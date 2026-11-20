import { build } from 'esbuild';
import { rmSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');
const entryPoint = resolve(rootDir, 'src/index.js');

async function runBuild() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const sharedOptions = {
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: ['node20'],
    sourcemap: true,
    minify: false,
    external: ['express'],
  };

  await Promise.all([
    build({
      ...sharedOptions,
      format: 'esm',
      outfile: resolve(distDir, 'index.js'),
    }),
    build({
      ...sharedOptions,
      format: 'cjs',
      outfile: resolve(distDir, 'index.cjs'),
    }),
  ]);

  const esmSize = statSync(resolve(distDir, 'index.js')).size;
  const cjsSize = statSync(resolve(distDir, 'index.cjs')).size;

  console.log(
    `[api-sentinel-express] Build complete: dist/index.js (${esmSize} B), dist/index.cjs (${cjsSize} B)`
  );
}

runBuild().catch((error) => {
  console.error('[api-sentinel-express] Build failed:', error);
  process.exit(1);
});
