import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;

function check(name, predicate) {
  try {
    if (!predicate()) throw new Error('assertion failed');
    pass += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const vite = readFileSync('vite.config.ts', 'utf8');
const styles = `${readFileSync('src/web/styles.css', 'utf8')}\n${readFileSync('src/web/product.css', 'utf8')}`;
const index = readFileSync('index.html', 'utf8');
const bootstrap = readFileSync('src/web/security-bootstrap.ts', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

const allHeaders = vercel.headers.flatMap((rule) => rule.headers ?? []);
const globalRule = vercel.headers.find((rule) => rule.source === '/(.*)');
const globalHeaders = new Map((globalRule?.headers ?? []).map((header) => [header.key, header.value]));
const zkRule = vercel.headers.find((rule) => rule.source === '/zk-artifacts/blackout-safe/(.*)');
const zkHeaders = new Map((zkRule?.headers ?? []).map((header) => [header.key, header.value]));
const csp = globalHeaders.get('Content-Security-Policy') ?? '';
const bootstrapEntry = '/src/web/security-bootstrap.ts';
const treasuryEntries = ['/src/web/app-v2.ts', '/src/web/main.ts'];
const activeTreasuryEntry = treasuryEntries.find((entry) => index.includes(entry));

check('WEBSEC CSP denies framing, objects and base injection', () =>
  csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && csp.includes("base-uri 'none'"));
check('WEBSEC CSP permits WASM without generic unsafe-eval', () =>
  csp.includes("'wasm-unsafe-eval'") && !csp.includes("'unsafe-eval'"));
check('WEBSEC transport and clickjacking headers are enforced', () =>
  globalHeaders.get('Strict-Transport-Security')?.includes('max-age=63072000') === true && globalHeaders.get('X-Frame-Options') === 'DENY');
check('WEBSEC privacy/security headers are present', () =>
  globalHeaders.get('Referrer-Policy') === 'no-referrer' && globalHeaders.get('X-Content-Type-Options') === 'nosniff' && globalHeaders.get('Origin-Agent-Cluster') === '?1');
check('WEBSEC proving artifacts cannot become stale immutable keys', () => {
  const value = zkHeaders.get('Cache-Control') ?? '';
  return value.includes('must-revalidate') && !value.includes('immutable');
});
check('WEBSEC dependency install scripts are disabled on Vercel', () =>
  typeof vercel.installCommand === 'string' && vercel.installCommand.includes('--ignore-scripts'));
check('WEBSEC production source maps are disabled', () => vite.includes('sourcemap: false'));
check('WEBSEC third-party font beacon removed', () => !styles.includes('fonts.googleapis.com') && !styles.includes('fonts.gstatic.com'));
check('WEBSEC security bootstrap loads before treasury app', () =>
  Boolean(activeTreasuryEntry) && index.indexOf(bootstrapEntry) >= 0 && index.indexOf(bootstrapEntry) < index.indexOf(activeTreasuryEntry));
check('WEBSEC self-asserted network verification is scrubbed', () =>
  bootstrap.includes('deploymentVerifiedOnChain = false') && bootstrap.includes("#attach-verified") && bootstrap.includes('NETWORK VERIFICATION CANNOT BE SELF-DECLARED'));
check('WEBSEC private browser inputs disable spellcheck/autocomplete and cap payloads', () =>
  bootstrap.includes("element.autocomplete = 'off'") && bootstrap.includes('element.spellcheck = false') && bootstrap.includes('MAX_PRIVATE_INPUT_CHARS'));
check('WEBSEC CI actions are SHA pinned', () =>
  ci.includes('actions/checkout@11d5960a326750d5838078e36cf38b85af677262') &&
  ci.includes('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020') &&
  ci.includes('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02') &&
  !ci.includes('actions/checkout@v4') && !ci.includes('actions/setup-node@v4') && !ci.includes('actions/upload-artifact@v4'));
check('WEBSEC CI install also disables dependency scripts', () => ci.includes('npm install --ignore-scripts --no-audit --no-fund'));
check('WEBSEC header surface contains no legacy X-XSS-Protection override', () => !allHeaders.some((header) => header.key === 'X-XSS-Protection'));

console.log(`\nBLACKOUT SAFE WEB SECURITY TESTS: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
