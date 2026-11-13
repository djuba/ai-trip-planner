# The api-nextjs image (WU-20; ADR 0005). Build from the repo root, always for linux/amd64 (the
# platform comes from the build command, not FROM, which BuildKit warns against):
#   docker build --platform linux/amd64 -f backends/api-nextjs/Dockerfile -t vp-api-nextjs .
# `pnpm test:image` builds it, checks it and runs the provider contract tests against it.
# The build context is an allowlist (/.dockerignore), and no ARG or ENV holds a secret: an API key
# is supplied only at run time, and only for LLM_MODE=live or record.

# node 24.22.1 (matches .nvmrc), pinned by digest. Bump the tag and digest together.
ARG NODE_IMAGE=node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

# Dependencies first, from the lockfile alone, so this layer is reused until the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# Every workspace manifest, so the frozen install sees the workspace the lockfile describes; only
# api-nextjs and what it depends on are installed. Install scripts stay off: lefthook's `prepare`
# needs .git, and nothing the backend uses needs a build step.
COPY tsconfig.base.json ./
COPY apps/web-nextjs/package.json apps/web-nextjs/
COPY tests/contract/package.json tests/contract/
COPY tests/journeys/package.json tests/journeys/
COPY packages/domain-schema packages/domain-schema
COPY backends/api-nextjs backends/api-nextjs
RUN pnpm install --offline --frozen-lockfile --ignore-scripts --filter "@vp/api-nextjs..."

# Standalone output only here; other builds keep `next start` working (next.config.mjs).
RUN NEXT_OUTPUT=standalone pnpm --filter @vp/api-nextjs build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# HOSTNAME: Docker sets it to the container ID, and Next's standalone server listens on it.
# PORT 8080 is Cloud Run's default (WU-21).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080 \
    LLM_CASSETTE_DIR=/app/.llm-cassettes/api-nextjs
# Defaults: replay mode needs no key and costs nothing. Override any of them at run time.
# scripts/image/plan-image.test.ts keeps the model IDs equal to .env.example (CLAUDE.md §8.1).
ENV LLM_MODE=replay
ENV MODEL_FAST=claude-haiku-5-5
ENV MODEL_REASONING=claude-sonnet-5-5
ENV MODEL_CRITIC=claude-sonnet-5-5

# Owned by root and read-only to the server's user. The cassettes are public in the repo already.
COPY --from=build /repo/backends/api-nextjs/.next/standalone ./
COPY .llm-cassettes/api-nextjs .llm-cassettes/api-nextjs

USER node
EXPOSE 8080
CMD ["node", "backends/api-nextjs/server.js"]
