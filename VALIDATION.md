# Validation record

Target environment: Foundry 14.367, Foundryborne Daggerheart 2.10.2.

Status: implementation and local validation complete; live acceptance is pending installation. Manifest URL release packaging has been added.

## Automated checks

Validated on 2026-09-19 with the pinned dependencies in `pnpm-lock.yaml`:

- TypeScript type checking passes.
- 31 tests pass when both private PDFs and the external Foundryborne 2.10.2 reference checkout are present, including stable manifest URLs, version-specific downloads, and rejection of mismatched release versions.
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

The Witherwild test world reports Foundry 14.367 and Daggerheart 2.10.2. Sqyre requires the world to stop before the module manager can enter service mode. Service mode and the ZIP upload chooser were reached, but Chrome rejected `fileChooser.setFiles` with “Not allowed.” No module was uploaded and no test actors were created. The world was restarted after the attempt.

Enable “Allow access to file URLs” for Chrome's ChatGPT browser extension, or upload the ZIP manually through Sqyre, then complete these checks:

1. Enable the module and confirm the Actors directory button and all wizard tabs render correctly.
2. Import **[Import test] Jen**, using **0** for Folk hero. Preserve PDF Evasion **8**; confirm armor **4**, thresholds **7/14**, one shield bonus, both domain cards in the vault, and HP/Stress/Hope controls.
3. Import **[Import test] Ex Ampleton**, using level **1** and **0** for both missing experience bonuses. Review `0Greatstaff` as an inventory export artifact. Confirm unmatched playtest items are editable and all zero traits survive.
4. Inspect actual source UUIDs, class/subclass grants, feature links, and copied attacks/actions/effects. Activate a matched attack and ability. Check equipped/unequipped behavior without duplicating armor bonuses.
5. Reload and reopen both actors. Verify resources remain editable and reports survive reload.
6. Exercise a higher-level synthetic character, multiclass, mixed ancestry, and companion through the wizard. Advance a clearly named test character one level and confirm imported bonuses are not reapplied. Test native behavior both with and without automatic level-ups.
7. Exercise actual native document failure/cleanup and verify all existing actors are unchanged. The automated rollback test alone does not satisfy this live check.

Do not describe this release candidate as fully accepted until these live checks pass. Pre-import advancement history cannot be reconstructed from the PDF; imported snapshots should not be rolled back to an earlier level using Foundry's advancement history UI.
