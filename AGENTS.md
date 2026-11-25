# AGENTS.md

Foundry VTT module that imports Demiplane PDF character sheets into Foundryborne characters. Compatible with Daggerheart. Target Foundry 14.x (`compatibility.verified` in `module.json` is 14.367). Base branch: `main`.

## Before you open a PR

1. Read `docs/review/reviewer.md` (the rubric you will be reviewed against) and `docs/review/evidence-contract.md` (the evidence you must post).
2. Use `.github/pull_request_template.md`. Every section is required.
3. Run `pnpm typecheck && pnpm test && pnpm verify && pnpm build && node scripts/check-package-readiness.mjs`. The readiness script must finish with no errors. `pnpm verify` is the formal-verification check. It needs no AI tooling. The same command is the GitHub Actions job `formal-verification` on every pull request into `main`.
4. Live Foundry evidence (E4) is required only on a release-candidate pull request: one that bumps `version` in `module.json` and `package.json` together. Every other pull request, including class R and any change to import behaviour, posts the `formal-verification` result plus the tests and evidence in `docs/review/evidence-contract.md`. It does not need a live run, and it does not use `needs-live-run`. When the pull request is a release candidate, run the journeys in `.claude/skills/verify-foundry-importer` (on `main`). The suite is the `journeys.json` entries with status `proven` and kind `open` or `import`: `open-importer`, `druid`, `ex_ampleton`, `luph`, `luph-levelup-manual`, `raelyn`. After the suite, write one observation sentence per journey and run `.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs`. Paste the printed `## Live evidence` block (pass/fail, observation, and screenshots) into the PR description. Every critical issue that run finds is fixed before merge. If that release candidate cannot be run here, write `needs-live-run` in the Verification section with the reason and the journeys, and stop.
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

Item 4 requires a live run only for a version-bump release candidate. On any other pull request, do not start Foundry. On a release candidate, run the suite when the Foundry secrets and the private sample PDFs are on the machine: `scripts/foundry-verify-server.sh up`, drive the suite against the `URL` it prints, then `scripts/foundry-verify-server.sh down`. `EVIDENCE` is the directory `.claude/skills/verify-foundry-importer/scripts/render-evidence.mjs` reads: `run.json` at the top, and one folder per journey after the suite. Write one observation per journey and paste the printed `## Live evidence` block into the PR description. When the secrets or the sample PDFs are missing, write `needs-live-run` for that release candidate and stop. One Foundry licence allows one active server. Details: `docs/review/cloud-foundry.md`.
