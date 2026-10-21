// face/tests/unwind.ts
/** The real-boot smokes' cleanup (tests/desk-smoke.test.ts, tests/telegram-smoke.test.ts): every step runs,
 * whatever the steps before it did, so a dispose that rejects can skip neither the face's dispose nor the
 * fixture's removal. */

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
    try {
      await step();
    } catch (error) {
      failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length === 0) return;
  if (passed) throw new Error(`the cleanup failed - ${failures.join("; ")}`);
  console.error(`${label}: the cleanup failed too - ${failures.join("; ")}`);
}
