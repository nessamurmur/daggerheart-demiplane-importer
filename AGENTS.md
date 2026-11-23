# AGENTS.md

Foundry VTT module that imports Demiplane PDF character sheets into Foundryborne characters. Compatible with Daggerheart. Target Foundry 14.x (`compatibility.verified` in `module.json` is 14.367). Base branch: `main`.

## Before you open a PR

1. Read `docs/review/reviewer.md` (the rubric you will be reviewed against) and `docs/review/evidence-contract.md` (the evidence you must post).
2. Use `.github/pull_request_template.md`. Every section is required.
3. Run `pnpm typecheck && pnpm test && pnpm build && node scripts/check-package-readiness.mjs`. The readiness script must finish with no errors.
4. Anything that changes import behaviour needs the live Foundry journeys in `.claude/skills/verify-foundry-importer`. That skill is pull request #11 and is not on `main` until it merges; use that copy. Its suite is the `journeys.json` entries with status `proven` and kind `open` or `import`: `open-importer`, `druid`, `ex_ampleton`, `luph`, `luph-levelup-manual`, `raelyn`. Cloud agents cannot run it (it needs a Foundry licence and private PDFs on NJ's machine). Write `needs-live-run` in the Verification section with the reason and the journeys you would run, and stop.
5. Never commit sample PDFs, character data, Foundry licence data, or rules text. Fixtures use synthetic names.

## Shape of the code (keep it)

- `src/core.ts`, `src/levelups.ts`, `src/types.ts`: pure, no Foundry globals.
- `src/importer.ts`: planning is pure; Foundry is reached only through `ImportRuntime`. All world writes go through `executePlan`.
- `src/wizard.ts`, `src/module.ts`: UI adapter. GM only.
- User-facing strings: list them in the PR body.

## Scope

NJ initiates features. Do not add features nobody asked for. Fixes to known defects are fine.

## Review

Verdicts are posted from the repository owner's account (`nessamurmur`), which also authors the pull requests. GitHub will not accept `APPROVE` or `REQUEST_CHANGES` on those pull requests. The reviewer posts a `COMMENT` review, one marker comment `<!-- dpi-review:v1 ... -->` with `verdict` and `head_sha`, and exactly one `review:*` label. That marker and label are what the merge rule reads. Follow `docs/review/reviewer.md`.
