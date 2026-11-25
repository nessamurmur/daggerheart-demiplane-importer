# Advanced characters

The wizard handles characters beyond a single level-1 class: multiclass (second class, subclasses, one gained domain), mixed ancestry (primary and secondary ancestry features), a linked companion with its stats and previous training, and higher-level snapshots marked as having incomplete history.

## Sub-features

- `adv-multiclass`: **Add multiclass** / **Add subclass**, parent class per subclass, one gained domain; Foundry links the subclass to the correct class.
- `adv-mixed-ancestry`: "Use features from two ancestries" with primary/secondary selects; one combined ancestry item.
- `adv-companion`: "Create and link a companion" creates a second actor linked both ways, with one training choice per previous level.
- `adv-snapshot`: level > 1 sets `incompleteHistory` and does not reapply bonuses on a later level-up.

## How to get to it (user POV)

- Wizard → **Content** tab (multiclass buttons) and **Ancestry & companion** tab.

## Driving it with harness.mjs

Preconditions: baseline.

- **Higher-level snapshot (proven).** `node import-pdf.mjs ... --pdf ~/Downloads/luph.pdf --answers ../answers/luph.json` or `raelyn.json`. Exit 0. `levelups.json` matches `expect.levelupDialog`. Suite ids: `luph`, `raelyn`.
- **Manual level-up setting (proven).** `--answers ../answers/luph-levelup-manual.json` sets `levelupAuto: false` before import. Suite id: `luph-levelup-manual`.
- **Companion (recipe only).** After read: `tab(page,"advanced")`, `check('[data-bind="companion.enabled"]')` (re-renders), fill `companion.name` = `[Import test] Pet`, `companion.evasion`, `companion.stressMax`, `companion.attackName`, select `companion.damageDice`, `companion.range`. Set `level` to 2 on the Character tab first to get `select[data-training="0"]`. Preview, create. `world-after.json` has a second actor of type `companion`, and the report has `companionUuid`.
- **Mixed ancestry (recipe only).** `check('[data-bind="mixedAncestry.enabled"]')`, fill `mixedAncestry.name`, select primary/secondary from `select[data-bind="mixedAncestry.primaryUuid"]`. The created character has one ancestry item with the combined name. Ad-hoc evidence exists; commit an answers file before calling it proven.
- **Multiclass (recipe only).** Content tab → `action(page,"add-class")`, choose its source, set `entries.<i>.domains`; `action(page,"add-subclass")`, set `entries.<j>.className`. Create and inspect class/subclass items. Ad-hoc evidence exists; commit an answers file before calling it proven.

## Gotchas

- Companion, mixed ancestry, and multiclass are recipe only in `journeys.json` until they have answers and a suite pass.
- With Foundryborne's automatic level-up setting off, its own multiclass dialog can pop up during creation; `dismissPopups` will not catch it mid-journey.
- Do not use Foundry's level rollback on imported snapshots.
