import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const core = globalThis.ShuttleCore;
const highBall = () => ({ phase: 'return', shotType: 'clear', age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x: .5, y: -.8 }, returnHeight: 95, returnEndHeight: 0, returnDuration: 1.3, returnArc: 215 });

test('expert high-point interception still requires live proximity, height and readiness', () => {
  const ball = highBall(), actor = core.createOpponent('hard');
  ball.age = core.opponentContactAge(ball, actor);
  assert.ok(ball.age < core.opponentContactAge(ball));
  Object.assign(actor, core.returnPosition(ball));
  assert.equal(core.opponentCanHit(actor, ball), true);
  assert.equal(core.opponentCanHit({ ...actor, x: actor.x + .14 }, ball), false);
  assert.equal(core.opponentCanHit({ ...actor, reaction: .001 }, ball), false);
  assert.equal(core.opponentCanHit({ ...actor, strokeRecovery: .001 }, ball), false);
  ball.age -= .04; Object.assign(actor, core.returnPosition(ball));
  assert.equal(core.opponentCanHit(actor, ball), false, 'no reaching above ground height without jumping');
});

test('AI waits for readiness within the takeoff window instead of discarding its jump', () => {
  const ball = highBall(), actor = core.createOpponent('hard', 'attack');
  const contactAge = core.opponentContactAge(ball, actor, true), contact = core.returnPosition(ball, contactAge);
  Object.assign(actor, { x: contact.x, y: contact.y, reaction: .025 });
  ball.age = contactAge - .33;
  assert.equal(core.advanceOpponentReturn(actor, ball, .01, () => 0).jumped, false);
  assert.equal(ball.opponentJumpDecided, undefined);
  ball.age += .02;
  assert.equal(core.advanceOpponentReturn(actor, ball, .02, () => 0).jumped, true);
  assert.equal(ball.opponentJumpDecided, true);
});

test('production AI loop converts a reachable high ball to an actual jump smash at common frame rates', () => {
  for (const rate of [60, 120, 240]) {
    const ball = highBall(), actor = core.createOpponent('hard', 'attack');
    actor.intent = 'chase'; actor.reaction = actor.skill.reaction;
    let jumped = false, result = null;
    for (let frame = 1; frame / rate <= ball.returnDuration; frame++) {
      ball.age = frame / rate; core.updateJump(actor, 1 / rate);
      const action = core.advanceOpponentReturn(actor, ball, 1 / rate, () => 0);
      jumped ||= action.jumped;
      if (action.hit) {
        const contact = core.returnPosition(ball);
        assert.ok(contact.z <= core.CONTACT.overheadHeight + actor.height);
        assert.ok(Math.hypot(actor.x - contact.x, actor.y - contact.y) <= actor.skill.radius);
        result = core.makeMatchDelivery({ x: .5, y: .65 }, actor, 2, contact, () => 0, 'clear'); break;
      }
    }
    assert.equal(jumped, true, `${rate} fps starts a jump`);
    assert.equal(result?.incomingType, 'jumpSmash', `${rate} fps actually completes it`);
  }
});

test('styles recover to visibly different court depths using real footwork', () => {
  const ball = { incomingType: 'clear', target: { x: .5, y: .85 } }, actors = {};
  for (const style of Object.keys(core.AI_STYLES)) {
    actors[style] = core.createOpponent('normal', style);
    for (let frame = 0; frame < 240; frame++) core.recoverOpponent(actors[style], ball, 1 / 120);
    assert.ok(Math.abs(actors[style].y - core.opponentBase(ball, actors[style]).y) < .01);
  }
  assert.ok(actors.attack.y - actors.defense.y > .14);
  assert.ok(actors.attack.y > actors.balanced.y && actors.defense.y < actors.balanced.y);
});

test('rally style keeps alternating deep and short shots even when player returns to center', () => {
  const actor = core.createOpponent('hard', 'rally'), player = { x: .5, y: .5 }, contact = { x: .5, y: -.65, z: 95 };
  let last = null;
  for (let i = 0; i < 12; i++) {
    const ball = core.makeMatchDelivery(player, actor, i + 1, contact, () => .5);
    const deep = core.isHighShot(ball.incomingType);
    if (last !== null) assert.notEqual(deep, last);
    assert.ok(deep ? ball.target.y > .85 : ball.target.y < .26);
    last = deep;
  }
});

test('expert shots apply tighter playable pressure while leisure leaves generous recovery time', () => {
  const player = { x: .12, y: .9 }, contact = { x: .5, y: -.65, z: 100 };
  const easy = core.makeMatchDelivery(player, core.createOpponent('easy', 'attack'), 30, contact, () => 0);
  const hard = core.makeMatchDelivery(player, core.createOpponent('hard', 'attack'), 30, contact, () => 0);
  const slack = ball => ball.duration - Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / core.RULES.speed;
  assert.ok(slack(easy) >= .28 - 1e-9 && slack(hard) >= .14 - 1e-9);
  assert.ok(slack(hard) < .20 && slack(easy) > slack(hard) + .10);
});
