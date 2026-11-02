import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { createPlayer, createTrainingSession, makeTrainingDelivery, incomingPosition, assessHit, planReturn, shotFor, SWING } = globalThis.ShuttleCore;

test('original ground right-click resolves taps and retains the stricter side backhand', () => {
  for (const side of [-.04, -.029, -.014, 0, .014, .04]) for (const height of [75, 80, 89, 90, 120]) {
    const ball = { phase: 'incoming', incomingType: 'clear', from: { x: .5, y: -.7 }, target: { x: .5, y: .72 }, fromHeight: 25, duration: 2, age: 1.8 + SWING.impact };
    ball.flightArc = (height - 25) / Math.sin(Math.PI * ball.age / ball.duration);
    const contact = incomingPosition(ball), player = { ...createPlayer(), x: contact.x - side, y: contact.y + .025 };
    const hit = assessHit(player, ball);
    assert.ok(hit.grade, `side ${side}, height ${height} remains reachable`);
    const shot = planReturn(player, contact, 'smash', 2, .5, hit.time, ball);
    assert.equal(shot.type, side === -.04 && height < 90 ? 'clear' : 'tap', `side ${side}, height ${height} follows original attack rules`);
    assert.equal(shot.fault, null);
    assert.equal(shot.backhand, side < 0);
    assert.equal(player.height, 0, 'ground attack needs no jump');
  }
});

test('original taps accept low clears while actual contact and low defense remain checked', () => {
  const player = createPlayer();
  for (const side of [-.029, -.014, 0, .04]) {
    for (const z of [50, 74]) assert.equal(shotFor(player, { x: player.x + side, y: player.y - .025, z }, 'smash').type, 'tap');
    for (const z of [55, 75, 80, 89]) assert.equal(shotFor(player, { x: player.x + side, y: player.y - .025, z }, 'smash', 2, { phase: 'incoming', incomingType: 'smash' }).type, 'drive');
  }
  assert.equal(shotFor({ ...player, pivot: .7 }, { x: .46, y: .625, z: 80 }, 'smash').type, 'clear', 'a wider backhand still requires balance');
  const high = { phase: 'incoming', incomingType: 'clear', from: { x: .5, y: -.7 }, target: { x: .5, y: .72 }, duration: 2, age: 1.9, fromHeight: 25, flightArc: 800 };
  assert.equal(assessHit(player, high).reason, 'high', 'removing a duplicate attack threshold does not admit unreachable hits');
});

test('jump training keeps continuous original travel without easing or a slow contact plateau', () => {
  for (const speed of ['slow', 'normal', 'fast']) for (const feedIndex of [0, 1, 2]) {
    const ball = makeTrainingDelivery({ ...createTrainingSession('jump', speed), feedIndex });
    const points = [.65, .75, .85, .95].map(t => incomingPosition({ ...ball, age: ball.duration * t }));
    const steps = points.slice(1).map((p, i) => ({ x: p.x - points[i].x, y: p.y - points[i].y, fall: points[i].z - p.z }));
    for (const step of steps) {
      assert.ok(Math.abs(step.x - steps[0].x) < 1e-12, 'horizontal speed stays constant');
      assert.ok(Math.abs(step.y - steps[0].y) < 1e-12, 'court-depth speed stays constant');
      assert.ok(step.fall > 0, 'shuttle is descending');
    }
    assert.ok(steps[1].fall > steps[0].fall && steps[2].fall > steps[1].fall, 'descent accelerates smoothly through contact rather than slowing there');
    const rising = incomingPosition({ ...ball, age: ball.duration * .2 });
    const falling = incomingPosition({ ...ball, age: ball.duration * .8 });
    assert.ok(Math.abs(rising.z - falling.z) < 1e-9, 'original symmetric arc is preserved');
  }
});
