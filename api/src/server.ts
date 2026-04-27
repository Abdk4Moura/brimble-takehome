import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import {
  createDeployment,
  getDeployment,
  listDeployments,
  patchDeployment,
  removeDeployment,
} from "./repo.js";
import { runPipeline } from "./pipeline.js";
import { streamLogs } from "./sse.js";
import { reconcile } from "./reconcile.js";
import { syncCaddyWithRetry, syncCaddy } from "./caddy.js";
import Docker from "dockerode";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB tarball cap
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/deployments", async () => {
  return listDeployments();
});

app.get<{ Params: { id: string } }>(
  "/api/deployments/:id",
  async (req, reply) => {
    const d = getDeployment(req.params.id);
    if (!d) {
      reply.status(404);
      return { error: "not found" };
    }
    return d;
  },
);

app.post("/api/deployments", async (req, reply) => {
  const contentType = req.headers["content-type"] || "";

  if (contentType.includes("multipart/form-data")) {
    let gitUrl: string | undefined;
    let name: string | undefined;
    let uploadPath: string | undefined;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        await mkdir(config.buildsDir, { recursive: true });
        uploadPath = join(
          config.buildsDir,
          `upload-${Date.now()}-${part.filename}`,
        );
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        await writeFile(uploadPath, Buffer.concat(chunks));
      } else {
        if (part.fieldname === "gitUrl") gitUrl = String(part.value);
        if (part.fieldname === "name") name = String(part.value);
      }
    }

    if (uploadPath) {
      const dep = createDeployment({
        name: name ?? "upload",
        sourceType: "upload",
        sourceRef: uploadPath,
      });
      runPipeline(dep.id);
      return dep;
    }
    if (gitUrl) {
      const dep = createDeployment({
        name: name ?? deriveNameFromGit(gitUrl),
        sourceType: "git",
        sourceRef: gitUrl,
      });
      runPipeline(dep.id);
      return dep;
    }
    reply.status(400);
    return { error: "expected gitUrl field or uploaded file" };
  }

  const body = (req.body ?? {}) as { gitUrl?: string; name?: string };
  if (!body.gitUrl) {
    reply.status(400);
    return { error: "gitUrl required" };
  }
  const dep = createDeployment({
    name: body.name ?? deriveNameFromGit(body.gitUrl),
    sourceType: "git",
    sourceRef: body.gitUrl,
  });
  runPipeline(dep.id);
  return dep;
});

app.post<{ Params: { id: string } }>(
  "/api/deployments/:id/redeploy",
  async (req, reply) => {
    const d = getDeployment(req.params.id);
    if (!d) {
      reply.status(404);
      return { error: "not found" };
    }
    patchDeployment(d.id, { status: "pending", error: null as never });
    runPipeline(d.id);
    return getDeployment(d.id);
  },
);

app.delete<{ Params: { id: string } }>(
  "/api/deployments/:id",
  async (req, reply) => {
    const d = getDeployment(req.params.id);
    if (!d) {
      reply.status(404);
      return { error: "not found" };
    }
    if (d.container_name) {
      try {
        const c = docker.getContainer(d.container_name);
        await c.stop({ t: 5 }).catch(() => {});
        await c.remove({ force: true }).catch(() => {});
      } catch {
        // best effort
      }
    }
    removeDeployment(d.id);
    await syncCaddy().catch(() => {});
    return { ok: true };
  },
);

app.get<{ Params: { id: string } }>(
  "/api/deployments/:id/logs",
  async (req, reply) => {
    const d = getDeployment(req.params.id);
    if (!d) {
      reply.status(404);
      return { error: "not found" };
    }
    await streamLogs(req, reply, d.id);
  },
);

function deriveNameFromGit(url: string): string {
  const last = url.split("/").pop() || "deployment";
  return last.replace(/\.git$/, "");
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`api listening on ${config.host}:${config.port}`);

// Reconcile DB ↔ Docker state, then push the resulting Caddy config.
await reconcile().catch((err) => app.log.error({ err }, "reconcile failed"));
await syncCaddyWithRetry().catch((err) =>
  app.log.error({ err }, "initial caddy sync failed"),
);
app.log.info("caddy synced");
