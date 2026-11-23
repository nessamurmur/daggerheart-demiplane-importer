## Why

<!-- The defect or need, in terms of what a GM sees. For a fix, name the first wrong decision in the code, not where it surfaced. -->

## What changed

## Scope

<!-- What this PR deliberately does not touch. -->

## Tradeoffs

<!-- Options you rejected and why. -->

## Blast Radius

<!-- Who and what can break. State the one fact the safety rests on, and how you know it (line, test, or live run). -->

## Verification

<!-- Follow docs/review/evidence-contract.md. State the change class (D, P, R, M) and the head SHA. -->

- Class:
- Head SHA:
- CI:
- Red then green (test or journey, base SHA vs head SHA):
- Live Foundry evidence (import behaviour, class R, or a `tests/helpers.ts` mirror): link to the `## Live evidence` comment, or `needs-live-run` plus the reason and the journeys from `.claude/skills/verify-foundry-importer`
- Package artifact (class M):

## User-facing strings

<!-- Each added or changed label, notification, README sentence, or error message. Or "none". -->

## Requested by

<!-- Link or sentence showing NJ asked for this. Not needed for a fix to a known defect. -->

## Private data

- [ ] No sample PDFs, character data, rules text, or Foundry licence data in this PR, its tests, or its evidence.
