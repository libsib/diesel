import { Glob } from 'bun';
import { rm } from 'fs/promises';

console.log('🧹 Cleaning dist...');
await rm('./dist', { recursive: true, force: true });

// Auto-discover all TS source files, skip tests
const glob = new Glob('**/*.ts');
const entrypoints = [];
for await (const file of glob.scan('./lib')) {
  if (!file.includes('.test.') && !file.includes('.spec.')) {
    entrypoints.push(`./lib/${file}`);
  }
}

console.log(`📦 Building ${entrypoints.length} entrypoints...`);

const result = await Bun.build({
  entrypoints,
  outdir: './dist',
  root: './lib',
  // minify: true,
  splitting: false,   // no shared chunks — each file is self-contained
  target: 'node',
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
