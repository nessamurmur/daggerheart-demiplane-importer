# Verification evidence contract

Who this is for: whoever opens a PR here (a Cursor cloud agent, a Cursor session on NJ's machine, or NJ). The reviewer checks this list; a PR that meets it gets a verdict on the first pass. Read it before you start, not after you finish.

A PR is merge-eligible only when all of these hold for its current head SHA: the latest `<!-- dpi-review:v1 ... -->` comment has `verdict` `SATISFIED` and `head_sha` equal to that head, the label is `review:satisfied`, CI is green, and the evidence below is posted. The review itself is a `COMMENT` from `nessamurmur`, because that account also opens the pull requests and GitHub will not accept `APPROVE` or `REQUEST_CHANGES`. "Tests pass" with no detail is not evidence.

## 1. Classify the change

| Class | Touches | Required evidence |
| --- | --- | --- |
| D: docs or CI only | `*.md` (not behavior claims), `.github/**` | E1 |
| P: pure logic | `src/core.ts`, `src/levelups.ts`, `src/types.ts`, planning in `src/importer.ts`, with no change to what the wizard shows or what gets written | E1, E2, E3 |
| R: runtime, wizard, styles | `executePlan`, `foundryRuntime`, `loadCatalog`, `src/wizard.ts`, `src/module.ts`, `src/pdf.ts`, `styles/**`, `tests/helpers.ts` mirrors of Foundryborne | E1, E2, E3, E4 |
| M: manifest, build, release | `module.json`, `package.json`, `scripts/**`, `.github/workflows/release.yml`, `LICENSE`, notices | E1, E5, plus E4 if the built module's behavior can change |

When a PR spans classes, the strictest applies. Say which class you chose in the Verification section.

## 2. The evidence items

**E1: static gates.** The CI check named `ci` on the head SHA (workflow `.github/workflows/ci.yml`), with its conclusion, plus the commands you ran and what they printed. The commands are `pnpm typecheck`, `pnpm test`, `pnpm build`, and, when the change is class M or touches packaging, `node scripts/check-package-readiness.mjs`. Paste counts (how many tests passed). "Tests pass" with no count is not evidence. If CI has not been set up on a fork, paste those command outputs instead and say CI was absent.

**E2: head SHA.** Write the 7+ character head SHA the evidence was produced on. If you push again, either re-run or state that the later commits changed only comments, docs, or evidence.

**E3: red then green (fixes and behavior changes).** Name the test or journey that fails on the base commit and passes on the head, with the failing assertion's text. A new test that passes on both proves nothing. If a behavior change has no failing-first test, say why (for example a pure refactor guarded by existing tests) and name the existing tests that cover it.

**E4: live Foundry run (class R, any change to import behaviour, and any change to a mirror in `tests/helpers.ts`).** Use `.claude/skills/verify-foundry-importer`. That skill is pull request #11 (`cursor/verify-map-honesty-suite`); it is not on `main` until that PR merges, so run it from a checkout that contains it. It needs NJ's Foundry licence and the private sample PDFs, which stay outside git. Cloud agents cannot run it.

Read `journeys.json` in that skill and run the suite (`scripts/suite.mjs`): every entry with status `proven` and kind `open` or `import`. As of pull request #11 those are `open-importer`, `druid`, `ex_ampleton`, `luph`, `luph-levelup-manual`, and `raelyn`. `druid-stats-preserve` is an alias of `druid`, not a separate run. Recipe journeys (`oliver`, and the other `kind: "recipe"` entries) are not the suite; run one only when the change is about that recipe. Also run a new or changed journey when none of the proven journeys exercise the change through the UI path (sidebar button, wizard tabs, Create).

Post a comment headed `## Live evidence` containing:

- Foundry build, Foundryborne version, module version (from `module.json`), head SHA, run id, machine label (not a path with a username).
- The journeys run, one line each, `PASS` or `FAIL`.
- For a fix, the same journey failing on the base commit (SHA) and passing on the head. Name the assertion.
- `failures: 0` and `pageErrors: 0` from each `result.json`; say whether `browser-console.log` showed any `[daggerheart-demiplane-importer]` error or Foundry deprecation warning (paste the line if so).
- Stat or document claims come from Foundry's own documents (`world-after.json`): the prepared value and the effect that produces it, never the wizard's success banner.
- If the Foundry build differs from `compatibility.verified` in `module.json`, say so. Change `verified` only when the run was on that build.

The reviewer cannot open the evidence directory and will say the evidence is self-reported. Do not paste private character sheets, PDF text, or license data; journey names and the summary fields are enough.

If you cannot run E4, write `needs-live-run` in the Verification section with the reason and the exact journeys you would run, and stop. Apply the `needs-live-run` label when your account can create it. The verdict will be `NEEDS_EVIDENCE` until NJ's machine posts the block. A docs-only or CI-only change, or a manifest edit that cannot change import behaviour, does not need E4; say that in Verification instead of writing `needs-live-run`.

**E5: package artifact (class M).** After `pnpm build`: the ZIP file list (top-level folder name, `module.json` at its root), a diff showing `artifacts/module.json` equals the ZIP's `module.json`, the `download` and `manifest` URLs, and the output of `node scripts/check-package-readiness.mjs` (zero errors).

## 3. Also in every PR body (existing template, keep it)

`Why`, `What changed`, `Scope`, `Tradeoffs` (what you rejected and why), `Blast Radius` (who and what can break, with the one fact the safety rests on), `Verification` (the items above). Also:

- `User-facing strings`: list each added or changed UI label, notification, README sentence, or error message (or "none"). This keeps authorship decisions for the Foundry AI policy visible.
- `Requested by`: link or sentence showing NJ asked for the feature (not needed for a fix to a known defect).
- `Private data`: "no sample PDFs, character data, or licence data in this PR".

## 4. Example Verification section (shape only)

```md
## Verification
Class: R. Head: 4a41e01. CI check `ci`: <link> green.
- `pnpm typecheck && pnpm test && pnpm build`: paste the counts the commands printed. Name the test or journey that fails on the base SHA and passes on the head, with the failing assertion.
- Live (Foundry build, Foundryborne version, module version, run id): see the Live evidence comment. Journeys from `.claude/skills/verify-foundry-importer` `journeys.json`.
```

## 5. Cloud agent machine

E4 says cloud agents cannot run the suite, and that the verdict stays `NEEDS_EVIDENCE` until NJ's machine posts the block. That remains the fallback when `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD`, or `FOUNDRY_LICENSE_KEY` is missing, or when the private sample PDFs are not on the machine.

When those Runtime Secrets are set, the cloud agent runs E4 itself. `scripts/foundry-verify-server.sh up` prints `EVIDENCE`. That directory is what `render-evidence.mjs` reads (pull request #13, branch `cursor/live-evidence-screenshots-b34c`): `run.json` (`runId`, `foundry`, `foundryborne`, `moduleVersion`, `headSha`, no home directory path) and, after the suite, one `<journey-id>/` folder with `result.json`, the stable screenshot names, and `observation.txt`. Paste the printed `## Live evidence` block into the PR description. Do not paste `RUN` or `EVIDENCE` paths. `scripts/foundry-verify-server.sh down` stops the server and leaves that directory in place.

A Foundry licence allows one active server. Do not start a second one on NJ's computer or in another cloud agent. Secret names, the sample PDFs, and the one-time environment steps are in `docs/review/cloud-foundry.md`.
