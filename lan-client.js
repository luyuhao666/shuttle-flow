(() => {
'use strict';
const C = globalThis.ShuttleCore, L = globalThis.ShuttleLanCore;
function parseAddress(value) {
  const match = String(value).trim().match(/^((?:\d{1,3}\.){3}\d{1,3}|localhost)(?::(\d{1,5}))?$/i);
  if (!match || (match[1] !== 'localhost' && match[1].split('.').some(n => Number(n) > 255))) throw new Error('address');
  const port = Number(match[2] ?? 3210);
  if (port < 1 || port > 65535 || match[1] === '0.0.0.0') throw new Error('address');
  return { host: match[1], port, url: 'ws://' + match[1] + ':' + port + '/shuttle-flow' };
}
function createClient({ onState = () => {}, onStatus = () => {}, onEvent = () => {} } = {}) {
  let socket = null, snapshot = null, received = 0, lastReceive = 0, timer = null;
  let sequence = 0, eventId = 0, side = 0, connected = false, rtt = 0;
  let movement = { dx: 0, dy: 0 }, lastInput = 0, status = 'idle';
  const now = () => performance.now();
  function send(message) { if (socket?.readyState === 1) socket.send(JSON.stringify(message)); }
  function report(next) { status = next; onStatus(next); }
  function disconnect() {
    const old = socket; socket = null;
    if (old) { old.onclose = old.onmessage = old.onerror = null; old.close(); }
    clearInterval(timer); timer = null; connected = false; snapshot = null;
    movement = { dx: 0, dy: 0 }; status = 'idle';
  }
  async function connect(address, { token, look } = {}) {
    const { url } = parseAddress(address); disconnect(); report('connecting');
    eventId = 0; sequence = 0; rtt = 0;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url); socket = ws;
      let settled = false;
      const fail = code => {
        if (socket !== ws) return;
        clearTimeout(timeout);
        if (!settled) { settled = true; reject(new Error(code)); }
        clearInterval(timer); timer = null; connected = false;
        report(code);
      };
      const timeout = setTimeout(() => { fail('timeout'); ws.close(); }, 7000);
      ws.onopen = () => send({ type: 'hello', version: L.VERSION, token, look });
      ws.onmessage = event => {
        if (socket !== ws) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        lastReceive = now();
        if (message.type === 'error') { fail(message.code); return; }
        if (message.type === 'welcome') {
          side = message.side; connected = true; clearTimeout(timeout);
          report('connected'); settled = true; resolve();
          timer = setInterval(() => {
            if (now() - lastReceive > 5000) { fail('disconnected'); ws.close(); return; }
            send({ type: 'ping', sent: now() }); flushInput(true);
          }, 1000);
        } else if (message.type === 'pong') {
          const measured = Math.max(0, now() - message.sent);
          rtt = rtt ? rtt * .7 + measured * .3 : measured;
        } else if (message.type === 'state') {
          snapshot = message; received = now();
          for (const event of message.events) {
            if (event.id > eventId) { eventId = event.id; onEvent(event, side); }
          }
          onState(message);
        }
      };
      ws.onerror = () => fail('connection');
      ws.onclose = () => { if (status === 'connected' || status === 'connecting') fail('disconnected'); };
    });
  }
  function flushInput(force = false) {
    if (!connected || !snapshot) return;
    if (!force && now() - lastInput < 25) return;
    lastInput = now(); send({ type: 'input', ...movement, seq: ++sequence });
  }
  function input(dx, dy) {
    const changed = dx !== movement.dx || dy !== movement.dy;
    movement = { dx, dy }; flushInput(changed);
  }
  function sample() {
    if (!snapshot) return null;
    const result = { ...snapshot, player: { ...snapshot.player }, opponent: { ...snapshot.opponent },
      delivery: snapshot.delivery ? { ...snapshot.delivery } : null };
    const dt = snapshot.phase === 'playing' ? Math.min(.1, (now() - received) / 1000) : 0;
    result.time += dt;
    if (result.delivery && ['incoming', 'return', 'point'].includes(result.delivery.phase)) result.delivery.age += dt;
    if (snapshot.stage !== 'point') {
      C.movePlayer(result.player, movement.dx, movement.dy, dt); C.updateJump(result.player, dt);
      const far = { ...L.mirror(snapshot.opponent), vx: -snapshot.opponent.vx, vy: -snapshot.opponent.vy };
      C.movePlayer(far, snapshot.opponentInput.dx, snapshot.opponentInput.dy, dt); C.updateJump(far, dt);
      result.opponent = { ...result.opponent, ...L.mirror(far), vx: -far.vx, vy: -far.vy };
    }
    if (snapshot.stage === 'serve') C.constrainToServiceCourt(result.player, C.serviceSetup(result.match).playerCourt);
    return result;
  }
  function action(action, values = {}) {
    if (snapshot?.phase !== 'playing') return;
    send({ type: 'action', seq: ++sequence, action, at: sample().time, ...values });
  }
  return Object.freeze({ connect, disconnect, input, sample, action,
    ready: (ready, look) => send({ type: 'ready', ready, look }),
    pause: paused => { movement = { dx: 0, dy: 0 }; flushInput(true); send({ type: 'pause', paused }); },
    get state() { return snapshot; }, get side() { return side; },
    get ping() { return Math.round(rtt); }, get connected() { return connected; }
  });
}
globalThis.ShuttleLan = Object.freeze({ createClient, parseAddress });
})();
