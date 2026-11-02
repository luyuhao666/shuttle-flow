import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '@electron/asar';

const root=fileURLToPath(new URL('../',import.meta.url));
const tutorialCheck=process.argv.includes('--tutorial');
const landscapeCheck=process.argv.includes('--landscape');
const languageCheck=process.argv.includes('--language');
const baseline=resolve(root,languageCheck?'artifacts/language-before.asar':landscapeCheck?'artifacts/landscape-before.asar':tutorialCheck?'artifacts/tutorial-before.asar':'artifacts/mobile-controls-before.asar');
const packaged=resolve(root,'dist/Shuttle Flow-win32-x64/resources/app.asar');
const unchanged=['core.js','appearance.js','guidance.js','sounds.js','target-challenge.js','assets/characters/pixel-athlete-v2/game-renderer.js'];
if(tutorialCheck&&!landscapeCheck&&!languageCheck)unchanged.push('touch-input.js');
if(landscapeCheck||languageCheck)unchanged.push('tutorial.js');
for(const name of unchanged) assert.ok((await readFile(join(root,name))).equals(extractFile(baseline,join(...name.split('/')))),`${name} unchanged from before touch work`);
const html=await readFile(join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
const files=['index.html','style.css',...scripts,'desktop/main.cjs','desktop/window-state.cjs'];
const archive=[];
for(const name of files) {
  const source=await readFile(join(root,name));
  assert.ok(source.equals(extractFile(packaged,join(...name.split('/')))),`packaged ${name} matches source`);
  archive.push({name,bytes:source.length,equal:true});
}
const http=[];
for(const lan of [false,true]) {
  const port=lan?3022:3021;
  const server=spawn(process.execPath,[join(root,'server.js'),...(lan?['--lan']:[])],{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';server.stdout.on('data',b=>{output+=b;});server.stderr.on('data',b=>{output+=b;});
  try {
    let ready=false;
    for(let i=0;i<50;i++) {try {const r=await fetch(`http://127.0.0.1:${port}/`);if(r.ok){ready=true;break;}}catch {}await new Promise(r=>setTimeout(r,100));}
    assert.ok(ready,`HTTP ${lan?'LAN':'local'} server ready: ${output}`);
    for(const name of ['index.html','style.css',...scripts]) {
      const response=await fetch(`http://127.0.0.1:${port}/${name}`);assert.equal(response.status,200,name);
      const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.equals(await readFile(join(root,name))),`${name} served without alteration`);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/HANDOFF.md`)).status,404,'only game resources are exposed');
    http.push({mode:lan?'optional LAN bind':'default localhost',scripts:scripts.length,resourcesMatch:true,privateDocumentBlocked:true});
  } finally {server.kill();}
}
await writeFile(join(root,languageCheck?'artifacts/language-support-checks.json':landscapeCheck?'artifacts/landscape-support-checks.json':tutorialCheck?'artifacts/tutorial-support-checks.json':'artifacts/mobile-controls-support-checks.json'),JSON.stringify({unchanged,archive,http,phoneOnActualWifiTested:false},null,2));
console.log(`${languageCheck?'Language':landscapeCheck?'Landscape':tutorialCheck?'Tutorial':'Mobile'} support: existing rules/AI/renderer unchanged; packaged scripts match; default and optional LAN HTTP resources verified.`);
