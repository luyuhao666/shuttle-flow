import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { createPlayer, createTrainingSession, makeTrainingDelivery, startJump, updateJump, SWING, CONTACT, assessHit, planReturn } = globalThis.ShuttleCore;

function attempt(speed, feedIndex, pressDelay, jumpLead = .56) {
  const ball = makeTrainingDelivery({ ...createTrainingSession('jump', speed), feedIndex });
  const actor = { ...createPlayer(), ...ball.target };
  startJump(actor);
  updateJump(actor, pressDelay + SWING.impact);
  ball.age = ball.duration - jumpLead + pressDelay + SWING.impact;
  const result = assessHit(actor, ball);
  const shot = result.grade && planReturn(actor, result.point, 'smash', 2, .5, result.time, ball);
  return { legal: Boolean(shot && shot.type === 'smash' && !shot.fault), actor, result };
}

for (const speed of ['slow', 'normal', 'fast']) for (const feed of [0, 1, 2]) {
  test(`jump training ${speed}/feed ${feed} supports a continuous manual input window`, () => {
    const legal = [];
    for (let ms = 100; ms <= 550; ms++) {
      const outcome = attempt(speed, feed, ms / 1000);
      if (!outcome.legal) continue;
      legal.push(ms);
      const height = outcome.result.point.z - outcome.actor.height;
      assert.ok(outcome.result.point.z >= 75 && height <= CONTACT.overheadHeight, 'every success respects original absolute-height minimum and actual maximum reach');
    }
    assert.ok(legal.length >= 115, `${speed}/${feed}: only ${legal.length} ms available with original attack rules`);
    assert.equal(legal.length, legal.at(-1) - legal[0] + 1, 'window is continuous');
    for (const reaction of [.06, .10]) {
      assert.ok(attempt(speed, feed, legal[0] / 1000 + reaction).legal, `${reaction}s after the first gold cue still succeeds`);
    }
    assert.equal(attempt(speed, feed, .50).legal, false, 'a late descending swing still fails');
  });
  test(`jump training ${speed}/feed ${feed} tolerates variation in jump timing`, () => {
    for (const jumpLead of [.52, .56, .60]) {
      const legal = [];
      for (let ms = 100; ms <= 550; ms++) if (attempt(speed, feed, ms / 1000, jumpLead).legal) legal.push(ms);
      assert.ok(legal.length >= 85, `jump lead ${jumpLead}: only ${legal.length} ms available`);
      assert.ok(attempt(speed, feed, legal[0] / 1000 + .08, jumpLead).legal);
    }
  });
}
