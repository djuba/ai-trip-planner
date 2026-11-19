# WU-23b — Web service + live release workflow: plan

**Status:** approved (2026-11-17), revision 2, with the recommended answers · **Depends on:** WU-23a (done on `main`) · **Author:** main agent (Opus), 2026-11-17

**Review tier:** `sonnet` for the plan review (done, on revision 1) and the unit review (Q3)

## Decisions at approval

- **Revision 2 approved:** fully automated promotion after the twin check and the journeys; no human approval step.
- **Q1** the twin is `api-replay`. **Q2** a failure rolls back both services. **Q3** `sonnet` for the unit review.
- **Plan-review outcomes** (review ran on revision 1): #1, #3, #4, #5, #6 kept as written into revision 2 (D8's `rollout_wu23b`, the smoke check's bundle-URL case, AC-HOST-19's read-back, automatic rollback, the journeys job's setup and timeout); #2 moot (digests pass between jobs, D5).

## Revision 2 (2026-11-17, at your direction)

Revision 1 planned a manual release: merges deployed only a replay twin, and a `release.yml` you approved in a GitHub Environment promoted the images to the user-facing services. You chose **fully automated CI/CD** instead: a merge that passes every check deploys to the user-facing services with no human step. Merges still never pay for model calls, and no check is removed. What changed:
- D6 is now one automated pipeline in `deploy.yml`, ending in a `promote` job. There is no `release.yml`, and the Environment has no required reviewer.
- `verify:integrated` runs in that pipeline (revision 1's Q3 is settled).
- A failed smoke check rolls back to the previous images automatically.
- D7 keeps the separate identity, now for the `promote` job rather than for a human-approved release. The reason is supply-chain isolation, not approval (D7).
- The WU-23b entry in `docs/work-breakdown.md` changes with the plan commit: "live deploys go out only through a manual release that you approve" becomes "live deploys go out automatically when every check passes, through an identity only the promote step holds", and the Definition of done follows. ADR 0005's addendum records the choice and the manual option it replaced.

## 1. Goal & scope

**Goal:** the web client runs on Cloud Run next to the API, and every merge that passes the contract suite (on a replay twin) and the integrated journeys deploys both services automatically, with a model-free smoke check and automatic rollback. No merge pays for a model call, and only one narrow job can deploy as the account that will read the API key.

**In scope** (from the WU-23b entry, as revised, and the WU-12, WU-15, WU-21 and WU-23a Notes it takes):
- `apps/web-nextjs/Dockerfile` on the WU-20 pattern, with `NEXT_PUBLIC_API_BASE_URL` as a required build argument, and its own build-context allowlist. `pnpm test:image` builds and checks it too.
- The web service in `infra/`, and the API's `WEB_ORIGIN` set from it.
- A **replay twin** of the API (D4), where every merge's contract check runs, so the check never calls the model, even once `api` is live.
- The **automated pipeline** in `deploy.yml` (D6): build → twin check and journeys → promote → smoke → rollback on failure. A manual dispatch for re-promoting or rolling back by hand.
- A **promote identity** of its own (D7). ADR 0005 records the choice.
- ADR 0005 addendum, runbook (`infra/README.md`), CLAUDE.md §2, §3, §6.7.

**Out of scope:**
- `LLM_MODE=live`, the API key secret, the Anthropic workspace, the final limits, the README demo line: **WU-23c**. Both services still run in replay mode after this unit.
- A human approval step. The Environment `live` exists, so adding a required reviewer later is one setting (runbook).
- Candidate-tag deploys: the replay twin (D4) does that job without traffic splits or per-revision env overrides (recorded in the ADR).
- The journeys' `--image` mode (WU-15 D9): `pnpm test:image` proves both images; the pipeline's journeys run against `next start` builds, as locally.
- A custom domain (Backlog). Any HTTP contract change: `contractVersion` stays as it is (0.8.0; the plan first said 0.6.0, copied from WU-23a by mistake).

## 2. Approach & key decisions

**D1. The web image.** (WU-12 Note; ADR 0005 §3, §8)
- `apps/web-nextjs/Dockerfile`, two stages like the API's: the same pinned Node base image (same `ARG NODE_IMAGE` line, so both bump together; a test checks they match), `pnpm fetch`, a filtered offline install (`@vp/web-nextjs...`), then `NEXT_OUTPUT=standalone pnpm --filter @vp/web-nextjs build`. Runtime runs `node apps/web-nextjs/server.js` as `node`, on port 8080, `HOSTNAME=0.0.0.0`.
- `ARG NEXT_PUBLIC_API_BASE_URL` with no default; the build stage fails at once if it's empty or not `http(s)://…`, rather than shipping a bundle that throws `ConfigError` in every browser. It is the image's one build argument, and it isn't a secret (it ends up in public JS).
- `apps/web-nextjs/next.config.mjs` gains the same `NEXT_OUTPUT` toggle as the API's, so `next start` keeps working everywhere else.
- **Its own allowlist:** `apps/web-nextjs/Dockerfile.dockerignore`. BuildKit uses `<Dockerfile>.dockerignore` beside the Dockerfile in place of the root `.dockerignore`, so each image sees only what it needs: the web build gets `apps/web-nextjs/` (minus tests, reports, `.next`), `packages/domain-schema/`, `spec/messages/` (the catalog the web bundle imports) and the manifests, and never the cassettes or the backend. The root `.dockerignore` stays the API's, unchanged. *Rejected:* widening the root allowlist, which would put the web sources in the API's context and the cassettes in the web's.

**D2. `pnpm test:image` checks both images.** (WU-20 plan D5)
- `plan-image.ts` takes an image description (Dockerfile, tag, build args) instead of constants; the API path is unchanged.
- The web image gets AC-IMAGE-02/03's checks (non-root, no `.env*` file, no secret-looking config variable), then runs: `GET /` returns 200 HTML, and one of the `/_next/static/` scripts that page loads contains the build-argument URL (a sentinel, `https://api.image-test.invalid`), proving Next inlined it. The same bundle check is reused by the smoke check (D6).
- The CI `image` job's timeout goes from 20 to 30 minutes for the second build.

**D3. The web service.** (ADR 0005 §2, §8)
- `infra/web.tf`: a `web-runtime` service account with **no roles**, an Artifact Registry repository `web` (same cleanup policy as `api`), and `google_cloud_run_v2_service.web`: 0 to 1 instances, 1 CPU, 512 MiB, request-based billing, a startup probe on `/`, the placeholder image ignored after creation as for the API, and `allUsers` as invoker (it serves a public page; the API's gate does the access control).
- The web service has **no environment variables and no secrets**: everything it needs is in the image.
- The API's `WEB_ORIGIN` becomes `google_cloud_run_v2_service.web.uri`, and the `web_origin` variable is removed. No cycle: the web image needs the API's URL at build time, not in Terraform.

**D4. The contract check runs on a replay twin of the API.** (WU-23a Note on contract checks against live; WU-21 Note on candidate tags)
- `google_cloud_run_v2_service.api_replay` (`api-replay`): the same image and probe as `api`, always `LLM_MODE=replay`, `USAGE_STORE=memory` (WU-22 allows memory with replay on a hosted server), `TRUSTED_SERVICE_ACCOUNTS=ci-deploy:<build SA>`, no invite codes, `WEB_ORIGIN` = the real web origin. Its own runtime account, `api-replay-runtime`, with **no roles**. Public like `api`, unadvertised, one instance, scales to zero: it costs nothing.
- Both API services get their env from one Terraform `locals` map plus a per-service map (`dynamic "env"`), so the twin can't drift from `api` except where it must.
- Every merge's contract suite runs against the twin, with the ID token, as today. So the platform proof WU-21 built (OIDC, ID-token auth, CORS with the real web origin, streaming through the front end, cold starts) keeps running on every merge, and never calls the model, even once `api` is live. The twin's memory counts don't share `api`'s Firestore global daily window.
- `api` loses `TRUSTED_SERVICE_ACCOUNTS` once no CI step calls it with a token (after the rollout, D8).
- *Rejected:* **candidate tags on `api`** (`--no-traffic --tag candidate`): a candidate revision of a live service runs live, so the suite would call the model unless the revision overrides `LLM_MODE`, and then Terraform's view of the service changes with every deploy, and the promoted revision isn't the one checked. **The contract suite against live**: costs money per merge, eats the global daily window, and fails, since live output isn't the cassettes'. **No hosted check** (CI's `image` job only): loses the platform proof.
- This refines ADR 0005 §1: still one environment users see; the twin is a replay-only copy that only CI calls.

**D5. What gets promoted.** Exactly the images the run built and checked. `build` outputs the two digests as job outputs; `twin-check` deploys the API digest; `promote` deploys both digests from those outputs. Nothing re-reads a tag, so an overwritten tag can't slip in between check and deploy (plan review #2, now moot). The web image is built in `build` with `api`'s URL, read from Cloud Run.

**D6. The automated pipeline.** (WU-23b scope "Release trigger", as revised)
`deploy.yml`, on push to `main` and on `workflow_dispatch`. Concurrency group `deploy`, never cancelled, so runs promote in merge order. Jobs:

| Job | Needs | Identity | Does |
|---|---|---|---|
| `build` | — | build (D7) | install (before any credential, as today); read `api`'s URL; build and push both images tagged with the SHA; output their digests |
| `twin-check` | `build` | build | deploy the API digest to `api-replay`; mint the ID token; run the full provider contract suite against it |
| `journeys` | — | none (no `id-token` permission) | install, Playwright Chromium, `pnpm verify:integrated` (journeys `@smoke` + `@critical`, replay); timeout 25 min |
| `promote` | `build`, `twin-check`, `journeys` | promote (D7), `environment: live` | record the current `api` and `web` images; deploy `api`, then `web`, by digest; smoke check; on failure, redeploy the recorded images and fail the run |

- **Smoke check** (`scripts/release-smoke.ts`), model-free so it stays valid after WU-23c: `GET /v1/health` is 200 with a `contractVersion`; a CORS preflight from the web origin to `/v1/trip/extract` allows it and the `Authorization` header; `POST /v1/trip/extract` with no code is 401 with `WWW-Authenticate: Bearer`; the web service's `/` is 200 HTML **and its bundle contains `api`'s URL** (plan review #3). It reads both URLs from Cloud Run and masks them, as `deploy.yml` does today. It uses only Node built-ins, so `promote` runs it with no `pnpm install`. Its checks are pure functions over responses, unit-tested with an injected `fetch`.
- **Automatic rollback:** before deploying, `promote` records each service's current image digest (in the log, masked URLs aside). If either deploy or the smoke check fails, it redeploys both recorded digests and re-runs the smoke check; the run fails either way, so the merge shows red. API first on the way up means a web image never points at an older API than it was built against; on the way back both return to the last good pair.
- **Manual dispatch** (`workflow_dispatch`, optional input `sha`): with no input it is a normal run of the tip of `main`; with a SHA on `main` it rebuilds and re-runs the whole pipeline for that commit. That is the hand-driven redeploy and roll-forward path. The fast rollback stays `gcloud run services update --image <digest>` from the runbook.
- **Environment `live`**, with **no required reviewer** and deployment branches = `main` only. It exists so GitHub issues the promote identity's token only to that job (D7), and records a deployment history. Adding a reviewer later turns the pipeline into revision 1's approval flow with no other change (runbook).
- `pnpm verify:integrated` stays a local gate too; the pipeline makes it a check nobody can skip before users see a change. CLAUDE.md §6.7 says so.

**D7. The promote step gets its own identity.** (WU-21 Note, plan review #5)
- **Why, without a human approval:** a Cloud Run revision runs as a service account, and deploying one needs permission to act as that account. In WU-23c, `api-runtime` gets read access to the Anthropic key, so whoever can deploy as `api-runtime` can ship an image that reads the key. Today the job that holds that permission also runs `pnpm install`, a Docker build and several third-party actions. A compromised package or action there would run with a path to the key. Splitting the identities puts that permission only in `promote`, which runs no install and no build: checkout, `gcloud`, and a smoke script on Node built-ins. A compromised dependency could at worst push a bad image, which must still pass the contract suite and the journeys before `promote` deploys it.
- New service account `github-promote`. The WIF provider maps one new attribute, `attribute.deployer`, with a CEL expression on the token's claims: `promote` for `deploy.yml` on `main` **in environment `live`** (the `environment` claim exists only in jobs that name one), `build` for `deploy.yml` on `main` (or `extra_deploy_ref`) without an environment, `none` otherwise; the condition admits only `build` and `promote`. Each service account is bound to its own `principalSet …/attribute.deployer/<value>`, replacing today's binding to the whole repository.
- **Build identity (today's `github-deploy`):** push to the `api` and `web` repositories; `run.developer` on `api-replay` only; actAs `api-replay-runtime` only; `run.viewer` on `api` (its URL for the web build); the ID-token role on itself. Its grants on `api` (developer) and `api-runtime` (actAs) are removed after the rollout (D8). So once WU-23c gives `api-runtime` the key, **no job that installs dependencies can reach it.**
- **Promote identity (`github-promote`):** `run.developer` on `api` and `web`; actAs `api-runtime` and `web-runtime`. No registry role (Cloud Run's service agent pulls images), no ID-token role (the smoke check sends no credential).
- *Rejected:* one identity for everything (simpler, and defensible with WU-23c's spend limit as the bound, but a supply-chain compromise in `build` would reach the key). The split costs one service account, a few bindings and a job boundary the pipeline needs anyway.

**D8. Rollout without breaking `main`.** Everything is additive until the merge, and **nothing else merges to `main`** between step 1 and the merge's own run (as in WU-23a):
1. **On the branch, before the walk-through ends:** you apply Terraform with `extra_deploy_ref = refs/heads/scratch/wu-23b`. This adds the web repository and service, the twin, the promote identity, the new attribute and bindings, and the Environment branch rule for the scratch branch. It **keeps** today's repository-wide binding, the build identity's grants on `api` and `api-runtime`, and `api`'s `TRUSTED_SERVICE_ACCOUNTS` (plan review #1), so today's `deploy.yml` on `main` still works. You create the Environment `live` with `gh api` (deployment branches: `main` and the scratch branch).
2. A push to the scratch branch runs the new pipeline end to end: twin check, journeys, promote, smoke. Then a run with a deliberately failing smoke URL proves the rollback, and a run from a job without the environment proves the promote identity is refused (AC-HOST-13). I open the web URL in the browser pane with a fresh invite code and send a message, proving CORS across the real origins (the DoD).
3. **After the merge:** `main`'s run promotes. You remove `extra_deploy_ref`, the old binding, the build identity's `api` grants and `api`'s `TRUSTED_SERVICE_ACCOUNTS` (the transitional pieces sit behind one variable, `rollout_wu23b`, `true` in the code commits; you apply with it `false`, and the close commit removes the variable and the pieces), apply, and `terraform plan` is clean. The Environment drops the scratch branch, read back with `gh api` (plan review #4).
I prepare every command; you run the applies and the `gh api` settings (as in WU-21 to WU-23a).

## 3. File-by-file changes

| File | Change | Purpose |
|---|---|---|
| `apps/web-nextjs/Dockerfile` | create | D1 web image |
| `apps/web-nextjs/Dockerfile.dockerignore` | create | D1 the web build's allowlist |
| `apps/web-nextjs/next.config.mjs` | modify | `NEXT_OUTPUT=standalone` toggle |
| `scripts/image/plan-image.ts` (+ `.test.ts`) | modify | D2 two image descriptions; web checks; Dockerfile assertions; the bundle-URL check, shared with D6 |
| `scripts/test-image.ts` | modify | D2 build, check and run the web image |
| `.github/workflows/verify.yml` | modify | `image` job timeout 30 min |
| `infra/web.tf` | create | D3 web runtime SA, `web` repository, web service, public invoker |
| `infra/service.tf` | modify | D4 shared env locals; `api_replay` and its runtime SA; `WEB_ORIGIN` from the web service; `api`'s `TRUSTED_SERVICE_ACCOUNTS` behind `rollout_wu23b` |
| `infra/deploy-identity.tf` | modify | D7 `attribute.deployer`, promote SA, per-identity bindings and grants; D8 transitional ones behind `rollout_wu23b` |
| `infra/variables.tf`, `infra/outputs.tf`, `infra/terraform.tfvars.example` | modify | drop `web_origin`; add `rollout_wu23b`; outputs `gcp_promote_sa`, `web_url` |
| `.github/workflows/deploy.yml` | modify | D5, D6 the pipeline |
| `scripts/release-smoke.ts`, `scripts/release/smoke-checks.ts` (+ `.test.ts`) | create | D6 smoke check and its pure checks |
| `package.json` | modify | `release:smoke` script |
| `scripts/infra-config.test.ts` | modify | pin D3, D4, D6, D7 (§4) |
| `docs/decisions/0005-hosting-and-access.md` | modify | WU-23b addendum: web image as built, the twin, automated promotion (and the manual approval it replaced), the promote identity |
| `infra/README.md` | modify | files table, the pipeline, the Environment (and how to add a reviewer), rollback for both services, the rollout, the twin, the new secret, teardown |
| `CLAUDE.md` | modify | §2 layout (web Dockerfile), §3 `release:smoke`, §6.7 Deploy row (twin check, journeys, promote, rollback) |
| `docs/work-breakdown.md` | modify | plan commit: status and the revised WU-23b goal and DoD; close: Notes for WU-23c |

The pipeline needs one new Actions secret, `GCP_PROMOTE_SA` (an identifier, not a credential, like the other three).

## 4. Acceptance criteria → tests

> **Moved (2026-11-19):** these ACs now live in `docs/features/hosting.md` and `docs/features/container-image.md`, which are their source of truth. The table below is the plan as approved.

No user-facing feature, so the ACs live here, continuing WU-20's `AC-IMAGE` and WU-21's `AC-HOST` series.

| AC | Given / When / Then | Test | Layer |
|---|---|---|---|
| AC-IMAGE-05 | Given a clean checkout and an API URL, when the web image is built, then it builds; without the argument the Dockerfile refuses | `pnpm test:image` (CI `image` job); Dockerfile assertion in `plan-image.test.ts` | Image + unit |
| AC-IMAGE-06 | Given the web image, then it runs as non-root, with no `.env*` file and no secret-looking variable | `pnpm test:image`; `plan-image.test.ts` | Image + unit |
| AC-IMAGE-07 | Given the running web image, when `/` is fetched, then it is 200 HTML and its bundle contains the build-argument URL | `pnpm test:image` | Image |
| AC-IMAGE-08 | Given both Dockerfiles, then they use the same pinned Node image, and the web build context excludes the cassettes and the backend | `plan-image.test.ts` | Unit |
| AC-HOST-10 | Given the infra, then the web service has no env, no secret and a role-less runtime account, and the API's `WEB_ORIGIN` is the web service's URI | `infra-config.test.ts` | Unit |
| AC-HOST-11 | Given the twin, then it runs replay with the memory store and trusts only `ci-deploy`, its runtime account has no role, and it shares `api`'s env except those keys | `infra-config.test.ts` | Unit |
| AC-HOST-12 | Given a merge, then the contract suite runs against `api-replay` only, and passes | `infra-config.test.ts`; scratch and `main` runs | Unit + deployment |
| AC-HOST-13 | Given the identities, then the build identity can't deploy `api` or act as `api-runtime` (after rollout), and only a `deploy.yml` job in environment `live` maps to the promote identity | `infra-config.test.ts` (bindings, CEL); a scratch run of the promote steps without the environment fails at `auth` (recorded) | Unit + infra |
| AC-HOST-14 | Given `deploy.yml`, then `promote` needs `twin-check` and `journeys`, uses environment `live`, deploys the digests `build` output (never a tag), and runs no `pnpm install`; `journeys` has no `id-token` permission | `infra-config.test.ts` | Unit |
| AC-HOST-15 | Given a failing check (contract suite or journeys), then `promote` doesn't run and the user-facing services are unchanged | scratch run (recorded) | Deployment |
| AC-HOST-16 | Given a promotion, when the smoke check runs, then health, the CORS preflight from the web origin, the 401, the web page and its bundle's API URL all pass; each failing case is reported | `smoke-checks.test.ts`; scratch run | Unit + deployment |
| AC-HOST-17 | Given a failing smoke check, then `promote` redeploys the previous images of both services, the smoke check passes on them, and the run fails | scratch run (recorded) | Deployment |
| AC-HOST-18 | Given a person opens the web URL with an invite code and sends a message, then the health badge shows the API, the gate accepts the code, and the request ends in the recoverable error state (a typed message has no replay cassette, so the model call is a 502) | manual, in the browser pane, recorded in deviations | Manual |
| AC-HOST-19 | Given the rollout, then `terraform plan` is clean on `main`, no service account has a user-managed key, and the Environment allows `main` only (`gh api` read-back recorded) | local, recorded | Infra |

AC-HOST-18: as WU-21's plan says, no typed message can hit a cassette (the key hashes `referenceDate` and the whole conversation), so the manual check proves the browser reaches the API cross-origin with a code. The full UI flow on Cloud Run is WU-23c's launch checklist, in live mode.

## 5. Task list

| Task | Owner | Files | Done when (proof) | Deps |
|---|---|---|---|---|
| **T1** Web image (D1) | Opus (build-context and standalone details; debugging likely) | `apps/web-nextjs/Dockerfile`, `Dockerfile.dockerignore`, `next.config.mjs` | `docker build --platform linux/amd64 -f apps/web-nextjs/Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.image-test.invalid .` succeeds; the container serves `/` | — |
| **T2** `test:image` for both images (D2) | Sonnet (mechanical, specified here) | `scripts/image/plan-image.ts` (+ test), `scripts/test-image.ts`, `.github/workflows/verify.yml` | `pnpm test:image` green locally (both images); `pnpm test:unit` green | T1 |
| **T3** Terraform (D3, D4, D7, D8) | Opus (IAM and CEL design) | `infra/web.tf`, `service.tf`, `deploy-identity.tf`, `variables.tf`, `outputs.tf`, `terraform.tfvars.example` | `terraform fmt -check`, `terraform validate`; your `terraform plan` reviewed | — |
| **T4** Smoke checks (D6) | Sonnet (pure functions + script on Node built-ins, specified here) | `scripts/release/smoke-checks.ts` (+ test), `scripts/release-smoke.ts`, `package.json` | `pnpm test:unit` green; AC-HOST-16 cases | T2 (bundle check) |
| **T5** Pipeline (D5, D6) | Opus (security-sensitive YAML, masking, rollback) | `.github/workflows/deploy.yml` | `infra-config.test.ts` green; scratch runs (T8). Includes the `journeys` job's Playwright install and timeout (plan review #6) | T3, T4 |
| **T6** Config tests | Opus (pins T3/T5 details) | `scripts/infra-config.test.ts` | `pnpm test:unit` green | T3, T5 |
| **T7** Docs | Opus (ADR, CLAUDE.md) | ADR 0005, `infra/README.md`, `CLAUDE.md` | `pnpm verify` (docs-links, format) | T3, T5 |
| **T8** Verify and scratch proof (D8 steps 1–2) | Opus, with your applies | — | `pnpm verify` green; scratch pipeline green; AC-HOST-13/15/17/18 recorded | all |

T1 and T3 run in parallel (different files). T2 follows T1, then T4 follows T2 (it reuses T2's bundle check), both with `wu-implementer`.

## 6. Risks & open questions

**R1. Two URLs per service.** Cloud Run gives each service a deterministic URL and a legacy one, and CORS allows one origin. `WEB_ORIGIN` is the Terraform `uri`; the runbook says to share only `terraform output web_url`. The smoke check's bundle test catches a web image built against the wrong API URL. Accepting both origins would need a list-valued `WEB_ORIGIN` (an API change); not worth it.

**R2. The WIF attribute CEL and the `environment` claim.** A typo makes the mapping `none`, and `auth` fails closed. Proven on the scratch branch, including the negative run (AC-HOST-13).

**R3. A web build in a filtered workspace.** `transpilePackages` and the catalog import from `spec/messages/` must resolve inside the container; the allowlist (D1) may need a path or two more. Found by T1's build.

**R4. Pipeline time.** A merge now builds two images and runs the journeys (in parallel with the build and twin check). Expect roughly 10–15 minutes to a promotion. Merges queue behind each other (concurrency, D6).

**R5. Auto-promotion reaches users with no human look.** That's the choice: the checks are the gate. The journeys, contract suite and smoke check cover the paths that matter, rollback undoes a bad deploy within the run, and adding a reviewer to `live` is one setting if that ever changes.

**R6. Rollback's own failure.** If redeploying the recorded images also fails, the run fails with both services possibly on the new images. The runbook's manual rollback by digest covers it, and the log lists the recorded digests.

**Questions** (my recommendation first):
- **Q1. The twin's name:** `api-replay` (says what it is), or `api-check`.
- **Q2. Rollback scope:** roll back both services whenever either deploy or the smoke check fails (as planned); or roll back only the service that failed (keeps a good API release when only the web fails, but can leave a mismatched pair).
- **Q3. Review tier:** `sonnet` (no contract, rule or `LlmClient` change); `opus` if you'd rather the IAM design get the stronger reviewer.

## 7. Expected commits

1. `docs(repo): add WU-23b plan` — the plan, `in-progress` status, the revised WU-23b goal and DoD.
2. `build(web): add the web image and check it in test:image` — T1, T2.
3. `feat(infra): host the web client and a replay twin of the API` — T3, the D3/D4 parts of T6.
4. `ci(infra): promote merges automatically after the twin and journeys` — T4, T5, the rest of T6, T7 (ADR, runbook, CLAUDE.md).
5. `docs(repo): close WU-23b` — also removes `rollout_wu23b` and the transitional grants once D8 step 3 is applied (or a `chore(infra)` commit just before it, if you'd rather keep the close commit docs-only).

Commits 3 and 4 may merge if the identity changes don't separate cleanly from the services. No split is required (no contract change).

## 8. Review tier

`sonnet` for both reviews: no contract, rule catalog or `LlmClient` change. The security-relevant part (D7's IAM) is small and proven by negative runs on the scratch branch. The plan review ran once, on revision 1; its findings are triaged against revision 2 in chat, and no second review runs unless you ask.

## Deviations during implementation

1. **The twin's env is explicit, not a shared `locals` map** (D4, not material). Planned: both API services take their env from one `locals` map through `dynamic "env"`. Done: the twin lives in its own file, `infra/replay.tf`, with explicit `env` blocks, and `infra-config.test.ts` (AC-HOST-11) requires its model IDs and `WEB_ORIGIN` to equal `api`'s. Why: `api`'s invite entries are sensitive variables, which can't drive a `dynamic` block's `for_each`; explicit blocks keep both files readable and parseable by the existing test helper, and the test gives the same no-drift guarantee.
2. **`api`'s trusted CI caller sits behind `rollout_wu23b`** (D8, as planned in substance): `TRUSTED_SERVICE_ACCOUNTS` and `ID_TOKEN_AUDIENCE` are one `dynamic "env"` block on `api`, present only while `rollout_wu23b` is `true`. The rollout-only IAM grants use `count` on the same variable, with `moved` blocks so the existing bindings keep their state and aren't recreated.
3. **The build job installs nothing on the runner** (D6, stronger than planned). Both images build inside Docker, so no `pnpm install` runs where the build identity's credential lives. Only `twin-check` installs (before its credential, as today) to run the contract suite.
4. **`findInBundle` throws on a non-200** (T2's choice), so a broken page is never read as "URL not found"; the smoke check turns the throw into a failed check.
5. **A dispatched SHA must be on `main`**: the build job checks it (`git merge-base --is-ancestor`) before anything else, since the WIF condition checks only the workflow's ref, not the commit checked out.
6. **`infra-config.test.ts` lands with the pipeline, not the Terraform** (commit boundaries, not material). The plan split T6 across commits 3 and 4, but each file lands in one commit, and this one also pins `deploy.yml`. So the Terraform commit's tests arrive in the next commit; only the branch tip is verified (CLAUDE.md §12).
7. **Unit-review fixes, all four approved and applied in commit 4.** (1) Every smoke request has a 10-second deadline (`AbortSignal.timeout`), and the deploy, smoke and rollback steps have their own timeouts inside a 30-minute job, so a hang fails a step and the rollback runs; a job timeout would have cancelled it. (2) The rollback also runs on a cancelled run. (3) A dispatched `sha` must be a full 40-character SHA. (4) The ADR addendum names the residual risk: an image built to pass the checks would still ship.
8. **The on-main check refused pushes** (fixed forward, `fix(infra): check only dispatched commits are on main`). Review fix #3 made the build job's "commit is on main" step run on every event, so the first scratch run stopped at `build` (nothing deployed; `journeys` passed). The step now runs only for a dispatch with a `sha`; pushes are already limited to `main` (and one scratch ref) by the identity condition. A test pins it.
9. **The promote identity needs to read the registry** (fixed forward, `fix(infra): let the promote identity read the images it deploys`; D7 was wrong). Revision 2 dropped revision 1's registry role on the assumption that Cloud Run's service agent pulls the image. `gcloud run services update` also checks that the deployer itself may download it, so the second scratch run's promote was refused, and its rollback too, leaving both services unchanged. The promote identity now has `artifactregistry.reader` on both repositories (never writer); applied by hand (2 added), and a test pins it.
10. **Scratch proof (D8 step 2), recorded.** Run 3 passed every job: build, the contract suite on the twin with the ID token, the journeys, promotion of both digests, and all five smoke checks (AC-HOST-12, -14, -16). `terraform plan` after the twin deploy showed no drift. Run 4 added two scratch-only changes: a wrong `WEB_ORIGIN` for the smoke step, so `corsPreflight` failed and the rollback redeployed the previous pair and passed its own smoke check (AC-HOST-17); and a job without the environment that asked for the promote identity and was refused (`iam.serviceAccounts.getAccessToken` denied; AC-HOST-13). Run 4's commit was made and pushed with `--no-verify`, with your approval for the push: its intended breakage fails AC-HOST-12, and the commit itself skipped the pre-commit hooks without asking first, which it shouldn't have. The scratch branch is deleted. Both services run run 3's images.
11. **Browser check (AC-HOST-18), partly.** On the web service's URL, in the browser pane: the badge read "API connected · contract 0.8.0", and a message sent with no code got a cross-origin 401 and the invite prompt, with no console errors. So the UI is served against the hosted API, and CORS works across the real origins (the DoD). The gate *accepting* a code wasn't checked: entering a code on a hosted page is yours, so it moves to WU-23c's launch checklist, which checks it in live mode anyway.
12. **Rollout cleanup (D8 step 3) comes after the merge, so it can't be in this PR.** The `rollout_wu23b` variable keeps today's grants until `main` has run the new pipeline. After the merge's run passes, you set `rollout_wu23b = false`, remove `extra_deploy_ref` and the scratch branch from `live`, apply, and check `terraform plan` is clean and the Environment allows only `main` (AC-HOST-19). Deleting the then-dead rollout code (the variable, the `count` resources and the `moved` blocks) is a small `chore(infra)` change, proposed as a Note on WU-23c.
13. **Web URL format.** Terraform's `uri` for the web service is the hash-style `*.a.run.app` URL, not the project-number one. It's the origin `WEB_ORIGIN` allows; the runbook says to share only `terraform output web_url` (R1).
