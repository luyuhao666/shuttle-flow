import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { BACKHAND, JUMP, SWING, createPlayer, isBackhand, canSmash, canPlayerSmash, canBackhandAttack, shotFor, planReturn, incomingPosition, assessHit, assessJumpPreparation, returnPosition } = globalThis.ShuttleCore;
const apex = JUMP.velocity ** 2 / (2 * JUMP.gravity);
const peak = () => ({ ...createPlayer(), height: apex, verticalVelocity: 0 });
const left = player => ({ x: player.x - .04, y: player.y - .025, z: player.height + 100 });

test('backhand follows the live left side and switches as the player moves past the shuttle', () => {
  const player = createPlayer();
  const ball = { phase: 'incoming', from: { x: .30, y: -.7 }, target: { x: .7, y: .65 }, duration: 2, age: .8 };
  const point = incomingPosition(ball);
  assert.ok(point.x < player.x && ball.target.x > player.x);
  assert.equal(isBackhand(player, point), true);
  assert.equal(shotFor(player, point).backhand, true);
  player.x = point.x - .01;
  assert.equal(shotFor(player, point).backhand, false);
  assert.equal(isBackhand(player, { x: player.x }), false);
  assert.equal(isBackhand(player, null), false);
});

test('ordinary backhands keep all shot profiles, power tiers, aiming and defensive mappings', () => {
  for (const incomingType of ['clear', 'drop', 'attack', 'smash', 'jumpSmash', 'drive']) {
    const player = createPlayer(), incoming = { phase: 'incoming', incomingType };
    for (const requested of ['clear', 'drop', ...(incomingType === 'clear' ? [] : ['smash'])]) for (const power of [1, 2, 3]) {
      const contact = { x: .46, y: .60, z: 55 };
      const back = planReturn(player, contact, requested, power, .7, 0, incoming);
      const fore = planReturn(player, { ...contact, x: .54 }, requested, power, .7, 0, incoming);
      assert.equal(back.backhand, true); assert.equal(fore.backhand, false);
      assert.deepEqual({ ...back, backhand: false }, fore);
      assert.equal(back.fault, null);
    }
  }
});

test('backhand jump smash has a narrow geometric, height, apex, movement and balance window', () => {
  const player = peak(), contact = left(player);
  assert.equal(canPlayerSmash(player, contact), true);
  const failures = [
    [{ ...player, height: apex * .94 }, contact],
    [{ ...player, verticalVelocity: 56 }, contact],
    [{ ...player, verticalVelocity: -56 }, contact],
    [{ ...player, vx: .21 }, contact],
    [{ ...player, vx: .15, vy: .15 }, contact],
    [{ ...player, pivot: .11 }, contact],
    [player, { ...contact, x: player.x - .076 }],
    [player, { ...contact, y: player.y - .091 }],
    [player, { ...contact, y: player.y + .011 }],
    [player, { ...contact, z: player.height + 49 }],
    [player, { ...contact, z: player.height + 106 }]
  ];
  for (const [actor, point] of failures) {
    assert.equal(canPlayerSmash(actor, point), false);
    const shot = shotFor(actor, point, 'smash');
    assert.equal(shot.type, 'clear'); assert.equal(shot.fallbackReason, 'backhand');
  }
  assert.equal(canPlayerSmash({ ...player, height: apex * .95, verticalVelocity: BACKHAND.verticalSpeed, vx: BACKHAND.speed, pivot: BACKHAND.pivot }, contact), true);
});

test('a near-centre overhead contact has no forbidden seam on the left side', () => {
  const player = { ...peak(), verticalVelocity: 100 };
  for (const side of [-.029, -.014, 0, .014]) {
    const point = { x: player.x + side, y: player.y - .025, z: player.height + 100 };
    assert.equal(canPlayerSmash(player, point), true);
    assert.equal(shotFor(player, point, 'smash').type, 'smash');
    assert.equal(canPlayerSmash(player, { ...point, z: 74 }), false, 'original absolute-height minimum still applies');
    assert.equal(canPlayerSmash(player, { ...point, z: 85 }), true, 'low relative height no longer cancels an otherwise valid overhead attack');
  }
  assert.equal(canPlayerSmash(player, left(player)), false, 'a wider backhand still requires the tighter apex window');
});

