# Normalization

The language-neutral source of truth for turning what the extraction model fills in (`ExtractionSchema`) into the wire profile (`TripProfile`). The backend implements this and must produce the profiles in `fixtures/normalize/`, its executable examples. `packages/domain-schema/src/rules/normalize.ts` is the TypeScript implementation; if the two disagree, this file wins. Why values are discarded rather than truncated or reported as rule violations is recorded in [ADR 0004](../docs/decisions/0004-input-and-output-limits.md).

## How normalization works

**Input:** an object that has passed `generated/ExtractionSchema.schema.json`. Every field is present, and `null` means not mentioned. That schema has no length or count caps, so the input may hold values over them.

**Output:** a `TripProfile`. It always passes `generated/TripProfile.schema.json`, so the server never returns a profile its own request schemas would reject, and the client can send it back on the next turn.

**Normalization never throws and never changes a value.** It only removes things: nulls, empties and values over a cap. It does not trim, case-fold, deduplicate, reorder lists or fix malformed values. Range and format problems are left for the rules (`rules.md`).

**Steps, in order:**
1. Drop each value over a cap (see Caps and discards).
2. Drop what is then empty or null (see Nulls and empties).

So a `departure` whose only field was an over-long `city` disappears entirely, exactly as if `city` had been `null`.

## Definitions

**Length.** A string's length is its number of Unicode code points. A lone surrogate counts as one. This is also what `maxLength` means in the generated schemas (JSON Schema counts characters per RFC 8259). It is not the number of UTF-16 code units, so `🌴` has length 1, and it is not the number of graphemes, so `e` followed by U+0301 has length 2.

**Over a cap.** A string is over its cap when its length is greater than the cap. A list is over its cap when it has more items than the cap. A value exactly at its cap is kept.

**Caps.** The constants are shared through `generated/constants.json`, so this file names them instead of repeating their values.

## Sections

### nulls

**Nulls and empties.** After the caps are applied:

- A top-level field that is `null` is omitted.
- `experiences`, `unmappedExperiences` and `people` are omitted when empty.
- `departure` drops its `null` fields, and is omitted if none are left.
- Each traveler drops its `null` `age` and `gender`. `userType` is always present.
- A `flexible` date range drops its `null` fields, and is omitted if none besides `kind` are left. A range with only `note` is kept.
- A `fixed` date range is kept as it is, even when its dates are malformed. `DATE_VALID` reports those.
- `0` is a value, not an empty: `maxStops: 0`, `age: 0`, `month: 0` and `durationNights: 0` are kept.
- Strings are kept as they are, including `""` and whitespace. The rules judge blank strings.

- **Fixtures:** `fixtures/normalize/nulls.json`

### strings

**Over-long text fields.** Each of these is dropped when it is over its cap. Only that field goes; its parent object stays unless it is then empty.

| Field | Cap |
|---|---|
| `region` | `maxShortTextLength` |
| `departure.city` | `maxShortTextLength` |
| `people[i].gender` | `maxShortTextLength` |
| `dateRange.note` (flexible) | `maxNoteLength` |

- **Fixtures:** `fixtures/normalize/strings.json`

### dates

**Over-long fixed dates.** A `fixed` range needs both `start` and `end`. When either is over `maxDateTextLength`, the whole `dateRange` is dropped.

- **Fixtures:** `fixtures/normalize/dates.json`

### lists

**Over-long items and over-count lists.**

- Each `unmappedExperiences` item over `maxShortTextLength` is dropped. The others keep their order.
- Then each list over its count cap is dropped whole. Lists are never shortened to the cap.

| List | Count cap |
|---|---|
| `experiences` | `maxExperiences` |
| `unmappedExperiences` (after item drops) | `maxUnmappedExperiences` |
| `people` | `maxPeople` |

- **Fixtures:** `fixtures/normalize/lists.json`

## Fixture format

`fixtures/normalize/<section>.json` holds the cases for one `###` section above. Each file is a JSON array of self-contained cases:

```json
{
  "id": "region-over-cap",
  "ac": "AC-LIMITS-07",
  "description": "a region one code point over maxShortTextLength is dropped",
  "extraction": {
    "departure": null,
    "dateRange": null,
    "region": "<101 code points>",
    "climate": "warm",
    "experiences": null,
    "unmappedExperiences": null,
    "people": null
  },
  "expectedProfile": { "climate": "warm" }
}
```

- `id` is unique across all files.
- `ac` names the acceptance criterion in `docs/features/input-limits.md` or `docs/features/trip-validation.md`.
- `extraction` passes `generated/ExtractionSchema.schema.json`.
- `expectedProfile` passes `generated/TripProfile.schema.json`.

Compare the normalized profile with `expectedProfile` as JSON values: key order does not matter, but list order does. What the implementation reports about discarded values is not part of this spec.
