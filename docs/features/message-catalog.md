# Message catalog: acceptance criteria

How the spec words what it defines for people: a sentence for each rule code, and a label for each closed-enum value. The catalog is [`spec/messages.md`](../../spec/messages.md) and `spec/messages/<locale>.json`; the design is in [the WU-13 plan](../plans/WU-13.md) (D13 and the fixes at approval). Messages are presentation only and never cross the wire (CLAUDE.md §4.5). The web app's use of it is in [`conversation-ui.md`](conversation-ui.md).

Tests: `packages/domain-schema/src/messages/catalog.test.ts`, `packages/domain-schema/exports.test.ts`, and the `gen` drift check.

## Acceptance criteria

- **AC-MSG-01:** Given every `spec/messages/*.json`, when it is validated against `spec/generated/MessageCatalog.schema.json`, then it passes, and its `locale` equals its file name. The English catalog exists.
- **AC-MSG-02:** Given a catalog, then `violations` has exactly one entry per `RuleCode`, and `labels` has exactly the groups `experience`, `climate`, `travelMode` and `userType`, each with exactly one entry per value of its enum. A missing or extra key fails.
- **AC-MSG-03:** Given a violation template, then it parses as ICU MessageFormat and contains only literals, simple arguments and `select` (with an `other` branch), with no `plural`, `#`, `number`, `date`, `time` or tags. It uses only its code's `params` (read from `RuleViolation.schema.json`) and the derived `field`. No `'` sits next to `{` or `}`. Given a label, then it is plain text, with no `'` next to a brace either.
- **AC-MSG-04:** Given every violation in `spec/fixtures/rules/`, plus `DATE_VALID` at `start` and at `durationNights`, when it is formatted with each catalog (every param as a string, plus `field`), then the text is non-empty and shows every argument value its chosen wording uses. `DATE_VALID` has a different wording for each of `start`, `end`, `month`, `year` and `durationNights`. A year of 2101 shows as `2101`, not `2,101`.
- **AC-MSG-05:** Given `gen --check`, then it covers `MessageCatalog.schema.json`, which stays out of `openapi.yaml`. Given `@vp/domain-schema/messages`, then it exports the English catalog, checked against `MessageCatalog` when it loads, plus `violationField` and `violationArguments`.
