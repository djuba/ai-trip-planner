# Container images: acceptance criteria

The API and web images that the hosted environment runs. The decisions are in [ADR 0005](../decisions/0005-hosting-and-access.md); the API image's design is the [WU-20 plan](../plans/WU-20.md), and the web image's is the [WU-23b plan](../plans/WU-23b.md). `pnpm test:image` builds and checks both images, then runs the provider contract tests against the API container; it needs Docker, so it runs in the CI `image` job, not in `pnpm verify` (CLAUDE.md §6.7). The unit tests in `scripts/image/` prove the arguments it builds and the checks it applies.

These ACs were first written in the plans above. WU-20 and WU-23b both used the IDs AC-IMAGE-05 and -06. The tests use them for WU-23b's web image, so WU-20's two gate checks are AC-IMAGE-09 and -10 here.

## The API image

- **AC-IMAGE-01:** Given a clean checkout, when the API image is built, then the build succeeds.
- **AC-IMAGE-02:** Given the API image, when it runs, then its user is not root.
- **AC-IMAGE-03:** Given the API image, then no layer config or file under `/app` holds a secret: no `ANTHROPIC_API_KEY`, no variable whose name contains `KEY`, `SECRET` or `TOKEN`, and no `.env*` file.
- **AC-IMAGE-04:** Given the API container in replay mode, when the provider contract tests run against it, then they pass.

## The web image

- **AC-IMAGE-05:** Given a clean checkout and an API URL, when the web image is built, then it builds. Without the argument, or with a URL that isn't http(s), the Dockerfile refuses.
- **AC-IMAGE-06:** Given the web image, then it runs as non-root, with no `.env*` file and no secret-looking variable.
- **AC-IMAGE-07:** Given the running web image, when `/` is fetched, then it is 200 HTML, and one of the `/_next/static/` scripts it loads contains the build-argument URL.
- **AC-IMAGE-08:** Given both Dockerfiles, then they use the same pinned Node image, and the web build context excludes the cassettes and the backend.

## Gates

- **AC-IMAGE-09:** Given a machine without Docker, when `pnpm verify` runs, then it passes. _(Proven outside the test suite: the CI `verify` job, which has no Docker step.)_
- **AC-IMAGE-10:** Given the standalone output switch, when the functional and contract tests build without `NEXT_OUTPUT`, then `next start` still serves them. _(Proven outside the test suite: every `pnpm test:functional` and `pnpm test:contract` run builds that way.)_
