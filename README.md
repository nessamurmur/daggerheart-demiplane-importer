# Demiplane PDF Importer for Daggerheart

A GM-only Foundry VTT module that imports original Demiplane PDF exports into **new** Foundryborne Daggerheart characters. Every import has an editable review, content matching, and a calculated-stat comparison before anything is created.

Target: Foundry **14.367**, Foundryborne Daggerheart **2.10.2**. Later system releases should be checked against the import preview before use.

## Install

Paste this **Manifest URL** into Foundry's **Install Module** dialog:

```text
https://github.com/nessamurmur/daggerheart-demiplane-importer/releases/latest/download/module.json
```

On Sqyre, stop the world briefly so the module manager can enter service mode, open **Assets → Modules** for the game's module set, and use its manifest installation option. Start the world again when installation finishes. ZIP upload remains available if preferred.

Then open **Settings → Module Management** in Foundry, enable **Demiplane PDF Importer for Daggerheart**, and use **Actors → Import Demiplane PDF** as GM.

The manifest URL stays the same for future updates; each version downloads its own release ZIP. This follows [Foundry's manifest and download fields](https://foundryvtt.com/article/module-development/).

For a local Foundry installation, extract the ZIP into `Data/modules/`. The resulting folder must be `daggerheart-demiplane-importer` with `module.json` directly inside it.

## Import

- Choose the original, form-bearing PDF exported by Demiplane. Scans, flattened printouts, encrypted files, other exporters, and files larger than 30 MB are not supported.
- Review the Character, Content, Ancestry & companion, and Notes & warnings tabs. Blank numeric inputs mean unknown; zero remains zero. Fill in essential missing values, including experience bonuses.
- The Content tab shows matches in accessible world items and installed Item compendiums. Multiple matching sources require a selection. You can choose a different installed source or an editable PDF item. After renaming inventory entries, use **Refresh content matches**.
- Matched items supply their own actions, effects and linked features. No SRD, playtest, or purchased rules are distributed with this module. Future purchased content is usable when its Item compendiums are installed and accessible.
- Unmatched items preserve available names and descriptions. Text is not converted into automated mechanics. A domain card whose domain is not registered becomes a descriptive feature; its original domain/card metadata remains in the import flags.
- Review every stat difference. **Use Foundry calculation** keeps the installed rules' result. **Preserve PDF value** adds a labeled, editable Active Effect for the difference. These additive corrections continue to allow future equipment and level changes. Remove them if later representing the same bonus with another feature.
- Choose **Create character** after acknowledging the review. The character, and optional companion, open automatically. The report is saved in actor flags and can be downloaded as JSON.

Existing actors are never updated. Importing the same PDF again creates another actor. If creation fails, the importer removes only documents created by that attempt and reports any unsuccessful cleanup.

## Advanced characters

For multiclass characters, choose the main class, secondary class, corresponding subclasses, progression, and the one gained multiclass domain. Repeated subclass blocks for the same class and subclass are consolidated. Mixed ancestry selects one primary and one secondary ancestry feature.

When Foundryborne's automatic level-up setting is disabled, its own multiclass dialog may also request confirmation of the selected domain during creation. Unknown playtest domains are kept in the item's notes and flags until registered through Foundryborne's homebrew settings; their cards remain editable descriptive features.

The PDF may omit companion details. Enable the companion editor and enter its current statistics, attack, experiences, and one training choice for each previous level. This records past training so it is not offered again. The companion is created as a separate actor linked in both directions.

Higher-level character imports are snapshots, not reconstructions of their entire advancement history. Current stats, features, marked traits, and level are imported; earlier character level-up choices that are absent from the PDF remain unknown. Do not use Foundry's rollback to reconstruct levels before the imported snapshot. Companion training is collected explicitly because it affects available future choices.

## Privacy

PDF parsing runs in the browser with a bundled PDF.js worker. It does not upload the PDF or run embedded PDF JavaScript. Reviewed character data and the extracted source fields are saved to your Foundry world. The module does not call Demiplane or an external AI service. Treat actor exports and import reports as character data.

## Development

Requires Node.js 24+ and pnpm. Dependencies are pinned in `pnpm-lock.yaml`.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The build produces `dist/daggerheart-demiplane-importer/`, a standalone `artifacts/module.json`, and `artifacts/daggerheart-demiplane-importer-0.1.0.zip`. The two manifest copies are identical. The ZIP includes the PDF.js library, worker, Apache license, module code and documentation. It excludes tests and sample PDFs.

Optional private sample tests use `druid.pdf` and `ex_ampleton.pdf` from `$DEMIPLANE_SAMPLE_DIR`, defaulting to `~/Downloads`:

```sh
DEMIPLANE_SAMPLE_DIR=/path/to/private/samples pnpm test:samples
```

Set `FOUNDRYBORNE_REFERENCE_DIR` to an unmodified checkout of Foundryborne tag `2.10.2` to additionally test matching against its catalog. This checkout is external test data and is never included in the module ZIP.

Core parsing and matching are independent of Foundry. The adapter uses native document creation and feature grants. The public module API is `game.modules.get("daggerheart-demiplane-importer").api.openImporter()`; it enforces GM access.

## Publishing updates

1. Update the version in both `module.json` and `package.json`, update `RELEASE_NOTES.md`, and commit the changes. Keep the source manifest's download URL in sync; the build also regenerates this URL from the version.
2. Push a tag matching that version, for example `v0.1.1`. Alternatively, run **Publish Foundry module** manually from the repository's Actions page to publish the version on the selected branch.
3. The workflow checks types and tests, builds, and publishes `module.json` and the matching ZIP together in a GitHub release. Wait for the workflow to succeed before installing.

Published versions are not overwritten. Use a new version for changes after publication. `RELEASE_TAG` prevents publishing a tag that disagrees with the manifest, and `RELEASE_REPOSITORY` supports building a fork with its own download and update URLs.

## Validation

Automated tests cover extraction, malformed values, matching ambiguity, multiclass and mixed ancestry mapping, missing rules, companion validation, native correction data, GM restrictions, failure cleanup, and report coverage. Private tests exercise both original PDFs without distributing their contents. Live-world verification is recorded in `VALIDATION.md`.

Module code is MIT licensed. PDF.js is Apache-2.0 licensed. This independent importer is not affiliated with Demiplane, Foundryborne, Foundry Gaming, or Darrington Press.
