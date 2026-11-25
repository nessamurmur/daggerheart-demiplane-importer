# Content matching

On the Content tab, every class, subclass, ancestry, community, domain card, weapon, armor and inventory entry is matched to an item in the world or an installed compendium, or kept as an editable PDF item. Matched items bring their own actions and effects; unmatched ones keep their name and text only.

## Sub-features

- `match-srd`: SRD content in Foundryborne's compendiums is matched automatically (shown with its pack, e.g. "Weapons", "Armors").
- `match-pdf-item`: content with no match becomes an "Editable PDF item" and gets a "created from PDF information" warning.
- `match-unregistered-domain`: a domain card from an unregistered domain (e.g. `blood`) becomes a descriptive feature with its metadata kept in flags.
- `match-duplicates`: an item that appears in both inventory and an equipment slot is imported once, with a warning.
- `match-override`: the GM can choose another source per entry; `select[aria-label="Source for <name>"]`.
- `match-refresh`: after renaming an entry, **Refresh content matches** re-resolves it.
- `match-exclude`: unticking **Include this item** leaves it out.

## How to get to it (user POV)

- In the wizard after **Read character**, the **Content** tab.

## Driving it with harness.mjs

Preconditions: baseline.

- **Mixed matches (proven).** `node import-pdf.mjs ... --pdf ~/Downloads/ex_ampleton.pdf --answers ../answers/ex_ampleton.json`. `content-matches.json` lists Clank → Ancestry, Warborne → Communities, Twisted Dagger → Weapons, Leather Armor → Armors, Minor Health Potion → Consumables; Summoner, Necromancy, Power Through Pain, Blood Spike, 0Greatstaff and the spirit bottle → Editable PDF item. `world-after.json` items with `source: null` are exactly those six, and there is one Twisted Dagger. Suite id: `ex_ampleton`.
- **Fully matched (proven via druid).** The druid journey: `content-matches.json` has no "Editable PDF item" and `unresolved content sources: []`.
- **Override (recipe only).** After read, open Content, `selectOption('select[aria-label="Source for Twisted Dagger"]', { label: "Editable PDF item" })`, preview and create; the Twisted Dagger item has `source: null`. Journey id: `match-override`.
- **Refresh (recipe only).** `fill('[data-bind="entries.<i>.name"]', ...)`, click `action(page, "rematch")`, and screenshot the new chip. Journey id: `match-refresh`.

## Gotchas

- Matching depends on what is installed: this instance has only Foundryborne's own packs. Purchased or homebrew compendiums would change results.
- Ex Ampleton's Leather Armor comes from inventory text, so it is imported unequipped (armor max 0). Check that against the PDF before calling it a bug.
- Matching warnings such as `0Greatstaff`'s leading digits are expected sample-data quirks.
