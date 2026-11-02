import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { build } from 'esbuild';
import { createAthlete, MODEL_VERSION } from './lib/athlete-model.mjs';

// GLTFExporter uses the browser FileReader API even for texture-free GLB exports.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }, error => this.onerror?.(error));
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(result => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.();
    }, error => this.onerror?.(error));
  }
};

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'assets', 'characters', 'anime-athlete-v1');
await mkdir(output, { recursive: true });
const athlete = createAthlete();
const exported = await new GLTFExporter().parseAsync(athlete.root, {
  binary: true, animations: athlete.animations, trs: true, onlyVisible: true
});
const binary = Buffer.from(exported);
await writeFile(join(output, 'athlete.glb'), binary);
// Embedded bytes let the standalone preview work on file:// without fetch/CORS.
await build({
  entryPoints: [resolve(root, 'scripts', 'athlete-preview.mjs')], bundle: true,
  format: 'iife', platform: 'browser', target: ['chrome110'], minify: true,
  define: { __ATHLETE_GLB__: JSON.stringify(binary.toString('base64')) },
  outfile: join(output, 'preview.js'), legalComments: 'eof'
});
await build({
  entryPoints: [resolve(root, 'scripts', 'athlete-game.mjs')], bundle: true,
  format: 'iife', platform: 'browser', target: ['chrome110'], minify: true,
  define: { __ATHLETE_GLB__: JSON.stringify(binary.toString('base64')) },
  outfile: join(output, 'game-renderer.js'), legalComments: 'eof'
});
await writeFile(join(output, 'preview.html'), await readFile(resolve(root, 'scripts', 'athlete-preview.html')));
const manifest = { version: MODEL_VERSION, format: 'glTF 2.0 binary', units: 'metres', forward: '+Z', handedness: 'right',
  file: 'athlete.glb', bytes: binary.length, joints: athlete.bones.map(bone => bone.name),
  animations: athlete.animations.map(clip => ({ name: clip.name, seconds: clip.duration })),
  racketAttachment: 'RightHand', contactLocator: 'RacketContact', embeddedTextures: 0,
  gameplayIntegrated: true, gameplayRenderer: 'game-renderer.js', source: '../../../scripts/lib/athlete-model.mjs' };
let vertices = 0, triangles = 0, meshCount = 0;
athlete.root.traverse(object => {
  if (!object.isMesh) return;
  meshCount++; vertices += object.geometry.attributes.position.count;
  triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
});
Object.assign(manifest, { vertices, triangles, meshCount });
await writeFile(join(output, 'model.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(output, 'THIRD_PARTY_LICENSE.txt'), 'Preview uses Three.js (MIT) and bundled Three.js addons.\n\n' + await readFile(resolve(root, 'node_modules', 'three', 'LICENSE'), 'utf8'));
console.log(JSON.stringify({ output, bytes: binary.length, joints: athlete.bones.length, animations: athlete.animations.map(clip => clip.name), vertices, triangles }, null, 2));
