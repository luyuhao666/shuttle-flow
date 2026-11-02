import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { createMatch, awardPoint, createOpponent, moveOpponent, opponentContactAge, opponentIntercept, shouldOpponentJump, opponentCanHit, chooseMatchShot, makeMatchDelivery, incomingPosition, returnPosition, startJump, updateJump, canSmash, RULES, serviceSetup, inServiceCourt, constrainToServiceCourt, serviceTarget, makeServiceDelivery } = globalThis.ShuttleCore;

test('service side uses the server score, and far-player right is screen left', () => {
  for (const server of ['player', 'computer']) for (const score of [0, 1, 2, 7, 14, 20]) {
    const match = { server, player: server === 'player' ? score : score + 1, computer: server === 'computer' ? score : score + 1 };
    const setup = serviceSetup(match); assert.equal(setup.right, score % 2 === 0);
    assert.equal(setup.playerCourt.minX, setup.right ? .5 : .075);
    assert.equal(setup.computerCourt.minX, setup.right ? .075 : .5);
    assert.ok(setup.playerCourt.minY > 0); assert.equal(setup.playerCourt.maxY, 1);
    assert.equal(setup.computerCourt.minY, -1); assert.ok(setup.computerCourt.maxY < 0);
    assert.notEqual(setup.serverCourt.minX, setup.receiverCourt.minX);
  }
});

test('serve targets stay diagonal, between the short line and singles back boundary', () => {
  for (const server of ['player', 'computer']) for (const score of [0, 1, 2, 3]) {
    const match = { server, player: score, computer: score }, setup = serviceSetup(match);
    for (const aim of [-100, 0, .22, .5, .78, 1, 100]) for (const depth of [-100, 0, .29, .88, 1, 100]) {
      const target = serviceTarget(match, aim, depth);
      assert.ok(inServiceCourt(target, setup.receiverCourt)); assert.ok(!inServiceCourt(target, setup.serverCourt));
    }
    const line = { x: setup.receiverCourt.minX, y: setup.receiverCourt.minY };
    assert.ok(inServiceCourt(line, setup.receiverCourt)); assert.ok(!inServiceCourt(line, setup.receiverCourt, true));
  }
});

test('service movement keeps feet inside the box with clearance from all lines', () => {
  const court = serviceSetup(createMatch()).playerCourt;
  for (const x of [-5, .5, .8, 5]) for (const y of [-5, .29, .7, 5]) {
    const player = { x, y }; constrainToServiceCourt(player, court);
    assert.ok(inServiceCourt(player, court, true));
    assert.ok(player.x > court.minX && player.x < court.maxX && player.y > court.minY && player.y < court.maxY);
  }
});

test('computer service starts at the server and always lands inside the correct receiver court', () => {
  for (const score of [0, 1, 2, 3]) for (const randomValue of [0, .5, 1]) {
    const match = { server: 'computer', computer: score, player: 9 }, setup = serviceSetup(match);
    const player = { x: (setup.playerCourt.minX + setup.playerCourt.maxX) / 2, y: .58 };
    const opponent = { x: (setup.computerCourt.minX + setup.computerCourt.maxX) / 2, y: -.58 };
    const ball = makeServiceDelivery(match, player, opponent, () => randomValue);
    assert.ok(inServiceCourt(ball.target, setup.receiverCourt)); assert.deepEqual(incomingPosition(ball), { ...opponent, z: 50 });
    assert.ok(Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed < ball.duration - .5);
  }
});

test('7/15/21 point matches finish exactly at the selected target and reject extra points', () => {
  for (const target of [7, 15, 21]) for (const side of ['player', 'computer']) {
    const match = createMatch(target);
    for (let i = 1; i <= target; i++) { assert.equal(awardPoint(match, side), true); assert.equal(match[side], i); assert.equal(match.server, side); assert.equal(match.winner, i === target ? side : null); }
    assert.equal(awardPoint(match, side), false); assert.equal(match[side], target);
  }
  assert.throws(() => createMatch(11), RangeError);
});

test('close games require a two-point lead until their 11/21/30 point caps', () => {
  for (const [target, cap] of [[7, 11], [15, 21], [21, 30]]) {
    const match = createMatch(target);
    assert.equal(match.cap, cap);
    for (let i = 0; i < target - 1; i++) { awardPoint(match, 'player'); awardPoint(match, 'computer'); }
    assert.equal(match.winner, null);
    awardPoint(match, 'player'); assert.equal(match.winner, null, `${target}-${target - 1} must continue`);
    awardPoint(match, 'computer'); assert.equal(match.winner, null);
    awardPoint(match, 'player'); awardPoint(match, 'player');
    assert.equal(match.winner, 'player'); assert.equal(match.player - match.computer, 2);
    const capped = createMatch(target);
    for (let i = 0; i < cap - 1; i++) { awardPoint(capped, 'player'); awardPoint(capped, 'computer'); }
    awardPoint(capped, 'computer');
    assert.equal(capped.winner, 'computer'); assert.equal(capped.computer, cap);
    assert.equal(capped.computer - capped.player, 1);
    assert.equal(awardPoint(capped, 'player'), false);
  }
});

