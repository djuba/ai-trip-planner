# Trip validation: acceptance criteria

What `evaluateRules`, `countPopulatedFields` and `normalize` must do. The rules themselves are defined in [`spec/rules.md`](../../spec/rules.md).

Unless a criterion says otherwise, each one starts from a profile that is otherwise valid, so the listed violations are the complete expected result. Parameters are written as `{ name: value }`.

## CHILD_AGE_RANGE

- **AC-RULES-01:** Given a child aged 17 or aged 0, when rules are evaluated, then there is no violation.
- **AC-RULES-02:** Given a child aged 18, when rules are evaluated, then `CHILD_AGE_RANGE` fires at `/people/<i>/age` with `{ age: 18, min: 0, max: 17 }`.
- **AC-RULES-03:** Given a child aged -1, when rules are evaluated, then `CHILD_AGE_RANGE` fires with `{ age: -1, min: 0, max: 17 }`.
- **AC-RULES-04:** Given a child whose age is null or absent, when rules are evaluated, then there is no violation.

## ADULT_AGE_RANGE

- **AC-RULES-05:** Given an adult aged 18 or aged 120, when rules are evaluated, then there is no violation.
- **AC-RULES-06:** Given an adult aged 17 or aged 121, when rules are evaluated, then `ADULT_AGE_RANGE` fires at `/people/<i>/age` with `{ age, min: 18, max: 120 }`.
- **AC-RULES-07:** Given an adult whose age is null or absent, when rules are evaluated, then there is no violation.

## DATE_ORDER

- **AC-RULES-08:** Given a fixed range whose `end` is after or equal to `start`, when rules are evaluated, then there is no violation.
- **AC-RULES-09:** Given a fixed range whose `end` is before `start`, when rules are evaluated, then `DATE_ORDER` fires at `/dateRange` with `{ start, end }`.
- **AC-RULES-10:** Given a fixed range where either date is malformed, when rules are evaluated, then `DATE_VALID` fires and `DATE_ORDER` does not.

## DATE_NOT_PAST

- **AC-RULES-11:** Given a fixed `start` equal to `referenceDate`, when rules are evaluated, then there is no violation.
- **AC-RULES-12:** Given a fixed `start` one day before `referenceDate`, when rules are evaluated, then `DATE_NOT_PAST` fires at `/dateRange/start` with the `YYYY-MM-DD` value, including when `end` is malformed.
- **AC-RULES-13:** Given a flexible month and year in or after the reference month, when rules are evaluated, then there is no violation.
- **AC-RULES-14:** Given a flexible month and year before the reference month, when rules are evaluated, then `DATE_NOT_PAST` fires at `/dateRange` with a zero-padded `YYYY-MM` value.
- **AC-RULES-15:** Given a flexible year with no month, when rules are evaluated, then the reference year passes and an earlier year fires `DATE_NOT_PAST` at `/dateRange` with a `YYYY` value.
- **AC-RULES-16:** Given a flexible month with no year, including a month already gone this year, when rules are evaluated, then there is no violation, because it means the next occurrence of that month.
- **AC-RULES-17:** Given a flexible range with an invalid field, when rules are evaluated, then an invalid month with a past year fires `DATE_VALID` on the month and `DATE_NOT_PAST` with a `YYYY` value; an out-of-range year fires `DATE_VALID` only; and an invalid month with no year fires `DATE_VALID` only.

## DATE_VALID

