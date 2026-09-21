# syntax=docker/dockerfile:1
# Static host + same-origin API aggregator for the webui.
#
# Caddy serves the Svelte build from /srv and reverse-proxies `/agent.v1.*` to
# the agent over h2c, so the browser talks to its own origin for both the app
# and the RPC (no CORS, no domain entry). See Caddyfile.
ARG REGISTRY=forgejo.develop.10.199.64.20.nip.io
FROM ${REGISTRY}/abcp/caddy:2.11.4

COPY dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
