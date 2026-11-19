# Hosting and deployment: acceptance criteria

The hosted environment on Cloud Run and the pipeline that deploys it. The decisions are in [ADR 0005](../decisions/0005-hosting-and-access.md); the design is the [WU-21 plan](../plans/WU-21.md) (the first deploy, in replay mode) and the [WU-23b plan](../plans/WU-23b.md) (the web service, the replay twin and promotion). How to run it is in the [runbook](../../infra/README.md). The live-mode ACs are in [live-demo.md](live-demo.md).

The static checks of `infra/` and `.github/workflows/deploy.yml` are in `scripts/infra-config.test.ts`, and the smoke check's in `scripts/release/smoke-checks.test.ts`. The rest are proven by deploy runs or checked by hand; each says so.

These ACs were first written in the plans above, with the same IDs.

## The first deploy (WU-21)

- **AC-HOST-01:** Given a push to the deploy branch, when the workflow runs, then the image is built, pushed and deployed by digest. _(Proven outside the test suite: each `deploy.yml` run; first recorded in the WU-21 plan's deviations.)_
- **AC-HOST-02:** Given a deployed API, when the provider contract tests run against its URL, then they pass, including CORS against `WEB_ORIGIN` and the `/present` stream through Cloud Run's front end. Since WU-23b that URL is the replay twin's (AC-HOST-12).
- **AC-HOST-03:** Given a deploy, when `terraform plan` runs, then it shows no changes. _(Proven outside the test suite: a local `terraform plan` after a deploy, recorded in the WU-21 plan's deviations.)_
- **AC-HOST-04:** Given the repo and its settings, then no long-lived cloud key exists: no repository secret holds a credential (the only ones are identifiers), and no service account has a user-managed key. _(Proven outside the test suite: `gh secret list` and `gcloud iam service-accounts keys list`, recorded in the WU-21 plan's deviations.)_
- **AC-HOST-05:** Given a workflow other than `deploy.yml` on `main`, or any branch other than `main`, when it requests a token for the identity pool, then STS refuses it.
- **AC-HOST-06:** Given the service is idle, then it scales to zero, and the next request still succeeds. _(Proven outside the test suite: Cloud Run's instance metric, checked once and recorded in the WU-21 plan's deviations.)_
- **AC-HOST-07:** Given `infra/`, when CI runs, then `terraform fmt -check` and `terraform validate` pass with no credentials. _(Proven outside the test suite: the CI `infra` job.)_
- **AC-HOST-08:** Given `commitlint.config.js`, then `infra` is an allowed scope, matching CLAUDE.md §10.
- **AC-HOST-09:** Given a week of merges, then the project's cost is about $0. _(Proven outside the test suite: the project's billing report, read by hand.)_

## The web service, the twin and promotion (WU-23b)

- **AC-HOST-10:** Given the infra, then the web service has no env, no secret and a role-less runtime account, and the API's `WEB_ORIGIN` is the web service's URI.
- **AC-HOST-11:** Given the replay twin, then it runs replay with the memory store and trusts only the build identity, its runtime account has no role, and it shares `api`'s env except those keys.
- **AC-HOST-12:** Given a merge, then the contract suite runs against `api-replay` only, and passes.
- **AC-HOST-13:** Given the identities, then the build identity can't deploy `api` or act as `api-runtime`, and only a `deploy.yml` job in environment `live` maps to the promote identity.
- **AC-HOST-14:** Given `deploy.yml`, then `promote` needs `twin-check` and `journeys`, uses environment `live`, deploys the digests `build` output (never a tag), and runs no `pnpm install`; `journeys` has no `id-token` permission.
- **AC-HOST-15:** Given a failing check (contract suite or journeys), then `promote` doesn't run and the user-facing services are unchanged. _(Proven outside the test suite: a scratch-branch run, recorded in the WU-23b plan's deviations.)_
- **AC-HOST-16:** Given a promotion, when the smoke check runs, then health, the CORS preflight from the web origin, the 401, the web page and its bundle's API URL all pass; each failing case is reported.
- **AC-HOST-17:** Given a failing smoke check, then `promote` redeploys the previous images of both services, the smoke check passes on them, and the run fails.
- **AC-HOST-18:** Given a person opens the web URL with an invite code and sends a message, then the health badge shows the API, the gate accepts the code, and the request ends in the recoverable error state (a typed message has no replay cassette, so the model call is a 502). _(Proven outside the test suite: by hand in a browser, recorded in the WU-23b plan's deviations; accepting a code moved to the live-demo checklist, AC-LIVE-08.)_
- **AC-HOST-19:** Given the rollout, then `terraform plan` is clean on `main`, no service account has a user-managed key, and the Environment allows `main` only. _(Proven outside the test suite: `terraform plan` and a `gh api` read-back, run by hand after the rollout (WU-23b plan, deviation 12).)_
