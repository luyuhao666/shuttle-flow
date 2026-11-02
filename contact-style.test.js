import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { createPlayer, createOpponent, AI_STYLES, CONTACT, assessHit, assessJumpPreparation, createTrainingSession, makeTrainingDelivery, incomingPosition, contactTimingError, planReturn, canSmash, makeMatchDelivery, chooseMatchShot, shouldOpponentJump, opponentIntercept, opponentContactAge, opponentCanHit, returnPosition, RULES } = globalThis.ShuttleCore;

test('diagonal high feeds can be returned from either side of the landing while the shuttle is in reach', () => {
  for (const incomingType of ['clear', 'lift', undefined]) for (const x of [.2, .8]) {
    const ball = { phase: 'incoming', incomingType, from: { x: .5, y: -.7 },
      target: { x, y: .65 }, duration: 2, age: 1.91 };
    for (const side of [-1, 1]) {
      const actor = { ...createPlayer(), x: x + side * .13 };
      const result = assessHit(actor, ball);
      assert.ok(result.grade, `${incomingType}/${x}/${side} admits both forehand and backhand`);
      assert.deepEqual(result.point, incomingPosition(ball), 'actual contact remains the live shuttle');
      const shot = planReturn(actor, result.point, 'clear', 2, .5, result.time, ball);
      assert.equal(shot.fault, null);
    }
  }
});

test('independent overhead side reach still rejects excessive horizontal, depth, height and late contacts', () => {
  const ball = { phase: 'incoming', incomingType: 'clear', from: { x: .5, y: -.7 },
    target: { x: .5, y: .65 }, duration: 2, age: 1.91 };
  const point = incomingPosition(ball);
  for (const sign of [-1, 1]) {
    assert.ok(assessHit({ ...createPlayer(), x: point.x + sign * (RULES.radius - .001) }, ball).grade);
    assert.equal(assessHit({ ...createPlayer(), x: point.x + sign * (RULES.radius + .001) }, ball).reason, 'far');
    assert.equal(assessHit({ ...createPlayer(), x: point.x, y: point.y + CONTACT.overheadForward + sign * (CONTACT.overheadDepth + .001) }, ball).reason, 'far');
  }
  assert.equal(assessHit(createPlayer(), { ...ball, age: 2.14 }).reason, 'late');
  assert.equal(assessHit(createPlayer(), { ...ball, age: 1.8, flightArc: 400 }).reason, 'high');
});

test('a high ball near its time window cannot be hit just by standing at its future landing', () => {
  for (const incomingType of ['clear', 'lift', undefined]) {
    const ball = { phase: 'incoming', incomingType, from: { x: .5, y: -.8 }, fromHeight: 25, target: { x: .5, y: .88 }, flightArc: 400, duration: 2, age: 1.76 };
    const player = { ...createPlayer(), y: .88, height: 55, verticalVelocity: 0 };
    assert.equal(assessHit(player, ball).reason, 'far');
    const point = incomingPosition(ball); player.y = point.y;
    const contact = assessHit(player, ball);
    assert.equal(contact.grade, 'perfect'); assert.deepEqual(contact.point, point);
    assert.ok(canSmash(player, point));
    const shot = planReturn(player, point, 'smash', 2, .5, contactTimingError(player, ball), ball);
    assert.equal(shot.fault, null); assert.equal(shot.type, 'smash');
  }
});

test('high contact checks live lateral distance, court crossing, reach height and jump height', () => {
  const ball = { phase: 'incoming', incomingType: 'clear', from: { x: .2, y: -.8 }, target: { x: .8, y: .88 }, fromHeight: 25, flightArc: 215, duration: 1.1, age: .91 };
  const point = incomingPosition(ball), player = { ...createPlayer(), x: point.x, y: point.y };
  assert.ok(point.z > CONTACT.overheadHeight);
  assert.equal(assessHit(player, ball).reason, 'high');
  player.height = 55;
  assert.ok(assessHit(player, ball).grade, 'jump brings the actual high shuttle within reach');
  assert.equal(assessHit({ ...player, x: point.x + RULES.radius + .01 }, ball).reason, 'far');
  assert.equal(assessHit({ ...player, height: 15 }, ball).reason, 'high');
  assert.equal(assessHit(player, { ...ball, age: .2 }).reason, 'before-net');
});

test('overhead reach permits a small forward racket reach but rejects excessive stretch and behind-body contacts', () => {
  const ball = { phase: 'incoming', from: { x: .5, y: -.7 }, target: { x: .5, y: .65 }, duration: 2, age: 1.97 };
  const point = incomingPosition(ball), player = { ...createPlayer(), x: point.x, y: point.y + .18 };
  assert.ok(assessHit(player, ball).grade);
  assert.equal(assessHit({ ...player, y: point.y + .22 }, ball).reason, 'far');
  assert.equal(assessHit({ ...player, y: point.y - .18 }, ball).reason, 'far');
  assert.equal(assessHit(player, { ...ball, age: 2.14 }).reason, 'late');
});

test('computer high-ball contact also requires the current shuttle rather than a cached interception point', () => {
  const ball = { phase: 'return', shotType: 'clear', age: 0, returnFrom: { x: .5, y: .65 }, returnTarget: { x: .5, y: -.9 }, returnHeight: 95, returnEndHeight: 0, returnDuration: 1.2, returnArc: 215 };
  const actor = { ...createOpponent(), ...opponentIntercept(ball), height: 58 };
  ball.age = opponentContactAge(ball); assert.equal(opponentCanHit(actor, ball), true);
  ball.age = 1.19;
  assert.equal(opponentCanHit(actor, ball), false, 'the shuttle has travelled beyond the old intercept position');
  const live = returnPosition(ball); Object.assign(actor, { x: live.x, y: live.y });
  assert.equal(opponentCanHit(actor, ball), true);
  assert.ok(opponentIntercept(ball, actor).y < opponentIntercept(ball).y, 'AI pursuit follows the moving high ball');
});

