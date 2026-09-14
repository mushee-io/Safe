import { readFile, writeFile } from 'node:fs/promises';

const path = 'contract/blackout_safe.preview.compact';
let source = await readFile(path, 'utf8');

source = source.replace(
  '): ReceiptStatementResult {\n  assert(statement >= 1 && statement <= 5,',
  '): ReceiptStatementResult {\n  const mode = disclose(statement);\n  assert(mode >= 1 && mode <= 5,',
);
source = source.replaceAll('(statement == ', '(mode == ');

if (!source.includes('const mode = disclose(statement);')) {
  throw new Error('BLACKOUT_SAFE_RECEIPT_MODE_DISCLOSURE_PATCH_FAILED');
}
if (source.includes('(statement == ')) {
  throw new Error('BLACKOUT_SAFE_RECEIPT_PRIVATE_MODE_BRANCH_REMAINED');
}

await writeFile(path, source, 'utf8');
console.log('BLACKOUT SAFE: receipt statement mode is explicitly public.');
