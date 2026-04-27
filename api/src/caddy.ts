import { config } from "./config.js";
import { listDeployments } from "./repo.js";

type Route = Record<string, unknown>;

function buildConfig(): Record<string, unknown> {
  const deployRoutes: Route[] = listDeployments()
    .filter(
      (d) =>
        d.container_name &&
        d.port &&
        (d.status === "running" || d.status === "deploying"),
    )
    .map((d) => ({
      "@id": `deploy-${d.id}`,
      match: [{ path: [`/d/${d.id}/*`, `/d/${d.id}`] }],
      handle: [
        {
          handler: "rewrite",
          strip_path_prefix: `/d/${d.id}`,
        },
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: `${d.container_name}:${d.port}` }],
        },
      ],
    }));

  const routes: Route[] = [
    {
      match: [{ path: ["/api/*"] }],
      handle: [
        {
          handler: "reverse_proxy",
          // The API talks to itself for SSE; no buffering or transforms.
          upstreams: [{ dial: "api:3000" }],
          flush_interval: -1,
        },
      ],
    },
    ...deployRoutes,
    // Frontend catch-all comes last so deploy routes match first.
    {
      match: [{ path: ["/*"] }],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [{ dial: "frontend:80" }],
        },
      ],
    },
  ];

  return {
    admin: { listen: ":2019" },
    apps: {
      http: {
        servers: {
          srv0: {
            listen: [":80"],
            routes,
          },
        },
      },
    },
  };
}

export async function syncCaddy(): Promise<void> {
  const body = JSON.stringify(buildConfig());
  const url = `${config.caddyAdmin}/load`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`caddy /load failed: ${res.status} ${text}`);
  }
}

// Retry sync until Caddy admin is reachable. Used at startup.
export async function syncCaddyWithRetry(maxMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < maxMs) {
    try {
      await syncCaddy();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("caddy sync timed out");
}
