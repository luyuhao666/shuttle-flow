import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const asset = join(root, 'assets', 'characters', 'pixel-athlete-v2');
const bytes = await readFile(join(asset, 'athlete.glb'));
await build({ entryPoints: [join(root, 'scripts', 'pixel-athlete-game.mjs')], bundle: true, format: 'iife', platform: 'browser',
  target: ['chrome110'], minify: true, define: { __ATHLETE_GLB__: JSON.stringify(bytes.toString('base64')) },
  outfile: join(asset, 'game-renderer.js'), legalComments: 'eof' });
console.log('Updated game renderer using the existing character GLB.');
