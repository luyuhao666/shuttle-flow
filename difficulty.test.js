import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { RULES, createOpponent, moveOpponent, opponentIntercept, opponentCanHit, chooseMatchShot, makeMatchDelivery, incomingPosition, returnFault } = globalThis.ShuttleCore;

test('the same legal return set leaves leisure AI well below standard and expert in actual pursuit', () => {
  const results = [];
  for (const level of ['easy', 'normal', 'hard']) {
    let hits = 0;
    for (const x of [.12, .5, .88]) for (const y of [-.25, -.6, -.92]) for (const duration of [.45, .65, .85, 1.2, 1.6]) for (const type of ['clear', 'drop', 'drive']) {
      const actor = createOpponent(level); actor.reaction = actor.skill.reaction; actor.intent = 'chase';
      const ball = { phase: 'return', shotType: type, age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x, y }, returnHeight: 85, returnEndHeight: 0, returnArc: type === 'clear' ? 215 : type === 'drop' ? 60 : 35, returnDuration: duration };
      assert.equal(returnFault(ball), null, 'comparison only includes legal returns');
      for (let age = 0; age <= duration; age += 1 / 240) {
        ball.age = age; moveOpponent(actor, opponentIntercept(ball, actor), 1 / 240);
        if (opponentCanHit(actor, ball)) { hits++; break; }
      }
    }
    results.push(hits);
  }
  assert.ok(results[0] > 20, 'leisure still returns enough balls to play rallies');
  assert.ok(results[1] - results[0] >= 25, `leisure/standard separation: ${results}`);
  assert.ok(results[2] > results[1], `expert improves on the standard tier near this probe's ceiling: ${results}`);
});

test('attack and counter-drive frequencies stay separated even with the same playing style', () => {
  const player = { x: .5, y: .65 }, contact = { x: .5, y: -.65, z: 95 };
  for (const style of ['balanced', 'attack', 'defense', 'rally']) {
    const attacks = [], drives = [];
    for (const level of ['easy', 'normal', 'hard']) {
      const actor = createOpponent(level, style); let attack = 0, drive = 0;
      for (let i = 0; i < 1000; i++) {
        const roll = (i + .5) / 1000;
        if (['smash', 'attack', 'jumpSmash'].includes(chooseMatchShot(player, actor, contact, 'clear', () => roll).type)) attack++;
        if (chooseMatchShot(player, actor, { ...contact, z: 65 }, 'smash', () => roll).type === 'drive') drive++;
      }
      attacks.push(attack); drives.push(drive);
    }
    assert.ok(attacks[0] < attacks[1] && attacks[1] <= attacks[2], `${style} attack separation, allowing aggressive styles to saturate`);
    assert.ok(drives[0] < drives[1] && drives[1] < drives[2], `${style} counter-drive separation`);
  }
});

test('leisure deliveries stay slower and closer to center throughout long rallies without losing net clearance', () => {
  const player = { x: .5, y: .65 }, contact = { x: .5, y: -.65, z: 95 };
  for (const style of ['balanced', 'attack', 'defense', 'rally']) for (const rally of [1, 50]) {
    const balls = ['easy', 'normal', 'hard'].map(level => makeMatchDelivery(player, createOpponent(level, style), rally, contact, () => .95, 'drop'));
    assert.ok(balls[0].duration > balls[1].duration + .10);
    assert.ok(balls[1].duration > balls[2].duration);
    assert.ok(Math.abs(balls[0].target.x - .5) < Math.abs(balls[1].target.x - .5));
    assert.ok(Math.abs(balls[1].target.x - .5) <= Math.abs(balls[2].target.x - .5), 'expert placement may reach the same legal sideline');
    assert.equal(balls[0].target.y, balls[1].target.y, 'shifted casual retains full front/back placement at the same shot type');
    for (const [index, ball] of balls.entries()) {
      assert.deepEqual(incomingPosition(ball), contact);
      assert.ok(ball.duration >= Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed + [.28, .16, .14][index]);
      ball.age = ball.duration * -contact.y / (ball.target.y - contact.y);
      assert.ok(incomingPosition(ball).z >= 52);
    }
  }
});
