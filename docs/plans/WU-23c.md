# WU-23c — Live demo launch: plan

**Status:** approved (2026-11-18), with the recommended answers and every plan-review fix · **Depends on:** WU-16, WU-23b (both done on `main`) · **Author:** main agent (Opus), 2026-11-18

**Review tier:** `sonnet` for the plan review (done) and the unit review. That was set at deployment planning (WU-23c Notes). The unit changes no contract, rule or `LlmClient` interface. Its one risky area, the secret and its IAM, sits in two Terraform files that the reviewer can read in full.

## Decisions at approval

- **Q1** the README asks people to get in touch through the owner's GitHub profile. **Q2** `MODEL_CRITIC` stays on Sonnet; no live eval. **Q3** a $10 hard spend limit on the Anthropic workspace, plus a $5 notification if the console offers one. **Q4** `request_timeout_seconds` 120. **Q5** live mode is applied from the branch before the merge; this PR merges next, with nothing in between.
- **Plan-review fixes, all applied below:**
  - #1: D2 now accepts the promote identity's path to the key, bounded by the spend limit.
  - #2: D7 dispatches the real promote path against live `api`.
  - #3: D7 checks the spend limit, before the live apply.
  - #4: D4 sizes for the most expensive mix.
  - #5: D2 pins the secret version through a variable.
  - #6: the pause is revoking every code.
  - #7: AC-LIVE-05 uses fixed bounds in the test.
  - #8: T7 issues the owner's code.

## 1. Goal & scope

**Goal:** the hosted `api` runs in live mode, reading its Anthropic key from Secret Manager, behind limits sized from measured cost. The worst-case monthly spend is bounded by a hard Anthropic workspace spend limit of at most $10, plus about $0 of hosting. The README offers the demo on request, with no URL or code in it.

**In scope**
1. **Rollout cleanup first** (WU-23b Notes): delete the `rollout_wu23b` variable, the rollout-only section of `deploy-identity.tf` (its `count` resources and `moved` blocks), and the `dynamic "env"` block on `api`. `terraform plan` must stay clean. `terraform.tfvars` already has `rollout_wu23b = false`, so the counted resources are not in state. Also delete the runbook's two finished one-time rollout sections ("Rolling out WU-23a/WU-23b"); the ADR addenda and plans keep that history.
2. **Cost per demo session:** work out the tokens per stage from one recorded full session (the journey cassettes: extract ×N, recommend + critic, present) and from WU-10's measured figures, multiply by the current list prices, and add the theoretical worst case per request. Record the arithmetic in an ADR 0005 addendum.
3. **Limits:** set `service.tf`'s service-wide quotas, hourly window and global daily window from that arithmetic, replacing the replay values (1,000,000 / 1000 / 10,000). Revisit `request_timeout_seconds` (300 s against a measured 17 s).
4. **Secret Manager:** a Terraform-created secret `anthropic-api-key` with **no version in Terraform**, so the key never enters state or plan. You add the value with `gcloud`. `api`'s runtime account gets `secretAccessor` on that one secret. The twin and the web service never see it.
5. **Switch `api` to live:** `LLM_MODE=live`, `ANTHROPIC_API_KEY` from the secret, the CLAUDE.md §8.1 model IDs. The twin stays on replay, and its model IDs are pinned to `CONTRACT_TEST_ENV` rather than to `api` (WU-23b Notes).
6. **Anthropic account setup** (yours, documented in the runbook): a dedicated workspace for the demo, a monthly spend limit, and its own API key.
7. **Runbook** (`infra/README.md`): go live (once); rotate the key; pause the demo; read the bill (Anthropic console and GCP billing). `min_instance_count` is already 0, so scaling to zero pauses nothing. The pause is moving every entry to `revoked_invite_codes` and applying. In an emergency, disable the key in the Anthropic console, which stops spend at once.
8. **README:** a "Live demo available on request" line in the Quickstart, next to "To try your own messages", saying how to ask. No URL or code.
9. **Launch checklist**, run on the hosted environment and recorded in Notes. A new code works end to end from the web UI on `terraform output web_url`. A revoked code gets 401. A spent quota returns 429. Health is open with no code.