- **AC-RULES-18:** Given Feb 29 in a leap year (2028, 2400), when rules are evaluated, then there is no violation.
- **AC-RULES-19:** Given a date that doesn't exist (Feb 29 in 2027 or 2100, Apr 31, month 13, day 00), when rules are evaluated, then `DATE_VALID` fires at the offending field with the raw string as `value`.
- **AC-RULES-20:** Given a malformed date (`2027-6-1`, an ISO datetime, an empty string, a trailing newline, non-ASCII digits), when rules are evaluated, then `DATE_VALID` fires; when both dates are bad, `start` comes before `end`.
- **AC-RULES-21:** Given a flexible month, when rules are evaluated, then 1 and 12 pass, and 0 and 13 fire `DATE_VALID` at `/dateRange/month`.
- **AC-RULES-22:** Given a flexible year, when rules are evaluated, then 2000 and 2100 pass under an early enough `referenceDate`, and 1999 and 2101 fire `DATE_VALID` at `/dateRange/year`.
- **AC-RULES-23:** Given a flexible `durationNights`, when rules are evaluated, then 1 passes, and 0 and -1 fire `DATE_VALID` at `/dateRange/durationNights`.

## PARTY_HAS_ADULT

- **AC-RULES-24:** Given a party of only children, when rules are evaluated, then `PARTY_HAS_ADULT` fires at `/people` with `{}`.
- **AC-RULES-25:** Given a party with an adult and a child, when rules are evaluated, then there is no `PARTY_HAS_ADULT`, including when the adult's age is out of range.
- **AC-RULES-26:** Given empty or absent `people`, when rules are evaluated, then there is no `PARTY_HAS_ADULT`.

## INSUFFICIENT_DETAIL and populated fields

- **AC-RULES-27:** Given a profile, when rules are evaluated, then 2 populated fields fire `INSUFFICIENT_DETAIL` at `""` with `{ populated: 2, required: 3 }`, 3 populated fields do not, and an empty profile fires with `{ populated: 0, required: 3 }`.
- **AC-RULES-28:** Given a `region` of `""` or only whitespace (space, tab, U+00A0, U+0085), when fields are counted, then it does not count; a `region` containing only U+FEFF or U+001C does count, because neither is Unicode `White_Space`.
- **AC-RULES-29:** Given a `departure`, when fields are counted, then it counts only with a non-blank `city`; one with only `mode` or `maxStops` does not.
- **AC-RULES-30:** Given a `dateRange`, when fields are counted, then a fixed range counts even when malformed; a flexible range counts with a `month` or `year`, even an invalid one such as `month: 0`; and a flexible range with only `durationNights` or `note` does not.
- **AC-RULES-31:** Given array and null fields, when fields are counted, then empty `experiences` and `people` do not count, `unmappedExperiences` never counts, null fields do not count, and a non-null `climate` does.

## MAX_STOPS_RANGE

- **AC-RULES-32:** Given a `maxStops` that is null, absent or 0, or a null `departure`, when rules are evaluated, then there is no violation.
- **AC-RULES-33:** Given a `maxStops` of -1, when rules are evaluated, then `MAX_STOPS_RANGE` fires at `/departure/maxStops` with `{ value: -1 }`.

## Evaluation as a whole

- **AC-RULES-34:** Given several violations, when rules are evaluated, then they come in catalog order and then document order, and each `path` index matches its traveler.
- **AC-RULES-35:** Given the same input twice, when rules are evaluated, then the results are equal, a deep-frozen input is not mutated, and the rule source reads neither a clock nor a random source.

## normalize

- **AC-RULES-36:** Given an all-null extraction, when it is normalized, then the result is `{}`.
- **AC-RULES-37:** Given an extraction with empty arrays and null subfields, when it is normalized, then they are dropped, a `departure` with only nulls is dropped, and `maxStops: 0` and `age: 0` are kept.
- **AC-RULES-38:** Given a date range within the caps (over-cap values: AC-LIMITS-07…09 in [`input-limits.md`](input-limits.md)), when it is normalized, then a flexible range loses its nulls, an all-null flexible range is dropped, a flexible range with only `note` is kept, and a fixed range is unchanged even when malformed.
- **AC-RULES-39:** Given any extraction within the caps (over-cap values: AC-LIMITS-07…10), when it is normalized, then strings are untouched, the result parses against `TripProfile`, and keys come out in schema order.
