# Foundry readiness audit: daggerheart-demiplane-importer

Purpose: answer one question with evidence. Could another Foundry user install, enable and use this module safely, and could it be accepted on the official package listing? This is a checklist plus a short report format. It is not a bug hunt and not a release process.

Run it in three situations only:
1. As part of a PR review, when the diff touches a trigger path (`reviewer.md` section 5). Scope the audit to what the diff touches.
2. Full audit, on request (`readiness-audit` label on any PR or issue, or NJ or the Engineering Lead asking), at most monthly, and always before the first submission to the Foundry package listing.
3. Never on a schedule by itself.

Start every run with the deterministic part and do not redo it by hand:

```sh
node scripts/check-package-readiness.mjs --json
```

Then spend tokens only on the judgment items below. Cite a source URL from section "Sources" for every policy claim. Anything you cannot verify from the repo or a source is "Not verified", never a guess.

## A. Manifest and packaging (Foundry module-development article, package-management article)

| Check | Pass condition |
| --- | --- |
| id | Lower-case, hyphens, equals the folder in the ZIP (`daggerheart-demiplane-importer/` with `module.json` directly inside) |
| Required fields | `id`, `title`, `description`, `version` present |
| Version | MAJOR.MINOR.PATCH string, same in `module.json` and `package.json`, bumped on every published change, never reused |
| manifest | Stable `https://github.com/<owner>/<repo>/releases/latest/download/module.json`, raw JSON not the GitHub HTML view |
| download | Version-specific ZIP (`.../releases/download/v<version>/<id>-<version>.zip`), never "latest" or a branch archive |
| compatibility | `minimum` is the oldest build you actually support; `verified` is the newest build you actually ran (build-specific like `14.370` or generation `14`); `maximum` empty unless a known break (it is hard-enforced) |
| System relationship | `relationships.systems` names `daggerheart` with `type: "system"` and a compatibility range that matches what you tested (Foundryborne 2.10.2 today) |
| Entry points | Every `esmodules`, `styles`, `languages[].path` exists in the built ZIP with identical case |
| Paths | No spaces; case-exact; no absolute `/modules/...` URLs in code (use `foundry.utils.getRoute()`) so route-prefixed hosts work |
| Metadata | `url`, `bugs`, `changelog`, `readme`, `license`, and `authors[0]` naming a real person or handle |
| ZIP contents | Built module, `LICENSE`, PDF.js Apache licence, `THIRD_PARTY_NOTICES.txt`; no tests, sample PDFs, source maps you did not mean to ship, or private files |
| Release atomicity | `module.json` and ZIP published together; the workflow fails on tag/version mismatch (it does today) |
| Verify the artifact | `pnpm build`, unzip `artifacts/*.zip`, diff its `module.json` against `artifacts/module.json` (must be identical) |

## B. Foundry runtime practice (Foundry API v14 docs, community best-practice checklist)

