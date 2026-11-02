import { gameFixture } from './scripts/lib/game-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
import './target-challenge.js';
import './appearance.js';
import './guidance.js';
const targets = globalThis.ShuttleTargets, core = globalThis.ShuttleCore;

test('challenge cycles all six zones or alternates the selected depth, including after misses', () => {
  for (const kind of Object.keys(targets.kinds)) {
    const session = targets.createSession(kind, 0), seen = new Set();
    for (let i = 0; i < 24; i++) {
      const zone = targets.targetFor(session); seen.add(zone.id);
      if (kind !== 'mixed') assert.equal(zone.depth, kind);
      targets.recordOutcome(session, zone, {});
    }
    assert.equal(seen.size, kind === 'mixed' ? 6 : 2);
    assert.equal(session.completed, 24); assert.equal(session.errors.miss, 24);
  }
  for (const kind of ['unknown', '__proto__', null]) assert.throws(() => targets.createSession(kind));
  assert.throws(() => targets.createSession('mixed', 10));
});

test('landing edges count, center earns a bonus, and faults override target overlap', () => {
  const zone = targets.zones['deep-left'];
  const center = { x: zone.x, y: zone.y };
  assert.equal(targets.judgeLanding(zone, { point: center }).points, 150);
  assert.equal(targets.judgeLanding(zone, { point: { x: zone.minX, y: zone.maxY } }).points, 100);
  assert.equal(targets.judgeLanding(zone, { point: { x: zone.minX - .001, y: zone.y } }).error, 'target');
  assert.equal(targets.judgeLanding(zone, { point: center, fault: { type: 'net' } }).error, 'net');
  assert.equal(targets.judgeLanding(zone, { point: { x: -.1, y: zone.y } }).error, 'out');
  assert.equal(targets.judgeLanding(zone, { point: { x: .5, y: .1 } }).error, 'net');
  assert.equal(targets.judgeLanding(zone, { point: { x: NaN, y: -.5 } }).error, 'miss');
});

test('twenty-ball limits, streak breaks, and independent sessions keep accurate totals', () => {
  const session = targets.createSession();
  for (let i = 0; i < 20; i++) {
    const zone = targets.targetFor(session);
    targets.recordOutcome(session, zone, i === 3 ? {} : { point: zone });
  }
  assert.equal(session.hits, 19); assert.equal(session.centers, 19);
  assert.equal(session.score, 2850); assert.equal(session.bestStreak, 16);
  assert.equal(Object.values(session.byZone).reduce((n, z) => n + z.attempts, 0), 20);
  assert.equal(targets.recordOutcome(session, targets.targetFor(session), {}), null);
  assert.equal(session.completed, 20);
  assert.equal(targets.createSession().score, 0);
});

test('challenge feeds retain the original reachable warm-up flight and do not accelerate', () => {
  const session = targets.createSession('mixed', 0), player = core.createPlayer();
  const first = targets.makeFeed(player, session, () => .7);
  for (let i = 0; i < 100; i++) targets.recordOutcome(session, targets.targetFor(session), {});
  const later = targets.makeFeed(player, session, () => .7), original = core.makeDelivery(player, 0, () => .7);
  assert.deepEqual(first.target, original.target); assert.deepEqual(later.target, original.target);
  assert.equal(later.duration, first.duration); assert.equal(later.duration, original.duration);
  assert.deepEqual(later.from, original.from);
});

