# Open the importer

A GM opens the import wizard from the Actors sidebar or from a macro. Players never get it, and it refuses to run outside Foundryborne 2.10.2+.

## Sub-features

- `open-sidebar`: an **Import Demiplane PDF** button sits in the Actors directory header for GMs.
- `open-api`: `game.modules.get("daggerheart-demiplane-importer").api.openImporter()` opens the same window.
- `open-single`: opening again brings the existing wizard to the front instead of a second copy.
- `open-gm-only`: a non-GM gets the warning "Only a GM may import Demiplane characters." and no button.

## How to get to it (user POV)

- Actors sidebar tab → **Import Demiplane PDF**.
- A script macro running `game.modules.get("daggerheart-demiplane-importer").api.openImporter()`.

## Driving it with harness.mjs

Preconditions: baseline; joined as Gamemaster.

- **Scripted check (proven).** `node open-importer.mjs --url "$URL" --evidence "$EVIDENCE"`: sidebar open, close, API open, sidebar while open. Exit 0 = one window, wizard is `ui.activeWindow`, no uncaught page errors. Suite id: `open-importer`.

- **Sidebar.** `await openImporterFromSidebar(page)`. `#daggerheart-demiplane-importer` is visible with heading "Bring your character to the table" and a `#dpi-file` input. Screenshot.
- **API.** `await page.evaluate(() => game.modules.get("daggerheart-demiplane-importer").api.openImporter())`. The same window is visible; `document.querySelectorAll("#daggerheart-demiplane-importer").length === 1`.
- **GM-only (recipe only).** Create a player as GM: `await page.evaluate(() => User.create({ name: "[Import test] Player", role: 1 }))`, then `join` as that user (`selectOption("#join-username", { label: "[Import test] Player" })`). There is no `button[data-module="daggerheart-demiplane-importer"]` in `#actors`, and calling the API shows the warning notification (`#notifications .notification.warning`). Journey id: `open-gm-only`.

## Gotchas

- Fixed in #1 (7652baa): `openImporter` used to call `bringToFront()` before `render()` created the element, throwing an uncaught `TypeError ... reading 'style'` on every open that built a new wizard. `scripts/open-importer.mjs` is the regression check: it fails on any `[pageerror]`.

- In a fresh world the module is disabled; `session()` enables it and reloads. A missing button before that is expected.
- The button is added on `renderActorDirectory`; if the Actors tab was never opened it is not in the DOM yet. Click the tab first.
