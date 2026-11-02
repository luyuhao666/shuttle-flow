import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { planService, serviceSetup, inServiceCourt, returnPosition, returnFault, NET_HEIGHT } = globalThis.ShuttleCore;

test('both player serves stay diagonal and clear the net from all legal service positions', () => {
  for (const score of [0, 1, 2, 3]) {
    const match = { player: score, computer: 0, server: 'player' }, setup = serviceSetup(match);
    for (const y of [.32, .58, .97]) for (const aim of [-10, .5, 10]) {
      const contact = { x: (setup.serverCourt.minX + setup.serverCourt.maxX) / 2, y, z: 50 };
      for (const requested of ['clear', 'smash']) {
        const shot = planService(match, contact, requested, aim);
        const ball = { returnFrom: contact, returnTarget: shot.target, returnHeight: contact.z, returnEndHeight: 0, returnDuration: shot.duration, returnArc: shot.arc };
        assert.ok(inServiceCourt(shot.target, setup.receiverCourt));
        assert.deepEqual(returnPosition(ball, 0), contact);
        const landing = returnPosition(ball, shot.duration);
        assert.ok(Math.hypot(landing.x - shot.target.x, landing.y - shot.target.y, landing.z) < 1e-10);
        assert.ok(returnPosition(ball, shot.duration * y / (y - shot.target.y)).z >= NET_HEIGHT + 5.99);
        assert.equal(returnFault(ball), null);
      }
    }
  }
});

test('right-button serve has a short low flight instead of a clear or an attack', () => {
  const match = { player: 1, computer: 0, server: 'player' }, contact = { x: .28, y: .58, z: 50 };
  const long = planService(match, contact, 'clear', .8), short = planService(match, contact, 'smash', .8);
  assert.equal(long.type, 'clear'); assert.equal(long.serviceKind, 'long');
  assert.equal(short.type, 'drop'); assert.equal(short.serviceKind, 'short');
  assert.equal(short.target.y, -.38); assert.equal(long.target.y, -.88);
  assert.ok(short.arc < long.arc / 3); assert.ok(short.duration < long.duration);
  assert.equal(short.power, 1); assert.equal(long.power, 3);
});