| Check | Pass condition |
| --- | --- |
| Lifecycle | Work happens in the right hook (`init` for registration, `ready` for game data); handlers are idempotent (the `renderActorDirectory` handler checks for an existing button) |
| ApplicationV2 | New UI extends `ApplicationV2` (ideally `HandlebarsApplicationMixin(ApplicationV2)` with `DEFAULT_OPTIONS.actions`, `PARTS`, `_prepareContext`); no V1 `Application`/`FormApplication`/`Dialog` (removed in v16); pop-out safe (no `document.querySelector` outside `this.element`) |
| Directory button | Added in the `renderActorDirectory` handler; works with HTMLElement `html` (V13+); degrades to nothing when the host element is missing |
| i18n | User-facing strings come from `lang/en.json` through `game.i18n`, keys namespaced `DPI.*`; `languages` declared in the manifest |
| Settings | Persistent user options use `game.settings.register`, never `localStorage` |
| Permissions | GM-only at the entry point and again at the write (`executePlan`); players see nothing; consider whether Assistant GM should be allowed (`isGM` includes them) |
| Globals | No `window.x =`; one public API at `game.modules.get(id).api`; no import from another module or from the system's files |
| Data | Documents created through the Document API; flags namespaced under the module id; no mutation of compendium documents; `keepId` justified |
| System coupling | Everything read from Foundryborne internals is listed, gated by `relationships.systems.compatibility`, and warned about when the installed version is newer than verified |
| CSS | Everything under `.dpi-*`; works in Foundry's light and dark themes or documents that it does not |
| Security | PDF-derived strings reach the DOM only through `escapeHTML`; no `eval`/`new Function`; PDF JavaScript never runs (`isEvalSupported: false`); no network calls (README promises none) |
| Performance | Catalog scan reads indexes, not full documents, and only when the wizard opens; PDF parsed once; large PDFs bounded (30 MB, 50 pages today) |
| Console | On a release candidate (a version bump), a live run produces no deprecation warnings attributed to this module and no `[pageerror]` (the verify skill's `browser-console.log`). Other pull requests leave this row as not run (`docs/review/evidence-contract.md`) |

## C. Listing and content policy (licensing guide, AI policy, DPCGL)

Treat these as flags for NJ, not legal conclusions. Only the human owner can decide.

1. Rights to everything shipped (licensing guide). The ZIP must contain no Daggerheart rules text, art, icons, or compendium data beyond what the licence allows, and no sample character PDFs. README claims none is distributed; verify by listing the ZIP and grepping `dist/` for game text. Hard-coded SRD compendium ids and mechanics names in source are references, not copies; flag any bundled description text.
2. Darrington Press Community Gaming License (DPCGL 2.0). The PDF header says last updated 2026-08-05; the licence page records the 2.0 update on 2026-08-25. Cite the text you opened. Section 2.5: a Name Mark (Daggerheart is on the list) cannot be used in the title of a work or on a front cover, and marketing and descriptive text must put "Compatible" adjacent to the mark. Section 4.1 requires a copyright notice, an attribution, links to the Public Game Content and to the licence, and a modification statement when Public Game Content or Adaptive Content is shared. Section 4.4 gives one combined Daggerheart sentence for those items. The package title stays "Demiplane PDF Importer for Daggerheart" by maintainer decision on 2026-11-23, including the Name Mark, which section 2.5(a) does not allow. README and `module.json` `description` say "Compatible with Daggerheart". The README carries the section 4.4 sentence and also says the download does not copy System Reference Document text or domain icons. Do not re-ask for a rename or a second notice unless those lines were removed. Whether an importer that ships no Public Game Content is Adaptive Content is still a question only Darrington Press can answer (`info@darringtonpress.com`). Flag any new bundled rules text, art, or domain icons.
3. Software distribution. A Reddit quote of the DPCGL FAQ says the licence does not allow distributing software or digital tools. The current licence page and DPCGL 2.0 text do not repeat that sentence; treat it as unverified and as another reason to ask Darrington Press once before a public listing.
4. Third-party names. "Demiplane" and "Foundryborne" are used descriptively. The README states non-affiliation (keep it). Do not use logos or trade dress. Foundry's licensing guide advises contacting the rights holder early.
5. Demiplane terms. The module reads a PDF the user exports from their own Demiplane account, locally, with no upload. Demiplane's public pages describe the PDF export and no third-party-tool restriction was found, but the Demiplane Terms of Service were not read in full. Flag for NJ.
6. AI content policy (revised 2026-03-18), applies only to the official listing and marketplace, not to self-published GitHub installs. Prepared user-facing text (UI labels, notifications, README or listing description, error messages) must be human-authored, with AI limited to proofreading or formatting of human text. Code may be AI-assisted if the author personally understands and can maintain all of it, and can show an authorship history. Packages that generate code at runtime need user consent (this module does not). Each review lists user-facing strings that changed so NJ can author or rewrite them before listing; moving them into `lang/en.json` makes that set auditable.
7. Provenance of assets. Any image, icon, font, or audio added to the repo needs a stated source, and under the AI policy must be human-made or licensed stock verified as human-made.
8. Privacy statement. README "Privacy" matches behavior: local parsing, no upload, report and source fields saved in the world's actor flags. Any change to what is stored or sent updates it.
9. Package submission. Listing needs manual approval by Foundry staff and an active Foundry licence on the submitting account. After approval, each release is registered as a package version whose number matches `module.json`.

## D. Report format

Post (or return) at most one page, in this shape:

```
## Foundry readiness: <scope: diff-scoped | full audit> @ <sha>
Script: <N errors, N warnings>  (paste the ERROR lines)
BLOCKERS (cannot ship to other users):  <id> <file:line or URL> <one line> <fix>
SHOULD (listing or UX risk):             <id> ...
DECISIONS FOR NJ (policy, IP, product):  <id> <one-sentence question>
Verified OK: <short list, one clause each>
Not verified: <what you could not check and why>
Sources: <only the URLs you used>
```

Severity: BLOCKER = a user cannot install, enable, or safely run it, or it violates a rule that would get it rejected or removed. SHOULD = degrades the experience or raises listing risk. DECISION = only NJ can resolve (licence, naming, authorship, listing yes or no).

## Sources (opened 2026-11-23)

- https://foundryvtt.com/article/module-development/ (manifest fields, compatibility, relationships, languages, esmodules, bugs/changelog/license/readme)
- https://foundryvtt.com/article/package-management/ (package versions, compatibility semantics: minimum/maximum enforced, verified advisory; install and update flow)
- https://foundryvtt.com/article/localization/ (languages array, namespaced keys, `game.i18n.localize`)
- https://foundryvtt.com/api/v14/modules/foundry.applications.html (ApplicationV2, DEFAULT_OPTIONS, actions, PARTS, V1 removal in v16)
- https://foundryvtt.com/api/v14/modules/foundry.documents.html (document creation and subtypes)
- https://foundryvtt.wiki/en/development/guides/package-best-practices (community checklist: stable manifest, version-specific download, module API location, no cross-module imports, hosting root)
- https://foundryvtt.com/article/licensing-guide/ (what Foundry checks on submission: rights, other companies' licences, art)
- https://foundryvtt.com/article/license/ (Limited License for Package Development)
- https://foundryvtt.com/article/ai-policy/ (revised 2026-03-18)
- https://foundryvtt.com/article/faq/ and https://foundryvtt.com/packages/ (seen in search-result excerpts only, not opened in full: submission is manual review with an active licence)
- https://darringtonpress.com/license/ and https://darringtonpress.com/wp-content/uploads/2026/08/DPCGL_2.0_AUG_26_2026.pdf (whitelisted VTTs include Foundry; Name Marks; attribution; non-commercial VTT sharing)
- https://support.demiplane.com/hc/en-us/articles/25810842657687-Daggerheart-NEXUS-Frequently-Asked-Questions (seen in a search-result excerpt only: PDF export from a character sheet)
- Not found: a Foundry "package submission guidelines" article (the `/article/package-submission/` URL returns 404). The submission form itself was not opened.
