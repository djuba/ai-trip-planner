# infra: the hosted environment

Terraform for the one hosted environment ([ADR 0005](../docs/decisions/0005-hosting-and-access.md)): on Cloud Run, the API (`backends/api-nextjs/Dockerfile`), the web client (`apps/web-nextjs/Dockerfile`), and a replay twin of the API that only CI calls. `api` runs in **live mode**: real model calls, paid from a dedicated Anthropic workspace whose hard spend limit bounds the cost ("The live demo" below). The twin always replays. The demo is offered on request; nothing public links to it.

**What a merge does** ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), ADR 0005 WU-23b addendum): build both images and push them; run the provider contract suite against the twin (`api-replay`) and `pnpm verify:integrated` on the runner; only if both pass, deploy the same digests to `api`, then `web`; run a model-free smoke check; and if a deploy or the smoke check fails, put both services back on the images that were running. No step calls the model, and no human approves anything: the checks are the gate.

**Who changes what.** Terraform owns everything except the running image: scaling, timeout, environment variables, identities, the registry, the budget. You apply it by hand from your machine. The deploy workflow changes only the image. So a deploy leaves `terraform plan` clean, and CI never holds the power to change IAM.

| File | Holds |
|---|---|
| `main.tf` | the provider and the project's APIs |
| `registry.tf` | Artifact Registry, keeping the 5 most recent images |
| `service.tf` | the API's runtime service account and the `api` service users reach: 0 to 1 instances, `/v1/health` startup probe, live mode with the key from `secrets.tf`, the access gate's limits, public, `WEB_ORIGIN` = the web service's URL |
| `secrets.tf` | the `anthropic-api-key` secret (no version: you add the value) and the runtime account's read access to it alone |
| `replay.tf` | the replay twin, `api-replay`: the same image, always replay, memory counts, no invite codes, trusts only the build identity's ID token; its runtime account has no role. Only the contract check calls it |
| `web.tf` | the `web` service (no env, no secret, a role-less runtime account, public), and its image repository |
| `firestore.tf` | the default Firestore database, where the access gate keeps its usage counts, and the runtime account's one role (read and write documents in that database) |
| `alerts.tf` | an email alert when the access gate refuses a known holder (revoked, expired, quota spent, window full) |
| `deploy-identity.tf` | Workload Identity Federation for `deploy.yml` on `main`, and its two service accounts. **Build** (`github-deploy`): push to both repositories, deploy the twin, read `api`'s URL, mint an ID token of itself for the contract check. **Promote** (`github-promote`): deploy `api` and `web`, nothing else; only the job in the GitHub Environment `live` can become it |
| `budget.tf` | a monthly budget with email alerts to the billing account's admins |
| `backend.hcl`, `terraform.tfvars` | the environment's identifiers. Git-ignored; copy the `.example` files |

## Prerequisites

