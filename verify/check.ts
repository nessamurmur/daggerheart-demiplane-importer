import fc from "fast-check";

/**
 * Fixed seed so `pnpm verify` checks the same inputs every time.
 * A failure prints this seed and a `path`. Replay with `{ seed: VERIFY_SEED, path }` from the report.
 */
export const VERIFY_SEED = 20261125;

export function check(property: Parameters<typeof fc.assert>[0], numRuns: number): Promise<void> | void {
  return fc.assert(property, { seed: VERIFY_SEED, numRuns, endOnFailure: true });
}
