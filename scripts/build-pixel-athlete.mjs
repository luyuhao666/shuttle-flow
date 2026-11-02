import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { build } from 'esbuild';
import { createPixelAthlete, PIXEL_MODEL_VERSION, PIXEL_PALETTE } from './lib/pixel-athlete-model.mjs';
import { PIXEL_MOTIONS } from './lib/pixel-athlete-motion.mjs';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};
const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'assets', 'characters', 'pixel-athlete-v2');
await mkdir(out, { recursive: true });
const athlete = createPixelAthlete();
const binary = Buffer.from(await new GLTFExporter().parseAsync(athlete.root,
  { binary: true, animations: athlete.animations, trs: true, onlyVisible: true }));
await writeFile(join(out, 'athlete.glb'), binary);
for (const [entry, output] of [['pixel-athlete-preview.mjs', 'preview.js'], ['pixel-athlete-game.mjs', 'game-renderer.js']]) {
  await build({ entryPoints: [join(root, 'scripts', entry)], bundle: true, format: 'iife', platform: 'browser',
    target: ['chrome110'], minify: true, define: { __ATHLETE_GLB__: JSON.stringify(binary.toString('base64')) },
    outfile: join(out, output), legalComments: 'eof' });
}
await writeFile(join(out, 'preview.html'), await readFile(join(root, 'scripts', 'pixel-athlete-preview.html')));
let triangles = 0, bodyTriangles = 0;
athlete.root.traverse(o => { if (o.isMesh) {
  const n = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  triangles += n; if (o.isSkinnedMesh) bodyTriangles += n;
} });
const manifest = { version: PIXEL_MODEL_VERSION, stage: 'gameplay integrated', file: 'athlete.glb',
  gameplayIntegrated: true, gameplayRenderer: 'game-renderer.js', reference: '../pixel-athlete-reference.png', palette: PIXEL_PALETTE,
  joints: athlete.bones.map(b => b.name), triangles, bodyTriangles, bytes: binary.length,
  floor: athlete.floor, top: athlete.top, animations: PIXEL_MOTIONS,
  racket: { separate: true, inherited: true, parent: 'RightHand', locator: 'RacketContact' } };
await writeFile(join(out, 'model.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(out, 'THIRD_PARTY_LICENSE.txt'), await readFile(join(root, 'node_modules', 'three', 'LICENSE')));
console.log(JSON.stringify({ out, triangles, bodyTriangles, bytes: binary.length, joints: athlete.bones.length }, null, 2));
