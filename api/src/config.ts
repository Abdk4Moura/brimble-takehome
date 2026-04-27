export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  dataDir: process.env.DATA_DIR || "/data",
  buildsDir: process.env.BUILDS_DIR || "/data/builds",
  caddyAdmin: process.env.CADDY_ADMIN_URL || "http://caddy:2019",
  // Docker network the deployed containers join (defined in docker-compose.yml).
  // Caddy must be on the same network to reach them by name.
  deployNetwork: process.env.DEPLOY_NETWORK || "brimble-takehome_brimble-net",
  // Default port the deployed app listens on (set via PORT env in container).
  defaultAppPort: parseInt(process.env.DEFAULT_APP_PORT || "3000", 10),
  // Public URL prefix where users reach this stack (used for friendly URLs).
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:8080",
};