test('jump preparation predicts the apex and swing delay at every training speed', () => {
  for (const speed of ['slow', 'normal', 'fast']) {
    const ball = makeTrainingDelivery(createTrainingSession('jump', speed));ball.age=ball.duration-.56;
    const actor = { ...createPlayer(), y: .72 }, before = { ...actor };
    assert.equal(assessJumpPreparation(actor, ball).smash,true,`${speed} keeps a usable jump lead`);
    assert.deepEqual(actor,before,'preview does not mutate the athlete');
    assert.equal(assessJumpPreparation({ ...actor, x: .1 },ball).reason,'far');
    const { JUMP, SWING } = globalThis.ShuttleCore;
    const point=incomingPosition({ ...ball, age: ball.age + JUMP.velocity / JUMP.gravity + SWING.impact });
    assert.ok(point.y < ball.target.y, 'apex contact is before the landing');
    const cue=assessJumpPreparation({ ...actor, y: point.y },ball);
    assert.equal(cue.smash,true,'a player beside the future contact can get a cue away from landing');
  }
});

test('style is separate from difficulty and invalid styles fall back to balanced', () => {
  const actors = Object.keys(AI_STYLES).map(style => createOpponent('normal', style));
  for (const actor of actors) assert.equal(actor.skill, actors[0].skill);
  assert.equal(createOpponent('missing', 'missing').style, 'balanced');
  assert.equal(createOpponent('missing', 'missing').level, 'normal');
});

test('styles produce distinct shot distributions at the same level and settled contact', () => {
  const player = { x: .5, y: .65 }, contact = { x: .5, y: -.65, z: 95 };
  const count = style => {
    const actor = createOpponent('normal', style), stats = { smash: 0, attack: 0, clear: 0, drop: 0 };
    for (let i = 0; i < 1000; i++) { let calls = 0; const shot = chooseMatchShot(player, actor, contact, 'clear', () => calls++ ? .5 : (i + .5) / 1000); stats[shot.type]++; }
    return stats;
  };
  const balanced = count('balanced'), attack = count('attack'), defense = count('defense'), rally = count('rally');
  assert.ok(attack.smash + attack.attack > balanced.smash + balanced.attack + 100);
  assert.ok(defense.clear > balanced.clear + 200);
  assert.ok(rally.drop > balanced.drop + 150);
  const actor = createOpponent('normal', 'rally');
  assert.equal(chooseMatchShot({ x: .5, y: .3 }, actor, { ...contact, z: 30 }, 'clear', () => .85).type, 'clear');
  assert.equal(chooseMatchShot(player, actor, { ...contact, z: 30 }, 'clear', () => .85).type, 'drop');
});

test('defenders lift low attacks, attackers counter-drive, and all styles respect pressure', () => {
  const player = { x: .5, y: .7 }, contact = { x: .5, y: -.65, z: 65 };
  const defensive = createOpponent('normal', 'defense'), attacking = createOpponent('normal', 'attack');
  assert.equal(chooseMatchShot(player, defensive, contact, 'smash', () => .2).type, 'lift');
  assert.equal(chooseMatchShot(player, attacking, contact, 'smash', () => .2).type, 'drive');
  for (const style of Object.keys(AI_STYLES)) {
    const actor = createOpponent('hard', style); Object.assign(actor, { pivot: 1, pressure: 1, vx: .9 });
    assert.equal(chooseMatchShot(player, actor, { ...contact, z: 95 }, 'clear', () => 0).type, 'lift');
  }
});

test('jump commitment varies with style while the physical conditions remain required', () => {
  const ball = { phase: 'return', shotType: 'clear', age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x: .5, y: -.8 }, returnHeight: 95, returnEndHeight: 0, returnDuration: 1.3, returnArc: 215 };
  const point = opponentIntercept(ball), attack = { ...createOpponent('normal', 'attack'), ...point }, defense = { ...createOpponent('normal', 'defense'), ...point };
  assert.equal(shouldOpponentJump(attack, ball, () => .15), true);
  assert.equal(shouldOpponentJump(defense, ball, () => .15), false);
  attack.pivot = 1; assert.equal(shouldOpponentJump(attack, ball, () => 0), false);
});

test('all style deliveries stay reachable, start continuously at contact, and clear the net', () => {
  for (const style of Object.keys(AI_STYLES)) for (const level of ['easy', 'normal', 'hard']) for (const y of [.2, .65, .9]) for (const roll of [.01, .2, .4, .7, .95]) {
    const actor = createOpponent(level, style), player = { x: .2, y }, contact = { x: .5, y: -.65, z: 95 };
    const ball = makeMatchDelivery(player, actor, 12, contact, () => roll);
    assert.deepEqual(incomingPosition(ball), contact);
    const margin = { easy: .28, normal: .16, hard: .14 }[level];
    assert.ok(ball.duration >= Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed + margin);
    ball.age = ball.duration * -contact.y / (ball.target.y - contact.y);
    assert.ok(incomingPosition(ball).z >= 52, `${style}/${level}/${ball.incomingType} clears net`);
    assert.ok(ball.target.x >= .075 && ball.target.x <= .925 && ball.target.y > 0 && ball.target.y <= 1);
  }
});
