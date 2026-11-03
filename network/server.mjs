import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import '../core.js';
import '../lan-core.js';
const L = globalThis.ShuttleLanCore;
export function localAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flat()
    .filter(n => n?.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))
    .map(n => n.address))];
}
function appearance(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const result = {};
  for (const part of ['JerseyColor', 'JerseyStripe', 'RacketColor', 'RacketGrip']) {
    const color = value[part]; result[part] = /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  }
  result.RacketStyle = ['classic', 'square', 'slim'].includes(value.RacketStyle) ? value.RacketStyle : 'classic';
  result.RacketSize = ['original', 'large', 'extra'].includes(value.RacketSize) ? value.RacketSize : 'large';
  return result;
}
export async function createLanServer({ port = 3210, host = '0.0.0.0', target = 7, court = 'classic' } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const session = L.createSession(target);
  const token = randomBytes(24).toString('hex');
  const peers = [null, null], looks = [appearance(), appearance()];
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Shuttle Flow LAN room. Join from the game using this IP and port.');
  });
  const wss = new WebSocketServer({ server, path: '/shuttle-flow', maxPayload: 8192, perMessageDeflate: false });
  // The listen promise below reports bind errors to the caller. ws also
  // forwards the HTTP server error and needs its own listener.
  wss.on('error', () => {});
  let closing = false;
  const send = (socket, value) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 131072) socket.send(JSON.stringify(value));
  };
  const broadcast = () => peers.forEach((socket, side) => {
    if (socket) send(socket, { type: 'state', ...L.view(session, side),
      connected: [Boolean(peers[side]), Boolean(peers[1 - side])], looks, court });
  });
  const sameToken = candidate => {
    if (typeof candidate !== 'string' || !/^[0-9a-f]{48}$/.test(candidate)) return false;
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
  };
  wss.on('connection', socket => {
    let side = null, lastAction = -1, count = 0, rateStart = Date.now();
    let lastSeen = Date.now();
    const helloTimer = setTimeout(() => socket.close(1008, 'Hello timeout'), 5000);
    socket.on('pong', () => { lastSeen = Date.now(); });
    socket.on('error', () => {});
    socket.on('message', raw => {
      const now = Date.now();
      if (now - rateStart >= 1000) { count = 0; rateStart = now; }
      if (++count > 180) { socket.close(1008, 'Too many messages'); return; }
      lastSeen = now;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid message'); return; }
      if (!message || typeof message !== 'object') { socket.close(1008, 'Invalid message'); return; }
      if (side === null) {
        if (message.type !== 'hello' || message.version !== L.VERSION) {
          send(socket, { type: 'error', code: 'version' }); socket.close(1008, 'Version mismatch'); return;
        }
        const assigned = sameToken(message.token) ? 0 : 1;
        if (peers[assigned] || (assigned === 1 && !peers[0]) || session.phase === 'disconnected') {
          send(socket, { type: 'error', code: 'full' }); socket.close(1008, 'Room unavailable'); return;
        }
        side = assigned; peers[side] = socket; looks[side] = appearance(message.look);
        clearTimeout(helloTimer);
        send(socket, { type: 'welcome', side, version: L.VERSION });
        broadcast(); return;
      }
      if (message.type === 'ping' && Number.isFinite(message.sent)) {
        send(socket, { type: 'pong', sent: message.sent, time: session.time }); return;
      }
      if (message.type === 'input') L.setInput(session, side, message);
      else if (message.type === 'ready' && peers.every(Boolean)) {
        looks[side] = appearance(message.look); L.setReady(session, side, message.ready); broadcast();
      } else if (message.type === 'pause' && typeof message.paused === 'boolean') {
        L.pause(session, side, message.paused); broadcast();
      } else if (message.type === 'action' && Number.isSafeInteger(message.seq) && message.seq > lastAction) {
        lastAction = message.seq; L.action(session, side, message);
      }
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (side === null || peers[side] !== socket) return;
      peers[side] = null; session.ready = [false, false];
      for (const input of session.inputs) { input.dx = 0; input.dy = 0; }
      if (!closing && !['lobby', 'over'].includes(session.phase)) session.phase = 'disconnected';
      if (!closing) broadcast();
    });
    socket._lanLastSeen = () => lastSeen;
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  }).catch(error => { wss.close(); throw error; });
  // The main-process clock keeps running when either game window loses focus.
  let previous = performance.now(), accumulator = 0, lastBroadcast = 0, lastPing = 0;
  const timer = setInterval(() => {
    const now = performance.now(); accumulator += Math.min(.25, (now - previous) / 1000); previous = now;
    while (accumulator >= L.STEP) { L.step(session, L.STEP); accumulator -= L.STEP; }
    if (now - lastBroadcast >= 1000 / 30) {
      lastBroadcast += 1000 / 30;
      if (now - lastBroadcast > 100) lastBroadcast = now;
      broadcast();
    }
    if (now - lastPing > 1000) {
      lastPing = now;
      for (const socket of wss.clients) {
        if (Date.now() - socket._lanLastSeen() > 5000) socket.terminate();
        else socket.ping();
      }
    }
  }, 1000 / 120);
  return {
    port: server.address().port, token, addresses: localAddresses(),
    // Exposed only in-process, for deterministic integration tests.
    session,
    async close() {
      if (closing) return;
      closing = true; clearInterval(timer);
      for (const socket of wss.clients) socket.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}
