// face/tests/unwind.ts
/** The real-boot smokes' cleanup (tests/desk-smoke.test.ts, tests/telegram-smoke.test.ts): every step runs,
 * whatever the steps before it did, so a dispose that rejects can skip neither the face's dispose nor the
 * fixture's removal - and a step that never settles (a dispose waiting on a test clock held still) is given
 * {@link UNWIND_STEP_MS} of real time, then counted failed, so the test's own error is reported instead of lost
 * to the runner's timeout (p2-m34). */

/** The longest one cleanup step is waited for, in real time. */
export const UNWIND_STEP_MS = 30_000;

/**
 * Run every cleanup step, in order, each whatever the steps before it did. A step that fails fails the test when
 * the test itself passed; a test that failed keeps its own error, and the step's is logged beside it.
 * @param label - the smoke's name, opening the line a failed step is logged with.
 * @param passed - whether the test's own body ran to its end.
 * @param steps - each step's name, for the failure, and the step.
 */
export async function unwind(label: string, passed: boolean, steps: readonly (readonly [string, () => unknown])[]): Promise<void> {
  const failures: string[] = [];
  for (const [what, step] of steps) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(step),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`did not settle in ${UNWIND_STEP_MS / 1_000} s`)), UNWIND_STEP_MS);
        }),
      ]).finally(() => clearTimeout(timer));
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length === 0) return;
  if (passed) throw new Error(`the cleanup failed - ${failures.join("; ")}`);
  console.error(`${label}: the cleanup failed too - ${failures.join("; ")}`);
}
