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

## Addendum: the environment as built (WU-21, 2026-11-13)

Decisions made while building the environment ([WU-21 plan](../plans/WU-21.md)); they refine §6 and §7.

- **Terraform owns the infrastructure; the deploy workflow owns only the image.** Terraform sets the service's scaling, timeout, probe, environment and identity, and ignores the running image. The workflow deploys a new image by digest and changes nothing else. So a deploy leaves `terraform plan` clean. Terraform is applied by hand from a developer machine, never from CI: applying it needs IAM admin over the project, far more than deploying an image does.
- **The deploy identity is scoped to resources, not the project.** It may push to the one Artifact Registry repository, deploy revisions of the one service (`run.developer`, which can't change who may invoke it), and act as the runtime service account only. The Workload Identity provider admits a GitHub token only if its repository ID (numeric, so a renamed or re-created repository can't match), its ref (`refs/heads/main`) and its `workflow_ref` (`deploy.yml` on `main`) all match exactly. One extra ref can be admitted temporarily, through a Terraform variable, to prove a workflow change before merge.
- **The runtime service account has no roles** in replay mode. In live mode (WU-23) it reads the one API key secret, and then the deploy identity can reach that key too, by deploying an image that runs as the runtime account. That is accepted for a demo (the key's workspace has a hard spend limit) and noted for WU-23.
- **The service is public but unadvertised.** `allUsers` may invoke it, so the contract suite and later the browser can reach it. In replay mode a call costs nothing beyond the Cloud Run free tier, and one instance caps compute.
- **The environment's identifiers stay out of the repository.** The project ID, billing account and state bucket are in git-ignored files, and the deploy workflow reads them from three GitHub Actions secrets. None of them is a credential. They're secrets only because GitHub masks secrets in every log line, and the repository's Actions logs are public: a plain variable is printed once, and the service URL can be derived from the project number. So "CI stores no secrets" now reads "CI stores no credentials".

### Considered after acceptance: Cloudflare (2026-11-13)

Cloudflare was suggested as a host after this ADR was accepted. §2's comparison didn't include it (only Cloudflare Access, for §5). Checked on 2026-11-13; Cloudflare's offerings change quickly, so recheck before relying on this.

- **Workers** (V8 isolates, not containers) would run the API only through the OpenNext adapter, in a partial Node.js environment with no filesystem: the cassettes would have to move into the bundle or into KV/R2 storage. The free plan caps a Worker at 3 MiB and 10 ms of CPU per request; the paid plan ($5 a month) raises that to 10 MiB and 30 s. The WU-20 image, which CI proves conforms, wouldn't be what ships.
- **Containers** would run the WU-20 image unchanged. It's generally available, but only on the Workers Paid plan ($5 a month, about the hosting budget on its own), behind a Worker and a Durable Object per container.
- **Deploy credentials:** Cloudflare doesn't support OIDC federation for GitHub Actions. Deploying from CI needs a Cloudflare API token stored as a GitHub secret, which is the long-lived credential §6 rules out. The token-free route, Workers Builds, builds on Cloudflare's side through its GitHub App, so the CI pipeline that deploys and checks the image would no longer be ours.
- **Strengths:** a global edge network, with DDoS protection and a WAF included.

**Decision: keep Cloud Run.** Cloudflare's strengths fit best **in front of** it: a custom domain on Cloudflare, proxied to the Cloud Run service, adds the edge, DDoS protection and WAF cheaply ("If this became a product"), and makes Cloudflare Access workable after all, since §5 rejected it mainly for lack of a domain. That's the route for the custom-domain Backlog item.

## Addendum: the access gate as built (WU-22, 2026-11-13)

Decisions made while building §5's invite codes ([WU-22 plan](../plans/WU-22.md), [`access-gate.md`](../features/access-gate.md)). They refine §4 and §5.

- **The server holds hashes, under labels.** `INVITE_CODES` lists `label:hash` entries: the hash is the SHA-256 of a random 256-bit code (`pnpm invite:new <label>`), and the label names the holder. A fast hash is enough, since there is nothing to guess; a leaked hash can't be used as a code. A presented code is compared with every entry in constant time. The code and its hash never appear in a log; the label does.
- **Revoked codes stay listed.** Revoking moves an entry to `REVOKED_INVITE_CODES`. The holder gets the same 401 as for an unknown code, but every later attempt is logged as `revoked` with the label, so a deactivated holder's behaviour stays visible. Revoking means re-applying Terraform; that's fine for a handful of holders.
- **A hard cap on each code's spend.** Each code has a lifetime quota per endpoint (defaults: 60 extracts, 3 recommends, 5 presents), an hourly window (30 requests) and a share of a global daily window (300 requests for all codes together). Request counts rather than metered tokens: with each stage's `maxOutputTokens` and the ADR 0004 caps, a count gives a guaranteed worst case per code (about $3 with WU-10's estimate), and a call can never overshoot it. A request one limit refuses consumes nothing from the others. A spent quota is `429 QUOTA_EXHAUSTED` with no `Retry-After`, so a client can say the invite is used up.
- **The counts must persist before live mode.** The first store is in memory. It is correct only because of §4's single instance, and it resets whenever the service scales to zero or redeploys, so it can't cap anything over time. A hosted server therefore refuses `LLM_MODE=live` with it; WU-23 adds a persistent store (Firestore, within its free tier). A hosted server also refuses, in every mode, the two codes committed to the repository (the local dev code and the test code), and `terraform plan` rejects them too. Live and record mode refuse to start with no codes anywhere. Every server counts as hosted unless it opts in with `LOCAL_DEV=true` (which `.env.example` and the tests set), so a host nobody planned for gets the strict rules; detecting the platform instead would fail open. With the opt-in, live and record accept the committed codes and the memory store, with a startup warning, because on a developer's machine the only caller is the developer; `pnpm dev` listens on `127.0.0.1` only. Cloud Run refuses the opt-in (`K_SERVICE` is set in every container), and the contract runs and `pnpm test:image` run the server without it, as hosted.
- **The post-deploy contract check has its own code.** It is a fourth Actions secret, `CONTRACT_INVITE_CODE`, readable only by the contract test step; its entry is in the service's `invite_codes`. Unlike the other three secrets it is a credential, but in replay mode it can spend nothing. Before going live, WU-23 drops it or caps it tightly, because every deploy's contract run would then call the model. *Rejected:* a manual check after each deploy, which loses the automatic proof that WU-21 built.
- **An invite link may end up in logs.** A code in a URL (`?invite=<code>`, WU-13) can reach browser history, proxies and request logs. This threat model accepts that: a code is per holder, revocable and capped, and the provider's spend limit bounds the rest.
- **A local switch, `ACCESS_GATE=off`.** It turns the gate off entirely, so a developer can demo locally, even in live mode, with no code and no usage store. It needs `LOCAL_DEV=true`, which Cloud Run refuses, so a hosted service can't run ungated even by mistake; `service.tf` sets neither (a test checks), and the tests always run with the gate on. A web client should therefore ask for a code only after a 401, never up front.
- **No per-IP limit on failed attempts.** Guessing a 256-bit code is hopeless, and limiting by IP behind Cloud Run's front end would need rules for trusting `X-Forwarded-For` for no real gain.

## Addendum: ready for live mode (WU-23a, 2026-11-17)

Decisions made while preparing the API for live mode ([WU-23a plan](../plans/WU-23a.md), [`access-gate.md`](../features/access-gate.md)). WU-23 was split in three at its start: WU-23a (this), WU-23b (the web service and the live-release workflow) and WU-23c (the launch). They refine §4 and §5 and the WU-22 addendum.

- **Usage counts persist in Firestore**, the "persistent store" the WU-22 addendum requires before live mode. Each counter is one document in the default database; a request reads its three counters and, if allowed, writes them back in one commit whose writes each carry a precondition. A concurrent writer makes the commit fail, and the store reads again, so no counter passes its limit even if two instances overlap (a deploy, or §4's limit raised later). The store talks to Firestore's REST API with `fetch`, not Google's SDK: two calls don't justify a gRPC and protobuf dependency tree in the image and in `pnpm audit`. The price is a small client of our own, which an emulator test in CI's `image` job checks against real Firestore. A store failure refuses the request (500): nothing is ever served uncounted. *Accepted:* each instance handles takes one at a time, so while Firestore is slow or failing, requests queue behind each other's 5-second timeouts. Only conflicts are retried, and a demo's traffic rarely queues; a deadline per take is the fix if that changes.
- **Each code can carry its own limits.** An entry may end in options: a per-endpoint lifetime quota (or none), an hourly window and an expiry date. They are set by `pnpm invite:new` flags and edited in `terraform.tfvars` without reissuing the code; counts are kept by label, so a raised limit adds to what is left. The global daily window applies to every code. This makes the owner's code (no lifetime quota) possible, and lets a recipient be given more without a new code.
- **Invite entries stay in Terraform, not Secret Manager.** WU-23's scope said the invite codes would be added to Secret Manager by hand, so they never reach Terraform state. That predates the WU-22 addendum, under which the server holds only `label:hash` entries; a hash can't be used as a code, so the entries aren't secrets. They stay in the git-ignored `terraform.tfvars`, which keeps issuing a code to one edit and an apply, and keeps the plan-time checks on entries. *Accepted:* the entries are in Terraform state (a private bucket) and in the service's configuration, which the deploy identity can read; labels name holders, so the runbook suggests opaque labels where that matters. The API key, the one real secret, goes to Secret Manager in WU-23c.
- **The post-deploy contract check authenticates with an ID token**, replacing the `CONTRACT_INVITE_CODE` secret the WU-22 addendum introduced. The deploy workflow mints a Google ID token of its own service account (one role: OpenID Connect Identity Token Creator on that account), with a fixed audience (`ai-trip-planner-api`), valid for an hour and masked in the public log. The gate verifies it with `jose` against Google's published keys: RS256 only, Google's issuer, the audience, expiry, a verified email on the `TRUSTED_SERVICE_ACCOUNTS` allowlist. A trusted account has no quota or hourly window, but counts toward the global daily window. So GitHub stores no credential for the API either, and a leaked log yields nothing usable. *Rejected:* a capped invite code in a secret (a long-lived credential), and writing the JWT checks ourselves on WebCrypto (security code to own, where `jose` has no dependencies).
- **An alert on refusals of known holders.** A Cloud Monitoring log-match alert emails when the gate logs `revoked`, `expired`, `quota_exhausted` or `rate_limited`, at most once per 5 minutes. A full hourly window is the threshold for "unusual volume", so no separate per-label metric is needed. `unknown` and `missing` don't alert, since anything scanning the URL produces them.
- **Logs never carry what a user typed, a code, a hash or a token.** A functional test sends a full session and an upstream failure through the built server and checks its output; unhandled errors are logged as name and stack only, because some provider errors carry the request body.

## Addendum: the web service and automated promotion (WU-23b, 2026-11-17)

Decisions made while hosting the web client and settling how changes reach the services users see ([WU-23b plan](../plans/WU-23b.md)). They refine §1, §6 and §8, and the WU-21 addendum.

- **The web image, as §8 planned.** `apps/web-nextjs/Dockerfile` follows the API's pattern (the same pinned Node image, Next's standalone output, a non-root user) with `NEXT_PUBLIC_API_BASE_URL` as its one, required, build argument. Its build context has its own allowlist beside the Dockerfile (`Dockerfile.dockerignore`), so the web build never sees the cassettes and the API build never sees the web sources. The web service has no environment, no secret and a role-less runtime account. The API's `WEB_ORIGIN` is the web service's URL, set by Terraform. `pnpm test:image` checks both images, including that the URL reached the bundle.
- **Merges are checked on a replay twin.** A second API service, `api-replay`, runs the same image, always in replay mode, with the memory usage store and no invite codes; only the CI identity's ID token is trusted. Every merge's provider contract suite runs there. So the check that WU-21 built keeps proving the platform (OIDC, ID tokens, CORS with the real web origin, streaming, cold starts) on every merge, and never calls the model, even once the user-facing API is live. This refines §1: still one environment that users see, plus a replay copy that only CI calls, at no cost. *Rejected:* the contract suite against the live service (it would pay for model calls on every merge, eat the global daily window, and fail, since live output isn't the cassettes'); candidate-tag revisions of the live service (a candidate of a live service runs live unless each revision overrides `LLM_MODE`, which changes the service's template on every deploy and means the promoted revision isn't the one checked).
- **Promotion is automatic.** A merge's pipeline builds both images, runs the contract suite on the twin and `pnpm verify:integrated` (journeys, replay, no cloud access), and only when both pass deploys the same digests to the API and then the web service. A model-free smoke check follows (health, the CORS preflight from the web origin, a 401 without a code, the web page and its bundle's API URL); if it or a deploy fails, both services go back to the images that were running, and the run fails. *Considered and replaced:* WU-23b was scoped with a manual release that the owner approves in a GitHub Environment. The owner chose full automation: the checks are the gate, and a reviewer can be added to the Environment later with no other change.
- **Two deploy identities.** Deploying a revision needs permission to act as its runtime account, and from WU-23c the API's runtime account reads the API key. So the job that deploys the user-facing services must not run third-party code. The **build identity** (the existing deploy account) pushes images, deploys the twin, acts as the twin's role-less runtime account, reads the API's URL, and mints the contract check's ID token; it can no longer deploy the API or act as its runtime account. The **promote identity** deploys the API and web services and acts as their runtime accounts, and nothing else. Workload Identity Federation maps each token to one of them by its `environment` claim: only a `deploy.yml` job in the Environment `live` can become the promote identity, and that job installs no dependency and builds nothing (it runs `gcloud` and a smoke script on Node built-ins). A compromised package or action in the build can't deploy as that account itself; it can only push a bad image, which must still pass the contract suite and the journeys. *Accepted:* an image built to pass those checks would still ship, so the split narrows the path to the key rather than closing it; the Anthropic spend limit (WU-23c) and the gate's alerts bound what follows. This replaces the WU-21 addendum's acceptance that the deploy identity can reach the key. *Rejected:* one identity for everything, bounded only by the Anthropic spend limit.
- **Digests, not tags.** The promote job deploys the digests the build job output, never a tag, so an image pushed between the check and the promotion can't slip in.
