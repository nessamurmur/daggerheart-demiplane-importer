---
name: verify-importer-contracts
description: >-
  Formally check the Demiplane importer's pure contracts with pnpm verify
  (fast-check 4.11.0 over the real functions, plus module.json and a generated
  form PDF). Use when editing src/core.ts, src/pdf.ts, src/levelups.ts,
  executePlan, makeReport, reportJSON, or adjustmentEffects in src/importer.ts,
  module.json manifest fields, or verify/.
---

# Verify importer contracts

`pnpm verify` checks promises the import keeps for every input inside a fixed bound. It does not open Foundry. Live end-to-end stays on NES-144 and runs only for a release candidate.

## Run it

From the repository root, after `pnpm install`:

```sh
pnpm verify
```

That is `node --test verify/*.test.ts`. The seed is `VERIFY_SEED` in `verify/check.ts` (`20261125`), so the same inputs run every time. A failure prints that seed and a `path`. The whole run is about a second. GitHub Actions runs the same command as the job named `formal-verification` (`.github/workflows/formal-verification.yml`) on every pull request to `main` and every push to `main`.

fast-check `4.11.0` and pdf-lib `1.17.1` are exact devDependencies in `package.json` and `pnpm-lock.yaml`. pdf.js is the existing `pdfjs-dist` `6.3.289`. Nothing in the run calls an AI tool.

The questions are "does this function keep its promise for every input in the bound?" `executePlan`'s rollback is checked by running the real function and declining writes, not by a separate model. A TLA+ model of the same steps would be a second copy of the TypeScript and would drift.

## Sync commit

Sync commit: `656ba2790adb37ab7ffeedb760439c931547741b`

That commit adds these checks. A following commit that only fills in this line does not change the covered files. If `git diff 656ba2790adb37ab7ffeedb760439c931547741b -- src/core.ts src/pdf.ts src/levelups.ts src/importer.ts module.json` is empty, this record is current.

Covered files at that commit:

- `src/core.ts`: `parseFields`, `finiteNumber`, `escapeHTML`, `paragraphs`, `setPath`, `getPath`, `parseWeapon`, `normalizeName`, `checked`, `fitCompanionTraining`, `validateCharacter`, `candidatesFor`, `resolveEntries`
- `src/pdf.ts`: `readPdf`
- `src/levelups.ts`: `inferLevelups`
- `src/importer.ts`: `executePlan`, `makeReport`, `reportJSON`, `adjustmentEffects`
- `module.json`: id, version, url, manifest, download, compatibility minimum and verified, the daggerheart system relationship, and paths for styles, esmodules, license, and readme. `package.json` name and version are compared to the manifest.
- `tests/helpers.ts` `LEVEL_TIERS` is the Foundryborne 2.10.2 default tier table passed into `inferLevelups`. It is input, not a function under test.

`verify/` is the check itself. A change there is a change to the proof, not to the product.

Move the sync commit forward only after you have read the covered functions, `pnpm verify` is green, and the properties still describe the code. If `git diff <sync> -- src/core.ts src/pdf.ts src/levelups.ts src/importer.ts module.json` is empty, the record is current even when a later commit edits only this file.

When those files change and this skill was not updated, use `/maintain-formal-verification-skill`.

## What each check covers

