import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import '../core.js';
import { pursuitProbe, rallyProbe, smashDefenseProbe } from './lib/ai-simulation.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), core = globalThis.ShuttleCore;
assert.ok((await readFile(join(root, 'game.js'), 'utf8')).includes('advanceOpponentReturn(opponent, delivery, dt)'), 'simulation exercises the production decision');
const report = { method: 'production AI decision + actual inertia, jump, contact, shot planner; seeded scripted player and real player attacks, no GUI or human win-rate claim', current: {}, baseline: null, smashDefense: { current: {}, baseline: null } };
const index = process.argv.indexOf('--baseline-asar');
let previous = null;
if (index >= 0) {
  const asar = createRequire(import.meta.url)('@electron/asar');
  const source = asar.extractFile(process.argv[index + 1], 'core.js').toString('utf8');
  previous = runInNewContext(`${source}\nglobalThis.ShuttleCore`);
  for (const name of ['RULES', 'FOOTWORK', 'JUMP', 'CONTACT', 'BACKHAND']) assert.equal(JSON.stringify(core[name]), JSON.stringify(previous[name]), `${name} player rules preserved`);
  for (const name of ['movePlayer', 'assessHit', 'canPlayerSmash', 'canBackhandAttack', 'shotFor', 'planReturn']) assert.equal(core[name].toString(), previous[name].toString(), `${name} player behavior preserved`);
  report.baseline = {};
  report.smashDefense.baseline = {};
  for (const [level, oldLevel] of [['easy','normal'],['normal','hard']]) {
    assert.equal(JSON.stringify(core.AI_LEVELS[level]),JSON.stringify(previous.AI_LEVELS[oldLevel]),`${level} inherits the previous ${oldLevel} profile exactly`);
    for (const style of Object.keys(core.AI_STYLES)) for (const received of ['clear','drop','smash']) for (const roll of [.05,.4,.7,.95]) {
      const player={x:.3,y:.7},contact={x:.5,y:-.65,z:received==='smash'?65:95};
      const current=core.makeMatchDelivery(player,core.createOpponent(level,style),5,contact,()=>roll,received);
      const old=previous.makeMatchDelivery(player,previous.createOpponent(oldLevel,style),5,contact,()=>roll,received);
      assert.equal(JSON.stringify(current),JSON.stringify(old),`${level}/${style} preserves the shifted tier's shot behavior`);
    }
  }
}
for (const level of Object.keys(core.AI_LEVELS)) {
  report.smashDefense.current[level]=smashDefenseProbe(core,level);
  if(previous)report.smashDefense.baseline[level]=smashDefenseProbe(previous,level);
}
for (const type of ['tap','smash']) {
  const rates=['easy','normal','hard'].map(level=>report.smashDefense.current[level].totals[type].returnRate);
  assert.ok(rates[1]>rates[0]+.20&&rates[2]>rates[1]+.05,`${type}: all three tiers are separated against actual player attacks`);
  assert.ok(rates[2]<1,`${type}: unfavorable positions remain punishable`);
  if(previous){
    assert.equal(rates[0],report.smashDefense.baseline.normal.totals[type].returnRate,'casual inherits previous standard defense');
    assert.equal(rates[1],report.smashDefense.baseline.hard.totals[type].returnRate,'standard inherits previous expert defense');
  }
}
for (const level of Object.keys(core.AI_LEVELS)) for (const style of Object.keys(core.AI_STYLES)) {
  const key = `${level}/${style}`;
  const result = { pursuit: pursuitProbe(core, level, style), rally: rallyProbe(core, level, style) };
  report.current[key] = result;
  assert.ok(result.rally.netMinimum >= core.NET_HEIGHT, `${key} legal actual returns clear net`);
  assert.equal(result.rally.computerPoints + result.rally.playerPoints + result.rally.capped, result.rally.points);
  if (previous) report.baseline[key] = { pursuit: pursuitProbe(previous, level, style), rally: rallyProbe(previous, level, style) };
}
for (const style of Object.keys(core.AI_STYLES)) {
  const easy = report.current[`easy/${style}`], normal = report.current[`normal/${style}`], hard = report.current[`hard/${style}`];
  assert.ok(normal.pursuit.returned - easy.pursuit.returned >= 25);
  assert.ok(hard.pursuit.returned > normal.pursuit.returned,'expert extends standard pursuit near the basic probe ceiling');
  // The scripted player sees the exact target and contacts high balls near the
  // ideal timing. Long capped rallies measure AI resilience, not human wins.
  assert.ok(hard.rally.playerPoints <= normal.rally.playerPoints, `${style} expert retains resilience when standard already reaches the rally cap`);
  assert.ok(normal.rally.returns > easy.rally.returns + 40, `${style} leisure/standard multi-shot separation`);
  if (previous) assert.ok(hard.pursuit.returned > report.baseline[`hard/${style}`].pursuit.returned, `${style} stronger expert pursuit`);
}
const shotRate = (style, types) => {
  const rally = report.current[`hard/${style}`].rally;
  return types.reduce((sum, type) => sum + (rally.shots[type] || 0), 0) / rally.returns;
};
assert.ok(shotRate('attack', ['smash', 'jumpSmash', 'attack', 'drive']) > shotRate('balanced', ['smash', 'jumpSmash', 'attack', 'drive']) + .07, 'attacker maintains aggressive identity under actual pursuit');
assert.ok(shotRate('defense', ['clear', 'lift']) > .75 && shotRate('defense', ['clear', 'lift']) > shotRate('balanced', ['clear', 'lift']) + .4, 'defender maintains deep cover');
assert.ok(report.current['hard/rally'].rally.alternationRate > report.current['hard/balanced'].rally.alternationRate + .1 && report.current['hard/rally'].rally.front > report.current['hard/defense'].rally.front * 3, 'rally style maintains more depth changes and front-court pressure than the other styles');
await mkdir(join(root, 'artifacts'), { recursive: true });
await writeFile(join(root, 'artifacts', 'ai-balance-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.table(Object.entries(report.current).map(([configuration, { pursuit, rally }]) => ({ configuration, returned: `${pursuit.returned}/${pursuit.tested}`, aiMisses: rally.playerPoints, cappedRallies: rally.capped, jumps: rally.jumps, jumpSmashes: rally.jumpSmashes, alternation: rally.alternationRate.toFixed(2), flight: rally.meanFlight.toFixed(2), shots: JSON.stringify(rally.shots) })));
console.log('AI pursuit and multi-shot rally checks passed; artifacts/ai-balance-checks.json');
