import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
import { smashDefenseProbe } from './scripts/lib/ai-simulation.mjs';

for (const rate of [60, 120, 240]) {
  test(`three AI tiers remain separated against actual player attacks at ${rate} fps`, () => {
    const results = ['easy', 'normal', 'hard'].map(level => smashDefenseProbe(ShuttleCore, level, 'balanced', rate));
    for (const type of ['tap', 'smash']) {
      const tiers = results.map(result => result.totals[type]);
      assert.ok(tiers.every(result => result.tested === tiers[0].tested), 'all levels face identical legal player shots');
      assert.ok(tiers[1].returnRate > tiers[0].returnRate + .20, `${type}: shifted standard holds rallies better than casual`);
      assert.ok(tiers[2].returnRate > tiers[1].returnRate + .05, `${type}: expert adds real defense without changing reach`);
      assert.ok(tiers[2].returned < tiers[2].tested, 'even expert misses good attacks from unfavorable positions');
    }
    for (const [index, result] of results.entries()) {
      assert.ok(result.maximumReach <= [ .115, .13, .13 ][index], 'AI contacts stay inside the live racket reach');
      assert.ok(result.netMinimum >= ShuttleCore.NET_HEIGHT, 'defensive replies actually clear the net');
    }
  });
}
