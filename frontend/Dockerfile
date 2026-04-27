FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# Tiny static server for the SPA. The ingress Caddy fronts it, so we don't
# need TLS or compression here, just serve files.
FROM caddy:2.8-alpine AS serve
COPY --from=build /app/dist /srv
RUN printf ':80 {\n\troot * /srv\n\tencode gzip\n\ttry_files {path} /index.html\n\tfile_server\n}\n' > /etc/caddy/Caddyfile
EXPOSE 80
