# Documentation and traceability: acceptance criteria

Checks that keep the documentation a reliable way in: its links resolve, and every acceptance criterion is proven. The first two were written in the [WU-16 plan](../plans/WU-16.md), with the same IDs. All are files-only unit tests in `scripts/`.

## Links

- **AC-DOCS-01:** Given `README.md` and `docs/decisions/README.md`, then every relative link in them resolves to an existing file, and every `#heading` anchor into a Markdown file to one of its headings.
- **AC-DOCS-02:** Given `docs/decisions/`, then every ADR is listed in the decision records index.

## Acceptance-criteria traceability

An AC is defined in `docs/features/*.md` by a line that starts with its ID in bold (`**AC-EXTRACT-03:**`, `**AC-EXTRACT-03.**` or `**AC-JOURNEY-01**`), optionally as a list item. An AC counts as proven when its ID appears in the code of a gated test file (`*.test.ts(x)`, `*.spec.ts`) or test support file (under a `tests/**/support/` or `scripts/test-support/` directory), or in the `ac` field of a rule fixture in `spec/fixtures/rules/`. In code it is usually a test's title, but any string counts: data that becomes a title (`it.each` with `$ac`), an expected value, an error message. Comments don't count, but only `/* … */` blocks and lines that start with `//` are dropped, so a `//` comment after code on the same line still counts. An ID built in a template string (`` `AC-EXTRACT-0${n}` ``) names nothing. Only files git tracks, or would track because they aren't ignored, are read, and nothing under `spikes/`.

The check reads files and runs no test. So a test marked `it.skip` or `test.fixme` still counts, and some proofs run in a gate other than `pnpm verify`: the journeys in `pnpm verify:integrated`, AC-GATE-26's Firestore cases in `pnpm test:firestore`.

An AC that no gated test can prove (a deploy run, a check by hand) says so where it is defined, with a marker at the end of its line that names how it is proven instead: `_(Proven outside the test suite: <how>.)_`.

- **AC-DOCS-03:** Given every AC defined in `docs/features/`, then each is proven by a test or a rule fixture, or carries the marker; none does both. Each ID is defined once.
- **AC-DOCS-04:** Given every AC ID that a test or rule fixture names, then it is defined in `docs/features/`.
