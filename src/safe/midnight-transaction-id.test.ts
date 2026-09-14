import { assertTransactionId } from './midnight/security-hardening.ts';
import { evaluateBlackoutSafeRelease } from './release-gate.ts';

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

function expectMessage(expected: string, fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error, 'expected Error');
    assert(error.message === expected, `expected ${expected}, got ${error.message}`);
    return;
  }
  throw new Error(`expected ${expected}`);
}

await test('TXID accepts canonical 32-byte transaction hash', () => {
  const hash = 'ab'.repeat(32);
  assert(assertTransactionId(hash, 'TX') === hash, '32-byte hash changed');
  assert(assertTransactionId(`0x${hash}`, 'TX') === hash, '0x hash did not normalize');
});

await test('TXID accepts Midnight 33-byte transaction identifier without stripping its tag byte', () => {
  const identifier = `01${'cd'.repeat(32)}`;
  assert(identifier.length === 66, 'fixture must be 33 bytes');
  assert(assertTransactionId(identifier, 'TX') === identifier, '33-byte identifier changed');
  assert(assertTransactionId(`0x${identifier}`, 'TX') === identifier, '0x identifier did not normalize');
});

await test('TXID rejects malformed lengths and contract-address prefixes', () => {
  expectMessage('TX_MUST_BE_64_OR_66_HEX', () => assertTransactionId('ab'.repeat(31), 'TX'));
  expectMessage('TX_MUST_BE_64_OR_66_HEX', () => assertTransactionId(`0200${'ab'.repeat(32)}`, 'TX'));
});

await test('release gate accepts finalized 33-byte Preview transaction identifier', () => {
  const txId = `01${'ab'.repeat(32)}`;
  const contractAddress = 'cd'.repeat(32);
  const gate = evaluateBlackoutSafeRelease({
    fullZkArtifactsGenerated: true,
    compilerPinned0311: true,
    strictTypecheckPassed: true,
    protocolTestsPassed: true,
    generatedBindingIntegrated: true,
    lacePreviewProviderIntegrated: true,
    previewDeploymentTxId: txId,
    previewContractAddress: contractAddress,
    previewDeploymentNetworkId: 'preview',
    previewDeploymentFinalized: true,
    previewDeploymentVerifiedOnChain: true,
    multiUserPreviewValidated: false,
    liveShieldedExecutionValidated: false,
    liveReceiptVerificationValidated: false,
  });
  assert(gate.deployedOnPreview, '33-byte tx identifier must count as valid Preview evidence');
  assert(gate.stage === 'PREVIEW_DEPLOYED', 'incomplete live validation should remain PREVIEW_DEPLOYED');
});

console.log(`\nBLACKOUT SAFE MIDNIGHT TX-ID TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} Midnight transaction-id test(s) failed`);
