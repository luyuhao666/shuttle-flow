import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import './core.js';
import './lan-core.js';

const C = globalThis.ShuttleCore, L = globalThis.ShuttleLanCore;
const source = readFileSync(new URL('./lan-client.js', import.meta.url), 'utf8');
async function fixture() {
  let time = 0, socket;
  class Socket {
    readyState = 1; sent = [];
    constructor() { socket = this; }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() {}
  }
  const context = { ShuttleCore: C, ShuttleLanCore: L, WebSocket: Socket,
    performance: { now: () => time }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} };
  runInNewContext(source, context);
  const client = context.ShuttleLan.createClient(), connection = client.connect('127.0.0.1:3210');
  socket.onopen(); socket.onmessage({ data: JSON.stringify({ type: 'welcome', side: 0 }) }); await connection;
  const session = L.createSession(); L.setReady(session, 0, true); L.setReady(session, 1, true);
  session.stage = 'rally'; session.flightId = 1;
  session.flight = { id: 1, owner: 1, phase: 'return', age: 0, returnFrom: { x: .5, y: .65 },
    returnTarget: { x: .5, y: -.68 }, returnHeight: 60, returnEndHeight: 0,
    returnDuration: 4, returnArc: 24, shotType: 'drive', power: 2, fault: null };
  return { client, session, socket, clock: value => { time = value; },
    packet(sent) {
      session.time = sent / 1000; session.flight.age = session.time;
      return { type: 'state', ...L.view(session, 0), connected: [true, true] };
    },
    receive(message) { socket.onmessage({ data: JSON.stringify(message) }); } };
}

test('displayed flights remain monotonic and bounded through ordered packet jitter', async () => {
  const f = await fixture(), packets = [], delays = [20, 100, 100, 100, 20, 20, 20, 20];
  let arrival = -1;
  for (let i = 0; i < 110; i++) {
    const sent = i * 1000 / 30;
    arrival = Math.max(arrival + .1, sent + delays[i % delays.length]);
    packets.push({ arrival, message: f.packet(sent) });
  }
  let index = 0, previousRaw, previousDisplay, rawRewinds = 0, largestStep = 0;
  for (let now = 0; now < 3400; now += 1000 / 60) {
    f.clock(now);
    while (index < packets.length && packets[index].arrival <= now) f.receive(packets[index++].message);
    const raw = f.client.sample(), shown = f.client.presentation(); if (!raw) continue;
    if (previousRaw !== undefined) {
      if (raw.delivery.age < previousRaw - .00001) rawRewinds++;
      const step = shown.delivery.age - previousDisplay;
      assert.ok(step >= -1e-10, 'late state never rewinds the displayed flight');
      largestStep = Math.max(largestStep, step);
    }
    assert.ok(shown.delivery.age <= f.client.state.delivery.age + .100001, 'bounded extrapolation');
    previousRaw = raw.delivery.age; previousDisplay = shown.delivery.age;
  }
  assert.ok(rawRewinds >= 10, 'the fixture exercises the previously observed rewind');
  assert.ok(largestStep <= .020001, 'no abrupt catch-up step at 60 Hz');
});

test('constant-delay presentation follows the original flight clock at its original rate', async () => {
  const f = await fixture();
  for (let frame = 0; frame < 120; frame++) {
    f.clock(frame * 1000 / 60 + 40);
    if (frame % 2 === 0) f.receive(f.packet(frame * 1000 / 60));
    const raw = f.client.sample(), shown = f.client.presentation();
    assert.ok(Math.abs(raw.delivery.age - shown.delivery.age) < 1e-10);
    assert.equal(raw.delivery.duration, shown.delivery.duration);
    assert.deepEqual(C.incomingPosition(raw.delivery), C.incomingPosition(shown.delivery));
  }
});

test('presentation cannot mutate snapshots, input sampling or historical action timestamps', async () => {
  const f = await fixture(); f.receive(f.packet(0)); f.client.presentation();
  f.clock(80); f.receive(f.packet(33));
  const snapshot = JSON.stringify(f.client.state), before = JSON.stringify(f.client.sample());
  const shown = f.client.presentation();
  assert.notEqual(shown.delivery.age, f.client.sample().delivery.age, 'display and judgement clocks may differ during jitter');
  assert.equal(JSON.stringify(f.client.state), snapshot);
  assert.equal(JSON.stringify(f.client.sample()), before);
  assert.equal(JSON.stringify(shown.player), JSON.stringify(f.client.sample().player));
  const timestamp = f.client.sample().time;
  f.client.action('hit', { requested: 'smash', power: 2, aim: .5, flightId: 1 });
  assert.equal(f.socket.sent.at(-1).at, timestamp, 'authority receives the original input clock');
});

test('pause, resumed play, new flights, round changes and points reset presentation immediately', async () => {
  const f = await fixture(); f.receive(f.packet(0)); f.client.presentation();
  f.clock(80); f.receive(f.packet(33)); f.client.presentation();
  for (const change of [
    message => { message.phase = 'paused'; },
    message => { message.phase = 'playing'; },
    message => { message.flightId++; message.delivery.age = 0; },
    message => { message.round++; message.delivery.age = 0; },
    message => { message.stage = 'point'; message.delivery = { phase: 'point', age: 0 }; }
  ]) {
    const message = JSON.parse(JSON.stringify(f.client.state)); change(message);
    f.receive(message);
    assert.equal(f.client.presentation().delivery.age, f.client.sample().delivery.age);
  }
});

test('repeated paints do not advance the clock and missing updates cannot extrapolate indefinitely', async () => {
  const f = await fixture(); f.receive(f.packet(0));
  const initial = f.client.presentation();
  assert.equal(f.client.presentation(), initial);
  for (const time of [80, 160, 240, 320, 900]) {
    f.clock(time);
    assert.ok(f.client.presentation().delivery.age <= .100001);
  }
  f.client.disconnect(); assert.equal(f.client.presentation(), null);
});

test('remote movement reconciles on the display only and never changes the authoritative player', async () => {
  const f = await fixture();
  f.receive(f.packet(0)); const previous = f.client.presentation().opponent.x;
  f.clock(16); const next = f.packet(16); next.opponent.x += .1; f.receive(next);
  const raw = f.client.sample(), shown = f.client.presentation();
  assert.ok(shown.opponent.x > previous && shown.opponent.x < raw.opponent.x);
  assert.equal(JSON.stringify(shown.player), JSON.stringify(raw.player));
  assert.equal(f.client.state.opponent.x, next.opponent.x);
});
