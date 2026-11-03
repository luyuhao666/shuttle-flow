import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
import './lan-core.js';
import './lan-client.js';
import { createLanServer } from './network/server.mjs';
const C = globalThis.ShuttleCore, L = globalThis.ShuttleLanCore;
function started(target = 7) {
  const s = L.createSession(target); L.setReady(s, 0, true); L.setReady(s, 1, true); return s;
}
const tick = (s, seconds) => { for (let t = 0; t < seconds; t += L.STEP) L.step(s, L.STEP); };
function stroke(s, side, requested = 'clear', extra = {}) {
  return L.action(s, side, { action: 'hit', requested, power: 3, aim: .5,
    at: s.time, flightId: s.flight?.id, ...extra });
}
test('LAN addresses accept IPv4 and explicit ports and reject URL injection and malformed input', () => {
  const parse = globalThis.ShuttleLan.parseAddress;
  assert.equal(parse(' 26.12.34.56:3210 ').url, 'ws://26.12.34.56:3210/shuttle-flow');
  assert.equal(parse('192.168.1.2').port, 3210);
  for (const value of ['999.1.1.1', 'a@26.1.2.3', '127.0.0.1:0', '127.0.0.1:65536', 'http://host/', '0.0.0.0', '127.0.0.1:3210/path']) assert.throws(() => parse(value));
});
test('both players must ready; each starts near the camera in the correct diagonal service court', () => {
  const s = L.createSession(15); L.setReady(s, 0, true); assert.equal(s.phase, 'lobby');
  L.setReady(s, 1, true); assert.equal(s.phase, 'playing');
  for (const side of [0, 1]) {
    const v = L.view(s, side);
    assert.equal(v.player.y, .58); assert.equal(v.opponent.y, -.58);
    assert.ok(C.inServiceCourt(v.player, C.serviceSetup(v.match).playerCourt, true));
  }
  assert.equal(L.view(s, 0).match.server, 'player'); assert.equal(L.view(s, 1).match.server, 'computer');
});
test('LAN movement uses unchanged acceleration, inertia, bounds and speed on both sides', () => {
  const s = started(); s.stage = 'rally'; s.flight = null;
  const expected = s.players.map(p => ({ ...p }));
  for (let i = 0; i < 20; i++) {
    for (const side of [0, 1]) { L.setInput(s, side, { seq: i, dx: -1, dy: 1 }); C.movePlayer(expected[side], -1, 1, L.STEP); }
    L.step(s, L.STEP);
  }
  for (const side of [0, 1]) {
    assert.equal(s.players[side].x, expected[side].x); assert.equal(s.players[side].y, expected[side].y);
    assert.equal(s.players[side].vx, expected[side].vx);
  }
  assert.equal(L.setInput(s, 0, { seq: 1, dx: 1, dy: 1 }), false);
  assert.equal(L.setInput(s, 0, { seq: 100, dx: NaN, dy: 0 }), false);
  assert.equal(L.setInput(s, 0, { seq: 100, dx: 40, dy: 0 }), false);
});
test('only the serving player can serve and both players must settle before serving', () => {
  const s = started(); assert.equal(stroke(s, 1), false);
  stroke(s, 0); tick(s, .08); assert.equal(s.stage, 'serve');
  tick(s, .4); assert.ok(stroke(s, 0, 'smash')); tick(s, .07);
  assert.equal(s.stage, 'rally'); assert.equal(s.flight.shotType, 'drop'); assert.equal(s.flight.fault, null);
});
test('both views show precisely the same shuttle throughout a long or short serve', () => {
  for (const requested of ['clear', 'smash']) {
    const s = started(); tick(s, .2); stroke(s, 0, requested); tick(s, .06);
    for (let i = 0; i < 60; i++) {
      const a = L.view(s, 0).delivery, b = L.view(s, 1).delivery;
      const p = C.returnPosition(a), q = L.mirror(C.incomingPosition(b));
      for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(p[k] - q[k]) < 1e-10);
      L.step(s, L.STEP);
    }
  }
});
test('late input is judged against recent history without enlarging contact windows', () => {
  const s = started(); tick(s, .2); stroke(s, 0); tick(s, .06);
  const f = s.flight, side = 1;
  s.players[side].x = 1 - f.returnTarget.x; s.players[side].y = -f.returnTarget.y;
  tick(s, f.returnDuration - f.age - .04);
  const seenAt = s.time; tick(s, .09);
  assert.ok(stroke(s, side, 'clear', { at: seenAt })); tick(s, .01);
  assert.equal(s.flight.owner, side); assert.equal(s.rally, 2);
  assert.equal(stroke(s, 0, 'clear', { flightId: -1 }), false);
  tick(s, .5); assert.ok(stroke(s, 0, 'clear', { at: s.time - 1000 })); tick(s, .01);
  assert.equal(s.flight.owner, side, 'timestamps cannot reach outside bounded history');
});
test('original jump-smash, standing-smash and defensive selection applies equally to both players', () => {
  const s = started();
  for (const side of [0, 1]) {
    const actor = { ...s.players[side], x: .5, y: .65, height: 55, verticalVelocity: 0 };
    assert.equal(C.shotFor(actor, { x: .53, y: .65, z: 100 }, 'smash').type, 'smash');
    actor.height = 0;
    assert.equal(C.shotFor(actor, { x: .53, y: .65, z: 90 }, 'smash').type, 'tap');
    const incoming = { phase: 'incoming', incomingType: 'smash' };
    assert.equal(C.shotFor(actor, { x: .53, y: .65, z: 40 }, 'clear', 3, incoming).type, 'lift');
    assert.equal(C.shotFor(actor, { x: .53, y: .65, z: 40 }, 'drop', 1, incoming).type, 'block');
    assert.equal(C.shotFor(actor, { x: .53, y: .65, z: 40 }, 'smash', 2, incoming).type, 'drive');
  }
});
test('either player can pause; pending strokes clear and both release their own pause', () => {
  const s = started(); tick(s, .2); stroke(s, 0); tick(s, .06);
  const age = s.flight.age, before = { ...s.players[0] };
  L.pause(s, 0, true); L.pause(s, 1, true); tick(s, 2);
  assert.equal(s.flight.age, age); assert.deepEqual(s.players[0], before);
  L.pause(s, 0, false); assert.equal(s.phase, 'paused');
  L.pause(s, 1, false); assert.equal(s.phase, 'playing'); tick(s, .05);
  assert.ok(s.flight.age > age); assert.deepEqual(s.swings, [null, null]);
});
test('a full seven-point match finishes once, mirrors the winner and supports mutual rematch', () => {
  const s = started();
  for (let i = 0; i < 10000 && s.phase !== 'over'; i++) {
    if (s.stage === 'serve' && s.still.every(n => n >= .2)) stroke(s, 0);
    L.step(s, L.STEP);
  }
  assert.equal(s.phase, 'over'); assert.equal(s.match.player, 7); assert.equal(s.match.computer, 0);
  assert.equal(L.view(s, 0).match.winner, 'player'); assert.equal(L.view(s, 1).match.winner, 'computer');
  tick(s, 2); assert.equal(s.match.player, 7);
  L.setReady(s, 0, true); assert.equal(s.phase, 'over');
  L.setReady(s, 1, true); assert.equal(s.phase, 'playing'); assert.equal(s.match.player, 0);
});
test('actual movement and swings sustain human rallies without AI or teleporting players', () => {
  const s = started(); let seq = 0;
  for (let i = 0; i < 14000 && s.rally < 10; i++) {
    for (const side of [0, 1]) {
      const v = L.view(s, side), actor = s.players[side];
      if (v.delivery?.phase === 'serve') {
        L.setInput(s, side, { seq: ++seq, dx: 0, dy: 0 });
        if (v.match.server === 'player' && s.still.every(n => n > .2)) stroke(s, side);
      } else if (v.delivery?.phase === 'incoming') {
        const target = C.isInterceptable(v.delivery) ? C.incomingPosition({ ...v.delivery, age: v.delivery.age + .15 }) : v.delivery.target;
        L.setInput(s, side, { seq: ++seq, dx: Math.abs(target.x - actor.x) > .012 ? Math.sign(target.x - actor.x) : 0,
          dy: Math.abs(target.y - actor.y) > .012 ? Math.sign(target.y - actor.y) : 0 });
        const future = { ...actor }; C.movePlayer(future, s.inputs[side].dx, s.inputs[side].dy, C.SWING.impact);
        const ball = { ...v.delivery, age: v.delivery.age + C.SWING.impact };
        if (C.assessHit(future, ball).grade) stroke(s, side, 'clear');
      } else L.setInput(s, side, { seq: ++seq, dx: 0, dy: 0 });
    }
    L.step(s, L.STEP);
  }
  assert.ok(s.longest >= 10, 'two human-rule controllers sustain a rally: ' + s.longest);
  assert.ok(s.events.some(e => e.type === 'hit' && e.side === 0));
  assert.ok(s.events.some(e => e.type === 'hit' && e.side === 1));
});
async function peer(room, token, version = L.VERSION) {
  const ws = new WebSocket('ws://127.0.0.1:' + room.port + '/shuttle-flow'), messages = [];
  ws.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ type: 'hello', version, token }));
  return { ws, messages, send: message => ws.send(JSON.stringify(message)) };
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Network wait timed out'); await new Promise(r => setTimeout(r, 10)); }
}
test('real sockets check version, reserve the host, allow two players and reject a third', async t => {
  const room = await createLanServer({ port: 0, host: '127.0.0.1' }); t.after(() => room.close());
  const wrong = await peer(room, null, 'old-version');
  await until(() => wrong.messages.some(m => m.code === 'version'));
  const host = await peer(room, room.token); await until(() => host.messages.some(m => m.type === 'welcome'));
  const guest = await peer(room); await until(() => guest.messages.some(m => m.type === 'welcome'));
  const third = await peer(room); await until(() => third.messages.some(m => m.code === 'full'));
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true });
  await until(() => guest.messages.some(m => m.phase === 'playing'));
  host.send({ type: 'pause', paused: true }); await until(() => guest.messages.some(m => m.phase === 'paused'));
  host.ws.close(); await until(() => guest.messages.some(m => m.phase === 'disconnected'));
  assert.equal(room.session.match.player, 0); guest.ws.close();
});
test('malformed tokens and appearances cannot crash a room; port conflicts are reported', async t => {
  const room = await createLanServer({ port: 0, host: '127.0.0.1' }); t.after(() => room.close());
  await assert.rejects(createLanServer({ port: room.port, host: '127.0.0.1' }), { code: 'EADDRINUSE' });
  const a = await peer(room, 'é'.repeat(48)); await until(() => a.messages.some(m => m.type === 'error'));
  const host = await peer(room, room.token); await until(() => host.messages.some(m => m.type === 'welcome'));
  host.send({ type: 'ready', ready: true, look: null }); host.send({ type: 'input', seq: 1, dx: 999, dy: 0 });
  await new Promise(r => setTimeout(r, 30)); assert.equal(room.session.inputs[0].dx, 0); host.ws.close();
});
test('two production clients sustain rallies with 80 ms simulated round-trip delay', async t => {
  const NativeSocket = globalThis.WebSocket, delayed = new Set();
  class DelayedSocket {
    constructor(url) {
      this.ws = new NativeSocket(url);
      for (const type of ['open', 'message', 'error', 'close']) this.ws.addEventListener(type, event => this.later(() => this['on' + type]?.(event)));
    }
    get readyState() { return this.ws.readyState; }
    later(fn) { const timer = setTimeout(() => { delayed.delete(timer); fn(); }, 40); delayed.add(timer); }
    send(message) { this.later(() => { if (this.ws.readyState === 1) this.ws.send(message); }); }
    close() { this.ws.close(); }
  }
  const room = await createLanServer({ port: 0, host: '127.0.0.1' });
  globalThis.WebSocket = DelayedSocket;
  const clients = [globalThis.ShuttleLan.createClient(), globalThis.ShuttleLan.createClient()];
  let bots;
  t.after(async () => {
    clearInterval(bots); clients.forEach(c => c.disconnect());
    for (const timer of delayed) clearTimeout(timer);
    globalThis.WebSocket = NativeSocket; await room.close();
  });
  await clients[0].connect('127.0.0.1:' + room.port, { token: room.token });
  await clients[1].connect('127.0.0.1:' + room.port);
  await until(() => clients.every(c => c.state?.connected[1]));
  clients.forEach(c => c.ready(true));
  bots = setInterval(() => {
    for (const client of clients) {
      const v = client.sample();
      if (v?.phase !== 'playing') continue;
      if (v.stage === 'serve') {
        client.input(0, 0);
        if (v.match.server === 'player' && v.still.every(n => n > .2)) client.action('hit', { requested: 'clear', power: 3, aim: .5 });
      } else if (v.delivery?.phase === 'incoming') {
        const target = v.delivery.target, p = v.player;
        const dx = Math.abs(target.x - p.x) > .012 ? Math.sign(target.x - p.x) : 0;
        const dy = Math.abs(target.y - p.y) > .012 ? Math.sign(target.y - p.y) : 0;
        client.input(dx, dy);
        const actor = { ...p }; C.movePlayer(actor, dx, dy, C.SWING.impact);
        if (C.assessHit(actor, { ...v.delivery, age: v.delivery.age + C.SWING.impact }).grade) client.action('hit', {
          requested: 'clear', power: 3, aim: .5, flightId: v.flightId
        });
      } else client.input(0, 0);
    }
  }, 25);
  const deadline = Date.now() + 16000;
  while (room.session.longest < 6 && Date.now() < deadline) await new Promise(r => setTimeout(r, 30));
  assert.ok(room.session.longest >= 6, 'six legal shots with delayed production clients: ' + room.session.longest);
  assert.ok(clients.every(c => c.ping >= 60 && c.ping < 300));
});
test('actual network jump and impact timing preserve jump smashes on either side, including after a pause', () => {
  for (const side of [0, 1]) for (const paused of [false, true]) {
    const s = started(); s.stage = 'rally'; s.flightId = 1;
    s.flight = { id: 1, owner: 1 - side, phase: 'return', age: .43, returnFrom: { x: .5, y: .65 },
      returnTarget: { x: .5, y: -.65 }, returnHeight: 25, returnEndHeight: 0,
      returnDuration: 1, returnArc: 195, shotType: 'clear', power: 3, fault: null };
    Object.assign(s.players[side], { x: .5, y: .39 });
    assert.ok(L.action(s, side, { action: 'jump', at: s.time }));
    assert.equal(L.action(s, side, { action: 'jump', at: s.time }), false, 'no double jump');
    tick(s, .15);
    if (paused) { L.pause(s, side, true); tick(s, .25); L.pause(s, side, false); }
    tick(s, .177); assert.ok(stroke(s, side, 'smash')); tick(s, .06);
    assert.equal(s.flight.owner, side); assert.equal(s.flight.shotType, 'smash');
    assert.equal(s.rally, 1); assert.equal(s.flight.fault, null);
  }
});
test('the authoritative impact resolver produces standing smashes, lifts, blocks and drives for both sides', () => {
  for (const side of [0, 1]) for (const [requested, expected] of [['clear', 'lift'], ['drop', 'block'], ['smash', 'drive'], ['smash', 'tap']]) {
    const s = started(); s.stage = 'rally'; s.flightId = 1;
    s.flight = { id: 1, owner: 1 - side, phase: 'return', age: expected === 'tap' ? .77 : .7,
      returnFrom: { x: .5, y: .65 }, returnTarget: { x: .5, y: -.65 },
      returnHeight: expected === 'tap' ? 25 : 130, returnEndHeight: 0,
      returnDuration: expected === 'tap' ? 1 : .8, returnArc: expected === 'tap' ? 195 : 20,
      shotType: expected === 'tap' ? 'clear' : 'smash', power: 3, fault: null };
    const atImpact = C.incomingPosition(L.incoming(s.flight, side, s.flight.age + C.SWING.impact));
    Object.assign(s.players[side], { x: atImpact.x, y: atImpact.y });
    assert.ok(stroke(s, side, requested)); tick(s, .06);
    assert.equal(s.flight.owner, side); assert.equal(s.flight.shotType, expected);
  }
});
test('point views preserve deuce, caps and odd/even service boxes for every match length', () => {
  for (const target of [7, 15, 21]) {
    const s = started(target); s.match.player = target - 1; s.match.computer = target - 1;
    C.awardPoint(s.match, 'computer'); assert.equal(s.match.winner, null);
    for (const side of [0, 1]) {
      const m = L.view(s, side).match, setup = C.serviceSetup(m);
      assert.equal(setup.right, target % 2 === 0);
      assert.equal(m.server, side === 0 ? 'computer' : 'player');
    }
    C.awardPoint(s.match, 'computer'); assert.equal(L.view(s, 1).match.winner, 'player');
    s.match.winner = null; s.match.player = s.match.cap - 1; s.match.computer = s.match.cap - 1;
    C.awardPoint(s.match, 'player'); assert.equal(s.match.winner, 'player');
    assert.equal(s.match.player, s.match.cap);
  }
});
