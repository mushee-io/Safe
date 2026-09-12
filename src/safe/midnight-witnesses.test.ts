import { buildBlackoutSafeWitnesses } from './midnight/witnesses.ts';

let pass = 0;
let fail = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    pass += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

await test('M16 ephemeral witness bundle returns values without mutating private state', () => {
  const state = {};
  const secret = new Uint8Array(32).fill(7);
  const witnesses = buildBlackoutSafeWitnesses({ memberSecret: secret }) as any;
  const [nextState, returnedSecret] = witnesses.local_member_secret({ privateState: state });
  assert(nextState === state, 'witness callback must preserve private-state identity');
  assert(returnedSecret === secret, 'witness callback must return the ephemeral secret');
  assert(Object.keys(state).length === 0, 'witness callback must not persist secret material');
});

await test('M16 missing witness fails closed at callback execution', () => {
  const witnesses = buildBlackoutSafeWitnesses({}) as any;
  let message = '';
  try {
    witnesses.local_policy({ privateState: {} });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message === 'BLACKOUT_SAFE_WITNESS_POLICY_MISSING', 'missing policy witness must fail closed');
});

console.log(`\nBLACKOUT SAFE WITNESS TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} witness test(s) failed`);