test('forehand attacks retain their existing apex window and ground tap behavior', () => {
  const player = { ...peak(), height: apex * .81, verticalVelocity: 140, vx: .4, pivot: .7 };
  const contact = { x: .54, y: .65, z: player.height + 100 };
  assert.equal(canSmash(player, contact), true);
  assert.equal(canPlayerSmash(player, contact), true);
  assert.equal(shotFor(player, contact, 'smash').type, 'smash');
  assert.equal(shotFor(createPlayer(), { ...contact, z: 50 }, 'smash').type, 'tap');
});

test('a real high ball permits a legal backhand smash only near its contact time', () => {
  const player = peak();
  const ball = { phase: 'incoming', incomingType: 'clear', from: { x: .46, y: -.7 }, target: { x: .46, y: .72 }, fromHeight: 25, flightArc: 360, duration: 2, age: 2 - apex / JUMP.contactSpeed };
  const point = incomingPosition(ball); player.y = point.y + .025;
  assert.ok(assessHit(player, ball).grade);
  const shot = planReturn(player, point, 'smash', 2, .6, 0, ball);
  assert.equal(shot.type, 'smash'); assert.equal(shot.backhand, true); assert.equal(shot.fault, null);
  const outgoing = { returnFrom: point, returnHeight: point.z, returnTarget: shot.target, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
  assert.deepEqual(returnPosition(outgoing, 0), point);
  let z = point.z;
  for (let i = 1; i <= 20; i++) { const next = returnPosition(outgoing, i / 20 * shot.duration); assert.ok(next.z < z); z = next.z; }
  for (const offset of [-.046, .046]) {
    const mistimed = { ...ball, age: ball.age + offset }, contact = incomingPosition(mistimed);
    assert.ok(assessHit(player, mistimed).grade, 'normal return remains reachable');
    assert.equal(shotFor(player, contact, 'smash', 2, mistimed).type, 'clear');
  }
});

test('ground backhand taps require a high stable front contact, while low balls still counter-drive', () => {
  const player = createPlayer(), contact = { x: .46, y: .625, z: 105 };
  assert.equal(canBackhandAttack(player, contact), true);
  assert.equal(shotFor(player, contact, 'smash').type, 'tap');
  for (const point of [{ ...contact, z: 74 }, { ...contact, z: 121 }, { ...contact, y: .68 }]) {
    assert.equal(shotFor(player, point, 'smash').type, 'clear');
  }
  assert.equal(shotFor({ ...player, pivot: .8 }, contact, 'smash').type, 'clear');
  const ball = { phase: 'incoming', incomingType: 'clear', duration: 2, age: 1.801, from: { x: .46, y: -.7 }, target: { x: .46, y: .72 }, flightArc: 215 };
  const point = incomingPosition(ball); player.y = point.y + .025;
  assert.ok(assessHit(player, ball).grade);
  assert.equal(shotFor(player, point, 'smash', 2, ball).type, 'tap', 'ordinary practice also offers a reachable ground window');
  assert.equal(shotFor(player, { ...contact, z: 55 }, 'smash', 2, { phase: 'incoming', incomingType: 'smash' }).type, 'drive');
});

test('jump preparation applies the same stricter backhand eligibility as the actual shot', () => {
  const player = createPlayer();
  const futureHeight = apex - .5 * JUMP.gravity * SWING.impact ** 2;
  const ball = { phase: 'incoming', incomingType: 'clear', from: { x: .46, y: -.7 }, target: { x: .46, y: .72 }, flightArc: 380, duration: 2, age: 2 - futureHeight / JUMP.contactSpeed - JUMP.velocity / JUMP.gravity - SWING.impact };
  const futurePoint = incomingPosition({ ...ball, age: ball.age + JUMP.velocity / JUMP.gravity + SWING.impact }); player.y = futurePoint.y + .025;
  assert.equal(assessJumpPreparation(player, ball).smash, true);
  assert.equal(assessJumpPreparation({ ...player, pivot: .7 }, ball).smash, false);
  assert.equal(assessJumpPreparation({ ...player, vx: .3 }, ball).smash, false);
});
