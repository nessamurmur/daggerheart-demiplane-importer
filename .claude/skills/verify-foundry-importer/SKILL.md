---
name: verify-foundry-importer
description: Drive the Demiplane PDF importer inside a real, isolated Foundry VTT 14 + Foundryborne Daggerheart 2.10.2 instance on this machine, the way a GM does (Actors sidebar button, wizard tabs, stat review, Create character), and capture screenshots plus created-actor state as proof. Use after changing src/ or styles/, before a release, or whenever unit tests alone cannot show that an import really works in Foundry.
---

# Verify the importer in real Foundry

The module only means anything inside Foundry. This skill starts a **throwaway** local Foundry server with its own copy of the data, joins it headlessly as Gamemaster through system Chrome, drives the wizard with Playwright, and asserts on the actors that were actually created.

Never drive the user's Sqyre world (Witherwild) or any server this skill did not start. Every run gets a fresh data dir and a random port, so parallel runs are fine.

## Layout (outside the repo)

| Path | What |
| --- | --- |
| `~/foundry-verify/app-14.370/` | Foundry 14.370 Linux build, run with Node from nvm (`node resources/app/main.mjs`). |
| `~/foundry-verify/base/` | Base data dir: signed license (`Config/license.json`) and Foundryborne 2.10.2 in `Data/systems/daggerheart`. Copied for every run; never driven directly. |
| `~/foundry-verify/runs/<id>/` | Per-run data dir, world `dpi-verify`, `server.log`, `server.pid`, `port`. Deleted by `stop`. |
| `~/foundry-verify/evidence/<id>/` | Proof. Survives `stop`. |
| `~/Downloads/druid.pdf`, `~/Downloads/ex_ampleton.pdf` | Private sample PDFs (gitignored; never copy them into the repo). Other real exports there: `luph.pdf`, `oliver.pdf`, `raelyn.pdf`, `val.pdf`. |

In the repo: `scripts/fvtt.sh` (server lifecycle), `scripts/harness.mjs` (Playwright helpers), `scripts/import-pdf.mjs` (import journey), `scripts/open-importer.mjs` (open/close/reopen, fails on page errors), `scripts/suite.mjs` (every proven journey), `journeys.json` (proven vs recipe registry), `answers/*.json` (per-PDF review answers and expected end state), `features/` (verification map).

## One-time setup (already done on this machine)

Only redo this if `~/foundry-verify/base` is missing.

