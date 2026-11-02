import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { createOpponent, moveOpponent, recoverOpponent, opponentBase, opponentShotQuality, makeMatchDelivery, chooseMatchShot, createTrainingSession, makeTrainingDelivery, recordTrainingOutcome, trainingAdvice, TRAINING_ERRORS, movePlayer, incomingPosition, assessHit, startJump, updateJump, planReturn, RULES } = globalThis.ShuttleCore;

test('computer recovers towards a shot-dependent base with inertia and stroke recovery', () => {
  const actor = createOpponent(); Object.assign(actor, { x: .85, y: -.9, strokeRecovery: .2, pressure: .8 });
  const ball = { incomingType: 'block', target: { x: .3, y: .22 } }, base = opponentBase(ball);
  recoverOpponent(actor, ball, .1); assert.equal(actor.x, .85); assert.equal(actor.y, -.9);
  for (let i = 0; i < 180; i++) recoverOpponent(actor, ball, 1 / 120);
  assert.ok(Math.hypot(actor.x - base.x, actor.y - base.y) < .02);
  assert.equal(actor.pressure, 0);
  assert.ok(opponentBase({ incomingType: 'clear' }).y < base.y);
});

test('chasing corners and reversing balance lowers quality and forces a slower defensive return', () => {
  const stable = createOpponent(), stretched = createOpponent(), player = { x: .3, y: .65 };
  Object.assign(stretched, { x: .90, y: -.8, vx: .8, pivot: .8, pressure: .9, intent: 'chase' });
  assert.ok(opponentShotQuality(stretched, { x: .9, y: -.8 }) < .58);
  const weak = makeMatchDelivery(player, stretched, 4, { x: .9, y: -.8, z: 90 }, () => .05);
  assert.equal(weak.incomingType, 'lift');
  const strong = makeMatchDelivery(player, stable, 4, { x: .5, y: -.65, z: 90 }, () => .05);
  assert.equal(strong.incomingType, 'smash'); assert.ok(weak.duration > strong.duration);
  moveOpponent(stretched, { x: .3, y: -.3 }, .1); assert.ok(stretched.chaseDistance > 0);
});

test('a pressured clear is shorter, slower and less precise than a settled clear', () => {
  const player = { x: .3, y: .3 }, stable = createOpponent(), moving = createOpponent();
  moving.vx = .65; moving.pressure = .4;
  const strong = makeMatchDelivery(player, stable, 1, { x: .5, y: -.65, z: 95 }, () => .7, 'drop');
  const weak = makeMatchDelivery(player, moving, 1, { x: .5, y: -.65, z: 95 }, () => .7, 'drop');
  assert.equal(strong.incomingType, 'clear'); assert.equal(weak.incomingType, 'clear');
  const pace = ball => Math.hypot(ball.target.x - ball.from.x, ball.target.y - ball.from.y) / ball.duration;
  assert.ok(weak.target.y < strong.target.y && weak.target.x < strong.target.x && pace(weak) < pace(strong), 'a shorter pressured clear travels more slowly over its shorter route');
});

test('computer remembers observed front/back movement when continuing a tactical sequence', () => {
  const actor = createOpponent(), contact = { x: .5, y: -.65, z: 30 };
  assert.equal(chooseMatchShot({ x: .5, y: .3 }, actor, contact, 'clear', () => .8).type, 'drop');
  actor.lastShotType = 'drop'; actor.lastPlayerY = .7;
  assert.equal(chooseMatchShot({ x: .5, y: .3 }, actor, contact, 'clear', () => .8).type, 'clear');
  actor.lastShotType = 'clear'; actor.lastPlayerY = .3;
  assert.equal(chooseMatchShot({ x: .5, y: .7 }, actor, contact, 'clear', () => .8).type, 'drop');
});

test('fixed feeds repeat after a failure, advance on success and never accelerate with count', () => {
  for (const kind of ['jump', 'net', 'defense']) {
    const session = createTrainingSession(kind, 'fast', 0), first = makeTrainingDelivery(session);
    recordTrainingOutcome(session, { missReason: 'far' }); assert.deepEqual(makeTrainingDelivery(session), first);
    recordTrainingOutcome(session, { shotType: kind === 'jump' ? 'smash' : 'block', age: .8, duration: 1.2 });
    const next = makeTrainingDelivery(session); assert.notEqual(next.target.x, first.target.x); assert.equal(next.duration, first.duration);
    session.completed = 999; assert.equal(makeTrainingDelivery(session).duration, first.duration);
  }
});

