import { rm, readFile } from 'fs/promises';
import pkg from './package.json';

console.log('🧹 Cleaning dist...');
await rm('./dist', { recursive: true, force: true });

// Real npm dependencies must stay imports, not get inlined - otherwise
// consumers ship them twice (once bundled here, once installed for real).
const external = Object.keys(pkg.dependencies ?? {});

// Only build what's actually reachable from the public package surface
// (the exports map + what index.js loads directly). Everything else in
// src/ is internal-only - it already gets inlined wherever it's really
// needed (splitting is off), so building it again as its own top-level
// file just ships dead weight.
const publicDistPaths = new Set();
for (const entry of Object.values(pkg.exports)) {
  if (entry.import?.startsWith('./dist/')) publicDistPaths.add(entry.import);
  if (entry.require?.startsWith('./dist/')) publicDistPaths.add(entry.require);
}

const indexSource = await readFile('./index.js', 'utf8');
for (const match of indexSource.matchAll(/from\s+['"](\.\/dist\/[^'"]+)['"]/g)) {
  publicDistPaths.add(match[1]);
}

const entrypoints = [...publicDistPaths]
  .filter((p) => p.endsWith('.js'))
  .map((p) => p.replace(/^\.\/dist\//, './src/').replace(/\.js$/, '.ts'));

console.log(`📦 Building ${entrypoints.length} entrypoints...`);

const result = await Bun.build({
  entrypoints,
  outdir: './dist',
  root: './src',
  // minify: true,
  splitting: false,   // no shared chunks — each file is self-contained
  target: 'node',
  external,
});

if (!result.success) {
  console.error('❌ Build failed');
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}

console.log(`✅ Built ${result.outputs.length} files`);

console.log('📦 Generating type declarations...');
const tsc = Bun.spawnSync(['npx', 'tsc', '-p', 'tsconfig.json'], { stdio: ['ignore', 'inherit', 'inherit'] });
if (tsc.exitCode !== 0) {
  console.error('❌ tsc failed');
  process.exit(tsc.exitCode);
}

console.log('✅ Build complete!');
