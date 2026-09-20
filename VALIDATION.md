# Validation record

Target environment: Foundry 14.367, Foundryborne Daggerheart 2.10.2.

Status: 0.1.2 fixes the stat-preview preparation defect found in the first live import attempt. Full live acceptance remains in progress.

## Automated checks

Validated on 2026-09-19 with the pinned dependencies in `pnpm-lock.yaml`:

- TypeScript type checking passes.
- 32 tests pass when both private PDFs and the external Foundryborne 2.10.2 reference checkout are present, including stable manifest URLs, version-specific downloads, rejection of mismatched release versions, and constructor preparation regression coverage.
- Both original PDFs are extracted through PDF.js, including page annotations outside the canonical field tree. No sample PDFs or upstream game content are included in the distribution.
- Jen: all nine content entries resolve uniquely against the upstream catalog. Traits, experiences, zero values, Hope checkboxes, equipped weapons, archived cards, and malformed armor thresholds are checked. The mapping preserves Leather Armor's base score 3 and exactly one native Round Shield armor effect.
- Ex Ampleton: missing level and experience bonuses remain missing until review; all six zero traits survive. Repeated inventory references are detected. Summoner, Necromancy, Power Through Pain, and Blood Spike remain unmatched; Twisted Dagger resolves to SRD content.
- Synthetic tests cover higher-level snapshots, multiclass/subclass links, mixed ancestry grants, companion training, ambiguous sources, inaccessible packs, malformed PDF input, unknown domains, HTML escaping, GM restrictions, and rollback/cleanup errors.
- The importer checks every resulting stat against its preview, even when the PDF initially agreed, so a doubled shield bonus causes rollback. Tests also verify that the report retains source values, review edits, exclusions, and verified numbers.

Planning and transaction tests use a deterministic runtime stub. Catalog tests inspect real upstream documents but do not execute Foundry's data models. These tests do **not** establish live sheet, action, effect, or advancement correctness.

Reproduce the full local check:

```sh
pnpm typecheck
FOUNDRYBORNE_REFERENCE_DIR=/path/to/daggerheart-2.10.2 \
DEMIPLANE_SAMPLE_DIR=/path/to/private/samples \
node --test --test-isolation=none tests/*.test.ts tests/*.test.mjs tests/local/*.test.ts
pnpm build
```

## Sqyre observations and remaining acceptance

After 0.1.0 was installed and enabled, the Actors directory button appeared. The first live Jen preview showed Evasion 20 and HP 12: `foundryRuntime.preview` called `prepareData()` after the actor constructor had already prepared the document. That repeated the class's additive bonuses, and preserving Evasion 8 consequently applied an incorrect -12 adjustment to the real Evasion of 10. Version 0.1.2 removes the redundant preparation call and keeps experience handling unchanged.

The provided `druid.pdf` contains “Folk hero” in `experience_name.2`, with no bonus; its page-one appearance stream also renders that text. It is source data, not an SRD item match. Experience handling remains as in 0.1.0.

On 2026-09-19, version 0.1.2 was published through GitHub Actions. The public latest manifest and its version-specific ZIP were fetched and verified to contain identical manifests, with no ZIP CRC errors. The Witherwild world (Foundry 14.367, Daggerheart 2.10.2) was stopped, then updated through Sqyre's All Available Modules manifest installer. Sqyre's installed module list confirmed 0.1.2. The world was restarted, and the Actors directory button and PDF wizard opened successfully.

The live Jen import is awaiting browser file access: Chrome rejected selecting the local PDF through `fileChooser.setFiles` with “Not allowed.” No test actors were created by this attempt, and the world is running. Enable “Allow access to file URLs” for Chrome's ChatGPT browser extension, then complete these checks:

1. Enable the module and confirm the Actors directory button and all wizard tabs render correctly.
2. Import **[Import test] Jen**, using **0** for Folk hero. Preserve PDF Evasion **8**; confirm armor **4**, thresholds **7/14**, one shield bonus, both domain cards in the vault, and HP/Stress/Hope controls.
3. Import **[Import test] Ex Ampleton**, using level **1** and **0** for both missing experience bonuses. Review `0Greatstaff` as an inventory export artifact. Confirm unmatched playtest items are editable and all zero traits survive.
4. Inspect actual source UUIDs, class/subclass grants, feature links, and copied attacks/actions/effects. Activate a matched attack and ability. Check equipped/unequipped behavior without duplicating armor bonuses.
5. Reload and reopen both actors. Verify resources remain editable and reports survive reload.
6. Exercise a higher-level synthetic character, multiclass, mixed ancestry, and companion through the wizard. Advance a clearly named test character one level and confirm imported bonuses are not reapplied. Test native behavior both with and without automatic level-ups.
7. Exercise actual native document failure/cleanup and verify all existing actors are unchanged. The automated rollback test alone does not satisfy this live check.

Do not describe this release candidate as fully accepted until these live checks pass. Pre-import advancement history cannot be reconstructed from the PDF; imported snapshots should not be rolled back to an earlier level using Foundry's advancement history UI.
