# infra: the hosted environment

Terraform for the one hosted environment ([ADR 0005](../docs/decisions/0005-hosting-and-access.md)): the API on Cloud Run, running the image from `backends/api-nextjs/Dockerfile` in **replay mode** (no API key, no LLM cost). It isn't a demo, and nothing links to it. Every merge to `main` deploys it and runs the provider contract tests against it ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)). WU-23 turns it into the live demo.

**Who changes what.** Terraform owns everything except the running image: scaling, timeout, environment variables, identities, the registry, the budget. You apply it by hand from your machine. The deploy workflow changes only the image. So a deploy leaves `terraform plan` clean, and CI never holds the power to change IAM.

| File | Holds |
|---|---|
| `main.tf` | the provider and the project's APIs |
| `registry.tf` | Artifact Registry, keeping the 5 most recent images |
| `service.tf` | the runtime service account (no roles) and the Cloud Run service: 0 to 1 instances, `/v1/health` startup probe, replay mode, public |
| `deploy-identity.tf` | Workload Identity Federation for `deploy.yml` on `main`, and the deploy service account, which can push to the one repository and deploy the one service |
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
cp terraform.tfvars.example terraform.tfvars       # set project_id and billing_account_id
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform apply tfplan
```

The first apply creates the service with Google's public `hello` sample image, because the registry is still empty. The first deploy replaces it.

### GitHub Actions secrets

The deploy workflow finds the environment through three repository secrets. **None of them is a credential**: the workflow gets a short-lived token through OIDC, and only `deploy.yml` on `main` can. They're secrets rather than variables only because GitHub masks secrets in every log line, and the repository's Actions logs are public. A variable's value would be printed once, and the service URL can be derived from the project number in it.

```sh
terraform output -raw gcp_project_id   | gh secret set GCP_PROJECT_ID
terraform output -raw gcp_wif_provider | gh secret set GCP_WIF_PROVIDER
terraform output -raw gcp_deploy_sa    | gh secret set GCP_DEPLOY_SA
```

Then deploy once without waiting for a merge: `gh workflow run deploy.yml --ref main`, and watch it with `gh run watch`.

A fourth secret, `CONTRACT_INVITE_CODE`, is the CI invite code that the post-deploy contract check sends (see "Invite codes" below). Unlike the three above it is a credential, but only a weak one: in replay mode a request spends nothing. Only the contract test step can read it.

## Invite codes

The trip endpoints need an invite code ([ADR 0005](../docs/decisions/0005-hosting-and-access.md), WU-22 addendum; [`access-gate.md`](../docs/features/access-gate.md)). The service holds only each code's SHA-256 hash, under a label that names its holder, as `label:hash` entries in the `invite_codes` variable (in the git-ignored `terraform.tfvars`). Labels show up in the logs, so pick ones that tell you who it is (`acme-recruiter`), and keep them out of anything public.

- **Issue a code:** `pnpm invite:new <label>` prints the code and its entry. Add the entry to `invite_codes`, plan and apply (as above), and send the code to its holder. The code is shown only once and stored nowhere; if it's lost, issue a new one.
- **Revoke a code:** move its entry from `invite_codes` to `revoked_invite_codes`, then plan and apply. The code gets a 401 from the next revision on, and every later attempt is logged as `revoked` with its label.
- **See usage:** every gate decision is one JSON log line with `event: "gate"`, `outcome` (`allowed`, `missing`, `unknown`, `revoked`, `rate_limited`, `quota_exhausted`), `path` and `code` (the label). In Logs Explorer: `jsonPayload.event="gate"`, then filter on `jsonPayload.code` or `jsonPayload.outcome`.
- **Limits:** set in `service.tf`. In replay mode they're high, so they stay out of the way of the post-deploy check. Live mode (WU-23) sets real values and needs a persistent usage store: the in-memory one resets whenever the service scales to zero, and the server refuses to start in live mode with it.
- **Never use a committed code.** `terraform plan` rejects the hashes of `local-dev-invite` and the tests' code, and a malformed entry; the server refuses committed codes on Cloud Run too.
- **Never set `ACCESS_GATE`** on the service. `ACCESS_GATE=off` is for local demos; the server refuses it on Cloud Run, and a test checks that `service.tf` doesn't set it.
- **The CI code:** made once with `pnpm invite:new ci-contract`. Its entry goes in `invite_codes`; the code goes in the `CONTRACT_INVITE_CODE` secret (`gh secret set CONTRACT_INVITE_CODE`, then paste it at the prompt, so it stays out of shell history). Before going live, WU-23 drops it or caps it, since in live mode every deploy's contract run would cost money.

**First rollout (WU-22), before its PR merges:** make the CI code, add its entry to `terraform.tfvars`, plan and apply from the branch (the running image ignores the new variables), and set the secret. The merge's deploy then runs the gated contract check. If the check fails with 401s, the entry or the secret is missing or mismatched: fix it and re-run the workflow (`gh workflow run deploy.yml --ref main`).

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
- **Prove a deploy workflow change before merge:** the identity condition admits only `deploy.yml` on `main`. To test a change on a scratch branch, add the branch to `on.push.branches` in that branch's copy of `deploy.yml` only, set `extra_deploy_ref = "refs/heads/<branch>"` in `terraform.tfvars` and apply. A push to the branch before that apply should fail at `auth` ("rejected by the attribute condition"), which shows other branches are refused. Remove it and apply again as soon as the run is green, then confirm `terraform output deploy_condition` mentions only `main`.

## Rollback

Deploy an earlier image by digest. The registry keeps the 5 most recent.

```sh
gcloud artifacts docker images list us-central1-docker.pkg.dev/<project-id>/api/api-nextjs \
  --sort-by=~UPDATE_TIME --limit=5 --format="value(version,tags,updateTime)"
gcloud run services update api --region us-central1 \
  --image us-central1-docker.pkg.dev/<project-id>/api/api-nextjs@<sha256:digest>
```

Rolling back with `update-traffic` instead would pin traffic to a revision, which Terraform reports as drift. The next merge to `main` deploys the newest image again, so revert the bad commit too.

## Cost

Hosting should cost about $0 a month: the service scales to zero, and the Cloud Run free tier covers a demo's traffic. Check it in the console under Billing → Reports, filtered to the project. The budget emails the billing account's admins at 20 %, 50 % and 100 % of `budget_amount_usd` ($5 by default), and when the forecast passes it. Google Cloud has no hard spend cap; the budget is a warning.

## Teardown

Everything lives in the one project, including the Terraform state:

```sh
gh workflow disable deploy.yml          # or every merge fails at the deploy
gh secret delete GCP_PROJECT_ID; gh secret delete GCP_WIF_PROVIDER; gh secret delete GCP_DEPLOY_SA
gcloud projects delete <project-id>     # recoverable for 30 days
```

`terraform destroy` removes the resources but keeps the project and the state bucket, if you want to rebuild in the same project. The budget is on the billing account, outside the project: `terraform destroy` removes it, but `gcloud projects delete` doesn't (delete it in the console under Billing → Budgets & alerts).