**Out of scope**
- `MODEL_CRITIC` on Haiku. Trying it means a live eval run, which costs money and is your call (Q2). The default here is to keep Sonnet.
- The opt-in `--image` mode for the journeys (WU-15 Notes). It's optional, and the image is already contract-checked on the twin every merge. Proposed as a backlog item.
- Candidate-tag revisions (WU-21 Notes). Rejected in the WU-23b addendum, so nothing to do here.
- Any API or web code change, any contract change (stays 0.6.0), any cassette re-recording.
- A custom domain, the closed beta, performance testing (backlog).

## 2. Approach

**D1. Cleanup lands first, in its own `chore(infra)` commit.** It's dead code, unrelated to going live, and the WU-23b Notes ask for it as its own commit. The test `AC-HOST-13: the rollout-only grants switch off with rollout_wu23b` is deleted, and `steadyIdentity()` in `scripts/infra-config.test.ts` no longer needs to cut the rollout section off. The other AC-HOST-13 tests must still pass on the whole file. Proof: `pnpm test:unit` and `terraform validate`. Then you run `terraform plan` on the branch, which should show "No changes". Afterwards you remove `rollout_wu23b = false` from your `terraform.tfvars`; otherwise Terraform warns about an undeclared variable.

**D2. The key lives only in Secret Manager and the Anthropic console** (DoD 3; CLAUDE.md §9).
- `infra/secrets.tf`: `google_secret_manager_secret.anthropic_api_key` (automatic replication), plus `google_secret_manager_secret_iam_member` granting `roles/secretmanager.secretAccessor` to `google_service_account.runtime.member` **on that secret only**. Terraform creates no `google_secret_manager_secret_version`, so the value is never in Terraform state, plan output or the repository. `secretmanager.googleapis.com` joins `local.apis`.
- `api`'s container gets `env { name = "ANTHROPIC_API_KEY" value_source { secret_key_ref { secret = …id, version = var.anthropic_api_key_version } } }`. The variable is a pinned version number, not `latest` (review #5): a promote that keeps the same digest may not start a new revision, so `latest` would not be re-resolved. A rotation is: add a version, set `anthropic_api_key_version` in `terraform.tfvars`, plan and apply (a new revision, with no drift), then disable the old version and delete the old key in the console (runbook). The variable has no default, so a plan without it fails loudly.
- You add the value yourself: `gcloud secrets versions add anthropic-api-key --data-file=-`, pasting the key on stdin. It never passes through this session, a file, the shell history or Terraform.
- *Rejected:* a Terraform-managed version (the key would sit in state in the bucket); a plain env var set by `gcloud` (drift, and the value visible in the service's configuration).
- Promotion should be unaffected. The promote identity already acts as `api-runtime` (WU-23b D7), and Cloud Run is expected to check the secret grant against the runtime account, not the deployer. That's unproven (review #2; compare WU-23b deviation 8), so D7 runs the real promote path against live `api` before close.
- **The promote identity can still reach the key** (review #1). It can deploy any image that runs as `api-runtime`, and such an image can read the secret. The two identities narrow who holds that power: only a `deploy.yml` job in Environment `live`, on `main`, that installs nothing. They don't remove it. The ADR addendum **accepts** it, bounded by the Anthropic spend limit and the gate's alerts, and closes the WU-21 note on that basis. Adding yourself as a required reviewer of `live` remains the one-step option to close it further (`infra/README.md`).

**D3. Going live is applied from the branch, before the merge.** The Definition of done needs the checklist to pass on the hosted environment, and its results go in the close commit, which lands before the merge. The runbook allows a branch apply "only when the PR's own CI or deploy needs the change". This isn't quite that, so it's a recorded exception. It's safe: the merge's deploy changes only the image, and `api`'s env stays as applied. If the PR were abandoned, applying `main` puts `api` back on replay. The order matters, because a revision that references a secret with no version fails to start:
1. `terraform apply` with `-target` on the secret and its grant (plus the API enablement) from the branch.
2. You create the Anthropic workspace, its hard spend limit and its key, and add the key as a secret version. **Precondition for step 3:** the limit is recorded as checked (D7, the first item).
3. You issue the owner's code and the checklist code and add their entries. Then a full `terraform plan -out=tfplan` / `apply tfplan`: `api` gets a new revision in live mode.
4. Run the checklist (D7).

*Rejected:* applying after the merge (the close commit couldn't record the checklist, or it would need a follow-up PR); a `llm_mode` variable defaulting to `replay` (a toggle that exists only for the launch, then must be removed, like `rollout_wu23b`).

**D4. Limits from the arithmetic, with the spend limit as the hard bound.** The gate's limits shape how one code can spend, and the Anthropic workspace limit caps the total (ADR 0005 WU-22 addendum). The method (T3):
- Cost per session = Σ over the stages of (input, cached-input and output tokens × the current list price per model). Token counts come from the cassettes of the journey `@smoke` session, cross-checked against WU-10's eval figures. Prices are read from the Claude API reference at build time, not from memory.
- Worst case per request = the stage's bound (WU-10: `/recommend` up to 12 calls at their `maxOutputTokens`) × the price. This shows how far the spend limit sits from a single code's worst case.
- **Sized for the most expensive mix** (review #4). The daily window counts every endpoint alike, so it's sized as if every request were `/recommend`. At its measured cost, 30 full days at the window's limit must stay under the $10 spend limit. The ADR shows the theoretical worst case beside it, and says that beyond the measured case the spend limit is the bound.
- The proposed shape, with the exact numbers set by the arithmetic: per-code `QUOTA_EXTRACT` about 40, `QUOTA_RECOMMEND` about 5, `QUOTA_PRESENT` about 5 (a few full sessions per interviewer); `RATE_LIMIT_PER_HOUR` about 30; `RATE_LIMIT_GLOBAL_PER_DAY` as above. Your own code is issued with `--no-quota --hour <n>` and still counts toward the daily window (WU-23a Notes). No CI caller reaches `api`, so the limits leave no room for CI (WU-23b Notes).
- `request_timeout_seconds`: 300 → 120. That is 7× the measured worst `/recommend` (17 s) and leaves room for a slow present stream. A request that runs longer is already spending abnormally. Proposed, not required (Q4).
- Also fixes the stale comment on `max_instance_count = 1`: the limiter is no longer in memory.

**D5. The twin pins its own model IDs.** `replay.tf` keeps literal model IDs equal to `CONTRACT_TEST_ENV`. AC-HOST-11 changes from "twin equals `api`" to "twin equals `CONTRACT_TEST_ENV`". AC-HOST-02 splits in two: `api` is live with the §8.1 IDs, and the twin replays with the contract runner's IDs. If `MODEL_CRITIC` later moves to Haiku on `api`, nothing else breaks.

**D6. Acceptance criteria in a new `docs/features/live-demo.md`** (CLAUDE.md §6.2). Static ACs are proven by `scripts/infra-config.test.ts`, the same layer that proves the hosting ACs today. The launch checklist ACs are manual, as the unit allows, and their results go in the work breakdown's Notes.

**D7. The checklist costs cents and proves each limit.** You run it, because each step needs a fresh invite code, which `pnpm invite:new` prints once. I don't handle the codes; I write out the exact `curl` commands with a `$CODE` placeholder, which you run in your terminal.
- **First, before the live apply:** the Anthropic workspace exists, holds the key, and has a hard monthly spend limit of $10, confirmed as a stop rather than a notification (review #3). Recorded in Notes as workspace name, limit and type.
- A checklist code `launch-check` issued with `--extract 1 --recommend none --present none`: one live `/extract` succeeds (about $0.001), the second returns 429 `QUOTA_EXHAUSTED`.
- That code moved to `revoked_invite_codes` and applied: 401.
- `GET /v1/health` with no header: 200.
- The owner's code through the web UI on `terraform output web_url`: one full session to presentation cards.
- The alert email for `quota_exhausted` and `revoked` arrives: a free side effect of the first two checks.
- **The promote path against live `api`** (review #2): `gh workflow run deploy.yml --ref main`. It rebuilds `main`, checks on the twin, and promotes onto the service that now reads the secret. Its smoke check is model-free, and a failure rolls back automatically. If it fails on a Secret Manager permission, that becomes a material deviation: a grant for the promote identity, decided with you.

**D8. The README line is short and private.** "A live demo is available on request: <how>." The contact channel is your call (Q1). Your email isn't added unless you ask for it.

## 3. File-by-file changes

| File | Change | Purpose |
|---|---|---|
| `infra/deploy-identity.tf` | modify | delete the rollout-only section (4 `moved` blocks, 4 counted resources) and the header lines that mention it |
| `infra/variables.tf` | modify | delete `rollout_wu23b`; `request_timeout_seconds` 120; new `anthropic_api_key_version` (no default) |
| `infra/terraform.tfvars.example` | modify | show `anthropic_api_key_version` |
| `infra/service.tf` | modify | D1: delete the `dynamic "env"` block. D2/D4/D5: `LLM_MODE=live`, `ANTHROPIC_API_KEY` from the secret, sized limits, timeout, comments; `depends_on` the secret grant |
| `infra/secrets.tf` | create | the secret (no version) and the runtime account's accessor grant on it |
| `infra/main.tf` | modify | enable `secretmanager.googleapis.com` |
| `infra/replay.tf` | modify | model IDs as literals (if they reference `api`'s today; otherwise unchanged) and its comment |
| `infra/README.md` | modify | D1: drop the finished rollout sections; file table gains `secrets.tf`; new sections: "The live demo" (Anthropic workspace and spend limit, go live once, rotate the key, pause, read the bill); intro no longer says "until WU-23c turns `api` live" |
| `scripts/infra-config.test.ts` | modify | D1: remove the rollout test and slicing. D5: AC-HOST-02/-11 as above. New AC-LIVE tests. AC-GATE-29's "only role is Firestore" becomes "Firestore plus the one secret" |
| `docs/features/live-demo.md` | create | AC-LIVE-01…-09 (§4) |
| `docs/decisions/0005-hosting-and-access.md` | modify | addendum "The live demo (WU-23c)": the cost arithmetic, the limits, the spend limit, the secret, the branch apply, closing the WU-21 key-access note |
| `README.md` | modify | the "Live demo available on request" line |
| `docs/work-breakdown.md` | modify | status (plan commit); close: status, PR, Notes (checklist results, usage), backlog item for `--image` |
| `docs/plans/WU-23c.md` | create | this plan; deviations at close |

No file under `apps/`, `backends/`, `packages/`, `spec/`, `.llm-cassettes/` or `contracts/` changes.

## 4. Acceptance criteria → tests

Planned for `docs/features/live-demo.md`:

| AC | Given/When/Then (short) | Test | Layer |
|---|---|---|---|
| AC-LIVE-01 | `api` runs `LLM_MODE=live` with the CLAUDE.md §8.1 model IDs | `scripts/infra-config.test.ts` | unit (static) |
| AC-LIVE-02 | `ANTHROPIC_API_KEY` on `api` comes only from `value_source.secret_key_ref` to the Terraform secret; no `.tf` file sets it as a literal, and Terraform holds no secret version | same | unit |
| AC-LIVE-03 | the accessor grant is on that one secret, to `api`'s runtime account only; no project-level Secret Manager role exists | same | unit |
| AC-LIVE-04 | the twin and `web` have no `ANTHROPIC_API_KEY` and no `value_source`; the twin stays `replay` with `CONTRACT_TEST_ENV`'s model IDs (AC-HOST-11 updated) | same | unit |
| AC-LIVE-05 | every limit on `api` is a positive integer at most a fixed upper bound written as a constant in the test, with a comment pointing to the ADR arithmetic (review #7). So the replay values can't return by accident, and raising a limit past the bound needs the test changed too | same | unit |
| AC-LIVE-06 | health is open: `GET /v1/health` with no header → 200 on the hosted URL | launch checklist | manual |
| AC-LIVE-07 | a new code works end to end from the web UI on `web_url` (extract → recommend → present cards) | launch checklist | manual |
| AC-LIVE-08 | a code whose `/extract` quota is spent → 429 `QUOTA_EXHAUSTED`, and the alert email arrives | launch checklist | manual |
| AC-LIVE-09 | a revoked code → 401 `UNAUTHORIZED`, logged `revoked`, and the alert email arrives | launch checklist | manual |

Updated existing: AC-HOST-02 (api live, twin replay), AC-HOST-11 (twin against `CONTRACT_TEST_ENV`), AC-GATE-29 (runtime grants: Firestore plus the one secret), AC-HOST-13 (the rollout test removed). Proof: `pnpm test:unit`, `pnpm verify`.

## 5. Task list

All tasks stay with **Opus**: each is small, mostly Terraform and docs tied to decisions made here, and a subagent's cold start would cost more than the work.

- **T1 — Rollout cleanup** (Opus: small, IAM-adjacent). Files: `infra/deploy-identity.tf`, `infra/variables.tf`, `infra/service.tf` (the `dynamic "env"` block only), `scripts/infra-config.test.ts` (rollout test and `steadyIdentity`), `infra/README.md` (the rollout sections). Done: `pnpm test:unit` green, `terraform fmt -check` and `terraform validate` (no backend) pass; you confirm `terraform plan` shows no changes. Depends: —.
- **T2 — Secret and live switch** (Opus: security boundary). Files: `infra/secrets.tf`, `infra/main.tf`, `infra/service.tf`, `infra/replay.tf`, `scripts/infra-config.test.ts`, `docs/features/live-demo.md`. Done: AC-LIVE-01…-04 and the updated AC-HOST/GATE tests pass; `terraform validate` passes. Depends: T1 (same files).
- **T3 — Cost arithmetic and limits** (Opus: judgement). Read the token usage in the `@smoke` journey's cassettes and WU-10's figures; read current prices from the `claude-api` skill. Files: `infra/service.tf` (limits, timeout), `infra/variables.tf` (timeout), `docs/decisions/0005-hosting-and-access.md` (addendum), `scripts/infra-config.test.ts` (AC-LIVE-05). Done: the arithmetic is in the ADR; AC-LIVE-05 passes. Depends: T2.
- **T4 — Runbook** (Opus). File: `infra/README.md`. Done: the go-live, rotate, pause and bill sections exist; `pnpm test:unit` (`docs-links.test.ts`) green. Depends: T1–T3.
- **T5 — README line** (Opus). File: `README.md`. Done: `docs-links.test.ts` green. Depends: Q1.
- **T6 — Verify and review** (Opus): `pnpm verify`, then the unit review.
- **T7 — Go live from the branch and run the checklist** (you, with commands I write; D3, D7). After the walk-through commits are pushed and CI is green. Steps:
1. A targeted apply.
2. Set up the Anthropic workspace, its limit and its key, and confirm the limit.
3. `gcloud secrets versions add`, then set `anthropic_api_key_version`.
4. `pnpm invite:new owner --no-quota --hour <n>` and the `launch-check` code, with their entries added to `invite_codes` (review #8). The owner's requests still count toward the daily window.
5. A full plan and apply.
6. The checklist, including the dispatched promote.
7. Record the results.

Depends: T6.

No two tasks run in parallel: T1–T4 share `service.tf`, the test file or the runbook.

## 6. Risks & open questions

**Questions for you**
- **Q1. How to ask for the demo:** the README line needs a channel. Options: "open a GitHub issue" (public, and no address needed); "contact me via my GitHub profile"; a specific email or LinkedIn you name. Recommendation: the GitHub profile, which shares nothing new.
- **Q2. `MODEL_CRITIC` on Haiku:** keep Sonnet (recommended; the critic's output is tiny, so the saving is mostly on input tokens and small in dollars), or run `pnpm eval` live with Haiku first (costs roughly $0.30–0.50, your approval needed).
- **Q3. Spend limit:** $10 (the budget ceiling), or $5 to match the GCP budget? Recommendation: $10 for the hard limit, plus an Anthropic usage notification at $5 if the console offers one.
- **Q4. Timeout 120 s:** fine, or keep 300 s?
- **Q5. The branch apply (D3):** OK to apply live mode from the branch before the merge, so the checklist goes in the close commit?

**Risks**
- **R1. A key in a terminal:** adding it with `--data-file=-` keeps it out of shell history; never pass it as an argument. The runbook says so.
- **R2. A revision fails to start** if the secret has no version, or the grant hasn't propagated yet. D3's order, and `depends_on` on the grant, prevent it. If it happens anyway, the previous revision keeps serving.
- **R3. A main/cloud gap** between the branch apply and the merge. It's small, and the merge closes it. Nothing else may merge in that window, or its deploy would run against live `api` with an older `main` Terraform. Its deploy changes only images, so the effect is benign, but the runbook says to merge this PR next.
- **R4. Pricing drift:** the arithmetic uses the list prices of 2026-11-18. The spend limit is the bound either way.
- **R5. Cold start with secret access** adds a little latency; the startup probe allows a minute.

## 7. Expected commits

1. `docs(repo): add WU-23c plan`: plan and status (approved with the plan).
2. `chore(infra): remove the WU-23b rollout scaffolding`: T1. **Required as its own commit** (WU-23b Notes).
3. `feat(infra): run the hosted api live with its key in secret manager`: T2, T3 (Terraform, tests, `live-demo.md`, ADR addendum).
4. `docs(infra): add the live demo runbook`: T4.
5. `docs(repo): offer the live demo on request`: T5.
6. `docs(repo): close WU-23c`: deviations, checklist results, Notes, usage, backlog item. After T7.

Commits 3 and 4 may merge into one if the runbook turns out to be small.
