import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { RULES, JUMP, SERVICE, createPlayer, startJump, updateJump, contactTime, contactTimingError, canSmash, aimHorizontal, defaultPowerFor, shotFor, planReturn, incomingPosition, returnPosition, returnFault, movePlayer, makeDelivery, assessHit, judgeHit, pointsFor, difficulty } = globalThis.ShuttleCore;

test('diagonal movement has the same speed as axial movement and stays in bounds', () => {
  const axial = { x: .4, y: .4 }, diagonal = { ...axial };
  movePlayer(axial, 1, 0, .2); movePlayer(diagonal, 1, 1, .2);
  assert.ok(Math.abs(Math.hypot(diagonal.x - .4, diagonal.y - .4) - (axial.x - .4)) < 1e-10);
  movePlayer(axial, 1, -1, 20); assert.equal(axial.x, .93); assert.equal(axial.y, .08);
});

test('a quick reversal braces the feet before movement changes direction', () => {
  const runner = createPlayer();
  for (let i = 0; i < 30; i++) movePlayer(runner, -1, 0, .01);
  assert.ok(runner.vx < -.7);
  const atTurn = runner.x;
  for (let i = 0; i < 8; i++) movePlayer(runner, 1, 0, .01);
  assert.ok(runner.x < atTurn, 'Momentum briefly continues in the old direction');
  assert.ok(runner.vx < 0); assert.ok(runner.pivot > .9); assert.equal(runner.plantX, 1);
  for (let i = 0; i < 40; i++) movePlayer(runner, 1, 0, .01);
  assert.ok(runner.vx > .6); assert.equal(runner.pivot, 0);
});

test('letting go brakes smoothly, then returns to a stable stance', () => {
  const player = createPlayer();
  for (let i = 0; i < 25; i++) movePlayer(player, 0, -1, .01);
  const releaseY = player.y;
  movePlayer(player, 0, 0, .01);
  assert.ok(player.y < releaseY && player.vy < 0);
  for (let i = 0; i < 25; i++) movePlayer(player, 0, 0, .01);
  assert.equal(player.vx, 0); assert.equal(player.vy, 0);
  const standingY = player.y; movePlayer(player, 0, 0, .25); assert.equal(player.y, standingY);
});

test('feeds remain reachable when accelerating from rest rather than moving at full speed immediately', () => {
  let seed = 219; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const returns of [0, 8, 30]) for (let i = 0; i < 100; i++) {
    const player = { ...createPlayer(), x: .07 + random() * .86, y: .08 + random() * .86 };
    const ball = makeDelivery(player, returns, random);
    for (let age = 0; age < ball.duration; age += .01) movePlayer(player, ball.target.x - player.x, ball.target.y - player.y, Math.min(.01, ball.duration - age));
    ball.age = ball.duration;
    assert.ok(judgeHit(player, ball), `Feed ${returns}/${i} should remain reachable`);
  }
});
test('hit grading requires both position and timing and rejects returned balls', () => {
  const player = { x: .5, y: .5 }, ball = { target: { ...player }, age: 2, duration: 2, phase: 'incoming' };
  assert.equal(judgeHit(player, ball), 'perfect');
  assert.equal(judgeHit(player, { ...ball, age: 1.85 }), 'good');
  assert.equal(judgeHit(player, { ...ball, age: 1.6 }), null);
  assert.equal(judgeHit(player, { ...ball, age: 2.2 }), null);
  assert.equal(judgeHit({ x: .9, y: .9 }, ball), null);
  assert.equal(judgeHit(player, { ...ball, phase: 'return' }), null);
});
test('low incoming shots can be intercepted along their path before the landing point', () => {
  const ball = { phase: 'incoming', incomingType: 'smash', from: { x: .72, y: -.65 }, fromHeight: 90, target: { x: .28, y: .5 }, flightArc: 16, duration: 1.2, age: .94 };
  const point = incomingPosition(ball), player = { ...createPlayer(), x: point.x, y: point.y };
  assert.ok(ball.age < ball.duration - RULES.early, 'Contact is genuinely earlier than the landing window');
  assert.equal(judgeHit(player, ball), 'perfect');
  assert.equal(contactTimingError(player, ball), 0, 'Early interception does not accidentally shorten the return');
  assert.equal(judgeHit({ ...player, x: ball.target.x, y: ball.target.y }, ball), null, 'Standing only at the landing point does not catch an airborne shuttle');
  assert.equal(judgeHit(player, { ...ball, incomingType: 'clear' }), null, 'High clears retain their landing-time rhythm');
  assert.equal(judgeHit({ ...player, x: point.x + .2 }, ball), null);
  ball.age = .66;
  const high = incomingPosition(ball);
  assert.equal(judgeHit({ ...player, x: high.x, y: high.y }, ball), null, 'Cannot hit while shuttle is still across the net');
});
test('jump extends the early interception height for a dropping shuttle', () => {
  const ball = { phase: 'incoming', incomingType: 'drop', from: { x: .5, y: -.65 }, fromHeight: 90, target: { x: .5, y: .5 }, flightArc: 108, duration: 1.4, age: .98 };
  const point = incomingPosition(ball), ground = { ...createPlayer(), x: point.x, y: point.y };
  assert.ok(point.y > .075 && point.z > 110);
  assert.equal(judgeHit(ground, ball), null);
  assert.equal(judgeHit({ ...ground, height: 55 }, ball), 'perfect');
});

