import { readFile, writeFile } from 'node:fs/promises';

const path = 'contract/blackout_safe.preview.compact';
const marker = '// ---------------------------------------------------------------------------\n// AUTHORIZATION / POLICY HELPERS\n// ---------------------------------------------------------------------------';

const helpers = `// ---------------------------------------------------------------------------
// STABLE CLIENT-SIDE COMMITMENT HELPERS
// ---------------------------------------------------------------------------
// These are intentionally unexported: they generate no deploy verifier keys.
// The browser calls their compiler-generated named helpers instead of brittle
// numbered _persistentHash_N internals, which can shift when circuits change.

circuit client_proposal_commitment(
  client_safe_id: Bytes<32>,
  payload: PrivateProposalPayload
): Bytes<32> {
  return persistentHash<[
    Bytes<32>, Bytes<32>, Bytes<32>, Bytes<32>, Bytes<32>, Uint<64>,
    Bytes<32>, Bytes<32>, Uint<64>, Uint<64>, Bytes<32>, Bytes<32>
  ]>([
    pad(32, "blackout:safe:proposal:v1"),
    client_safe_id,
    payload.action_type,
    payload.asset,
    payload.recipient,
    payload.amount,
    payload.calldata_or_action,
    payload.memo_hash,
    payload.created_at,
    payload.expires_at,
    payload.nonce,
    payload.salt
  ]);
}

circuit client_governance_simple_commitment(
  client_safe_id: Bytes<32>,
  action_tag: Bytes<32>
): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([
    pad(32, "blackout:safe:governance:v1"), client_safe_id, action_tag
  ]);
}

circuit client_governance_bytes_commitment(
  client_safe_id: Bytes<32>,
  action_tag: Bytes<32>,
  value: Bytes<32>
): Bytes<32> {
  return persistentHash<Vector<4, Bytes<32>>>([
    pad(32, "blackout:safe:governance:v1"), client_safe_id, action_tag, value
  ]);
}

circuit client_governance_root_commitment(
  client_safe_id: Bytes<32>,
  action_tag: Bytes<32>,
  root: MerkleTreeDigest
): Bytes<32> {
  return persistentHash<[Bytes<32>, Bytes<32>, Bytes<32>, Field]>([
    pad(32, "blackout:safe:governance:v1"), client_safe_id, action_tag, root.field
  ]);
}

`;

let source = await readFile(path, 'utf8');
if (!source.includes(marker)) throw new Error('BLACKOUT_SAFE_HASH_HELPER_INSERTION_MARKER_MISSING');
if (!source.includes('circuit client_proposal_commitment(')) {
  source = source.replace(marker, `${helpers}${marker}`);
}
await writeFile(path, source, 'utf8');
console.log('BLACKOUT SAFE: stable named client commitment helpers inserted.');
