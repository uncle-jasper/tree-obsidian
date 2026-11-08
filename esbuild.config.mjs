import esbuild from 'esbuild';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { gzipSync } from 'zlib';

// Proof mode's engine isn't bundled into main.js (it's about 20 MB). The build writes it gzipped next to
// main.js, to attach to the GitHub release, and bakes its version and hash into main.js so the plugin
// fetches the right file once and checks it before use.
const harperVersion = JSON.parse(readFileSync('node_modules/harper.js/package.json', 'utf8')).version;
const wasm = readFileSync('node_modules/harper.js/dist/harper_wasm_bg.wasm');
const engineFile = `proof-engine-${harperVersion}.wasm.gz`;
writeFileSync(engineFile, gzipSync(wasm, { level: 9 }));

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', 'fs'],
  format: 'cjs',
  target: 'es2020',
  outfile: 'main.js',
  logLevel: 'info',
  define: {
    __HARPER_VERSION__: JSON.stringify(harperVersion),
    __PROOF_ENGINE_SHA__: JSON.stringify(createHash('sha256').update(wasm).digest('hex')),
  },
});
console.log('proof engine: ' + engineFile);
