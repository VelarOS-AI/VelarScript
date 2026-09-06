import { lstat } from "node:fs/promises";

/**
 * A stated wait where a test would otherwise have to win a race.
 *
 * Two of this CLI's guarantees are only observable *between* processes: a
 * build output claim refuses a second CLI exactly while the first one holds
 * it. `tests/build-output-claim.test.ts` proves the directory-against-nested
 * direction end to end, and for that the directory build must still be holding
 * its tree claim when the second CLI reaches its own acquire.
 *
 * Widening that window by giving the first build more to do measures the
 * runner rather than the product. D114 F6c ④ found the test seeding 20,000
 * files under the previous output to buy ~584 ms of unlinks against a ~230 ms
 * cold CLI start; on the 3–4 vCPU ext4 CI machines the two numbers invert and
 * the test fails for a reason that has nothing to do with claims. So the
 * overlap is stated instead of raced: the build stops once it holds the claim
 * and resumes when the test says the second CLI has been refused.
 *
 * This is test scaffolding and it is written so it cannot become anything
 * else. Only `tests/` ever sets the variable, no emitted byte, diagnostic, or
 * exit status depends on it, and an unset variable costs one `process.env`
 * read per directory build.
 */
export const HOLD_TREE_CLAIM_VARIABLE = "VELAR_TEST_HOLD_TREE_CLAIM";

/**
 * How long a hold waits before continuing anyway, so a release path that never
 * appears fails as a slow test rather than as a build that never returns. The
 * test that outlives it then fails on its own assertion, which is the one that
 * says what actually went wrong.
 */
export const MAX_TEST_HOLD_MILLISECONDS = 30_000;

/** How often a hold looks for its release path. */
const TEST_HOLD_POLL_MILLISECONDS = 25;

/**
 * Pauses a directory build that has just acquired its tree claim until the
 * path `HOLD_TREE_CLAIM_VARIABLE` names exists. Returns immediately when the
 * variable is unset, which is every run outside `tests/`.
 */
export async function holdAcquiredTreeClaim(): Promise<void> {
  const releasePath = process.env[HOLD_TREE_CLAIM_VARIABLE];
  if (releasePath === undefined || releasePath === "") return;
  const deadline = Date.now() + MAX_TEST_HOLD_MILLISECONDS;
  while (Date.now() < deadline) {
    if (await pathExists(releasePath)) return;
    await new Promise((resumeHold) => setTimeout(resumeHold, TEST_HOLD_POLL_MILLISECONDS));
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