test('rally winners alternate service and each point advances only its own score', () => {
  const match = createMatch(7); assert.equal(match.server, 'computer');
  awardPoint(match, 'player'); awardPoint(match, 'computer'); awardPoint(match, 'player');
  assert.equal(match.player, 2); assert.equal(match.computer, 1); assert.equal(match.server, 'player');
});

test('opponent observes reaction time and cannot teleport to a remote target', () => {
  const opponent = createOpponent(), target = { x: .78, y: -.65 }; opponent.reaction = .16;
  moveOpponent(opponent, target, .1); assert.equal(opponent.x, .5);
  moveOpponent(opponent, target, .1); assert.ok(opponent.x > .5 && opponent.x < .54);
  const ball = { phase: 'return', age: .32, returnDuration: .32, returnTarget: target, shotType: 'smash' };
  assert.equal(opponentCanHit(opponent, ball), false);
  moveOpponent(opponent, target, 1); assert.equal(opponentCanHit(opponent, ball), true);
  ball.age = .33; assert.equal(opponentCanHit(opponent, ball), false, 'No returning a smash after it hits the floor');
});

test('computer also brakes and plants before reversing direction', () => {
  const opponent = createOpponent();
  for (let i = 0; i < 20; i++) moveOpponent(opponent, { x: .9, y: -.65 }, .01);
  assert.ok(opponent.vx > 0);
  const atTurn = opponent.x;
  for (let i = 0; i < 5; i++) moveOpponent(opponent, { x: .1, y: -.65 }, .01);
  assert.ok(opponent.x > atTurn); assert.ok(opponent.pivot > 0); assert.equal(opponent.plantX, -1);
});

test('AI delivery starts at its contact point and gives a reachable incoming target', () => {
  const player = { x: .5, y: .65 }, opponent = createOpponent(), contact = { x: .75, y: -.65, z: 55 };
  for (const rally of [0, 5, 20, 100]) {
    const ball = makeMatchDelivery(player, opponent, rally, contact, () => .9);
    assert.deepEqual(incomingPosition(ball), contact);
    assert.ok(Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed < ball.duration);
  }
});

test('computer intercepts a high clear before it lands and sees enough height to attack', () => {
  const ball = { phase: 'return', age: 0, returnFrom: { x: .3, y: .6 }, returnTarget: { x: .8, y: -.8 }, returnHeight: 95, returnEndHeight: 0, returnDuration: 1.3, returnArc: 215, shotType: 'clear' };
  const opponent = { ...createOpponent(), height: 55 };
  const contactAge = opponentContactAge(ball, opponent, true), point = returnPosition(ball, contactAge);
  Object.assign(opponent, point, { height: 55 });
  assert.ok(contactAge < ball.returnDuration - .1);
  ball.age = contactAge - .001; assert.equal(opponentCanHit(opponent, ball), false);
  ball.age = contactAge; assert.equal(opponentCanHit(opponent, ball), true);
  assert.ok(returnPosition(ball).z >= 70);
});
test('computer can meet a low return in flight while the shuttle is actually beside it', () => {
  const ball = { phase: 'return', age: 0, returnFrom: { x: .45, y: .6 }, returnTarget: { x: .7, y: -.5 }, returnHeight: 65, returnEndHeight: 0, returnDuration: .7, returnArc: 35, shotType: 'drop' };
  const first = opponentContactAge(ball);
  assert.ok(first < ball.returnDuration - .08);
  ball.age = first;
  const point = returnPosition(ball), opponent = { ...createOpponent(), x: point.x, y: point.y };
  assert.equal(opponentCanHit(opponent, ball), true);
  assert.equal(opponentCanHit({ ...opponent, y: ball.returnTarget.y }, ball), false);
  ball.age = first - .02;
  assert.equal(opponentCanHit(opponent, ball), false);
});
test('computer pursues a moving drop and returns it before the landing point', () => {
  const ball = { phase: 'return', age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x: .5, y: -.5 }, returnHeight: 65, returnEndHeight: 0, returnDuration: .7, returnArc: 35, shotType: 'drop' };
  const opponent = createOpponent(); opponent.reaction = opponent.skill.reaction;
  let hitAge = null;
  for (let frame = 0; frame <= 70; frame++) {
    ball.age = frame * .01;
    moveOpponent(opponent, opponentIntercept(ball, opponent), .01);
    if (opponentCanHit(opponent, ball)) { hitAge = ball.age; break; }
  }
  assert.ok(hitAge !== null && hitAge < ball.returnDuration - .1);
});