test('every fixed feed is reachable from its reset position at all speeds', () => {
  for (const kind of ['jump', 'net', 'defense']) for (const speed of ['slow', 'normal', 'fast']) for (let i = 0; i < 3; i++) {
    const session = createTrainingSession(kind, speed); session.feedIndex = i;
    const ball = makeTrainingDelivery(session), player = { ...ball.start, vx: 0, vy: 0, pivot: 0, height: 0, verticalVelocity: 0, jumpRecovery: 0 };
    let met = false;
    for (let age = 0; age <= ball.duration + RULES.late; age += 1 / 240) {
      ball.age = age;
      // Approach a little left of a high ball to prepare a forehand smash.
      const point = kind === 'jump' ? { x: ball.from.x + (ball.target.x - ball.from.x) * .88 - .035, y: ball.target.y } : incomingPosition(ball);
      const distance = Math.hypot(point.x - player.x, point.y - player.y);
      movePlayer(player, distance > .025 ? point.x - player.x : 0, distance > .025 ? point.y - player.y : 0, 1 / 240);
      if (kind === 'jump' && ball.duration - age <= .56 && player.height === 0 && !player.jumpRecovery) startJump(player);
      updateJump(player, 1 / 240);
      if (assessHit(player, ball).grade) {
        const contact = incomingPosition(ball), shot = planReturn(player, contact, kind === 'jump' ? 'smash' : 'clear', kind === 'jump' ? 2 : 3, .5, 0, ball);
        if (!shot.fault && (kind !== 'jump' || shot.type === 'smash') && (kind !== 'net' || age <= ball.duration - .18)) { met = true; break; }
      }
    }
    assert.ok(met, `${kind}/${speed}/feed ${i} has a reachable goal window`);
    ball.age = ball.duration * -ball.from.y / (ball.target.y - ball.from.y);
    assert.ok(incomingPosition(ball).z >= 52, 'feed crosses above net');
  }
});

test('goal grading distinguishes jump choice, early interception and defensive choices', () => {
  const jump = createTrainingSession('jump');
  assert.equal(recordTrainingOutcome(jump, { shotType: 'tap' }).error, 'shot');
  assert.ok(recordTrainingOutcome(jump, { shotType: 'smash' }).success);
  const net = createTrainingSession('net');
  assert.equal(recordTrainingOutcome(net, { shotType: 'block', age: 1.4, duration: 1.55 }).error, 'timing');
  assert.ok(recordTrainingOutcome(net, { shotType: 'block', age: 1.3, duration: 1.55 }).success);
  for (const type of ['lift', 'block', 'drive']) assert.ok(recordTrainingOutcome(createTrainingSession('defense'), { shotType: type }).success);
  assert.equal(recordTrainingOutcome(createTrainingSession('defense'), { shotType: 'clear' }).error, 'shot');
});

test('one main cause per feed, bounded sessions, unlimited retries and no empty-result NaN', () => {
  const session = createTrainingSession();
  assert.match(trainingAdvice(session), /No completed feeds yet/);
  for (const outcome of [{ missReason: 'far' }, { missReason: 'high' }, { missReason: 'early' }, { shotType: 'clear' }, { shotType: 'smash', fault: { type: 'out' } }, { shotType: 'smash', fault: { type: 'net' } }]) recordTrainingOutcome(session, outcome);
  for (const key of Object.keys(TRAINING_ERRORS)) assert.equal(session.errors[key], 1);
  while (session.completed < 20) recordTrainingOutcome(session, { shotType: 'smash' });
  assert.equal(session.bestStreak, 14); assert.equal(session.legalReturns, 15);
  assert.equal(recordTrainingOutcome(session, { shotType: 'smash' }), null); assert.equal(session.completed, 20);
  const unlimited = createTrainingSession('defense', 'slow', 0);
  for (let i = 0; i < 100; i++) recordTrainingOutcome(unlimited, { missReason: 'late' });
  assert.equal(unlimited.completed, 100); assert.equal(unlimited.feedIndex, 0);
  assert.throws(() => createTrainingSession('missing'), RangeError);
});
