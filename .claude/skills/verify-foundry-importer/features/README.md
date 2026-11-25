# Importer verification map

This directory is the maintained source for verifying what a GM can do with the Demiplane PDF importer in real Foundry. Read this index, then use the matching feature file as the recipe. Commands are in `../SKILL.md`. Journey status lives in `../journeys.json`. The suite runs every `proven` open/import entry from that file.

## Status tags

- **Proven.** A committed answers file (or open script) has passed on this machine. `node scripts/suite.mjs` can rerun it.
- **Recipe only.** Described with harness steps, but not yet a suite entry. Report as not run until it has answers and a pass.

## Baseline preconditions

- A run started by `fvtt.sh launch` from a fresh `pnpm build`; `fvtt.sh doctor "$RUN"` all `ok`.
- World `dpi-verify`, system Foundryborne 2.10.2 with its bundled SRD compendiums, no actors, joined as `Gamemaster`.
- Sample PDFs in `~/Downloads` (`druid.pdf`, `ex_ampleton.pdf`, `luph.pdf`, `oliver.pdf`, `raelyn.pdf`).
- Never drive the user's Sqyre world or any instance this run did not start.

## Driving conventions

- Enter through the user path: Actors sidebar → **Import Demiplane PDF**. The `api.openImporter()` macro entry is a second entry point, not a substitute.
- Prefer the `data-dpi-action`, `data-bind`, `data-tab` and `aria-label` handles listed in `SKILL.md`.
- Name every created actor with the `[Import test] ` prefix.
- After `pnpm build`, open a new harness session; the run serves `dist/` live.

## Proof and skip reporting

- Capture the action (stable screenshot names per step; see `SKILL.md`) and the resulting Foundry state (`world-after.json`), not only the success screen. Publish the screenshots and one observation per journey with `scripts/render-evidence.mjs`.
- Assert that pre-existing actors are unchanged after any create or failure.
- Record the PDF, answers file, entry point and Foundry build with the result.
- If a precondition is missing (e.g. no multiclass sample PDF), report the journey as not run and why. Do not report it as verified through another path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behaviour, then exactly these H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with harness.mjs`, `Gotchas`.

## Features

- [Open the importer](./open-importer.md): sidebar button, macro API, GM-only gate. **Proven:** `open-importer`. **Recipe only:** `open-gm-only`.
- [Import a character](./import-character.md): upload, review tabs, required answers, create, report saved. **Proven:** `druid`. **Recipe only:** `oliver`, `import-reject`, `import-persist`, `val`.
- [Content matching](./content-matching.md): compendium matches, editable PDF items, unregistered domains, duplicates, refresh. **Proven:** `ex_ampleton`. **Recipe only:** `match-override`, `match-refresh`.
- [Stat reconciliation](./stat-reconciliation.md): Foundry vs PDF values, labelled Active Effects, no doubled bonuses. **Proven:** `druid-stats-preserve` (alias of `druid`). **Recipe only:** `stats-foundry`, `stats-required`.
- [Advanced characters](./advanced-characters.md): multiclass, mixed ancestry, companion, higher-level snapshots. **Proven:** `luph`, `luph-levelup-manual`, `raelyn`. **Recipe only:** `adv-companion`, `adv-mixed-ancestry`, `adv-multiclass`.

## Suite

```sh
S=.claude/skills/verify-foundry-importer/scripts
node $S/suite.mjs --list
node $S/suite.mjs --url "$URL" --evidence "$EVIDENCE"
node $S/suite.mjs --url "$URL" --evidence "$EVIDENCE" --only open-importer,druid
# one sentence per journey in $EVIDENCE/<id>/observation.txt, then:
node $S/render-evidence.mjs --evidence "$EVIDENCE"
```

Keep the map honest with `/maintain-verification-skill` when the wizard or Foundryborne version changes.
