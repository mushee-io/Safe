import { buildBlackoutSafeWitnesses } from './midnight/witnesses.ts';
import {
  bytesToHex32,
  createMembershipSetup,
  decodePolicyOpening,
  decodeProposalBundle,
  decodeSignerKit,
  exactPolicyCommitment,
  exactProposalCommitment,
  padAscii32,
  randomBytes32,
  serializePolicyOpening,
  serializeProposalBundle,
  verifyMembershipSetup,
  witnessBundleForSigner,
} from './midnight/live-encoding.ts';

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => Promise<void> | void) {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await test('WEB exact 10-level membership setup verifies every generated signer path', () => {
  const setup = createMembershipSetup(5, new Uint8Array(32).fill(7));
  assert(setup.kits.length === 5, 'expected five signer kits');
  assert(verifyMembershipSetup(setup), 'all generated paths must reconstruct exact Compact root');
  assert(setup.kits.every((kit) => kit.memberPath.value.path.length === 10), 'every path must be depth 10');
});

await test('WEB signer kit round trip binds secret to exact Compact member commitment', () => {
  const setup = createMembershipSetup(3, new Uint8Array(32).fill(8));
  const decoded = decodeSignerKit(setup.kits[1]);
  assert(bytesToHex32(decoded.memberCommitment) === setup.kits[1].memberCommitment, 'commitment mismatch');
  assert(decoded.membershipVersion === 1n, 'membership version mismatch');
});

await test('WEB policy opening round trip preserves exact Compact commitment', () => {
  const setup = createMembershipSetup(3, new Uint8Array(32).fill(9));
  const policy = {
    is_private: true,
    threshold: 2n,
    max_transfer_amount: 5000n,
    max_proposal_lifetime: 86400n,
    min_execution_delay: 0n,
    membership_version: 1n,
    policy_version: 1n,
    salt: new Uint8Array(32).fill(4),
  };
  const before = bytesToHex32(exactPolicyCommitment(policy));
  const serialized = serializePolicyOpening(setup.safeId, policy);
  const after = bytesToHex32(exactPolicyCommitment(decodePolicyOpening(serialized).policy));
  assert(before === after, 'policy commitment changed across round trip');
});

await test('WEB proposal bundle round trip preserves exact Compact proposal commitment', () => {
  const safeId = new Uint8Array(32).fill(5);
  const payload = {
    action_type: padAscii32('TRANSFER'),
    asset: new Uint8Array(32).fill(1),
    recipient: new Uint8Array(32).fill(2),
    amount: 123n,
    calldata_or_action: padAscii32('TRANSFER'),
    memo_hash: new Uint8Array(32).fill(3),
    created_at: 1_800_000_000n,
    expires_at: 1_800_003_600n,
    nonce: new Uint8Array(32).fill(6),
    salt: new Uint8Array(32).fill(7),
  };
  const commitment = exactProposalCommitment(safeId, payload);
  const serialized = serializeProposalBundle(safeId, commitment, payload);
  const decoded = decodeProposalBundle(serialized);
  assert(bytesToHex32(decoded.proposalCommitment) === bytesToHex32(commitment), 'proposal commitment changed');
});

await test('WEB witness bundle remains ephemeral and compiler-shaped', () => {
  const setup = createMembershipSetup(2, new Uint8Array(32).fill(11));
  const policy = serializePolicyOpening(setup.safeId, {
    is_private: false,
    threshold: 2n,
    max_transfer_amount: 0n,
    max_proposal_lifetime: 86400n,
    min_execution_delay: 0n,
    membership_version: 1n,
    policy_version: 1n,
    salt: new Uint8Array(32),
  });
  const privateProposal = {
    action_type: padAscii32('TRANSFER'),
    asset: new Uint8Array(32).fill(1),
    recipient: new Uint8Array(32).fill(2),
    amount: 1n,
    calldata_or_action: padAscii32('TRANSFER'),
    memo_hash: new Uint8Array(32).fill(3),
    created_at: 1n,
    expires_at: 2n,
    nonce: randomBytes32(),
    salt: randomBytes32(),
  };
  const commitment = exactProposalCommitment(setup.safeId, privateProposal);
  const proposal = serializeProposalBundle(setup.safeId, commitment, privateProposal);
  const witnesses = buildBlackoutSafeWitnesses(witnessBundleForSigner(setup.kits[0], policy, proposal));
  assert(typeof witnesses.local_member_secret === 'function', 'member witness missing');
  assert(typeof witnesses.local_private_proposal === 'function', 'proposal witness missing');
});

console.log(`\nBLACKOUT SAFE WEB ENCODING TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) throw new Error(`${fail} web encoding test(s) failed`);