- A Google Cloud account with a billing account. You need the Billing Account Administrator (or Costs Manager) role on it, for the budget.
- The [gcloud CLI](https://cloud.google.com/sdk/docs/install) and Terraform 1.17 (`winget install Google.CloudSDK Hashicorp.Terraform` on Windows).
- The GitHub CLI (`gh`), signed in with admin rights on the repository (to set its Actions secrets).

## Bootstrap (once)

Terraform can't create the project it runs in or the bucket that holds its own state, so these are manual. Pick a globally unique project ID, e.g. `ai-trip-planner-1234`.

```sh
gcloud auth login
gcloud projects create <project-id> --name="ai-trip-planner"
gcloud billing accounts list                     # note the ACCOUNT_ID
gcloud billing projects link <project-id> --billing-account=<billing-account-id>
gcloud config set project <project-id>
# billingbudgets is needed before the first apply: Terraform calls it with this project as quota project.
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com \
  billingbudgets.googleapis.com
gcloud storage buckets create gs://<project-id>-tfstate --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://<project-id>-tfstate --versioning

# Terraform uses Application Default Credentials, with the project as its quota project.
gcloud auth application-default login
gcloud auth application-default set-quota-project <project-id>
```

Then, in `infra/`:

```sh
cp backend.hcl.example backend.hcl                 # set the bucket
cp terraform.tfvars.example terraform.tfvars       # set project_id, billing_account_id and alert_email
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

The first apply creates the service with Google's public `hello` sample image, because the registry is still empty. The first deploy replaces it.

### GitHub Actions secrets

The deploy workflow finds the environment through four repository secrets. **None of them is a credential**: the workflow gets a short-lived token through OIDC, and only `deploy.yml` on `main` can. They're secrets rather than variables only because GitHub masks secrets in every log line, and the repository's Actions logs are public. A variable's value would be printed once, and the service URL can be derived from the project number in it.

```sh
terraform output -raw gcp_project_id   | gh secret set GCP_PROJECT_ID
terraform output -raw gcp_wif_provider | gh secret set GCP_WIF_PROVIDER
terraform output -raw gcp_deploy_sa    | gh secret set GCP_DEPLOY_SA
terraform output -raw gcp_promote_sa   | gh secret set GCP_PROMOTE_SA
```

### The GitHub Environment `live`

Only a job in this Environment can become the promote identity (`deploy-identity.tf`), and it may run only from `main`. It has no required reviewer: promotion is automatic. Create it once (`{owner}/{repo}` is filled in by `gh` from the checkout):

```sh
gh api -X PUT repos/{owner}/{repo}/environments/live \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/{owner}/{repo}/environments/live/deployment-branch-policies -f name=main -f type=branch
gh api repos/{owner}/{repo}/environments/live/deployment-branch-policies --jq '.branch_policies[].name'   # main
```

**To require your approval before each promotion**, add yourself as a required reviewer of `live` (repository Settings → Environments → live). Nothing else changes: the promote job then waits for you after the checks pass.

Then deploy once without waiting for a merge: `gh workflow run deploy.yml --ref main`, and watch it with `gh run watch`. To rebuild and redeploy an earlier commit of `main` through the whole pipeline: `gh workflow run deploy.yml --ref main -f sha=<full-sha>`.

The contract check needs no extra secret. The workflow mints a Google ID token of the build identity, valid for an hour and only for the API's audience, and the twin accepts it for that one account (`TRUSTED_SERVICE_ACCOUNTS` in `replay.tf`; ADR 0005, WU-23a addendum). The GitHub action masks the token in the log.

## Invite codes

The trip endpoints need an invite code ([ADR 0005](../docs/decisions/0005-hosting-and-access.md), WU-22 and WU-23a addenda; [`access-gate.md`](../docs/features/access-gate.md)). The service holds only each code's SHA-256 hash, under a label that names its holder, as `label:hash` entries in the `invite_codes` variable (in the git-ignored `terraform.tfvars`). A hash can't be used as a code, so the entries aren't secrets, but labels say whom you've given a demo to: they show up in the logs and in the service's configuration, so keep them out of anything public, or use opaque labels (`r01`) and keep the mapping yourself.

- **Issue a code:** `pnpm invite:new <label> [flags]` prints the code and its entry. Add the entry to `invite_codes`, plan and apply (as above), and send the code to its holder. The code is shown only once and stored nowhere; if it's lost, issue a new one.
- **A code's own limits:** flags put options on the entry: `--extract`, `--recommend`, `--present` (a number, or `none` for no lifetime quota), `--no-quota` (all three `none`), `--hour` (its hourly window) and `--expires YYYY-MM-DD` (works through that day, UTC). Unset options take the service-wide values in `service.tf`; the global daily window applies to every code. Your own code, for example: `pnpm invite:new owner --no-quota --hour 30`.
- **Extend or change a code:** edit its entry's options in `terraform.tfvars` (e.g. `acme-recruiter:<hash>;recommend=6`, or add `;expires=2027-03-31`), then plan and apply. The code doesn't change, so there's nothing to resend. Its usage counts are kept by label, so it keeps what it has used: having used 2 of 3 recommends, `recommend=6` leaves it 4.
- **Revoke a code:** move its entry from `invite_codes` to `revoked_invite_codes`, then plan and apply. The code gets a 401 from the next revision on, and every later attempt is logged as `revoked` with its label.
- **See usage:** every gate decision is one JSON log line with `event: "gate"`, `outcome` (`allowed`, `missing`, `unknown`, `revoked`, `expired`, `invalid_token`, `rate_limited`, `quota_exhausted`), `path` and `code` (the label). In Logs Explorer: `jsonPayload.event="gate"`, then filter on `jsonPayload.code` or `jsonPayload.outcome`. The current counts are in Firestore (below).
- **Alerts:** a `revoked`, `expired`, `quota_exhausted` or `rate_limited` decision emails `alert_email`, at most once per 5 minutes, naming the label and the outcome. `unknown` and `missing` don't alert: anything scanning the URL would make them noise.
- **Limits:** the service-wide values are set in `service.tf`, sized from the cost arithmetic in ADR 0005's WU-23c addendum: 40 extracts, 5 recommends and 5 presents per code for its whole life, 30 requests an hour per code, 60 a day for all codes together. `scripts/infra-config.test.ts` holds them as upper bounds, so raise one only after redoing the arithmetic. No CI check calls `api` (the contract suite runs on the twin, and the smoke check sends no code), so the limits leave no room for CI.
- **Never use a committed code.** `terraform plan` rejects the hashes of `local-dev-invite` and the tests' code, and a malformed entry; the server refuses committed codes unless `LOCAL_DEV=true`, which Cloud Run refuses.
- **Never set `ACCESS_GATE` or `LOCAL_DEV`** on the service. Both are for local use: the server refuses `ACCESS_GATE=off` without `LOCAL_DEV=true`, refuses `LOCAL_DEV=true` on Cloud Run, and a test checks that `service.tf` sets neither.
- **The CI credential:** the contract check sends an ID token of the build identity, not a code, and only to the replay twin (see "GitHub Actions secrets" above). It is logged there under the label `ci-deploy`, has no quota or hourly window, and counts only toward the twin's own daily window, never `api`'s.

### Usage counts in Firestore

The gate's counts live in the default Firestore database, collection `usage`, one small document per counter. For a code labelled `acme-recruiter`:

| Document | Holds |
|---|---|
| `quota:acme-recruiter:extract` (and `:recommend`, `:present`) | `count`: requests to that endpoint over the code's life |
| `hour:acme-recruiter` | `count` and `windowStart` (epoch ms) of its current hourly window |
| `global:day` | `count` and `windowStart` of the current day, for all codes together |

There's no code, hash, message or limit in them: the limits stay in your entries. A request the gate allows creates or increments its three documents in one atomic write; a refused request writes nothing; a window that has ended restarts at 1. An endpoint with a `none` quota never gets a `quota:` document.

You never edit these documents to change a limit: edit the entry and apply. Two exceptions:

- **A fresh allowance rather than a larger one:** delete that code's `quota:` documents in the console (Firestore → Data → `usage`). Raising the limit does the same job without touching Firestore.
- **A renamed label** starts from zero; the old label's documents stay behind, a few bytes each.

## The live demo

`api` calls the model with a key from Secret Manager. The key exists in two places only: the Anthropic console and the secret's versions. Terraform holds neither: it creates the secret and its one grant, never a version. What bounds the cost is a hard monthly spend limit on the workspace the key belongs to. The per-code quotas and the daily window shape how it's spent ([ADR 0005](../docs/decisions/0005-hosting-and-access.md), WU-23c addendum). The acceptance criteria are in [`live-demo.md`](../docs/features/live-demo.md).

### The Anthropic workspace (once)

In the Anthropic Console, under Settings → Workspaces:

1. Create a workspace used only by the demo, e.g. `trip-planner-demo`.
2. Set its **monthly spend limit to $10**. Make sure it's a limit that rejects requests once it's reached, not only a notification. If the console offers a notification threshold too, set one at $5.
3. Create an API key **in that workspace**. Copy it once, straight into step 3 of "Going live" below, and don't save it anywhere else.

The spend limit is the bound on everything: a leaked code, a bug that loops, a bad release. Keep it on.

### Going live (once)

`api` was switched from replay to live by WU-23c, from its PR branch before the merge. The order matters: a revision that references a secret with no version fails to start.

1. Set `anthropic_api_key_version = "1"` in `terraform.tfvars`. Then create the secret and its grant only:
   ```sh
   terraform plan -out=tfplan -target=google_project_service.apis \
     -target=google_secret_manager_secret.anthropic_api_key \
     -target=google_secret_manager_secret_iam_member.runtime_api_key
   terraform apply tfplan
   ```
2. Set up the workspace, its limit and its key (above).
3. Add the key as version 1. Paste it on stdin, so it stays out of your shell history and out of every file. Never pass it as an argument.
   ```sh
   gcloud secrets versions add anthropic-api-key --data-file=-
   # paste the key, press Enter, then Ctrl-D (Ctrl-Z then Enter on Windows)
   ```
   The output names the version it created. It must equal `anthropic_api_key_version`.
4. Issue your own code (`pnpm invite:new owner --no-quota --hour 30`), and any codes you're giving out. Add their entries to `invite_codes`.
5. Plan and apply in full (`terraform plan -out=tfplan`, review, `terraform apply tfplan`). `api` gets a new revision in live mode.

### Rotate the key

1. In the Anthropic Console, create a new key in the demo's workspace.
2. Add it as a new version (`gcloud secrets versions add anthropic-api-key --data-file=-`, as above), and note the version number it prints.
3. Set `anthropic_api_key_version` to that number, then plan and apply. Terraform starts a new revision that reads the new key. A redeploy of the same image wouldn't: the version is pinned for exactly that reason.
4. Once the new revision serves (`gcloud run services describe api --region us-central1 --format="value(status.latestReadyRevisionName)"`), disable the old version (`gcloud secrets versions disable <old-version> --secret anthropic-api-key`) and delete the old key in the console.

If a key may have leaked, delete it in the console **first**. Requests fail with a 502 until step 3 has applied, and nothing more can be spent with it.

### Pause the demo

- **For a while:** move every entry from `invite_codes` to `revoked_invite_codes`, then plan and apply. Every code gets a 401 from the next revision on. To keep testing yourself, leave your own entry where it is. Move the entries back to resume; their counts are kept.
- **At once, in an emergency:** disable the key in the Anthropic Console. Model calls fail with a 502 straight away, and nothing more can be spent. To resume, rotate the key (above).
- Scaling to zero pauses nothing: `api` already scales to zero when idle, and a request starts an instance.

### Read the bill

- **Model spend:** in the Anthropic Console, Usage and Cost, filtered to the demo's workspace. The workspace's spend limit shows how much of the month's limit is used. Expect a few cents per demo session (ADR 0005, WU-23c addendum).
- **Who used it:** the gate's log lines (`jsonPayload.event="gate"`) give each request's label and outcome. The counts in Firestore give each code's totals ("Usage counts in Firestore" above).
- **Hosting:** Google Cloud Billing → Reports, filtered to the project ("Cost" below).

## Reviewing and applying infra changes

Terraform is applied by hand, because applying it needs near-owner rights over the project and the billing account, and no CI identity should hold those ([ADR 0005](../docs/decisions/0005-hosting-and-access.md), addendum). So an infra change is reviewed like code, and its plan is reviewed before anyone applies it:

1. **The `.tf` diff is reviewed in the PR**, with the rest of the change. CI's `infra` job checks `terraform fmt` and `terraform validate`, with no credentials.
2. **The plan is reviewed locally**, never in CI: its output names the project, the project number and the service accounts, and the repository's Actions logs are public. On the branch, run `terraform plan -out=tfplan` and read every create, change and destroy, and every IAM binding in full.
3. **Apply the saved plan:** `terraform apply tfplan` applies exactly what was reviewed. If anything changed since, Terraform refuses the stale plan; plan again.

When to apply:

- **By default, after the merge, from an up-to-date `main`**, so `main` is always what's deployed.
- **From the branch before the merge** only when the PR's own CI or deploy needs the change to exist (a new permission, a new secret). Keep such changes additive: add what the new code needs first, and remove what the old code used in a later change. An applied but unmerged change then can't break `main`. If the PR is abandoned, apply `main` again to undo it.
- **Either way, finish with `terraform plan` on `main`.** "No changes" means `main` and the cloud agree.

The state bucket locks during an apply, so two applies can't collide, and it's versioned, so an earlier state can be recovered.

## Everyday use

- **Change the infrastructure:** see above. CI checks `terraform fmt` and `terraform validate` on every PR (the `infra` job in `verify.yml`), but never plans or applies.
- **Check for drift:** `terraform plan` should say "No changes" after any deploy. If it doesn't, something changed the service outside Terraform.
- **Prove a deploy workflow change before merge:** the identity condition admits only `deploy.yml` on `main`. To test a change on a scratch branch, add the branch to `on.push.branches` in that branch's copy of `deploy.yml` only, set `extra_deploy_ref = "refs/heads/<branch>"` in `terraform.tfvars` and apply. For its promote job to run, also allow the branch in the Environment `live` (`gh api -X POST repos/{owner}/{repo}/environments/live/deployment-branch-policies -f name=<branch> -f type=branch`), and remove it afterwards (`gh api repos/{owner}/{repo}/environments/live/deployment-branch-policies` lists the IDs; `gh api -X DELETE …/deployment-branch-policies/<id>`; read it back: only `main`). A push to the branch before that apply should fail at `auth` ("rejected by the attribute condition"), which shows other branches are refused. Remove it and apply again as soon as the run is green, then confirm `terraform output deploy_condition` mentions only `main`.

## Rollback

A failed promotion rolls itself back: the promote job puts both services back on the images that were running, and logs both pairs of digests. If that rollback fails too, or a bad release passed every check, deploy an earlier pair by hand, the API first. Each repository keeps its 5 most recent images.

```sh
gcloud artifacts docker images list us-central1-docker.pkg.dev/<project-id>/api/api-nextjs \
  --sort-by=~UPDATE_TIME --limit=5 --format="value(version,tags,updateTime)"
gcloud run services update api --region us-central1 \
  --image us-central1-docker.pkg.dev/<project-id>/api/api-nextjs@<sha256:digest>
gcloud artifacts docker images list us-central1-docker.pkg.dev/<project-id>/web/web-nextjs \
  --sort-by=~UPDATE_TIME --limit=5 --format="value(version,tags,updateTime)"
gcloud run services update web --region us-central1 \
  --image us-central1-docker.pkg.dev/<project-id>/web/web-nextjs@<sha256:digest>
```

Images of one commit carry the same tag (its SHA), so pick the pair by tag. Or re-run the whole pipeline for an earlier commit: `gh workflow run deploy.yml --ref main -f sha=<full-sha>`. Rolling back with `update-traffic` instead would pin traffic to a revision, which Terraform reports as drift. The next merge to `main` deploys the newest commit again, so revert the bad commit too.

## Cost

Hosting should cost about $0 a month: the three services scale to zero, and the Cloud Run and Firestore free tiers cover a demo's traffic (an allowed request is 3 small reads and 3 writes). Check it in the console under Billing → Reports, filtered to the project. The budget emails the billing account's admins at 20 %, 50 % and 100 % of `budget_amount_usd` ($5 by default), and when the forecast passes it. Google Cloud has no hard spend cap; the budget is a warning.

Model spend is billed by Anthropic, not Google, and capped by the demo workspace's spend limit ("The live demo" above). Secret Manager adds nothing: one active version and a few hundred reads a month are inside its free tier.

## Teardown

Everything lives in the one project, including the Terraform state:

```sh
gh workflow disable deploy.yml          # or every merge fails at the deploy
gh secret delete GCP_PROJECT_ID; gh secret delete GCP_WIF_PROVIDER; gh secret delete GCP_DEPLOY_SA; gh secret delete GCP_PROMOTE_SA
gh api -X DELETE repos/{owner}/{repo}/environments/live
gcloud projects delete <project-id>     # recoverable for 30 days
```

`terraform destroy` removes the resources but keeps the project and the state bucket, if you want to rebuild in the same project. The budget is on the billing account, outside the project: `terraform destroy` removes it, but `gcloud projects delete` doesn't (delete it in the console under Billing → Budgets & alerts).