test('computer clear, drop, attack, smash, and jump smash have distinct readable trajectories and reachable targets', () => {
  const opponent = createOpponent(), contact = { x: .7, y: -.7, z: 90 };
  const cases = [
    { player: { x: .5, y: .65 }, received: 'clear', roll: .45, type: 'attack' },
    { player: { x: .5, y: .65 }, received: 'clear', roll: 0, type: 'smash' },
    { player: { x: .5, y: .8 }, received: 'drop', roll: .5, type: 'drop' },
    { player: { x: .5, y: .25 }, received: 'drop', roll: .5, type: 'clear' }
  ];
  const arcs = [];
  for (const { player, received, roll, type } of cases) {
    assert.equal(chooseMatchShot(player, opponent, contact, received, () => roll).type, type);
    const ball = makeMatchDelivery(player, opponent, 4, contact, () => roll, received);
    assert.equal(ball.incomingType, type); assert.deepEqual(incomingPosition(ball), contact);
    assert.ok(Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed + .16 <= ball.duration);
    assert.ok(ball.target.x >= .075 && ball.target.x <= .925 && ball.target.y > 0 && ball.target.y < 1);
    const crossing = -ball.from.y / (ball.target.y - ball.from.y);
    ball.age = ball.duration * crossing;
    assert.ok(incomingPosition(ball).z > 52, `${type} must clear the net`);
    arcs.push(ball.flightArc);
  }
  assert.ok(arcs[1] < arcs[0] && arcs[0] < arcs[2] && arcs[2] < arcs[3]);
  const jumper = { ...createOpponent(), height: 55, verticalVelocity: 0 };
  const jump = makeMatchDelivery({ x: .5, y: .65 }, jumper, 4, { ...contact, z: 155 }, () => .9, 'clear');
  assert.equal(jump.incomingType, 'jumpSmash'); assert.ok(jump.flightArc < arcs[1]);
});

test('difficulty changes movement, shot threat, and chance to commit to a visible jump smash', () => {
  const easy = createOpponent('easy'), normal = createOpponent('normal'), hard = createOpponent('hard');
  for (const actor of [easy, normal, hard]) moveOpponent(actor, { x: .85, y: -.65 }, .2);
  assert.ok(easy.x < normal.x && normal.x < hard.x);
  assert.ok(easy.skill.reaction > normal.skill.reaction && normal.skill.reaction > hard.skill.reaction);
  const player = { x: .5, y: .65 }, contact = { x: .75, y: -.7, z: 90 };
  // Compare difficulty at the same settled contact, independently of the preceding chase.
  for (const actor of [easy, normal, hard]) Object.assign(actor, { x: contact.x, y: contact.y, vx: 0, vy: 0, pivot: 0 });
  assert.equal(chooseMatchShot(player, easy, contact, 'clear', () => .4).type, 'drop');
  assert.equal(chooseMatchShot(player, normal, contact, 'clear', () => .4).type, 'attack');
  assert.equal(chooseMatchShot(player, hard, contact, 'clear', () => .4).type, 'smash');
  const ball = { phase: 'return', age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x: .5, y: -.8 }, returnHeight: 95, returnEndHeight: 0, returnDuration: 1.3, returnArc: 215, shotType: 'clear' };
  const point = opponentIntercept(ball);
  Object.assign(easy, point, { pivot: 0 }); Object.assign(hard, point, { pivot: 0 });
  assert.equal(shouldOpponentJump(easy, ball, () => .2), false);
  assert.equal(shouldOpponentJump(hard, ball, () => .2), true);
  assert.equal(startJump(hard), true); updateJump(hard, .31);
  ball.age = opponentContactAge(ball);
  assert.ok(canSmash(hard, returnPosition(ball)));
  assert.equal(chooseMatchShot(player, hard, returnPosition(ball), 'clear', () => .9).type, 'jumpSmash');
});

test('computer smashes descend from contact and still cross above the net', () => {
  const opponent = createOpponent(), player = { x: .5, y: .65 };
  for (const [type, height, actor] of [['smash', 100, opponent], ['jumpSmash', 155, { ...opponent, height: 55, verticalVelocity: 0 }]]) {
    for (const fromY of [-.6, -.85, -.94]) for (const roll of [0, 1]) {
      const values = [0, .5, .5, roll];
      const ball = makeMatchDelivery(player, actor, 4, { x: .5, y: fromY, z: height }, () => values.shift() ?? roll, 'clear');
      assert.equal(ball.incomingType, type);
      let previous = height;
      for (let i = 1; i <= 100; i++) {
        ball.age = ball.duration * i / 100;
        const next = incomingPosition(ball).z;
        assert.ok(next < previous, `${type} must descend at every step`);
        previous = next;
      }
      ball.age = ball.duration * -fromY / (ball.target.y - fromY);
      assert.ok(incomingPosition(ball).z >= 52, `${type} must clear the net`);
    }
  }
});