test('hit feedback distinguishes height, court crossing, distance and timing failures', () => {
  const player = createPlayer();
  const clear = { phase: 'incoming', target: { x: player.x, y: player.y }, duration: 2, age: 2 };
  assert.equal(assessHit(player, null).reason, 'no-ball');
  assert.equal(assessHit(player, { ...clear, phase: 'return' }).reason, 'no-ball');
  assert.equal(assessHit(player, { ...clear, age: 1 }).reason, 'early');
  assert.equal(assessHit(player, { ...clear, age: 2.14 }).reason, 'late');
  assert.equal(assessHit({ ...player, x: .9 }, clear).reason, 'far');
  const drop = { phase: 'incoming', incomingType: 'drop', from: { x: .5, y: -.65 }, fromHeight: 90, target: { x: .5, y: .5 }, flightArc: 108, duration: 1.4, age: .98 };
  const point = incomingPosition(drop), receiver = { ...player, x: point.x, y: point.y };
  assert.equal(assessHit(receiver, drop).reason, 'high');
  assert.equal(assessHit({ ...receiver, height: 55 }, drop).grade, 'perfect');
  assert.equal(assessHit(receiver, { ...drop, age: .3 }).reason, 'before-net');
  assert.equal(assessHit({ ...player, x: .5, y: .5 }, { ...drop, age: 1.54 }).reason, 'late');
});

test('feeds remain reachable across levels and edge positions', () => {
  let seed = 17; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const returns of [0, 3, 8, 30, 1000]) for (let i = 0; i < 400; i++) {
    const player = { x: random() * .86 + .07, y: random() * .86 + .08 };
    const ball = makeDelivery(player, returns, random);
    assert.ok(ball.target.x >= .12 && ball.target.x <= .88);
    assert.ok(ball.target.y >= .16 && ball.target.y <= .86);
    assert.ok(Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed < ball.duration - .5);
  }
  assert.ok(difficulty(20).flight < difficulty(0).flight);
  assert.ok(difficulty(1000).flight >= 1.05);
});
test('perfects score more and combo bonuses are bounded', () => {
  assert.equal(pointsFor('perfect', 1), 150); assert.equal(pointsFor('good', 1), 100);
  assert.equal(pointsFor('perfect', 5), 160); assert.equal(pointsFor('perfect', 1000), 250);
});

