import { access, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const circuits = ['mint_test_asset'];
const source = resolve('contract/build-test-asset');
const destination = resolve('public/zk-artifacts/blackout-test-asset');
const required = circuits.flatMap((circuit) => [
  `keys/${circuit}.prover`,
  `keys/${circuit}.verifier`,
  `zkir/${circuit}.bzkir`,
]);

await Promise.all(required.map((artifact) => access(resolve(source, artifact))));
await rm(destination, { recursive: true, force: true });

for (const artifact of required) {
  const target = resolve(destination, artifact);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(source, artifact), target);
}

await Promise.all(required.map((artifact) => access(resolve(destination, artifact))));
console.log(`BLACKOUT TEST ASSET: staged only the ${required.length} required browser ZK files for ${circuits[0]}.`);
