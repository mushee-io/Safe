import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = 'contract/blackout_safe.compact';
const OUTPUT = 'contract/blackout_safe.preview.compact';
const MARKER = '// ---------------------------------------------------------------------------\n// BLACKOUT RECEIPT CIRCUITS\n// ---------------------------------------------------------------------------';

const receiptBlock = `// ---------------------------------------------------------------------------
// BLACKOUT RECEIPT — ONE EXPORTED CIRCUIT, FIVE STATEMENT MODES
// ---------------------------------------------------------------------------
// This deployment form preserves all five receipt statements while reducing
// verifier-key count. Mode values are public and domain-stable:
// 1 quorum authorized, 2 executed exactly once, 3 disclose amount,
// 4 disclose recipient, 5 proposal cancelled.

export struct ReceiptStatementResult {
  valid: Boolean;
  amount: Uint<64>;
  recipient: Bytes<32>;
}

export circuit receipt_statement(
  statement: Uint<64>,
  proposal_commitment: Bytes<32>
): ReceiptStatementResult {
  assert(statement >= 1 && statement <= 5, "BLACKOUT_SAFE_RECEIPT_STATEMENT_UNSUPPORTED");

  if (statement == 1) {
    assert(proposals.member(disclose(proposal_commitment)), "BLACKOUT_SAFE_UNKNOWN_PROPOSAL");
    const proposal = proposals.lookup(disclose(proposal_commitment));
    const policy = require_proposal_policy_opening(proposal);
    const valid = proposal.approval_count >= policy.threshold;
    assert(valid, "BLACKOUT_SAFE_QUORUM_NOT_REACHED");
    return ReceiptStatementResult {
      valid: disclose(valid),
      amount: 0,
      recipient: pad(32, "")
    };
  } else if (statement == 2) {
    const payload = local_private_proposal();
    assert(private_proposal_commitment(payload) == proposal_commitment, "BLACKOUT_SAFE_RECEIPT_PAYLOAD_MISMATCH");
    const exec_nul = execution_nullifier(proposal_commitment, payload.nonce);
    assert(execution_nullifiers.member(exec_nul), "BLACKOUT_SAFE_RECEIPT_NOT_EXECUTED");
    return ReceiptStatementResult {
      valid: true,
      amount: 0,
      recipient: pad(32, "")
    };
  } else if (statement == 3) {
    const payload = local_private_proposal();
    assert(private_proposal_commitment(payload) == proposal_commitment, "BLACKOUT_SAFE_RECEIPT_PAYLOAD_MISMATCH");
    const exec_nul = execution_nullifier(proposal_commitment, payload.nonce);
    assert(execution_nullifiers.member(exec_nul), "BLACKOUT_SAFE_RECEIPT_NOT_EXECUTED");
    return ReceiptStatementResult {
      valid: true,
      amount: disclose(payload.amount),
      recipient: pad(32, "")
    };
  } else if (statement == 4) {
    const payload = local_private_proposal();
    assert(private_proposal_commitment(payload) == proposal_commitment, "BLACKOUT_SAFE_RECEIPT_PAYLOAD_MISMATCH");
    const exec_nul = execution_nullifier(proposal_commitment, payload.nonce);
    assert(execution_nullifiers.member(exec_nul), "BLACKOUT_SAFE_RECEIPT_NOT_EXECUTED");
    return ReceiptStatementResult {
      valid: true,
      amount: 0,
      recipient: disclose(payload.recipient)
    };
  } else {
    const valid = cancelled_proposals.member(disclose(proposal_commitment));
    assert(valid, "BLACKOUT_SAFE_RECEIPT_NOT_CANCELLED");
    return ReceiptStatementResult {
      valid: disclose(valid),
      amount: 0,
      recipient: pad(32, "")
    };
  }
}
`;

const source = await readFile(SOURCE, 'utf8');
const markerIndex = source.indexOf(MARKER);
if (markerIndex < 0) throw new Error('BLACKOUT_SAFE_RECEIPT_SECTION_NOT_FOUND');

const generated = `${source.slice(0, markerIndex)}${receiptBlock}`;
const legacyExports = [
  'export circuit receipt_quorum_authorized',
  'export circuit receipt_executed_exactly_once',
  'export circuit receipt_disclose_amount',
  'export circuit receipt_disclose_recipient',
  'export circuit receipt_proposal_cancelled',
];
for (const legacy of legacyExports) {
  if (generated.includes(legacy)) throw new Error(`BLACKOUT_SAFE_LEGACY_RECEIPT_EXPORT_RETAINED: ${legacy}`);
}
if (!generated.includes('export circuit receipt_statement')) {
  throw new Error('BLACKOUT_SAFE_UNIFIED_RECEIPT_MISSING');
}

await writeFile(OUTPUT, generated, 'utf8');
console.log('BLACKOUT SAFE: generated Preview contract with one receipt circuit.');