test('jump follows a ballistic arc, rejects double jumps, and recovers after landing', () => {
  const player = createPlayer();
  assert.equal(startJump(player), true); assert.equal(startJump(player), false);
  const apex = JUMP.velocity / JUMP.gravity;
  assert.equal(updateJump(player, apex), false);
  assert.ok(Math.abs(player.height - JUMP.velocity ** 2 / (2 * JUMP.gravity)) < 1e-8);
  assert.equal(startJump(player), false);
  assert.equal(updateJump(player, apex + .001), true);
  assert.equal(player.height, 0); assert.equal(player.verticalVelocity, 0);
  assert.equal(startJump(player), false);
  updateJump(player, JUMP.recovery + .001); assert.equal(startJump(player), true);
});

test('jump trajectory is stable across frame sizes and leaves court movement independent', () => {
  const largeStep = createPlayer(), smallSteps = createPlayer(); startJump(largeStep); startJump(smallSteps);
  updateJump(largeStep, .3); for (let i = 0; i < 30; i++) updateJump(smallSteps, .01);
  assert.ok(Math.abs(largeStep.height - smallSteps.height) < 1e-8);
  movePlayer(smallSteps, 1, 0, .1); assert.ok(smallSteps.x > .5); assert.ok(smallSteps.height > 0);
});

test('airborne contact moves earlier, still requires proximity, and allows an explicitly selected clear', () => {
  const grounded = createPlayer(), airborne = { ...grounded, height: 58 };
  const ball = { target: { x: .5, y: .65 }, duration: 2, age: 1.58, phase: 'incoming' };
  assert.equal(judgeHit(grounded, ball), null); assert.equal(judgeHit(airborne, ball), 'good');
  ball.age = contactTime(airborne, ball); assert.equal(judgeHit(airborne, ball), 'perfect');
  assert.equal(judgeHit({ ...airborne, x: .9 }, ball), null);
  assert.equal(shotFor(grounded).type, 'clear'); assert.equal(shotFor(airborne).type, 'clear');
  assert.ok(shotFor(airborne).duration < shotFor(grounded).duration);
});

test('smash requires apex height, controlled vertical velocity, and a high incoming ball', () => {
  const peak = { ...createPlayer(), height: JUMP.velocity ** 2 / (2 * JUMP.gravity), verticalVelocity: 0 }, contact = { x: .5, y: .5, z: 160 };
  assert.equal(canSmash(peak, contact), true); assert.equal(shotFor(peak, contact, 'smash').type, 'smash');
  assert.equal(shotFor(peak, contact, 'smash').bonus, 50);
  for (const player of [createPlayer(), { ...peak, height: 30 }, { ...peak, verticalVelocity: 200 }, { ...peak, verticalVelocity: -200 }]) assert.equal(canSmash(player, contact), false);
  assert.equal(canSmash(peak, { ...contact, z: 74 }), false);
  assert.equal(shotFor(peak, { ...contact, z: 50 }, 'smash').type, 'clear');
  assert.equal(canSmash(peak, null), false);
});

test('original jump smash uses absolute shuttle height while actual contact retains maximum reach', () => {
  const height = JUMP.velocity ** 2 / (2 * JUMP.gravity);
  const player = { ...createPlayer(), height, verticalVelocity: 0 };
  for (const z of [0, 30, 74]) {
    assert.equal(shotFor(player, { x: .54, y: .625, z }, 'smash').type, 'clear');
  }
  for (const z of [75, 85, 100, 160]) {
    assert.equal(shotFor(player, { x: .54, y: .625, z }, 'smash').type, 'smash');
  }
  for (const z of [175, 185]) {
    const ball = { phase: 'incoming', incomingType: 'clear', from: { x: .5, y: -.7 }, target: { x: .5, y: .72 }, duration: 2, age: 1.8, fromHeight: 25, flightArc: (z - 25) / Math.sin(Math.PI * .9) };
    const point = incomingPosition(ball), actor = { ...player, y: point.y + .025 };
    assert.equal(Boolean(assessHit(actor, ball).grade), z === 175, 'actual hit still rejects a shuttle beyond airborne reach');
  }
});

