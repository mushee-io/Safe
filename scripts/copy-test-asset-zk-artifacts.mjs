import { access, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

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
await mkdir(destination, { recursive: true });
await Promise.all([
  cp(resolve(source, 'keys'), resolve(destination, 'keys'), { recursive: true }),
  cp(resolve(source, 'zkir'), resolve(destination, 'zkir'), { recursive: true }),
]);
await Promise.all(required.map((artifact) => access(resolve(destination, artifact))));
console.log(`BLACKOUT TEST ASSET: staged ${required.length} ZK artifacts for ${circuits.length} circuit.`);
