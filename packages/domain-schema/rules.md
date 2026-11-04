# Rule catalog

The language-neutral source of truth for the business rules. Every backend implements these and must produce the violations in `fixtures/rules/`. `src/rules/` is the TypeScript implementation; if the two disagree, this file wins.

## How rules work

**Input:** a `TripProfile` that has already passed the wire schema, and the request's `referenceDate` (the client's local date, `YYYY-MM-DD`). Rules never read the system clock.

**Output:** a list of violations, each `{ code, path, params }`. `path` is a JSON Pointer into the profile, and `""` means the whole profile. Rules never throw. Messages are not part of the contract: clients render text from `code` and `params`.

**Routing:** an empty list means `ready`; anything else means `needs_clarification`, a normal 200 response. A rule failure is never an HTTP error.

**Order is part of the contract:** violations come in the order of the headings below, and in document order within a code (array index ascending; `start` before `end`; `month`, `year`, then `durationNights`). Fixtures compare exact lists.

**An absent field and a `null` field mean the same thing:** not mentioned. Neither one fires a range or date check.

## Definitions

**Calendar date.** A string is a calendar date when all of these hold, and implementations should check them directly instead of calling a date library:

1. It is exactly 10 characters: four digits, `-`, two digits, `-`, two digits. Digits are ASCII `0`–`9` only. Nothing may follow, not even a newline.
2. The month is 01–12.
3. The day is at least 01 and no more than the days in that month. February has 29 days when the year is divisible by 4 and either not divisible by 100 or divisible by 400, and 28 otherwise.

Calendar dates compare correctly as plain strings.

**Valid flexible fields.** `month` is 1–12, `year` is 2000–2100, and `durationNights` is at least 1.

**Non-blank string.** A string is non-blank when it contains at least one character without the Unicode `White_Space` property. U+00A0 and U+0085 are whitespace. U+FEFF and U+001C are not, even though some standard-library trim functions remove them.

## Rules

### CHILD_AGE_RANGE

A traveler with `userType: 'child'` and a non-null `age` must have `0 ≤ age ≤ 17`.

- **Path:** `/people/<index>/age`
- **Params:** `{ age, min: 0, max: 17 }` (bounds are inclusive)
- **Fixtures:** `fixtures/rules/CHILD_AGE_RANGE.json`

### ADULT_AGE_RANGE

A traveler with `userType: 'adult'` and a non-null `age` must have `18 ≤ age ≤ 120`.

- **Path:** `/people/<index>/age`
- **Params:** `{ age, min: 18, max: 120 }` (bounds are inclusive)
- **Fixtures:** `fixtures/rules/ADULT_AGE_RANGE.json`

### DATE_ORDER

A `fixed` range must have `end ≥ start`. Equal dates pass. The rule runs only when both are calendar dates; otherwise `DATE_VALID` reports the problem.

- **Path:** `/dateRange`
- **Params:** `{ start, end }`
- **Fixtures:** `fixtures/rules/DATE_ORDER.json`

### DATE_NOT_PAST

A date the user states must not be before `referenceDate`. Comparison uses only values that pass `DATE_VALID`.

| Date range | Compared | Violation when | `value` | Path |
|---|---|---|---|---|
| `fixed`, `start` is a calendar date | `start` | `start` is before `referenceDate` | `YYYY-MM-DD` | `/dateRange/start` |
| `flexible`, valid `month` and valid `year` | `YYYY-MM` | before the reference month | `YYYY-MM` | `/dateRange` |
| `flexible`, valid `year`, `month` absent or invalid | `YYYY` | before the reference year | `YYYY` | `/dateRange` |

Only the fixed `start` is checked: a past `end` with a later `start` is a `DATE_ORDER` violation. The current day, month or year passes. `MM` is zero-padded to two digits.

These are not compared, so they never fire this rule:

- A flexible `month` with no `year`. It means the next occurrence of that month, which is never in the past.
- A flexible range whose `year` is present but invalid.
- A flexible range with neither a valid `month` nor a `year`.

- **Params:** `{ value, referenceDate }`
- **Fixtures:** `fixtures/rules/DATE_NOT_PAST.json`

### DATE_VALID

Fixed `start` and `end` must each be a calendar date. Flexible `month`, `year` and `durationNights`, when present, must each be valid as defined above. Fixed dates have no year bound beyond the calendar-date definition. Each bad field is its own violation.

- **Path:** `/dateRange/start`, `/dateRange/end`, `/dateRange/month`, `/dateRange/year` or `/dateRange/durationNights`
- **Params:** `{ value }`, the offending value exactly as received
- **Fixtures:** `fixtures/rules/DATE_VALID.json`

### PARTY_HAS_ADULT

A non-empty `people` must contain at least one traveler with `userType: 'adult'`. This looks at `userType` only, so an adult with an out-of-range age still counts. Empty or absent `people` passes.

- **Path:** `/people`
- **Params:** `{}`
- **Fixtures:** `fixtures/rules/PARTY_HAS_ADULT.json`

### INSUFFICIENT_DETAIL

The profile must have at least `MIN_POPULATED_FIELDS` populated top-level fields. That constant is 3, shared through `generated/constants.json`. Each of the fields below counts once at most, so the maximum is 6.

| Field | Populated when |
|---|---|
| `region` | it is a non-blank string |
| `climate` | it is not null |
| `departure` | its `city` is a non-blank string; `mode` and `maxStops` alone do not count |
| `dateRange` | its kind is `fixed`, or it is `flexible` with a `month` or `year` present |
| `experiences` | it is a non-empty array |
| `people` | it is a non-empty array |

`unmappedExperiences` never counts. Validity does not matter here: a malformed fixed range or `month: 0` still counts, because `DATE_VALID` reports those separately.

- **Path:** `""`
- **Params:** `{ populated, required: 3 }`
- **Fixtures:** `fixtures/rules/INSUFFICIENT_DETAIL.json`

### MAX_STOPS_RANGE

A non-null `departure.maxStops` must be at least 0. `0` means non-stop.

- **Path:** `/departure/maxStops`
- **Params:** `{ value }`
- **Fixtures:** `fixtures/rules/MAX_STOPS_RANGE.json`

## Fixture format

`fixtures/rules/<CODE>.json` holds the cases for one code, and `fixtures/rules/_multiple.json` holds cases where several codes fire together. Each file is a JSON array of self-contained cases:

```json
{
  "id": "child-aged-18",
  "ac": "AC-RULES-02",
  "description": "child aged 18 fires CHILD_AGE_RANGE at the traveler index",
  "referenceDate": "2027-03-01",
  "profile": {
    "region": "Italy",
    "climate": "warm",
    "experiences": ["beach"],
    "people": [
      { "userType": "adult", "age": 40 },
      { "userType": "child", "age": 18 }
    ]
  },
  "expectedViolations": [
    {
      "code": "CHILD_AGE_RANGE",
      "path": "/people/1/age",
      "params": { "age": 18, "min": 0, "max": 17 }
    }
  ]
}
```

`profile` and `expectedViolations` are compared exactly, including order. `ac` links the case to an acceptance criterion in `docs/features/trip-validation.md`.
