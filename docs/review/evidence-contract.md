# Verification evidence contract

Who this is for: whoever opens a PR here (a Cursor cloud agent, a Cursor session on NJ's machine, or NJ). The reviewer checks this list; a PR that meets it gets a verdict on the first pass. Read it before you start, not after you finish.

A PR is merge-eligible only when all of these hold for its current head SHA: the latest `<!-- dpi-review:v1 ... -->` comment has `verdict` `SATISFIED` and `head_sha` equal to that head, the label is `review:satisfied`, the jobs `ci` and `formal-verification` are green, and the evidence below is posted. The review itself is a `COMMENT` from `nessamurmur` or `cursor[bot]`. Either author counts. `nessamurmur` also opens the pull requests, so GitHub will not accept `APPROVE` or `REQUEST_CHANGES` from that account. "Tests pass" with no detail is not evidence. The merge checklist is `CONTRIBUTING.md`.

## 1. Classify the change

| Class | Touches | Required evidence |
| --- | --- | --- |
| D: docs or CI only | `*.md` (not behavior claims), `.github/**` | E1 |
| P: pure logic | `src/core.ts`, `src/levelups.ts`, `src/types.ts`, planning in `src/importer.ts`, with no change to what the wizard shows or what gets written | E1, E2, E3 |
| R: runtime, wizard, styles | `executePlan`, `foundryRuntime`, `loadCatalog`, `src/wizard.ts`, `src/module.ts`, `src/pdf.ts`, `styles/**`, `tests/helpers.ts` mirrors of Foundryborne | E1, E2, E3 |
| M: manifest, build, release | `module.json`, `package.json`, `scripts/**`, `.github/workflows/release.yml`, `LICENSE`, notices | E1, E5 |

When a PR spans classes, the strictest applies. Say which class you chose in the Verification section.

E4 is separate from the class. It is required only on a release candidate: a pull request that bumps `version` in `module.json` and `package.json` together. Class R, a change to import behaviour, and a change to a mirror in `tests/helpers.ts` do not require E4 unless that pull request is a release candidate. Every class requires the `formal-verification` job, which is part of E1. Policy date: 25 November 2026 (`CONTRIBUTING.md`).

## 2. The evidence items

**E1: static gates.** On the head SHA, the job `ci` (`.github/workflows/ci.yml`) and the job `formal-verification` (`.github/workflows/formal-verification.yml`), with their conclusions, plus the commands you ran and what they printed. The commands are `pnpm typecheck`, `pnpm test`, `pnpm verify`, `pnpm build`, and, when the change is class M or touches packaging, `node scripts/check-package-readiness.mjs`. `pnpm verify` is the formal-verification command. It needs no AI tooling. Paste counts (how many tests passed, including `pnpm verify`). "Tests pass" with no count is not evidence. `ci` runs on every pull request. `formal-verification` runs on every pull request into `main`. If those jobs are absent, paste the command outputs and say so.

**E2: head SHA.** Write the 7+ character head SHA the evidence was produced on. If you push again, either re-run or state that the later commits changed only comments, docs, or evidence.

**E3: red then green (fixes and behavior changes).** Name the test or journey that fails on the base commit and passes on the head, with the failing assertion's text. A new test that passes on both proves nothing. If a behavior change has no failing-first test, say why (for example a pure refactor guarded by existing tests) and name the existing tests that cover it.

**E4: live Foundry run (release candidates only).** A release candidate is a pull request that bumps `version` in `module.json` and `package.json` together. No other pull request posts E4. When the version is unchanged, a class R change, a change to import behaviour, or a mirror change in `tests/helpers.ts` records "not a release candidate" in Verification.

On a release candidate, use `.claude/skills/verify-foundry-importer` from this repository. It is on `main`. It needs NJ's Foundry licence and the private sample PDFs, which stay outside git.

Read `journeys.json` in that skill and run the suite (`scripts/suite.mjs`): every entry with status `proven` and kind `open` or `import`. Those are `open-importer`, `druid`, `ex_ampleton`, `luph`, `luph-levelup-manual`, and `raelyn`. `druid-stats-preserve` is an alias of `druid`, not a separate run. Recipe journeys (`oliver`, and the other `kind: "recipe"` entries) are not the suite; run one only when the change is about that recipe. Also run a new or changed journey when none of the proven journeys exercise the change through the UI path (sidebar button, wizard tabs, Create).

Paste a `## Live evidence` section into the PR description, produced by `scripts/render-evidence.mjs` in that skill. The block contains:

- Head SHA, Foundry build, Foundryborne version, module version (from `module.json`), and run id. No home directory path.
- One `PASS` or `FAIL` line per journey, then one observation sentence per journey (what you saw on screen).
- The journey screenshots embedded as images: for an import, the wizard steps, the review screen, and the created actor sheet; for open-importer, the wizard opening. The image URLs are GitHub user-attachments, not files in the repository.
- `failures: 0` and `pageErrors: 0` from each `result.json`, and whether `browser-console.log` showed a `[daggerheart-demiplane-importer]` error or a Foundry deprecation warning.
- For a fix, in the Verification section, the same journey failing on the base commit (SHA) and passing on the head. Name the assertion.
- Stat or document claims come from Foundry's own documents (`world-after.json` stays on the machine): the prepared value and the effect that produces it, never the wizard's success banner. Put that claim in the observation or Verification section, not by pasting the JSON.
- If the Foundry build differs from `compatibility.verified` in `module.json`, say so. Change `verified` only when the run was on that build.

A live-evidence block with pass/fail text and no screenshots is incomplete. So is a block missing an observation for a journey. The reviewer cannot open the evidence directory. The screenshots in the PR description are the pictures they can check. Pass/fail lines are still the implementer's report. Do not paste `world-after.json`, PDF text, console dumps, or licence data. Character names show up in the screenshots; on a public PR those images are public. The sample PDFs stay out of git.

Every critical issue the live run finds is fixed before merge. If you cannot run E4 on a release candidate, write `needs-live-run` in the Verification section with the reason and the exact journeys you would run, and stop. Apply the `needs-live-run` label when your account can create it. The verdict will be `NEEDS_EVIDENCE` until the block is posted. A pull request that does not bump the version does not need E4. Say "not a release candidate" in Verification. Do not write `needs-live-run` for that pull request.

**E5: package artifact (class M).** After `pnpm build`: the ZIP file list (top-level folder name, `module.json` at its root), a diff showing `artifacts/module.json` equals the ZIP's `module.json`, the `download` and `manifest` URLs, and the output of `node scripts/check-package-readiness.mjs` (zero errors).

## 3. Also in every PR body (existing template, keep it)

`Why`, `What changed`, `Scope`, `Tradeoffs` (what you rejected and why), `Blast Radius` (who and what can break, with the one fact the safety rests on), `Verification` (the items above). Also:

- `User-facing strings`: list each added or changed UI label, notification, README sentence, or error message (or "none"). This keeps authorship decisions for the Foundry AI policy visible.
- `Requested by`: link or sentence showing NJ asked for the feature (not needed for a fix to a known defect).
- `Private data`: no sample PDFs, world JSON, rules text, or Foundry licence data in the PR or in git. Live screenshots are GitHub user-attachments; character names in those images are visible on the PR.

## 4. Example Verification section (shape only)

```md
## Verification
Class: R. Head: 4a41e01. Not a release candidate (`module.json` and `package.json` versions unchanged).
- Jobs `ci` and `formal-verification`: green on that head.
- `pnpm typecheck && pnpm test && pnpm verify && pnpm build`: paste the counts the commands printed. For a fix, name the test that fails on the base SHA and passes on the head, with the failing assertion.
- Live Foundry: not required.
```

A release candidate replaces the Live Foundry line with the `## Live evidence` block from `.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs` (head SHA, Foundry and Foundryborne versions, module version, run id, one pass/fail line, one observation, and screenshots per journey).

## 5. Cloud agent machine

E4 applies only when the pull request bumps the version. On any other pull request, do not start Foundry and do not write `needs-live-run`.

On a release candidate, run the suite when `FOUNDRY_LICENSE_KEY` is set, the Foundry Node zip is in the verify cache, and the private sample PDFs are on the machine. `scripts/foundry-verify-server.sh up` prints `EVIDENCE`. That directory is what `.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs` reads: `run.json` (`runId`, `foundry`, `foundryborne`, `moduleVersion`, `headSha`, no home directory path) and, after the suite, one `<journey-id>/` folder with `result.json`, the stable screenshot names, and `observation.txt`. Paste the printed `## Live evidence` block into the PR description. Do not paste `RUN` or `EVIDENCE` paths. `scripts/foundry-verify-server.sh down` stops the server and leaves that directory in place.

When `FOUNDRY_LICENSE_KEY` is missing, the Foundry Node zip is not in the verify cache, or the private sample PDFs are not on the machine, write `needs-live-run` for that release candidate and stop. The verdict stays `NEEDS_EVIDENCE` until the block is posted.

A Foundry licence allows one active server. Do not start a second one on NJ's computer or in another cloud agent. Secret names, the sample PDFs, and the one-time environment steps are in `docs/review/cloud-foundry.md`.
