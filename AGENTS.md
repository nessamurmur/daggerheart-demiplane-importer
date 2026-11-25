# AGENTS.md

Foundry VTT module that imports Demiplane PDF character sheets into Foundryborne characters. Compatible with Daggerheart. Target Foundry 14.x (`compatibility.verified` in `module.json` is 14.367). Base branch: `main`.

## Before you open a PR

1. Read `docs/review/reviewer.md` (the rubric you will be reviewed against) and `docs/review/evidence-contract.md` (the evidence you must post).
2. Use `.github/pull_request_template.md`. Every section is required.
3. Run `pnpm typecheck && pnpm test && pnpm build && node scripts/check-package-readiness.mjs`. The readiness script must finish with no errors.
4. Anything that changes import behaviour needs the live Foundry journeys in `.claude/skills/verify-foundry-importer`. That skill is pull request #11 and is not on `main` until it merges; use that copy. Its suite is the `journeys.json` entries with status `proven` and kind `open` or `import`: `open-importer`, `druid`, `ex_ampleton`, `luph`, `luph-levelup-manual`, `raelyn`. After the suite, write one observation sentence per journey and run `scripts/render-evidence.mjs`. Paste the printed `## Live evidence` block (pass/fail, observation, and screenshots) into the PR description. Cloud agents cannot run the suite (it needs a Foundry licence and private PDFs on NJ's machine). Write `needs-live-run` in the Verification section with the reason and the journeys you would run, and stop.
5. Never commit sample PDFs, world JSON, Foundry licence data, or rules text. Live screenshots go up as GitHub user-attachments, not as files in the branch. Fixtures use synthetic names. Character names can appear in those screenshots.

## Shape of the code (keep it)

- `src/core.ts`, `src/levelups.ts`, `src/types.ts`: pure, no Foundry globals.
- `src/importer.ts`: planning is pure; Foundry is reached only through `ImportRuntime`. All world writes go through `executePlan`.
- `src/wizard.ts`, `src/module.ts`: UI adapter. GM only.
- User-facing strings: list them in the PR body.

## Scope

NJ initiates features. Do not add features nobody asked for. Fixes to known defects are fine.

## Review

Verdicts are a `COMMENT` review from either the repository owner's account (`nessamurmur`) or `cursor[bot]`. Both count. `nessamurmur` also authors the pull requests, so GitHub will not accept `APPROVE` or `REQUEST_CHANGES` from that account. The reviewer posts one marker comment `<!-- dpi-review:v1 ... -->` with `verdict` and `head_sha`, and exactly one `review:*` label. That marker and label are what the merge rule reads. Follow `docs/review/reviewer.md`.

## Live Foundry on a cloud agent

Item 4 says a cloud agent cannot run the suite. Use that only when the Foundry secrets are missing or the private sample PDFs are not on the machine. When they are present, run `scripts/foundry-verify-server.sh up`, drive the suite against the `URL` it prints, then `scripts/foundry-verify-server.sh down`. `EVIDENCE` is the directory `render-evidence.mjs` reads (pull request #13): `run.json` at the top, and one folder per journey after the suite. Write one observation per journey and paste the printed `## Live evidence` block into the PR description. One Foundry licence allows one active server. Details: `docs/review/cloud-foundry.md`.
