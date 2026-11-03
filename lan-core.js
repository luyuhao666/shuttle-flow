(() => {
'use strict';
// Each player uses the original near-court coordinates. Only presentation and
// the shuttle crossing the net are mirrored; both players share the same rules.
const C = globalThis.ShuttleCore;
const VERSION = 'shuttle-flow-1.1.0-lan-1';
const STEP = 1 / 120, MAX_REWIND = .15;
const mirror = p => ({ ...p, x: 1 - p.x, y: -p.y });
const clone = value => JSON.parse(JSON.stringify(value));
const key = side => side === 0 ? 'player' : 'computer';
function createSession(target = 7) {
  const match = C.createMatch(target); match.server = 'player';
  return {
    phase: 'lobby', time: 0, match, players: [C.createPlayer(), C.createPlayer()],
    inputs: [0, 1].map(() => ({ dx: 0, dy: 0, seq: -1, time: 0 })),
    ready: [false, false], paused: [false, false], still: [0, 0],
    swings: [null, null], cooldown: [0, 0], jumpAt: [-100, -100],
    flight: null, flightId: 0, round: 0, rally: 0, longest: 0,
    breakUntil: 0, events: [], eventId: 0, history: [], point: null
  };
}
function emit(s, type, details = {}) {
  s.events.push({ id: ++s.eventId, type, time: s.time, ...details });
  if (s.events.length > 24) s.events.shift();
}
function stopInputs(s) {
  for (const input of s.inputs) { input.dx = 0; input.dy = 0; }
}
function relativeMatch(s, side) {
  return { ...s.match, player: s.match[key(side)], computer: s.match[key(1 - side)],
    server: s.match.server === key(side) ? 'player' : 'computer',
    winner: s.match.winner === null ? null : s.match.winner === key(side) ? 'player' : 'computer' };
}
function prepareServe(s) {
  s.round++; s.rally = 0; s.flight = null; s.point = null; s.swings = [null, null];
  s.cooldown = [0, 0]; s.still = [0, 0]; s.history = []; stopInputs(s);
  for (let side = 0; side < 2; side++) {
    const box = C.serviceSetup(relativeMatch(s, side)).playerCourt;
    s.players[side] = { ...C.createPlayer(), x: (box.minX + box.maxX) / 2, y: .58 };
  }
  s.stage = 'serve'; emit(s, 'serve');
}
function setReady(s, side, ready) {
  if (!['lobby', 'over'].includes(s.phase)) return false;
  s.ready[side] = ready === true;
  if (s.ready.every(Boolean)) {
    s.match = C.createMatch(s.match.target); s.match.server = 'player';
    s.phase = 'playing'; s.ready = [false, false]; s.paused = [false, false];
    s.longest = 0; prepareServe(s); emit(s, 'start');
  }
  return true;
}
function pause(s, side, value) {
  if (!['playing', 'paused'].includes(s.phase)) return;
  s.paused[side] = Boolean(value); stopInputs(s);
  // A swing cannot be held across a pause and then unexpectedly fire.
  s.swings = [null, null];
  s.phase = s.paused.some(Boolean) ? 'paused' : 'playing';
}
function setInput(s, side, input) {
  const previous = s.inputs[side];
  if (!Number.isSafeInteger(input.seq) || input.seq <= previous.seq) return false;
  if (![input.dx, input.dy].every(n => Number.isFinite(n) && Math.abs(n) <= 1)) return false;
  previous.seq = input.seq; previous.time = s.time;
  previous.dx = s.phase === 'playing' ? input.dx : 0;
  previous.dy = s.phase === 'playing' ? input.dy : 0;
  return true;
}
function incoming(flight, side, age = flight.age) {
  const from = mirror(flight.returnFrom), target = mirror(flight.returnTarget);
  return { phase: 'incoming', id: flight.id, age, from, target,
    fromHeight: flight.returnHeight, toHeight: flight.returnEndHeight,
    duration: flight.returnDuration, flightArc: flight.returnArc,
    incomingType: flight.shotType === 'tap' ? 'attack' : flight.shotType,
    power: flight.power, service: flight.service };
}
function launch(s, side, contact, shot, power, at) {
  s.flight = {
    id: ++s.flightId, owner: side, phase: 'return', age: Math.max(0, s.time - at),
    returnFrom: { x: contact.x, y: contact.y }, returnHeight: contact.z,
    returnTarget: shot.target, returnEndHeight: shot.endHeight,
    returnDuration: shot.duration, returnArc: shot.arc, shotType: shot.type,
    power, fault: shot.fault, service: s.stage === 'serve'
  };
  s.stage = 'rally'; s.rally++; s.longest = Math.max(s.longest, s.rally);
  emit(s, 'hit', { side, contact, shot: shot.type, backhand: shot.backhand,
    overhead: shot.overhead || (shot.type === 'clear' && contact.z >= 75), power });
}
function atTime(s, side, at) {
  const saved = [...s.history].reverse().find(h => h.time <= at + STEP / 2);
  const actor = { ...(saved?.players[side] ?? s.players[side]) };
  const flight = saved?.flight?.id === s.flight?.id ? saved.flight : s.flight;
  if (!flight) return { actor, ball: null };
  const age = Math.max(0, flight.age + at - (saved?.flight?.id === flight.id ? saved.time : s.time));
  // Jump input is timestamped too, so a hit following a delayed jump is judged
  // against the same airborne pose that the player saw.
  const air = at - s.jumpAt[side];
  if (air >= 0 && air < 2 * C.JUMP.velocity / C.JUMP.gravity) {
    actor.height = C.JUMP.velocity * air - .5 * C.JUMP.gravity * air * air;
    actor.verticalVelocity = C.JUMP.velocity - C.JUMP.gravity * air;
  }
  return { actor, ball: incoming(flight, side, age) };
}
function resolveSwing(s, side, stroke) {
  if (s.phase !== 'playing') return;
  const actor = s.players[side];
  if (s.stage === 'serve') {
    const match = relativeMatch(s, side);
    if (match.server !== 'player' || s.still.some(n => n < .15)
      || actor.height > 0 || !C.inServiceCourt(actor, C.serviceSetup(match).serverCourt, true)) {
      emit(s, 'miss', { side, reason: 'serve' }); return;
    }
    const contact = { x: actor.x + .02, y: actor.y, z: 50 };
    const shot = C.planService(match, contact, stroke.requested, stroke.aim);
    launch(s, side, contact, shot, shot.power, s.time); return;
  }
  if (s.stage !== 'rally' || s.flight.owner === side || stroke.flightId !== s.flight.id) {
    emit(s, 'miss', { side, reason: 'no-ball' }); return;
  }
  const { actor: historical, ball } = atTime(s, side, stroke.at);
  const result = C.assessHit(historical, ball);
  if (!result.grade) { emit(s, 'miss', { side, reason: result.reason }); return; }
  const shot = C.planReturn(historical, result.point, stroke.requested, stroke.power,
    stroke.aim, C.contactTimingError(historical, ball), ball);
  launch(s, side, result.point, shot, stroke.power, stroke.at);
}
function action(s, side, message) {
  if (s.phase !== 'playing' || s.stage === 'point') return false;
  const at = C.clamp(Number.isFinite(message.at) ? message.at : s.time, s.time - MAX_REWIND, s.time + .05);
  if (message.action === 'jump') {
    if (s.stage === 'serve' || !C.startJump(s.players[side])) return false;
    s.jumpAt[side] = Math.min(at, s.time);
    C.updateJump(s.players[side], s.time - s.jumpAt[side]);
    emit(s, 'jump', { side }); return true;
  }
  if (message.action !== 'hit' || !['clear', 'drop', 'smash'].includes(message.requested)
    || ![1, 2, 3].includes(message.power) || !Number.isFinite(message.aim)
    || s.time < s.cooldown[side]) return false;
  if (s.stage === 'serve' && s.match.server !== key(side)) return false;
  if (s.stage === 'rally' && message.flightId !== s.flight.id) return false;
  s.cooldown[side] = s.time + C.RULES.cooldown;
  const stroke = { requested: message.requested, aim: C.clamp(message.aim, .03, .97),
    power: message.power, at: at + C.SWING.impact, flightId: s.flight?.id };
  s.swings[side] = stroke;
  emit(s, 'swing', { side, requested: stroke.requested, power: stroke.power });
  return true;
}
function scorePoint(s, side, reason, position) {
  if (s.stage === 'point' || !C.awardPoint(s.match, key(side))) return;
  s.point = { owner: s.flight?.owner ?? side, position, reason };
  s.stage = 'point'; s.breakUntil = s.time + 1.7; s.swings = [null, null];
  stopInputs(s); emit(s, 'point', { side, reason });
}
function step(s, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  for (let remaining = Math.min(dt, .25); remaining > .000001; remaining -= STEP) {
    const delta = Math.min(STEP, remaining); s.time += delta;
    if (s.phase !== 'playing') {
      if (s.phase === 'paused') {
        // Network timestamps keep running during a pause, while gameplay
        // deadlines and the jump's active-time origin stay frozen together.
        s.breakUntil += delta;
        for (let side = 0; side < 2; side++) { s.cooldown[side] += delta; s.jumpAt[side] += delta; }
      }
      continue;
    }
    for (let side = 0; side < 2; side++) {
      const actor = s.players[side], input = s.inputs[side];
      if (s.time - input.time > .3) { input.dx = 0; input.dy = 0; }
      C.updateJump(actor, delta);
      if (s.stage !== 'point') C.movePlayer(actor, input.dx, input.dy, delta);
      if (s.stage === 'serve') C.constrainToServiceCourt(actor, C.serviceSetup(relativeMatch(s, side)).playerCourt);
      s.still[side] = Math.hypot(input.dx, input.dy, actor.vx, actor.vy) > .04 ? 0 : s.still[side] + delta;
    }
    if (s.stage === 'point') {
      if (s.time >= s.breakUntil) {
        if (s.match.winner) { s.phase = 'over'; s.ready = [false, false]; emit(s, 'over'); }
        else prepareServe(s);
      }
      continue;
    }
    if (s.flight) s.flight.age += delta;
    s.history.push({ time: s.time, players: s.players.map(p => ({ ...p })), flight: s.flight ? { ...s.flight } : null });
    while (s.history.length > 40) s.history.shift();
    for (let side = 0; side < 2; side++) {
      const stroke = s.swings[side];
      if (stroke && stroke.at <= s.time) { s.swings[side] = null; resolveSwing(s, side, stroke); }
    }
    if (s.stage === 'rally' && s.flight) {
      const f = s.flight;
      // Keep the original contact windows. This grace only defers final scoring
      // while already-sent inputs arrive; it does not slow or extend the flight.
      if (f.fault && f.age >= f.fault.age + MAX_REWIND) {
        scorePoint(s, 1 - f.owner, f.fault.type, f.fault.point);
      } else if (!f.fault && f.age > f.returnDuration + C.RULES.late + MAX_REWIND) {
        scorePoint(s, f.owner, 'miss', C.returnPosition(f));
      }
    }
  }
}
function view(s, side) {
  const near = { ...s.players[side] }, other = s.players[1 - side];
  const far = { ...mirror(other), vx: -other.vx, vy: -other.vy,
    skill: { speed: C.RULES.speed }, intent: 'human' };
  let delivery = null;
  if (s.stage === 'serve') delivery = { phase: 'serve', age: 0, delay: 0 };
  else if (s.stage === 'point') {
    const point = s.point?.position ?? { x: .5, y: .6, z: 0 };
    delivery = { phase: 'point', age: Math.max(0, s.time - s.breakUntil + 1.7),
      pointPosition: s.point.owner === side ? point : mirror(point) };
  } else if (s.flight) delivery = s.flight.owner === side ? { ...s.flight } : incoming(s.flight, side);
  return { phase: s.phase, stage: s.stage, time: s.time, round: s.round, flightId: s.flightId,
    player: near, opponent: far, match: relativeMatch(s, side), delivery,
    input: { ...s.inputs[side] }, opponentInput: { ...s.inputs[1 - side] },
    cooldown: Math.max(0, s.cooldown[side] - s.time), ready: [s.ready[side], s.ready[1 - side]],
    paused: [s.paused[side], s.paused[1 - side]], rally: s.rally, longest: s.longest,
    still: s.still.slice(), events: clone(s.events), side };
}
globalThis.ShuttleLanCore = Object.freeze({ VERSION, STEP, MAX_REWIND, mirror,
  createSession, setReady, pause, setInput, action, step, view, incoming });
})();
