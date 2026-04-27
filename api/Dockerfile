FROM node:24-bookworm-slim

ARG RAILPACK_VERSION=0.23.0
ARG DOCKER_CLI_VERSION=27.3.1

# git: cloning git sources. docker CLI: docker-container:// transport for
# railpack/buildkit. ca-certificates: TLS for npm + railpack downloads.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
      -o /tmp/docker.tgz \
    && tar -xzf /tmp/docker.tgz -C /tmp \
    && mv /tmp/docker/docker /usr/local/bin/docker \
    && rm -rf /tmp/docker /tmp/docker.tgz

RUN curl -fsSL "https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
      -o /tmp/railpack.tgz \
    && mkdir -p /tmp/railpack \
    && tar -xzf /tmp/railpack.tgz -C /tmp/railpack \
    && find /tmp/railpack -type f -executable -name 'railpack*' -exec mv {} /usr/local/bin/railpack \; \
    && chmod +x /usr/local/bin/railpack \
    && rm -rf /tmp/railpack /tmp/railpack.tgz \
    && railpack --version

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    BUILDS_DIR=/data/builds

VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