| Promise | Test | Functions |
| --- | --- | --- |
| A populated field is handled or named in an `unmapped-field` issue, and `source.fields` is a clone of the input | `populated PDF fields are handled or reported, and the source fields are a clone` | `parseFields` |
| A blank, boolean, null, or non-decimal is unknown (`null`). `0` and `"0"` stay `0`. Decimal spellings round-trip. `"1e2"` does not | `blank numbers stay unknown and zero stays zero` | `finiteNumber`, trait fields in `parseFields` |
| `escapeHTML` replaces `& < > " '` with entities, and `paragraphs` puts that text in `<p>` / `<br>` only | `escapeHTML leaves no raw markup and paragraphs are escaped text in p tags` | `escapeHTML`, `paragraphs` |
| A safe dotted path round-trips. A path segment `__proto__`, `prototype`, or `constructor` throws and does not write | `setPath round-trips a safe path and rejects prototype paths` | `setPath`, `getPath` |
| A `NdF` damage expression keeps the die, the signed bonus, and maps `magic` to `magical` | `a weapon damage expression keeps its die, signed bonus, and physical or magical type` | `parseWeapon` |
| If no domain card is marked in the loadout, every card is proposed for the loadout and one `loadout-unmarked` issue is recorded. A marked card stays out of the vault | `domain cards with no loadout mark are all proposed for the loadout` | `parseFields` |
| `normalizeName` is idempotent, folds case, and treats apostrophes as absent | `normalizeName folds case and drops apostrophes` | `normalizeName` |
| `checked` is true only for `true`, `1`, and `/yes`, `yes`, `on`, `true`, `1` (any case) | `checked recognizes only the Demiplane on-values` | `checked` |
| Companion training is padded or trimmed to `max(0, (level ?? 1) - 1)` and earlier choices stay in order | `companion training length follows the level and keeps the choices that remain` | `fitCompanionTraining` |
| Trait `0` validates. `null` does not. Level must be an integer 1 through 10. A null stat is allowed; a negative stat is not | `a zero trait validates and a blank trait does not` | `validateCharacter` |
| A candidate is returned only when the normalized name matches and the type is the entry's kind (or weapon/armor/loot/consumable for inventory text), ordered by pack then uuid | `candidatesFor returns only exact name and kind matches, in pack then uuid order` | `candidatesFor` |
| One match is selected. Several matches stay unresolved. An unmatched class, subclass, ancestry, or community stays unresolved. Any other unmatched entry is an editable item (`null`). A GM choice with `chosenFor` equal to the current name is kept | `resolveEntries waits on an identity item, keeps a single match, and preserves the GM's choice` | `resolveEntries` |
| Every non-blank field is in `fieldDisposition` once: `imported` only when it was handled and no issue names it, otherwise `reported` | `every non-blank field is imported or reported exactly once` | `makeReport` |
| `reportJSON` parses back to the report, and each `[field, value]` pair is on one line | `reportJSON parses back to the report and keeps each field pair on one line` | `reportJSON`, `makeReport` |
| A PDF stat choice stores `pdf - calculated`. A Foundry choice or an undecided comparison stores nothing | `PDF stat adjustments use the signed difference and skip a Foundry choice` | `adjustmentEffects` |
| A non-GM, an unreviewed plan, a blocking issue, or a comparison with `choice: null` performs no write | `executePlan does not write when the review is unfinished or the user is not a GM` | `executePlan` |
| On failure, every actor this call created is deleted or named in `cleanupFailures`. The failure report has no `actorUuid`. A bystander actor is not written | `a declined item create deletes only the actor this import created` and `executePlan deletes only documents it created, or names the ones it could not` | `executePlan` |
| Item creation order is main class, multiclass, subclass, other items, domain cards | `executePlan creates the main class before other items and domain cards last` | `executePlan` |
| Values written into a generated one-page AcroForm PDF come back as `source.fields`, and trait and level go through `finiteNumber` | `readPdf returns the form values that were written into the generated PDF` | `readPdf`, `parseFields` |
| More than 50 pages, more than 30 MB, or a non-PDF is rejected. `getDocument` is called with `isEvalSupported: false` | `readPdf refuses a PDF over 50 pages or 30 MB and disables document JavaScript` | `readPdf` |
| Level 1 stores no level-up history | `level 1 records no level-up history` | `inferLevelups` |
| Placed selections stay within each tier option's `checkboxSelections` and each level's `availableOptions`. Subclass and multiclass are not both taken in one tier. A domain-card uuid is recorded at most once, and not below its level | the `level-up` tests in `verify/levelups.test.ts` | `inferLevelups` |
| id, version, manifest URL, download URL, compatibility order, the daggerheart relationship, and referenced files hold for this repo. A download URL that is not this version's ZIP is a violation | `manifest gated properties hold for this repository` | `module.json`, `verify/manifest.ts` |