1. Unzip the Foundry Linux zip (from foundryvtt.com, the user's account) into `~/foundry-verify/app-14.370`.
2. Start it once against `~/foundry-verify/base` (`node resources/app/main.mjs --dataPath=$HOME/foundry-verify/base --port=30777`). **The user** enters the license key and accepts the EULA in the browser; an agent must not handle the key. Stop the server afterwards.
3. Download `https://github.com/Foundryborne/daggerheart/releases/download/2.10.2/system.zip` and unzip into `~/foundry-verify/base/Data/systems/daggerheart`.
4. `cd .claude/skills/verify-foundry-importer/scripts && npm install` (pinned `playwright-core`, uses `/usr/bin/google-chrome`; no browser download).

## Launch

Every shell must load Node first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.

```sh
pnpm build                                          # in the repo root; the run links dist/ live
S=.claude/skills/verify-foundry-importer/scripts
$S/fvtt.sh launch
# RUN=/home/nj/foundry-verify/runs/<id>
# URL=http://localhost:<port>
# EVIDENCE=/home/nj/foundry-verify/evidence/<id>
```

`launch` copies `base`, writes a `dpi-verify` world for Foundryborne, symlinks `dist/daggerheart-demiplane-importer` into the run's `Data/modules`, and starts the server with `--world=dpi-verify`. It returns only once `GET $URL/api/status` reports `"active":true` (usually ~2 s). The world starts empty, with one user, `Gamemaster`, with no password. The harness enables the module on first join (it is off in a fresh world) and reloads.

To verify another checkout (e.g. a PR worktree), build there and prefix every `fvtt.sh` call with `IMPORTER_REPO=/path/to/worktree`; `doctor` then checks that checkout's `dist/`.

Because `dist/` is symlinked, after `pnpm build` you only need to reload the page (start a new harness session); no relaunch.

## Doctor

Run first, and whenever anything looks off:

```sh
$S/fvtt.sh doctor "$RUN"
```

Checks: the pid is this run's server (matched by `--dataPath`), it owns the port, the world is active with system 2.10.2, the module link points at this repo's `dist/`, the built version matches `module.json`, and warns if `src/` or `styles/` is newer than the build (i.e. you are about to verify stale code). `fvtt.sh list` shows all runs and whether each is alive.

## Drive

List or run every proven journey (open-importer plus each answers file marked proven in `journeys.json`):

```sh
node $S/suite.mjs --list
node $S/suite.mjs --url "$URL" --evidence "$EVIDENCE"
node $S/suite.mjs --url "$URL" --evidence "$EVIDENCE" --only open-importer,druid
```

Import one PDF end to end, as a GM:

```sh
node $S/import-pdf.mjs --url "$URL" --evidence "$EVIDENCE" \
  --pdf ~/Downloads/druid.pdf --answers .claude/skills/verify-foundry-importer/answers/druid.json
```

What it does, in user terms: clicks the Actors sidebar tab → **Import Demiplane PDF** → chooses the file → **Read character** → visits **Character / Content / Ancestry & companion / Notes & warnings** → types the answers (name, blank experience bonuses, level, …) → **Review calculated stats** → picks **Use Foundry calculation** / **Preserve PDF value** per stat → ticks the review acknowledgement → **Create character**. Then it reads the world and checks the new character against `expect` in the answers file, and that every pre-existing actor is byte-for-byte unchanged. Exit 0 = PASS.

`--stop-at edit` or `--stop-at review` stops before creating anything (for checking parsing, matching, or the stat preview). `HEADED=1` shows the browser.

Answers file shape is documented at the top of `import-pdf.mjs`. Always keep the `[Import test] ` name prefix. Proven answers (also in `journeys.json`): `druid.json`, `ex_ampleton.json`, `luph.json`, `luph-levelup-manual.json`, `raelyn.json`. Recipe-only journeys (including `oliver.json`, which hits a blocking Small Revolver issue) stay out of the suite until they have a pass. Keep the map honest with `/maintain-verification-skill`.

For journeys the script does not cover, write a small script using `harness.mjs`:

```js
import { session, openImporterFromSidebar, settle, action, tab, worldState, WIZARD } from "./harness.mjs";
const s = await session({ url, evidence });           // joined as GM, module active
await openImporterFromSidebar(s.page);
await s.page.setInputFiles(`${WIZARD} #dpi-file`, pdf); await action(s.page, "read").click(); await settle(s.page);
await tab(s.page, "advanced").click(); await s.shot("advanced");
await s.close();
```

Stable handles (from `src/wizard.ts` / `src/module.ts`): wizard root `#daggerheart-demiplane-importer`; sidebar button `#actors button[data-module="daggerheart-demiplane-importer"]`; buttons `[data-dpi-action="read|tab|preview|back|create|restart|rematch|add-experience|add-entry|add-class|add-subclass|add-companion-experience|report"]`; tabs `[data-dpi-action="tab"][data-tab="character|content|advanced|notes"]`; inputs `[data-bind="<path>"]` (e.g. `level`, `experiences.0.value`, `companion.enabled`); per-item source `select[data-source]` with `aria-label="Source for <name>"`; stat choice `select[aria-label="Resolve <Stat>"]`; acknowledgement `#dpi-reviewed`; error banner `.dpi-error`; busy spinner `.dpi-status`; issues `.dpi-issues li`.

## Evidence

Each journey writes to `$EVIDENCE/<pdf>-<HHMMSS>/`:

- numbered screenshots of every step (`01-wizard-upload.png` … `07-review.png`, `08-created.png`, or `NN-failure.png`);
- `content-matches.json` (each Content-tab entry: name, kind, chosen source);
- `world-before.json` / `world-after.json`: every actor's prepared stats (level, traits, evasion, HP, Stress, armor, thresholds), items with compendium source / equipped / vault, Active Effects with changes, and import report status, read back from Foundry after creation;
- `journey.log`, `browser-console.log` (look for `[daggerheart-demiplane-importer]` errors and `[pageerror]`), `result.json` (`pass`, `failures`, `pageErrors`).

`stop` also copies `server.log` into `$EVIDENCE`.

Proof standards:

- Go through the user path (sidebar button and wizard controls). Do not call `executePlan`, `buildPlan` or set wizard fields in JS as proof. The only API shortcut is enabling the module in setup.
- Prove the outcome from Foundry's own documents (`world-after.json`), not from the wizard's success message.
- A stat claim needs the prepared value **and** the effect that produces it (e.g. Evasion 8 = base 10 + `PDF import: Evasion` −2).
- Say which Foundry build you verified on (14.370 here; the module's `verified` is 14.367).
- To verify a fix, first show the journey failing on the code before the fix (or with the assertion that captures the bug), then passing after.

## Cleanup

```sh
$S/fvtt.sh stop "$RUN"
```

Kills only the pid recorded for that run (after checking its command line has that run's `--dataPath`), deletes the run dir, and keeps `$EVIDENCE`. It refuses paths outside `~/foundry-verify/runs`. Never `pkill node` or `pkill foundry`: the user may be running other Node apps or their own Foundry. Stop every run you launch, including after failed attempts.

## Gotchas

- **No dot-directories in the Foundry path.** Foundry's Express `sendFile` refuses any path with a `/.something/` segment, so the EULA page and other files 404 if the app or data live under `~/.local/...`. `fvtt.sh` refuses such paths.
- **Node:** nvm provides Node 26. Foundry declares `>=24.22.1 <25` but runs on 26; if Foundry misbehaves in a way that smells like the runtime, try `nvm install 24` before blaming the module.
- **Version drift:** this instance is Foundry **14.370**, not the 14.367 in `VALIDATION.md`. Foundryborne is the exact 2.10.2 release zip.
- The license is bound to this machine. Concurrent local runs work; do not copy `base/Config/license.json` anywhere else.
- Headless Chrome has no GPU; Foundry logs a hardware-acceleration warning and runs the canvas slowly (~4 FPS). It is harmless for the wizard. Use `HEADED=1` for visual checks of styling.
- PDFs with blank experience bonuses or no level block **Review calculated stats** with an error banner until answered. That is the intended behaviour, not a harness failure.
- **Welcome tour:** Foundry's `core.welcome` tour lives in the browser's localStorage, so every fresh Playwright profile would see it start a few seconds into a new world, and its `.tour-overlay` swallows every click. `session()` pre-marks it complete with an init script. If clicks time out with "tour-overlay intercepts pointer events", that seeding broke.
- Never kill helpers by pattern (`pkill -f 'node ...'`): the pattern matches your own shell. Use `fvtt.sh stop`, or a pid you recorded.
- `fvtt.sh launch` must background `node` directly; wrapping it in a subshell records the wrong pid and keeps the caller's stdout pipe open.
- Expected review warnings for the samples (not regressions): Jen has malformed armor thresholds `{0} / {1}` and the Leather Armor base score 4 vs 3 note; Ex Ampleton has `0Greatstaff`, a duplicate Twisted Dagger, and unregistered `blood` domain cards.
