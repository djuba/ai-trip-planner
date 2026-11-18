# The web-nextjs image (WU-23b; ADR 0005 §8). Build from the repo root, always for linux/amd64, with
# the API's URL, which Next inlines into the browser bundle at build time:
#   docker build --platform linux/amd64 -f apps/web-nextjs/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://<api-host> -t vp-web-nextjs .
# `pnpm test:image` builds it, checks it and checks the URL reached the bundle.
# The build context is an allowlist (Dockerfile.dockerignore beside this file, which BuildKit uses in
# place of the root .dockerignore). The URL is the only build argument, and it isn't a secret: it
# ends up in public JavaScript. The image holds no API key; the web app never has one (CLAUDE.md §9).

# node 24.22.1 (matches .nvmrc), pinned by digest. Must equal backends/api-nextjs/Dockerfile's line
# (scripts/image/plan-image.test.ts checks); bump both together.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# Fail before any work if the URL is missing: a bundle without it throws in every browser.
ARG NEXT_PUBLIC_API_BASE_URL
RUN case "$NEXT_PUBLIC_API_BASE_URL" in \
      http://?*|https://?*) ;; \
      *) echo "NEXT_PUBLIC_API_BASE_URL must be set to the API's http(s) URL (--build-arg)" >&2; exit 1 ;; \
    esac

# Dependencies first, from the lockfile alone, so this layer is reused until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# Every workspace manifest, so the frozen install sees the workspace the lockfile describes; only
# web-nextjs and what it depends on are installed. Install scripts stay off, as for the API image.
COPY tsconfig.base.json ./
COPY backends/api-nextjs/package.json backends/api-nextjs/
COPY tests/contract/package.json tests/contract/
COPY tests/journeys/package.json tests/journeys/
COPY packages/domain-schema packages/domain-schema
COPY spec/messages spec/messages
COPY apps/web-nextjs apps/web-nextjs
RUN pnpm install --offline --frozen-lockfile --ignore-scripts --filter "@vp/web-nextjs..."

# Standalone output only here; other builds keep `next start` working (next.config.mjs).
RUN NEXT_OUTPUT=standalone pnpm --filter @vp/web-nextjs build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# HOSTNAME: Docker sets it to the container ID, and Next's standalone server listens on it.
# PORT 8080 is Cloud Run's default.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

# Owned by root and read-only to the server's user. Standalone output leaves out the static assets;
# they go where its server looks for them.
COPY --from=build /repo/apps/web-nextjs/.next/standalone ./
COPY --from=build /repo/apps/web-nextjs/.next/static apps/web-nextjs/.next/static

USER node
EXPOSE 8080
CMD ["node", "apps/web-nextjs/server.js"]
