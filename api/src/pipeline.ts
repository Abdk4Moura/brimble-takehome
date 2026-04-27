import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import Docker from "dockerode";
import * as tarStream from "tar-stream";
import { createGunzip } from "node:zlib";
import { config } from "./config.js";
import { getDeployment, patchDeployment } from "./repo.js";
import type { Deployment } from "./db.js";
import { LogSink } from "./log-sink.js";
import { emitStatus } from "./events.js";
import { syncCaddy } from "./caddy.js";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export async function runPipeline(deploymentId: string) {
  const sink = new LogSink(deploymentId, "build");
  try {
    const dep = getDeployment(deploymentId);
    if (!dep) throw new Error(`deployment ${deploymentId} not found`);

    setStatus(deploymentId, "building");
    sink.system(`pipeline started for ${dep.name} (${dep.id})`);

    const sourceDir = join(config.buildsDir, deploymentId);
    await rm(sourceDir, { recursive: true, force: true });
    await mkdir(sourceDir, { recursive: true });

    if (dep.source_type === "git") {
      sink.system(`cloning ${dep.source_ref}`);
      await spawnToSink(sink, "git", [
        "clone",
        "--depth",
        "1",
        dep.source_ref,
        sourceDir,
      ]);
    } else {
      sink.system(`extracting upload ${dep.source_ref}`);
      await extractTarGz(dep.source_ref, sourceDir);
    }

    const imageTag = `brimble-deploy/${dep.id}:latest`;
    sink.system(`railpack build --name ${imageTag} ${sourceDir}`);
    await spawnToSink(sink, "railpack", [
      "build",
      "--name",
      imageTag,
      "--progress",
      "plain",
      sourceDir,
    ]);
    patchDeployment(deploymentId, { image_tag: imageTag });

    setStatus(deploymentId, "deploying");
    sink.system(`starting container from ${imageTag}`);

    const containerName = `brimble-deploy-${dep.id}`;
    await stopAndRemoveIfExists(containerName, sink);

    const port = config.defaultAppPort;
    const container = await docker.createContainer({
      name: containerName,
      Image: imageTag,
      Env: [`PORT=${port}`, `HOSTNAME=0.0.0.0`],
      Labels: {
        "brimble.deployment.id": dep.id,
        "brimble.deployment.name": dep.name,
      },
      HostConfig: {
        RestartPolicy: { Name: "unless-stopped" },
        NetworkMode: config.deployNetwork,
      },
    });
    await container.start();

    patchDeployment(deploymentId, {
      container_id: container.id,
      container_name: containerName,
      port,
      url: `${config.publicBaseUrl}/d/${dep.id}/`,
    });

    sink.system("syncing caddy routes");
    await syncCaddy();

    setStatus(deploymentId, "running");
    sink.system(`running at ${config.publicBaseUrl}/d/${dep.id}/`);

    // Stream container logs (run output) into the same log table so the UI
    // can show app output alongside build output.
    streamContainerLogs(deploymentId, container).catch((err) => {
      const runSink = new LogSink(deploymentId, "run");
      runSink.system(`log stream ended: ${(err as Error).message}`);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sink.system(`pipeline failed: ${message}`);
    patchDeployment(deploymentId, { status: "failed", error: message });
    emitStatus(deploymentId, "failed");
  } finally {
    sink.flush();
  }
}

function setStatus(id: string, status: Deployment["status"]) {
  patchDeployment(id, { status });
  emitStatus(id, status);
}

function spawnToSink(
  sink: LogSink,
  cmd: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: {
        ...process.env,
        // Don't let git prompt for credentials when a repo is missing.
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "echo",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout.on("data", (b) => sink.write(b, "info"));
    proc.stderr.on("data", (b) => sink.write(b, "info"));
    proc.on("error", reject);
    proc.on("close", (code) => {
      sink.flush();
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function extractTarGz(tarPath: string, destDir: string) {
  await new Promise<void>((resolve, reject) => {
    const extract = tarStream.extract();
    extract.on("entry", (header, stream, next) => {
      // Strip a single leading directory so uploads like `myapp/...` land
      // directly in destDir.
      const parts = header.name.split("/");
      const stripped = parts.slice(1).join("/") || header.name;
      const destPath = join(destDir, stripped);
      if (header.type === "directory") {
        mkdir(destPath, { recursive: true })
          .then(() => {
            stream.resume();
            stream.on("end", next);
          })
          .catch(next);
        return;
      }
      mkdir(join(destPath, ".."), { recursive: true })
        .then(async () => {
          const { createWriteStream } = await import("node:fs");
          const out = createWriteStream(destPath);
          stream.pipe(out);
          out.on("finish", () => next());
          out.on("error", next);
        })
        .catch(next);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    createReadStream(tarPath).pipe(createGunzip()).pipe(extract);
  });
}

async function stopAndRemoveIfExists(name: string, sink: LogSink) {
  try {
    const c = docker.getContainer(name);
    const info = await c.inspect();
    if (info.State.Running) {
      sink.system(`stopping existing container ${name}`);
      await c.stop({ t: 5 }).catch(() => {});
    }
    sink.system(`removing existing container ${name}`);
    await c.remove({ force: true }).catch(() => {});
  } catch {
    // not found — fine
  }
}

async function streamContainerLogs(
  deploymentId: string,
  container: Docker.Container,
) {
  const sink = new LogSink(deploymentId, "run");
  const stream = await container.logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 0,
  });
  // Docker multiplexes stdout/stderr in a 8-byte header frame format. dockerode
  // exposes demuxStream — we hand it two simple sinks.
  const stdout = {
    write: (b: Buffer) => {
      sink.write(b, "info");
      return true;
    },
  } as NodeJS.WritableStream;
  const stderr = {
    write: (b: Buffer) => {
      sink.write(b, "error");
      return true;
    },
  } as NodeJS.WritableStream;
  container.modem.demuxStream(stream, stdout, stderr);
  return new Promise<void>((resolve, reject) => {
    stream.on("end", () => {
      sink.flush();
      resolve();
    });
    stream.on("error", reject);
  });
}
