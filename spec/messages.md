# Message catalog

The language-neutral source of truth for how a client words what the spec defines: one sentence per rule code, and a label for each value of the closed enums a client shows. Every client reads the same files, so a web app, a mobile app and any future client say the same things. `packages/domain-schema/src/messages/` is the TypeScript reader; if the two disagree, this file and `messages/` win.

**Messages are presentation only.** They are never sent on the wire, and nothing branches on them. Responses carry `code`, `path` and `params` (CLAUDE.md §4.5); a client turns those into text with this catalog. What a rule *means* is defined in [`rules.md`](rules.md), not here.

## Files

- One file per locale: `messages/<locale>.json`, where `<locale>` is a BCP 47 language tag (`en`, `fr`, `pt-BR`). The file's `locale` field equals its name.
- [`generated/MessageCatalog.schema.json`](generated/MessageCatalog.schema.json) gives the shape:

```jsonc
{
  "locale": "en",
  "violations": { "<RuleCode>": "<template>" },           // one per rule code
  "labels": {
    "experience": { "<Experience>": "<text>" },          // one per value
    "climate":    { "<Climate>": "<text>" },
    "travelMode": { "<TravelMode>": "<text>" },
    "userType":   { "<UserType>": "<text>" },
    "verification": { "<Verification>": "<text>" } // a factual claim's label
  }
}
```

- Every rule code and every enum value has exactly one entry, and there are no other keys. The schema requires every key, but like every generated schema it is open, so it can't reject extra keys. The catalog test (`packages/domain-schema/src/messages/catalog.test.ts`) does.
- Adding a rule code or an enum value (a `feat(domain-schema)`) fails the gate until every catalog has its text.

## Syntax

A template is an [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/) message, limited to a subset that every mainstream ICU library (formatjs, ICU4J, ICU4C, Swift and Kotlin wrappers) formats identically:

- literal text;
- simple arguments, `{name}`;
- `select`, `{name, select, a {…} b {…} other {…}}`, which must have an `other` branch.

Nothing else: no `plural`, `selectordinal`, `#`, `number`, `date`, `time` or skeletons, and no tags (`<b>…</b>`), so no template can carry markup. A client renders the result as plain text.

`plural` is left out for now because its arguments must be numbers, while everything else is passed as strings (next section). It can be added, with a rule for which arguments are numbers, when a template needs it.

**Apostrophes** follow ICU's default apostrophe mode (`DOUBLE_OPTIONAL`, the default in formatjs, ICU4J and ICU4C): a single `'` inside text, as in `isn't`, is a literal apostrophe. A `'` may never sit right next to `{` or `}`, where ICU would read it as quoting the brace. A client must use an ICU MessageFormat library, not one with stricter quoting rules: `java.text.MessageFormat` treats every `'` as a quote, so use ICU4J's `com.ibm.icu.text.MessageFormat` instead.

A label is plain text: literals only, with no arguments.

## Arguments

A violation's template is formatted with:

- **every property of its `params`,** as defined for its code in `rules.md` and [`generated/RuleViolation.schema.json`](generated/RuleViolation.schema.json);
- **`field`, the one derived argument:** the last reference token of the violation's `path`, unescaped per RFC 6901 (`~1` becomes `/`, then `~0` becomes `~`). The whole profile, `""`, gives `""`. For example `/dateRange/month` gives `month`, `/people/2/age` gives `age`, and `/dateRange` gives `dateRange`. It lets one template word each case of a code that applies to several fields, such as `DATE_VALID`.

No other argument may appear in a template.

**Every argument is passed as a string:** a number as its plain decimal form (`2101`, `-1`), and a string as it is (`2027-02-30`, `2030-02`). Some ICU libraries format a numeric simple argument with the locale's number format, so 2101 would become "2,101"; passing strings keeps every client's output the same. Dates are shown as the profile holds them, not reformatted.

## Fixtures

The rule fixtures in `fixtures/rules/` double as the catalog's examples. For every violation in them, each catalog's template must format to non-empty text that shows every argument value the chosen wording uses. The catalog test checks this for every locale.
