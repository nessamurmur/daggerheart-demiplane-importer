# Contributing

This page is for people changing the code by hand. It has two parts: how to run the formal check on your machine, and the list a pull request meets before it merges.

## Running formal verification

The check needs no AI tool, no Foundry licence, and no character PDF.

Use Node.js 24 or newer and pnpm. The GitHub Actions jobs use Node.js 24 and install pnpm 11.19.0, then `pnpm install --frozen-lockfile`. From a checkout of this repository:

```sh
pnpm install
pnpm verify
```

`pnpm verify` runs `node --test verify/*.test.ts`. The same inputs run every time. A failure prints a seed and a path.

GitHub Actions runs that same command as the job named `formal-verification` in `.github/workflows/formal-verification.yml`. The job runs on every pull request into `main` and on every push to `main`. On a pull request the workflow title is "Formal verification"; the status check name is `formal-verification`.

What the check covers, the bounds, and how to update a check are in `.cursor/skills/verify-importer-contracts/SKILL.md`.

## Ready to merge

NJ, 25 November 2026. The ship bot and human reviewers use this list.

On that date the repository allows squash, merge-commit, and rebase merges. The branch ruleset named Required Checks is disabled, and its required-check list is empty. The ship bot applies the items below.

- **Required checks.** On the pull request head, the jobs `ci` and `formal-verification` are green. `ci` is the job in `.github/workflows/ci.yml`. It runs on every pull request and on every push to `main`, and it runs typecheck, tests, the package-readiness lint, and the build. `formal-verification` is the job in `.github/workflows/formal-verification.yml`. It runs `pnpm verify` on every pull request into `main` and on every push to `main`. Live Foundry end-to-end verification runs only on a release candidate. A release candidate is a pull request that bumps the version. Every critical issue that live run finds is fixed before merge.

- **Required evidence.** The description says what was verified and how, following `docs/review/evidence-contract.md`. A release candidate also includes its end-to-end results, the `## Live evidence` block. A UI change includes screenshots, and those screenshots contain no sample PDFs, world JSON, rules text, or Foundry licence data. Character names may show in a live-run screenshot.

- **Pull request and commit format.** The title is `NES-<n>: <summary>`. The squash commit message is that title plus ` (#<PR>)`.

- **Ticket link.** The pull request links its NES ticket through the branch name `nessajane/nes-<n>-...`, a link in the body, or both.

- **History.** Squash-merge, so `main` stays a straight line of commits. Bring the branch up to date with `main` before merging.

- **Versioning and releases.** The version is `MAJOR.MINOR.PATCH` with no leading `v`. `module.json` and `package.json` carry the same value, bumped together. `pnpm verify` and `scripts/release-manifest.mjs` both reject a mismatch. Only a pull request that bumps that version is a release candidate. After it merges, tag `v<version>` from `main`. Publishing is `.github/workflows/release.yml` (`Publish Foundry module`). It runs when a tag matching `v*` is pushed, and when someone starts the workflow by hand on the commit selected on the Actions page. On a tag push the build stops unless that tag equals `v` plus the version in the two files. A hand-started run skips that tag check and still names the release `v` plus the version in the built manifest. The release attaches `module.json` and `daggerheart-demiplane-importer-<version>.zip` from `artifacts/`, targets that commit, and is marked latest. The manifest URL stays `https://github.com/nessamurmur/daggerheart-demiplane-importer/releases/latest/download/module.json`, which is `manifest` in `module.json`. The download URL is `https://github.com/nessamurmur/daggerheart-demiplane-importer/releases/download/v<version>/daggerheart-demiplane-importer-<version>.zip`, which is `download` in `module.json`. The source manifest keeps `download` in step with the version. The build writes the same two URLs into the published `module.json`.