## Bounds and assumptions

- fast-check runs use seed `20261125`. Counts are the `numRuns` arguments in `verify/*.test.ts` (8 for generated PDFs, 20 for level-up evidence, up to 80 for field maps).
- Field maps have at most 12 keys. Strings are at most a few dozen characters. Level-up evidence uses levels 1 through 6 on the concrete cases and 1 through 4 in the generated case, at most 4 Hit Point picks, at most 3 domain cards, and at most 2 marked traits, against `LEVEL_TIERS` only.
- `finiteNumber` accepts a number when `String(value).trim()` matches `^[+-]?\d+(\.\d+)?$`. A number whose default string uses an exponent, such as `1e21`, is rejected. PDF fields are decimal text, so that bound is intentional.
- Generated PDFs are pdf-lib text fields with printable ASCII values. No checkboxes, no encrypted files, no personal sheets. The PDF is built in memory and is not committed.
- The `executePlan` runtime in `verify/world.ts` records writes and declines the Nth one. It is not Foundry. It initializes resource and armor values at 0, and the plans under test set marked resources to 0 and `calculatedStats` to empty, so the post-create stat check is in bounds. Item sources carry no feature grants.
- `inferLevelups` is not checked for "every pick that could fit was placed". The search stops at `SEARCH_BUDGET`. The check is that every selection that was placed respects the tier budgets, and that cards are not reused.

## Finding (not a passing check)

`module.json` `compatibility.maximum` is `"14"`. Foundry hard-enforces `maximum` and will not install the module on a higher generation. The property "compatibility.maximum is absent" does not hold. `pnpm verify` prints:

```text
FINDING compatibility.maximum is "14". Foundry hard-enforces maximum and blocks install above it. The property "compatibility.maximum is absent" does not hold.
```

The process still exits 0. The readiness lint records the same fact as INFO `compat-maximum` and asks whether it is intentional, so this PR does not delete the field. The test `known finding: compatibility.maximum is present` fails if the value disappears or changes, so the finding cannot rot quietly. If you remove `maximum`, add "compatibility.maximum is absent" to `manifestViolations` in `verify/manifest.ts`, delete that test, and delete this section. Do not weaken the gated checks to hide it.

## What is not covered

- `buildPlan`, catalog loading, and Foundryborne stat preparation. Those need the system.
- A real Foundry world, the wizard, or GM chrome. That is NES-144.
- Whether `inferLevelups` finds a layout whenever one exists.
- `sourceOptions` fuzzy ranking, beyond the exact-match rule in `candidatesFor`.
- Private character PDFs. Do not add any.

## A real bug or a modeling error

Run the counterexample by hand against the function named in the table.

- The product is wrong when the counterexample is a value a GM can produce (a blank trait, an unmatched class, a declined item create, a field left off the report) and the function's result breaks the promise in the table. Report it. Do not change the property so the run goes green, and do not change product code unless the fix is a trivial bug called out on its own.
- The check is wrong when the failure is only about prototypes (`__proto__: null` on a fast-check record), key order, or a field the recording runtime forgot (`_stats` on an embedded document). Compare JSON values, or teach `verify/world.ts` the missing Foundry shape. Do not change `src/` for that.
- pdf.js returning a different string than pdf-lib wrote can be either. Diff `source.fields` against the object passed to `formPdf` in `verify/fixtures.ts` before treating it as an importer bug.

## When covered code changes

1. Read the row above for the function you changed.
2. If the promise is the same, run `pnpm verify`. A failure means this change broke it.
3. If the promise itself changed, edit the test in `verify/`. Then delete the new guard, run `node --test --test-name-pattern '<test name>' verify/*.test.ts`, and confirm that test fails. Restore the guard and confirm `pnpm verify` is green. A check you have not seen fail does not count.
4. Update the table, the bounds, and the sync commit in this file only after that green run.

Each property in the table was seen failing on a broken variant (the guard removed or the step reordered) and passing again after the variant was restored. Repeat that before you trust a new property.
