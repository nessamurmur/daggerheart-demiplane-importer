Demiplane PDF Importer for Foundryborne — 0.1.2.

Fixes the preview preparing the character twice, which doubled class Evasion and HP and produced incorrect PDF adjustments. For example, a Druid's base Evasion now previews as 10 rather than 20, and maximum HP as 6 rather than 12.

Experience handling is unchanged from 0.1.0.

Target: Foundry 14.367 and Foundryborne Daggerheart 2.10.2. Automated extraction, mapping and transaction tests pass. Live Foundry acceptance tests are still pending; see VALIDATION.md before using this initial release in a campaign.

Install using the **module.json** asset below. The module's manifest points to the latest published release for future updates. Sample PDFs and game rules are not included.
