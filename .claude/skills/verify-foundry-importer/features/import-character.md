# Import a character

A GM chooses an original Demiplane PDF, reviews every parsed value across four tabs, answers anything the PDF left blank, reviews calculated stats, acknowledges the review, and gets a **new** character actor (existing actors are never touched) with the import report saved on it.

## Sub-features

- `import-read`: **Read character** parses the PDF in the browser and shows the character's name and file name.
- `import-tabs`: Character, Content, Ancestry & companion, Notes & warnings all render with the parsed values.
- `import-required`: a blank experience bonus or missing level blocks **Review calculated stats** with an error naming it.
- `import-create`: **Create character** makes the actor, opens its sheet, and shows "Import complete".
- `import-report`: the report is stored in `flags.daggerheart-demiplane-importer.report` with `status: "complete"` and can be downloaded as JSON.
- `import-reject`: non-PDF, corrupted, or >30 MB files show an error and create nothing.
- `import-persist`: after a reload, the actor, its resources and its report are still there.

## How to get to it (user POV)

- Actors sidebar → **Import Demiplane PDF** → choose file → **Read character** → tabs → **Review calculated stats** → **Create character**.

## Driving it with harness.mjs

Preconditions: baseline; no actor named `[Import test] Jen`.

- **Full journey (proven).** `node import-pdf.mjs --url "$URL" --evidence "$EVIDENCE" --pdf ~/Downloads/druid.pdf --answers ../answers/druid.json`. Exit 0. `journey.log` shows `comparisons [["Evasion","8","10"]]` and `PASS`. `world-after.json` has `[Import test] Jen`: level 1, evasion 8, armor max 4, thresholds 7/14, one Round Shield, Gifted Tracker and Nature's Tongue in loadout, one `PDF import: Evasion` effect, `reportStatus: "complete"`. Suite id: `druid`.
- **Oliver (recipe only).** `--pdf ~/Downloads/oliver.pdf --answers ../answers/oliver.json` reaches review, but Create stays disabled on the blocking “Small Revolver” attack/hand issue. Complete or exclude that entry in answers before promoting to proven. Journey id: `oliver`.
- **Required answers (recipe only as a dedicated answers file).** Same command with an answers file that omits `experiences`. The journey fails with `preview failed: Enter a bonus for experience “Folk hero”, or remove it.` and `NN-failure.png` shows the `.dpi-error` banner. No actor is created.
- **Ex Ampleton** is covered under content-matching (`ex_ampleton`).
- **Download report (recipe only).** After create, `const dl = page.waitForEvent("download"); await action(page, "report").click(); await (await dl).saveAs(path.join(evidence, "report.json"))`. The file's `status` is `complete` and `actorUuid` matches the actor.
- **Reject bad files (recipe only).** `setInputFiles` with a renamed text file → **Read character** → `settle()` returns an error; `worldState` is unchanged. Journey id: `import-reject`.
- **Persistence (recipe only).** After create, `await join(page, url)` again and re-read `worldState`; the actor and `reportStatus` are unchanged. Journey id: `import-persist`.
- **val.pdf (recipe only).** Passed in prior evidence, but `answers/val.json` is not in the repo. Journey id: `val`.

## Gotchas

- `import-pdf.mjs` refuses nothing by name but warns if the name lacks `[Import test]`; keep the prefix so leftovers are obvious.
- Importing the same PDF twice creates a second actor by design. Use a fresh run, or account for the earlier actor in `world-before.json`.
- The wizard keeps state across tab switches only via its capture step; fill inputs on the tab they belong to before switching.
