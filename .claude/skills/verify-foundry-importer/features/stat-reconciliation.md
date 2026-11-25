# Stat reconciliation

Before creating anything, the wizard compares the PDF's exported Evasion, armor, thresholds, HP, Stress and Proficiency with what Foundry calculates from the chosen content. For each difference the GM picks **Use Foundry calculation** or **Preserve PDF value**; preserving adds a labelled, editable Active Effect for the difference. After creation every stat is re-checked against the preview.

## Sub-features

- `stats-preview`: the review table shows Statistic / PDF / Foundry per difference, computed once (no doubled class bonuses; regression from 0.1.0 where Evasion showed 20).
- `stats-preserve`: **Preserve PDF value** creates `PDF import: <Stat>` with an additive change equal to PDF − Foundry.
- `stats-foundry`: **Use Foundry calculation** creates no effect and the prepared stat equals the Foundry column.
- `stats-required`: **Create character** errors until every difference has a choice and the acknowledgement is ticked.
- `stats-verify`: if the created actor's stats differ from the preview, the import fails and rolls back.

## How to get to it (user POV)

- Wizard → **Review calculated stats** → the **Calculated statistics** table.

## Driving it with harness.mjs

Preconditions: baseline.

- **Preserve (proven).** Druid journey with `"comparisons": { "Evasion": "pdf" }`. `journey.log`: `[["Evasion","8","10"]]`. `world-after.json`: `evasion: 8`, effect `PDF import: Evasion` with change `system.evasion add -2`. Suite ids: `druid`, `druid-stats-preserve` (alias).
- **Foundry (recipe only).** Same PDF with `"comparisons": { "*": "foundry" }` and `"expect": { "actor": { "evasion": 10 }, "effects": [] }`. Exit 0. Journey id: `stats-foundry`.
- **Required choice (recipe only).** `--stop-at review`, then in a custom script leave the select on "Choose…", tick `#dpi-reviewed`, click create. `.dpi-error` reads "Choose a value for every stat difference." and no actor exists. Journey id: `stats-required`.

## Gotchas

- The Foundry column depends on the installed system's data model; check against Foundryborne 2.10.2 only.
- The Leather Armor "PDF base score 4; installed base score 3" line is informational. The armor total is still 4 because of the Round Shield effect; assert `armorScore.max`, not the item's base.