test('each target can be hit with existing legal shot profiles across all warm-up feed depths', () => {
  for (const zone of Object.values(targets.zones)) for (const y of [.16, .32, .5, .65, .86]) {
    const player = { ...core.createPlayer(), x: .5, y }, ball = core.makeDelivery(player, 0, () => .5);
    let found = false;
    for (const requested of ['clear', 'drop', 'smash']) for (const power of [1, 2, 3]) for (const timing of [-.08, 0, .08, .12]) {
      ball.age = ball.duration + timing;
      const contact = core.incomingPosition(ball);
      assert.ok(core.assessHit(player, ball).grade);
      const shot = core.planReturn(player, contact, requested, power, zone.x, timing, ball);
      const flight = { returnFrom: contact, returnTarget: shot.target, returnHeight: contact.z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
      const actual = core.returnPosition(flight, shot.duration);
      if (targets.judgeLanding(zone, { point: actual, fault: shot.fault }).success) found = true;
    }
    assert.ok(found, `${zone.id} reachable at feed depth ${y}`);
  }
});

test('real practice buttons offer parallel modes, goal and length selection without altering matches or drills', () => {
  const ui = gameFixture();
  ui.click('[data-practice="target"]');
  assert.equal(ui.byId.get('feed-overview').classList.contains('hidden'), true);
  assert.equal(ui.byId.get('target-options').classList.contains('hidden'), false);
  ui.click('[data-target-kind="net"]'); ui.click('[data-target-limit="0"]'); ui.byId.get('start').onclick();
  assert.equal(ui.api.snapshot().challenge.kind, 'net'); assert.equal(ui.api.snapshot().challenge.limit, 0);
  ui.api.leave(); ui.click('[data-practice="feed"]'); ui.byId.get('start').onclick();
  assert.equal(ui.api.snapshot().challenge, null);
  ui.step(1.05); ui.api.prepareStroke('clear', 3, .5); ui.step(.06);
  assert.ok(ui.api.snapshot().score >= 100, 'ordinary feed still awards original hit points');
  ui.api.finish(); assert.ok(Number(ui.storage.get('shuttle-club-best')) >= 100, 'ordinary personal best still saves');
  ui.api.leave(); ui.api.chooseMode('match'); ui.byId.get('start').onclick(); assert.equal(ui.api.snapshot().challenge, null);
  ui.api.leave(); ui.api.chooseMode('drill'); ui.byId.get('start').onclick(); assert.equal(ui.api.snapshot().challenge, null);
});

test('actual swing scores only when the shuttle lands, once per ball, and pause freezes progress', () => {
  const ui = gameFixture(); ui.click('[data-practice="target"]'); ui.byId.get('start').onclick(); ui.step(1.05);
  ui.api.prepareStroke('drop', 1); ui.step(.06);
  assert.equal(ui.api.snapshot().delivery.phase, 'return'); assert.equal(ui.api.snapshot().challenge.completed, 0);
  const duration = ui.api.snapshot().delivery.returnDuration;
  ui.api.togglePause(); ui.step(3); assert.equal(ui.api.snapshot().challenge.completed, 0);
  ui.api.togglePause(); ui.step(duration + .05);
  const session = ui.api.snapshot().challenge;
  assert.equal(session.completed, 1); assert.equal(session.hits, 1); assert.ok(session.score >= 100);
  assert.equal(ui.api.snapshot().score, 0, 'ordinary practice score remains separate');
  ui.step(.3); assert.equal(session.completed, 1);
  assert.equal(ui.byId.get('feedback').dataset.kind, 'notice', 'landing feedback survives compact guidance');
  assert.equal(ui.byId.get('feedback').classList.contains('visible'), true);
  ui.api.drawChallengeZone();
});

test('miss, net, out and legal off-target each count once in the actual update loop', () => {
  const ui = gameFixture(); ui.click('[data-practice="target"]'); ui.byId.get('start').onclick(); ui.step(1.05);
  ui.step(3.2); assert.equal(ui.api.snapshot().challenge.errors.miss, 1);
  ui.step(1); ui.api.forceNet(); ui.step(.2); assert.equal(ui.api.snapshot().challenge.errors.net, 1);
  ui.step(1.5); ui.api.prepareStroke('clear', 3, -.1); ui.step(2); assert.equal(ui.api.snapshot().challenge.errors.out, 1);
  ui.step(1.3); ui.api.prepareStroke('clear', 2, .5); ui.step(2); assert.equal(ui.api.snapshot().challenge.errors.target, 1);
  assert.equal(ui.api.snapshot().challenge.completed, 4); assert.equal(ui.api.snapshot().challenge.score, 0);
});

test('twenty expired feeds finish automatically; restart resets and unlimited sessions continue', () => {
  const ui = gameFixture(); ui.click('[data-practice="target"]'); ui.byId.get('start').onclick(); ui.step(120);
  assert.equal(ui.api.snapshot().state, 'over'); assert.equal(ui.api.snapshot().challenge.completed, 20);
  assert.match(ui.byId.get('result-details').textContent, /Hit rate 0%/);
  assert.equal(ui.storage.has('shuttle-club-best'), false);
  ui.byId.get('restart').onclick(); assert.equal(ui.api.snapshot().challenge.completed, 0);
  ui.api.leave(); ui.click('[data-target-limit="0"]'); ui.byId.get('start').onclick(); ui.step(120);
  assert.equal(ui.api.snapshot().state, 'playing'); assert.ok(ui.api.snapshot().challenge.completed > 20);
  ui.api.finish(); assert.equal(ui.api.snapshot().state, 'over');
});
