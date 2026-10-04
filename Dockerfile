# syntax=docker/dockerfile:1
# Self-contained static host + same-origin API aggregator for the webui.
#
# The vite+PWA build runs INSIDE the image (stage `build`), so the repo tree
# alone is enough to build — no prebuilt `dist/` is required, which is what
# `repo-build-image` (build straight from the repo) needs. Caddy then serves
# `/srv` and reverse-proxies `/agent.v1.*` + `/workspace.v1.*` to the workspace
# gateway over h2c, so the browser talks to its own origin for both the app and
# the RPC (no CORS, no domain entry). See Caddyfile.
ARG REGISTRY=git.agent.svc.cluster.local
ARG NODE_IMAGE=${REGISTRY}/root/node:26-alpine
ARG CADDY_IMAGE=${REGISTRY}/abcp/caddy:2.11.4

# ---- build (vite + PWA -> /src/dist) ----
FROM ${NODE_IMAGE} AS build
WORKDIR /src
# npm comes from the in-cluster artifact mirror (proxy.golang/npm are NOT
# reachable from the cluster, so public egress would make the build fail).
RUN npm config set registry http://artifact.worker.svc.cluster.local/artifacts/npm/ \
 && npm config set strict-ssl false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run build

# ---- runtime (Caddy static host + h2c gateway proxy) ----
FROM ${CADDY_IMAGE}
COPY --from=build /src/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