test('long rallies become slightly faster without making a chosen target unreachable', () => {
  const player = { x: .5, y: .58 }, opponent = createOpponent(), contact = { x: .5, y: -.6, z: 30 };
  const early = makeMatchDelivery(player, opponent, 1, contact, () => .8, 'drop');
  const late = makeMatchDelivery(player, opponent, 30, contact, () => .8, 'drop');
  assert.deepEqual(late.target, early.target);
  assert.equal(late.incomingType, early.incomingType);
  assert.ok(late.duration < early.duration);
  assert.ok(late.duration > Math.hypot(player.x - late.target.x, player.y - late.target.y) / RULES.speed + .3);
});

test('computer can block, lift and counter-drive a low attack without manufacturing a smash', () => {
  const opponent = createOpponent(), contact = { x: .5, y: -.65, z: 65 };
  const cases = [
    { player: { x: .5, y: .8 }, roll: .4, type: 'block' },
    { player: { x: .5, y: .25 }, roll: .4, type: 'lift' },
    { player: { x: .5, y: .65 }, roll: .05, type: 'drive' }
  ];
  for (const receivedType of ['tap', 'smash', 'drive']) for (const { player, roll, type } of cases) {
    const ball = makeMatchDelivery(player, opponent, 2, contact, () => roll, receivedType);
    assert.equal(ball.incomingType, type); assert.deepEqual(incomingPosition(ball), contact);
    ball.age = ball.duration * -contact.y / (ball.target.y - contact.y);
    assert.ok(incomingPosition(ball).z >= 59.99);
    assert.ok(Math.hypot(player.x - ball.target.x, player.y - ball.target.y) / RULES.speed + .16 <= ball.duration);
  }
});

test('a lifted defense is treated as a high ball and can create the next overhead attack', () => {
  const ball = { phase: 'return', age: 0, returnFrom: { x: .5, y: .4 }, returnTarget: { x: .5, y: -.92 }, returnHeight: 55, returnEndHeight: 0, returnDuration: 1.68, returnArc: 265, shotType: 'lift' };
  ball.age = opponentContactAge(ball);
  const point = opponentIntercept(ball), contact = returnPosition(ball), opponent = { ...createOpponent(), ...point };
  assert.equal(opponentCanHit(opponent, ball), true, 'original later interception brings this lifted shuttle within ground reach');
  ball.returnArc=365;
  const higherContact=returnPosition(ball);
  assert.equal(opponentCanHit(opponent, ball), false, 'a higher lifted shuttle still exceeds standing reach');
  assert.ok(shouldOpponentJump(opponent, ball, () => 0));
  Object.assign(opponent, { height: 55, verticalVelocity: 0 });
  assert.ok(opponentCanHit(opponent, ball));
  assert.equal(chooseMatchShot({ x: .5, y: .6 }, opponent, higherContact, 'lift', () => 0).type, 'jumpSmash');
  const incoming = { phase: 'incoming', incomingType: 'lift', from: { x: .5, y: -.7 }, target: { x: .5, y: .65 }, fromHeight: 25, flightArc: 245, duration: 2, age: 1.2 };
  const livePoint = incomingPosition(incoming);
  assert.equal(globalThis.ShuttleCore.judgeHit({ x: livePoint.x, y: livePoint.y, height: 250 }, incoming), null, 'Lift reception uses the high-ball landing window and still requires target proximity');
});

test('computer intercepts new flat and blocked returns using live height and distance', () => {
  for (const shotType of ['block', 'drive']) {
    const ball = { phase: 'return', age: 0, returnFrom: { x: .5, y: .5 }, returnTarget: { x: .5, y: -.5 }, returnHeight: 65, returnEndHeight: 0, returnDuration: .7, returnArc: 30, shotType };
    ball.age = opponentContactAge(ball) + .03;
    const point = returnPosition(ball), opponent = { ...createOpponent(), x: point.x, y: point.y };
    assert.ok(ball.age < ball.returnDuration - .2);
    assert.ok(opponentCanHit(opponent, ball));
    assert.equal(opponentCanHit({ ...opponent, x: .9 }, ball), false);
    assert.equal(opponentCanHit(opponent, { ...ball, age: .71 }), false);
  }
});
