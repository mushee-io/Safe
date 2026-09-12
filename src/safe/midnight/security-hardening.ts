const SERIALIZED_SECRETISH_HEX = /\b(?:0x)?[0-9a-f]{128,}\b/gi;
const URL_CREDENTIALS = /(https?:\/\/)([^\s/@]+):([^\s/@]+)@/gi;

export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function normalizedHexIdentifier(value: unknown, stripContractPrefix: boolean): string {
  if (typeof value !== 'string') return '';
  let normalized = value.trim().toLowerCase().replace(/^0x/, '');
  if (stripContractPrefix) normalized = normalized.replace(/^0200/, '');
  return normalized;
}

/** Canonical Midnight transaction identifier: raw 32-byte lower-case hex. */
export function assertTransactionId(value: unknown, label: string): string {
  const normalized = normalizedHexIdentifier(value, false);
  if (!isHex64(normalized)) throw new Error(`${label}_MUST_BE_64_HEX`);
  return normalized;
}

/**
 * Canonical Midnight contract address: raw 32-byte lower-case hex. Midnight
 * tooling may surface the same address as `0x...` or with an `0200` prefix;
 * those recognized encodings are normalized before validation.
 */
export function assertContractAddress(value: unknown, label: string): string {
  const normalized = normalizedHexIdentifier(value, true);
  if (!isHex64(normalized)) throw new Error(`${label}_MUST_BE_64_HEX`);
  return normalized;
}

export function assertSafeEndpointUri(value: string | undefined, kind: 'HTTP' | 'WS'): string {
  if (!value) throw new Error(`BLACKOUT_SAFE_${kind}_ENDPOINT_MISSING`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`BLACKOUT_SAFE_${kind}_ENDPOINT_INVALID`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`BLACKOUT_SAFE_${kind}_ENDPOINT_CREDENTIALS_FORBIDDEN`);
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (kind === 'HTTP' && parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('BLACKOUT_SAFE_INDEXER_HTTPS_REQUIRED');
  }
  if (kind === 'WS' && parsed.protocol !== 'wss:' && !(local && parsed.protocol === 'ws:')) {
    throw new Error('BLACKOUT_SAFE_INDEXER_WSS_REQUIRED');
  }
  return parsed.toString();
}

export function resolvePinnedAssetBaseUrl(assetPath: string, origin?: string): string {
  if (assetPath !== '/zk-artifacts/blackout-safe') {
    throw new Error('BLACKOUT_SAFE_ZK_ASSET_PATH_NOT_PINNED');
  }
  const runtimeOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  if (!runtimeOrigin) throw new Error('BLACKOUT_SAFE_BROWSER_ORIGIN_REQUIRED');
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(runtimeOrigin);
  } catch {
    throw new Error('BLACKOUT_SAFE_BROWSER_ORIGIN_INVALID');
  }
  const local = parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1' || parsedOrigin.hostname === '[::1]';
  if (parsedOrigin.protocol !== 'https:' && !(local && parsedOrigin.protocol === 'http:')) {
    throw new Error('BLACKOUT_SAFE_HTTPS_ORIGIN_REQUIRED');
  }
  return new URL(`${assetPath}/`, parsedOrigin.origin).toString().replace(/\/$/, '');
}

export function sanitizeMidnightErrorMessage(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const redacted = trimmed
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(SERIALIZED_SECRETISH_HEX, '[REDACTED_HEX_PAYLOAD]');
  return redacted.length > 512 ? `${redacted.slice(0, 509)}...` : redacted;
}

export function assertCircuitArity(
  circuitId: string,
  args: readonly unknown[],
  expected: Readonly<Record<string, number>>,
): void {
  const arity = expected[circuitId];
  if (arity === undefined) throw new Error('BLACKOUT_SAFE_UNKNOWN_CIRCUIT');
  if (args.length !== arity) throw new Error(`BLACKOUT_SAFE_${circuitId.toUpperCase()}_ARGUMENT_COUNT_MISMATCH`);
}
