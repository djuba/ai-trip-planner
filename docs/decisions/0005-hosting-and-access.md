# ADR 0005 — Hosting and access

**Status:** accepted · **Date:** 2026-11-12 · **Work unit:** WU-20 · **Plan:** [WU-20](../plans/WU-20.md)

## Context

The app has to run somewhere other than a laptop, for two reasons:

- **1a. A portfolio piece.** It's linked from every job application. Most reviewers who look closely read the GitHub repo; a live demo is offered case by case, mostly around interviews.
- **1b. Learning and showing platform skills.** That means what a platform team usually provides: containers, infrastructure as code, CI that deploys without stored credentials, and cost controls.

**Threat model.** The server is stateless ([CLAUDE.md §5](../../CLAUDE.md#5-http-api-v1)). It stores no user data and has nothing to authorize. The risk worth controlling is **LLM spend and abuse of the live API**: someone who finds the URL can make us pay for model calls. What a call can yield is already limited, by structured output and the [ADR 0004](0004-input-and-output-limits.md) caps.

**Budget.** $5–10 a month in total. Hosting should cost about nothing (scale to zero, a free tier), so the budget goes to the LLM.

## Decision

### 1. One hosted environment, built early and launched late

There's one environment and no separate staging. It's built in WU-21 and runs in **replay mode** (no API key, no LLM cost), unadvertised, so every merge to `main` proves the deployment still works. WU-23 switches it to live mode for the demo, once the UI is complete.

### 2. Google Cloud Run, from a container image

Two stateless containers (the API, and later the web client) on a managed platform. **No Kubernetes:** it would add a control plane, node pools and manifests to get what Cloud Run gives here for free.

Checked on 2026-11-12; prices change, so recheck before relying on them.

| Option | Scale to zero | Idle cost | Fit |
|---|---|---|---|
| **GCP Cloud Run** (chosen) | Yes | $0: the monthly free tier (180,000 vCPU-seconds, 360,000 GiB-seconds, 2 million requests, for request-based billing) covers a demo's traffic | Streams responses; GitHub OIDC through Workload Identity Federation; Terraform provider is mature |
| AWS App Runner | No (idle instances bill for memory) | A few dollars a month | Closed to new customers since 2026-04-30; AWS points to ECS Express Mode instead |
| AWS ECS on Fargate (incl. Express Mode) | No | An Application Load Balancer bills hourly while idle (roughly $16+ a month) before any task runs | More to build (VPC, load balancer, service); the most transferable AWS skill set, but over budget |
| Fly.io | Yes (machines stop when idle) | Pay as you go; new organizations get a short trial, not a free allowance | Good fit technically; no free tier |
| Vercel | Yes | Free Hobby plan | Natural for Next.js, but the Hobby plan is for non-commercial use, and it hides the platform work that goal 1b is about |
| A VPS | No | About $5 a month | Cheapest fixed cost, but patching, TLS and process supervision are all ours, and nothing scales to zero |

The image runs anywhere that runs containers, so the choice can change later without touching the app.

### 3. The API is built as one container image, across all LLM modes

`backends/api-nextjs/Dockerfile` builds Next's standalone output on a pinned Node base image, runs as a non-root user, and holds no secrets. The build context is an allowlist (`.dockerignore`), so a stray `.env.local` or key file can't get in.

- **One image for every mode.** `LLM_MODE` and the model IDs are environment variables with safe defaults (replay, the CLAUDE.md §8.1 models). WU-21 runs it in replay mode; WU-23 sets `LLM_MODE=live` and supplies the key from the platform's secret store at run time.
- **The cassettes are baked in** at `LLM_CASSETTE_DIR`. They're already public in the repo, and they hold no keys or account identifiers (CLAUDE.md §8.2).
- **CI proves the image conforms.** The `image` job builds it, checks it doesn't run as root and holds no secret-looking variables or `.env` files, runs it in replay mode and runs the provider contract tests against it (`pnpm test:image`). That job is a required check; `pnpm verify` still needs no Docker.

### 4. `max instances = 1`

The service runs at most one instance. That caps compute spend, and it makes an in-memory rate limiter correct (WU-22): with one instance, its counters see every request. Concurrency within the instance handles a demo's traffic. If it ever needed more, the limiter would have to move to a shared store first.

### 5. Access: per-recipient invite codes, checked by the API

No user accounts. A product would likely need them (saved trips, history, billing). A portfolio demo doesn't, and a sign-up screen costs a reviewer's attention. Instead:

- **Invite codes (WU-22).** Each recipient gets their own code, which the API checks on every request, with a per-code rate limit. The server stores only each code's hash, so usage is visible per code and each code can be revoked.
- **A provider spend limit (WU-23).** The Anthropic workspace for this environment has a hard monthly limit. That bounds the worst case even if a code leaks.

Rejected: **Cloudflare Access** in front of the app. It needs a domain we control, and its login redirect is awkward for cross-origin `fetch` calls from the web app to the API (CORS preflights can't follow a login page).

**A later use: a closed beta.** Because codes are per recipient, the same gate can later admit a small pool of testers, with usage per code and each code revocable. It isn't scheduled (Backlog in `docs/work-breakdown.md`).

### 6. Deploys authenticate through OIDC; no stored cloud credentials

The WU-21 deploy workflow authenticates to Google Cloud through GitHub's OIDC token and Workload Identity Federation, limited to this repository. Its identity can only push images and deploy the service. No long-lived key exists in GitHub secrets or anywhere else. The `verify` and `image` jobs have no cloud access at all, and CI still stores no secrets.

### 7. Infrastructure as code: Terraform

The hosted resources (registry, service, service accounts, identity federation, budget alert) are Terraform in `infra/` (WU-21), for goal 1b. Bootstrapping the state bucket and the project is a documented manual step. GCP has no hard spend cap, so a billing budget alert is the early warning, and the Anthropic spend limit is the hard stop.

### 8. The web image is built for its environment

Next inlines `NEXT_PUBLIC_API_BASE_URL` into the client bundle when the web app is built, so the web image is built per environment, with the API URL as a build argument (WU-23). Tradeoff: the API image is promoted unchanged ("build once, deploy anywhere"), and the web image isn't. With one environment that costs nothing. Serving the URL at run time (a `/config` endpoint, or a placeholder substituted at startup) would fix it, at the cost of an extra request or a startup script, and isn't worth it yet.

### 9. Domain

A custom domain is optional. The default `*.run.app` URLs are fine to start, and CORS (`WEB_ORIGIN`) takes whatever origin the web service gets.

## Consequences

- The image is the artifact that ships, and every PR proves it passes the provider contract tests. The local project gate is unchanged.
- Hosting should cost about $0 a month; WU-21 records the real figure after a week.
- Docker is optional for local work: `pnpm test:image` needs it, `pnpm verify` doesn't. The image is built for `linux/amd64`.
- Moving clouds means rewriting `infra/` and the deploy workflow, not the app.

## If this became a product

- **User accounts** and real authorization, replacing invite codes (saved trips, history, billing).
- **More than one instance**, so the rate limiter moves to a shared store (e.g. Redis or Firestore).
- **Staging and production** as separate environments, each with its own Anthropic workspace and spend limit, and promotion of the same images between them (which would make decision 8 worth fixing).
- **A custom domain**, a WAF or Cloud Armor in front, and image vulnerability scanning in CI.
