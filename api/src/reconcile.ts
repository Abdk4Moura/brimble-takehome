import Docker from "dockerode";
import { listDeployments, patchDeployment } from "./repo.js";
import { syncCaddy } from "./caddy.js";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// On boot, walk every deployment that the DB thinks is running and confirm
// the container is actually up. Anything missing gets marked stopped so the
// UI matches reality and Caddy doesn't get a dead upstream.
export async function reconcile() {
  const deployments = listDeployments();
  for (const d of deployments) {
    if (d.status !== "running" || !d.container_name) continue;
    try {
      const info = await docker.getContainer(d.container_name).inspect();
      if (!info.State.Running) {
        patchDeployment(d.id, {
          status: "stopped",
          error: "container not running at boot",
        });
      }
    } catch {
      patchDeployment(d.id, {
        status: "stopped",
        error: "container missing at boot",
      });
    }
  }
  await syncCaddy().catch(() => {
    // First sync can race with caddy startup; server.ts retries via syncCaddyWithRetry.
  });
}
