# Live demo: acceptance criteria

The hosted `api` serves the demo in live mode. It reads its Anthropic key from Secret Manager, and its limits are sized from measured cost. A hard spend limit on a dedicated Anthropic workspace bounds what it can spend. The decisions are in the [WU-23c plan](../plans/WU-23c.md) and the [ADR 0005 WU-23c addendum](../decisions/0005-hosting-and-access.md#addendum-the-live-demo-wu-23c-2026-11-18). How to run it is in the [runbook](../../infra/README.md#the-live-demo).

ACs 01–05 are static checks of `infra/` in `scripts/infra-config.test.ts`. ACs 06–10 are the launch checklist, run by hand on the hosted environment, with their results recorded in the WU-23c Notes in [`work-breakdown.md`](../work-breakdown.md).

- **AC-LIVE-01:** Given `infra/service.tf`, then `api` runs with `LLM_MODE=live` and the CLAUDE.md §8.1 model IDs.
- **AC-LIVE-02:** Given `infra/`, then `api`'s `ANTHROPIC_API_KEY` comes only from a `secret_key_ref` to the `anthropic-api-key` secret, at the version in `var.anthropic_api_key_version`. That variable is a version number with no default, never `latest`. No Terraform file creates a secret version or holds secret data, and no other file names `ANTHROPIC_API_KEY`.
- **AC-LIVE-03:** Given `infra/`, then the only Secret Manager role is `secretAccessor` on that one secret, granted to `api`'s runtime account. No project-wide Secret Manager role exists.
- **AC-LIVE-04:** Given `infra/replay.tf` and `infra/web.tf`, then neither names the key or any secret reference. The twin still runs `LLM_MODE=replay` with the contract runner's model IDs (AC-HOST-02, AC-HOST-11).
- **AC-LIVE-05:** Given `api`'s limits, then each one is a positive integer no larger than the fixed bound in the test. The test's comment points to the ADR arithmetic. So the replay values (1,000,000 / 1000 / 10,000) can't come back unnoticed, and raising a limit past its bound means changing the test as well.
- **AC-LIVE-06:** Given the hosted environment, before `api` goes live, then the dedicated Anthropic workspace holds the demo's key and has a monthly spend limit of at most $10 that stops requests, not just one that notifies.
- **AC-LIVE-07:** Given `api` in live mode, when `GET /v1/health` is sent with no `Authorization` header, then it returns 200 with the contract version.
- **AC-LIVE-08:** Given a new code, when it is entered in the web UI on `terraform output web_url`, then a full session runs end to end: a clarification or a ready profile, recommendations, then streamed presentation cards.
- **AC-LIVE-09:** Given a code whose `/extract` quota is 1, when it sends a second `/extract`, then the response is 429 `QUOTA_EXHAUSTED`. When that code is moved to `revoked_invite_codes` and applied, then its next request is 401 `UNAUTHORIZED`, logged as `revoked`. Each of the two outcomes sends an alert email.
- **AC-LIVE-10:** Given `api` in live mode, when `deploy.yml` is dispatched on `main`, then the promote job deploys onto `api` (which now reads the secret), and the smoke check passes. So the merge pipeline still works against a service that reads the key.