test('original ground right-click allows a tap on low clears and defense retains its drive', () => {
  const player = createPlayer();
  for (const z of [25, 55, 74, 75, 89, 90, 100, 120]) {
    assert.equal(shotFor(player, { x: .54, y: .625, z }, 'smash').type, 'tap');
  }
  assert.equal(shotFor(player, { x: .54, y: .625, z: 55 }, 'smash', 2,
    { phase: 'incoming', incomingType: 'smash' }).type, 'drive');
});

test('smash stays descending, clears the net, and lands in the far half', () => {
  const peak = { ...createPlayer(), height: 58, verticalVelocity: 0 };
  for (const y of [.16, .45, .86]) for (const z of [150, 160, 175]) {
    const contact = { x: .5, y, z }, shot = shotFor(peak, contact, 'smash');
    const ball = { returnFrom: contact, returnTarget: { x: .7, y: shot.targetDepth }, returnHeight: z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
    assert.deepEqual(returnPosition(ball, 0), contact);
    const netAge = shot.duration * y / (y - shot.targetDepth);
    assert.ok(returnPosition(ball, netAge).z > 58, 'Smash must clear the 52 px net with a margin');
    let previous = z;
    for (let i = 1; i <= 100; i++) { const point = returnPosition(ball, shot.duration * i / 100); assert.ok(point.z < previous); previous = point.z; }
    const end = returnPosition(ball, shot.duration); assert.ok(end.y < 0); assert.ok(Math.abs(end.z) < 1e-8);
    assert.ok(shot.duration < shotFor(peak).duration);
  }
});

test('a valid smash uses the same contact point for the incoming and outgoing ball', () => {
  const player = { ...createPlayer(), height: 58, verticalVelocity: 0 };
  const ball = makeDelivery(player, 0, () => .5); ball.age = ball.duration - .406;
  const contact = incomingPosition(ball), shot = shotFor(player, contact, 'smash');
  player.y = contact.y;
  assert.ok(judgeHit(player, ball)); assert.equal(shot.type, 'smash');
  const returned = { returnFrom: contact, returnTarget: { x: .5, y: shot.targetDepth }, returnHeight: contact.z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
  assert.deepEqual(returnPosition(returned, 0), contact);
});


test('horizontal aiming varies smoothly and only extreme directions land outside singles sidelines', () => {
  assert.equal(aimHorizontal(-1), .03); assert.equal(aimHorizontal(.5), .5); assert.equal(aimHorizontal(2), .97);
  assert.ok(aimHorizontal(.3) < aimHorizontal(.31));
  const player = createPlayer(), contact = { x: .5, y: .65, z: 80 };
  for (const type of ['clear', 'drop', 'smash']) {
    const left = planReturn(player, contact, type, 2, aimHorizontal(.25));
    const right = planReturn(player, contact, type, 2, aimHorizontal(.75));
    assert.ok(left.target.x < right.target.x);
    assert.equal(left.target.y, right.target.y);
    assert.equal(left.fault, null); assert.equal(right.fault, null);
    assert.equal(planReturn(player, contact, type, 2, aimHorizontal(0)).fault?.type, 'out');
    assert.equal(planReturn(player, contact, type, 2, aimHorizontal(1)).fault?.type, 'out');
  }
});

test('shot choice remains explicit at the apex and failed smashes fall back to a clear', () => {
  const peak = { ...createPlayer(), height: 58, verticalVelocity: 0 }, contact = { x: .5, y: .65, z: 160 };
  assert.equal(shotFor(peak, contact).type, 'clear');
  assert.equal(shotFor(peak, contact, 'drop').type, 'drop');
  assert.equal(shotFor(peak, contact, 'smash').type, 'smash');
  const fallback = shotFor({ ...createPlayer(), height: 30, verticalVelocity: 200 }, contact, 'smash');
  assert.equal(fallback.type, 'clear'); assert.equal(fallback.fallback, true); assert.equal(fallback.bonus, 0);
});

test('clears and drops have distinct depths, clear the net from low contacts, and land on court', () => {
  for (const y of [.08, .45, .94]) for (const z of [25, 50, 100]) {
    const contact = { x: .5, y, z }, player = createPlayer();
    const clear = shotFor(player, contact, 'clear'), drop = shotFor(player, contact, 'drop');
    assert.ok(clear.targetDepth < -.8); assert.ok(drop.targetDepth > -.3 && drop.targetDepth < 0);
    assert.ok(clear.duration > drop.duration); assert.ok(clear.arc > drop.arc);
    for (const shot of [clear, drop]) {
      const ball = { returnFrom: contact, returnTarget: { x: .22, y: shot.targetDepth }, returnHeight: z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
      assert.deepEqual(returnPosition(ball, 0), contact);
      assert.ok(returnPosition(ball, shot.duration * y / (y - shot.targetDepth)).z >= 59.99);
      const end = returnPosition(ball, shot.duration); assert.ok(Math.abs(end.x - .22) < 1e-8); assert.ok(Math.abs(end.z) < 1e-8);
    }
  }
});


test('ground right click selects a tap with a short flight and no jump-smash bonus', () => {
  const player = createPlayer(), contact = { x: .5, y: .65, z: 100 };
  const tap = shotFor(player, contact, 'smash'), clear = shotFor(player, contact, 'clear');
  assert.equal(tap.type, 'tap'); assert.equal(tap.bonus, 0); assert.equal(tap.fallback, false);
  assert.ok(tap.duration > .32 && tap.duration < clear.duration);
  assert.ok(tap.targetDepth < -.3 && tap.targetDepth > -.8);
  assert.ok(tap.arc < clear.arc); assert.equal(tap.endHeight, 0);
  for (const airborne of [{ height: .1, verticalVelocity: 0 }, { height: 0, verticalVelocity: 360 }, { height: 30, verticalVelocity: -200 }]) {
    assert.equal(shotFor(airborne, contact, 'smash').type, 'clear', 'Airborne fallback must not become a ground tap');
  }
});

test('tap clears the net at low contacts and descends throughout at high contacts', () => {
  for (const y of [.08, .45, .94]) for (const z of [25, 50, 120]) {
    const contact = { x: .5, y, z }, shot = shotFor(createPlayer(), contact, 'smash');
    const ball = { returnFrom: contact, returnTarget: { x: .78, y: shot.targetDepth }, returnHeight: z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
    assert.deepEqual(returnPosition(ball, 0), contact);
    assert.ok(returnPosition(ball, shot.duration * y / (y - shot.targetDepth)).z >= 59.99);
    assert.ok(Math.abs(returnPosition(ball, shot.duration).z) < 1e-8);
    if (z === 120) {
      let previous = z;
      for (let i = 1; i <= 100; i++) { const next = returnPosition(ball, shot.duration * i / 100).z; assert.ok(next < previous); previous = next; }
    }
  }
});

test('three power tiers change clear and drop depth while each shot keeps its own default', () => {
  const player = createPlayer(), contact = { x: .5, y: .65, z: 65 };
  assert.equal(defaultPowerFor('clear'), 3); assert.equal(defaultPowerFor('drop'), 1); assert.equal(defaultPowerFor('smash'), 2);
  for (const type of ['clear', 'drop']) {
    const shots = [1, 2, 3].map(power => planReturn(player, contact, type, power, .5));
    assert.ok(shots[0].target.y > shots[1].target.y && shots[1].target.y > shots[2].target.y);
    assert.ok(shots.every(shot => !shot.fault));
  }
  assert.ok(planReturn(player, contact, 'clear', 1, .5).target.y > -.5, 'Weak clear lands in midcourt');
  assert.ok(planReturn(player, contact, 'clear', 3, .5).target.y < -.85, 'Strong clear reaches the rear court');
  assert.ok(planReturn(player, contact, 'drop', 1, .5).target.y > -.2, 'Soft drop stays near the net');
  assert.ok(planReturn(player, contact, 'drop', 3, .5).target.y < -.45, 'Long slice travels farther');
});

test('saved defaults can differ by shot, with one setting shared by both smash types', () => {
  const saved = { clear: 1, drop: 3, smash: 2 };
  assert.equal(defaultPowerFor('clear', saved), 1);
  assert.equal(defaultPowerFor('drop', saved), 3);
  assert.equal(defaultPowerFor('smash', saved), 2);
  assert.equal(defaultPowerFor('tap', saved), 2);
  assert.equal(defaultPowerFor('drop', { drop: 9 }), 1, 'Invalid saved values revert to the built-in default');
});

test('early or front-court heavy clears can go long, and an off-balance soft drop can hit the net', () => {
  const player = createPlayer();
  assert.equal(planReturn(player, { x: .5, y: .65, z: 65 }, 'clear', 3, .5, -.20).fault?.type, 'out');
  assert.equal(planReturn(player, { x: .5, y: .08, z: 65 }, 'clear', 3, .5, 0).fault?.type, 'out');
  const net = planReturn({ ...player, pivot: 1 }, { x: .5, y: .94, z: 25 }, 'drop', 1, .5, .08).fault;
  assert.equal(net?.type, 'net'); assert.ok(net.age > 0 && net.age < shotFor(player, null, 'drop', 1).duration);
  assert.equal(net.point.y, 0);
});

test('fault lines are inclusive and only shots clearing the net and landing inside count', () => {
  const ball = { returnFrom: { x: .5, y: .65 }, returnHeight: 65, returnEndHeight: 0, returnDuration: 1.3, returnArc: 215, returnTarget: { x: SERVICE.sideline, y: -1 } };
  assert.equal(returnFault(ball), null);
  assert.equal(returnFault({ ...ball, returnTarget: { x: SERVICE.sideline - .001, y: -.5 } })?.type, 'out');
  assert.equal(returnFault({ ...ball, returnTarget: { x: .5, y: -1.001 } })?.type, 'out');
  assert.equal(returnFault({ ...ball, returnArc: 10, returnTarget: { x: .5, y: -.2 } })?.type, 'net');
});

test('jump-smash power changes pace and an ordinary service stays valid', () => {
  const peak = { ...createPlayer(), height: 58, verticalVelocity: 0 }, contact = { x: .5, y: .65, z: 160 };
  const light = planReturn(peak, contact, 'smash', 1, .5), heavy = planReturn(peak, contact, 'smash', 3, .5);
  assert.equal(light.type, 'smash'); assert.equal(heavy.type, 'smash');
  assert.ok(light.duration > heavy.duration && light.target.y > heavy.target.y);
  assert.equal(light.fault, null); assert.equal(heavy.fault, null);
  const serve = shotFor({ height: 0 }, { x: .25, y: .58, z: 50 }, 'clear');
  assert.equal(returnFault({ returnFrom: { x: .25, y: .58 }, returnHeight: 50, returnEndHeight: 0, returnDuration: serve.duration, returnArc: serve.arc, returnTarget: { x: .75, y: -.88 } }), null);
});

test('defending fast balls gives the player distinct lift, block and low drive choices', () => {
  const player = createPlayer(), contact = { x: .5, y: .45, z: 65 };
  for (const incomingType of ['attack', 'smash', 'jumpSmash', 'drive']) {
    const incoming = { phase: 'incoming', incomingType };
    assert.equal(shotFor(player, contact, 'clear', 3, incoming).type, 'lift');
    assert.equal(shotFor(player, contact, 'drop', 1, incoming).type, 'block');
    assert.equal(shotFor(player, contact, 'smash', 2, incoming).type, 'drive');
    assert.equal(shotFor(player, { ...contact, z: 100 }, 'smash', 2, incoming).type, 'tap', 'High contact retains downward attack');
    const peak = { ...player, height: 58, verticalVelocity: 0 };
    assert.equal(shotFor(peak, { ...contact, z: 160 }, 'smash', 2, incoming).type, 'smash', 'A valid jump smash takes priority');
  }
  for (const incomingType of ['clear', 'lift']) {
    const incoming = { phase: 'incoming', incomingType };
    assert.equal(shotFor(player, contact, 'clear', 3, incoming).type, 'clear');
    assert.equal(shotFor(player, contact, 'drop', 1, incoming).type, 'drop');
    assert.equal(shotFor(player, contact, 'smash', 2, incoming).type, 'tap', 'Original ground right-click remains a tap on a low clear');
  }
  const service = { phase: 'serve', incomingType: 'smash' };
  assert.equal(shotFor(player, contact, 'clear', 3, service).type, 'clear');
  assert.equal(shotFor(player, contact, 'smash', 2, { phase: 'incoming', incomingType: 'drop' }).type, 'drive', 'Low midcourt balls support a flat counter');
});

test('new defensive returns start at contact, cross the net and have distinct depths and pace', () => {
  const player = createPlayer(), incoming = { phase: 'incoming', incomingType: 'smash' };
  for (const y of [.12, .45, .9]) for (const z of [25, 55, 85]) for (const power of [1, 2, 3]) {
    const contact = { x: .5, y, z };
    const lift = planReturn(player, contact, 'clear', power, .5, 0, incoming);
    const block = planReturn(player, contact, 'drop', power, .5, 0, incoming);
    const drive = planReturn(player, contact, 'smash', power, .5, 0, incoming);
    assert.ok(block.target.y > drive.target.y && drive.target.y > lift.target.y);
    assert.ok(lift.duration > block.duration && block.duration > drive.duration);
    assert.ok(lift.arc > drive.arc + 90);
    for (const shot of [lift, block, drive]) {
      assert.equal(shot.fault, null, `${shot.type} should be legal from ${y}/${z}/${power}`);
      assert.equal(shot.bonus, 0); assert.equal(shot.overhead, false);
      const ball = { returnFrom: contact, returnTarget: shot.target, returnHeight: z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: shot.arc };
      assert.deepEqual(returnPosition(ball, 0), contact);
      const net = returnPosition(ball, shot.duration * y / (y - shot.target.y));
      assert.ok(net.z >= 59.99, `${shot.type} should lift over the net`);
      assert.ok(Math.abs(returnPosition(ball, shot.duration).z) < 1e-8);
    }
  }
});

test('defensive power shares saved presets and changes depth without losing aim or fault checks', () => {
  const saved = { clear: 1, drop: 3, smash: 2 };
  assert.equal(defaultPowerFor('lift', saved), 1);
  assert.equal(defaultPowerFor('block', saved), 3);
  assert.equal(defaultPowerFor('drive', saved), 2);
  const player = createPlayer(), contact = { x: .5, y: .5, z: 55 }, incoming = { phase: 'incoming', incomingType: 'smash' };
  for (const requested of ['clear', 'drop', 'smash']) {
    const shots = [1, 2, 3].map(power => planReturn(player, contact, requested, power, .27, 0, incoming));
    assert.ok(shots[0].target.y > shots[1].target.y && shots[1].target.y > shots[2].target.y);
    assert.ok(shots.every(shot => shot.target.x === .27));
    assert.equal(planReturn(player, contact, requested, 2, .03, 0, incoming).fault?.type, 'out');
  }
  assert.equal(planReturn({ ...player, pivot: 1 }, { ...contact, y: .94, z: 25 }, 'drop', 1, .5, 0, incoming).fault?.type, 'net', 'Unbalanced deep-court blocks can still fail');
});
