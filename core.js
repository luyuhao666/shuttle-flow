(() => {
'use strict';
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const RULES = { speed: 0.72, radius: 0.145, perfectRadius: 0.10, early: 0.23, late: 0.13, perfectTime: 0.085, cooldown: 0.38 };
const FOOTWORK = Object.freeze({ acceleration: 4.8, braking: 5.8, reversal: 3.6, pivotRecovery: 3.4 });
const JUMP = Object.freeze({ velocity: 360, gravity: 1100, recovery: 0.18, contactSpeed: 260 });
const SWING = Object.freeze({ impact: .045, contactEnd: .11, duration: .38 });
const POWER = Object.freeze({ light: 1, medium: 2, heavy: 3, defaults: Object.freeze({ clear: 3, drop: 1, smash: 2 }) });
const NET_HEIGHT = 52;
const CONTACT = Object.freeze({ overheadHeight: 120, lowHeight: 110, centerAttackSide: .03, overheadForward: .025, overheadDepth: .17 });
const BACKHAND = Object.freeze({ minSide: .015, maxSide: .075, forward: .09, behind: .01, speed: .20, pivot: .10, timing: .045, groundTiming: .20, apexRatio: .95, verticalSpeed: 55, jumpMinHeight: 50, jumpMaxHeight: 105, groundMinHeight: 90 });
function createPlayer() { return { x: .5, y: .65, vx: 0, vy: 0, pivot: 0, plantX: 0, plantY: 0, height: 0, verticalVelocity: 0, jumpRecovery: 0 }; }
function startJump(player) {
  if (player.height > 0 || player.verticalVelocity > 0 || player.jumpRecovery > 0) return false;
  player.verticalVelocity = JUMP.velocity;
  return true;
}
function updateJump(player, dt) {
  player.jumpRecovery = Math.max(0, player.jumpRecovery - dt);
  if (player.height <= 0 && player.verticalVelocity <= 0) return false;
  player.height += player.verticalVelocity * dt - .5 * JUMP.gravity * dt * dt;
  player.verticalVelocity -= JUMP.gravity * dt;
  if (player.height <= 0) { player.height = 0; player.verticalVelocity = 0; player.jumpRecovery = JUMP.recovery; return true; }
  return false;
}
function contactTime(player, delivery) { return delivery.duration - Math.min(.25, (player.height || 0) / JUMP.contactSpeed); }
function isHighShot(type) { return type === 'clear' || type === 'lift'; }
function isInterceptable(ball) { return ball?.incomingType && !isHighShot(ball.incomingType); }
function contactTimingError(player, delivery) {
  return isInterceptable(delivery) ? 0 : delivery.age - contactTime(player, delivery);
}
function canSmash(player, contact) {
  const apex = JUMP.velocity ** 2 / (2 * JUMP.gravity);
  // Restore the original attack rule. Actual reach and timing are checked by
  // assessHit; the character's visual pose must not narrow this attack window.
  return player.height >= apex * .80 && Math.abs(player.verticalVelocity || 0) <= 145
    && (contact?.z ?? 0) >= 75;
}
function isBackhand(player, contact) { return Boolean(contact && contact.x < player.x); }
function needsBackhandAttack(player, contact) {
  return isBackhand(player, contact) && player.x - contact.x > CONTACT.centerAttackSide;
}
function canBackhandAttack(player, contact, incoming = null, jumping = false) {
  if (!isBackhand(player, contact)) return false;
  const side = player.x - contact.x, depth = contact.y - player.y, height = contact.z - (player.height || 0);
  if (side < BACKHAND.minSide || side > BACKHAND.maxSide || depth < -BACKHAND.forward || depth > BACKHAND.behind) return false;
  if (Math.hypot(player.vx || 0, player.vy || 0) > BACKHAND.speed || (player.pivot || 0) > BACKHAND.pivot) return false;
  if (incoming?.phase === 'incoming' && Math.abs(contactTimingError(player, incoming)) > (jumping ? BACKHAND.timing : BACKHAND.groundTiming)) return false;
  if (jumping) {
    const apex = JUMP.velocity ** 2 / (2 * JUMP.gravity);
    return canSmash(player, contact) && player.height >= apex * BACKHAND.apexRatio && Math.abs(player.verticalVelocity || 0) <= BACKHAND.verticalSpeed && height >= BACKHAND.jumpMinHeight && height <= BACKHAND.jumpMaxHeight;
  }
  return !(player.height > 0 || player.verticalVelocity > 0) && height >= BACKHAND.groundMinHeight && height <= CONTACT.overheadHeight;
}
// Opponent attack rules keep their own facing and tactics; this helper governs the player.
function canPlayerSmash(player, contact, incoming = null) {
  // A shuttle just left of the centre line is still an overhead contact above
  // the body. Do not turn this tiny seam into a forbidden attack zone.
  return needsBackhandAttack(player, contact)
    ? canBackhandAttack(player, contact, incoming, true) : canSmash(player, contact);
}
function aimHorizontal(x) { return .03 + clamp(x, 0, 1) * .94; }
function defaultPowerFor(requested, defaults = POWER.defaults) {
  const type = { tap: 'smash', drive: 'smash', lift: 'clear', block: 'drop' }[requested] ?? requested;
  return [1, 2, 3].includes(defaults?.[type]) ? defaults[type] : POWER.defaults[type] ?? POWER.defaults.clear;
}
function shotFor(player, contact, requested = 'clear', power = defaultPowerFor(requested), incoming = null) {
  power = clamp(Math.round(Number(power) || defaultPowerFor(requested)), 1, 3);
  const backhand = isBackhand(player, contact);
  if (requested === 'smash' && canPlayerSmash(player, contact, incoming)) return { type: 'smash', backhand, power, duration: [.38, .32, .28][power - 1], arc: 20, targetDepth: [-.75, -.92, -.96][power - 1], endHeight: 0, bonus: 50, overhead: true };
  const low = incoming?.phase === 'incoming' && isInterceptable(incoming) && contact && contact.z - (player.height || 0) <= 90;
  const defending = incoming?.phase === 'incoming' && ['attack', 'smash', 'jumpSmash', 'drive'].includes(incoming.incomingType);
  const type = requested === 'clear' && (low || defending) ? 'lift' : requested === 'drop' && (low || defending) ? 'block' : requested === 'smash' && low ? 'drive' : null;
  if (type) {
    const profiles = {
      lift: { duration: [1.46, 1.57, 1.68], depth: [-.56, -.76, -.91], arc: [225, 245, 265] },
      block: { duration: [.78, .72, .67], depth: [-.13, -.23, -.34], arc: [24, 26, 28] },
      drive: { duration: [.58, .50, .44], depth: [-.50, -.68, -.84], arc: [22, 24, 26] }
    };
    const profile = profiles[type];
    const shot = { type, backhand, power, duration: profile.duration[power - 1], targetDepth: profile.depth[power - 1], arc: profile.arc[power - 1], endHeight: 0, bonus: 0, overhead: false, fallback: false };
    if (contact.y > 0) {
      const t = contact.y / (contact.y - shot.targetDepth);
      shot.arc = Math.max(shot.arc, (60 - contact.z * (1 - t)) / Math.sin(Math.PI * t));
    }
    return shot;
  }
  const airborne = player.height > 8, drop = requested === 'drop';
  const tap = requested === 'smash' && !(player.height > 0 || player.verticalVelocity > 0)
    && (!needsBackhandAttack(player, contact) || canBackhandAttack(player, contact, incoming));
  const shot = { type: tap ? 'tap' : drop ? 'drop' : 'clear', backhand, power, duration: tap ? [.57, .52, .47][power - 1] : drop ? [.64, .67, .70][power - 1] : (airborne ? 1.12 : 1.30) + (power - 3) * .08, arc: tap ? 32 : drop ? 35 : 215, targetDepth: tap ? [-.44, -.62, -.79][power - 1] : drop ? [-.15, -.32, -.51][power - 1] : [-.43, -.67, -.92][power - 1], endHeight: 0, bonus: 0, overhead: tap || airborne, fallback: requested === 'smash' && !tap, fallbackReason: requested === 'smash' && !tap && backhand ? 'backhand' : null };
  // Low contacts need enough lift to clear the net before the downward finish.
  if (contact && contact.y > 0) {
    const t = contact.y / (contact.y - shot.targetDepth);
    shot.arc = Math.max(shot.arc, (60 - contact.z * (1 - t)) / Math.sin(Math.PI * t));
  }
  return shot;
}
function planReturn(player, contact, requested, power, aimX, timeError = 0, incoming = null) {
  const shot = shotFor(player, contact, requested, power, incoming);
  // Early contact carries the shuttle deeper; late contact and an unsettled stance shorten it.
  const depthScale = shot.type === 'block' ? .075 : .16;
  const depth = shot.targetDepth + (contact.y - .65) * depthScale + timeError * .65 + clamp(player.pivot || 0, 0, 1) * .045;
  const target = { x: aimX, y: depth };
  let arc = shot.arc;
  if (target.y < 0 && contact.y > 0) {
    const t = contact.y / (contact.y - target.y);
    arc = Math.max(arc, (60 - contact.z * (1 - t)) / Math.sin(Math.PI * t));
  }
  if (!isHighShot(shot.type)) arc = Math.min(arc, ['drop', 'block'].includes(shot.type) ? 220 : ['tap', 'drive'].includes(shot.type) ? 120 : 70);
  if (!isHighShot(shot.type)) arc *= 1 - Math.max(0, timeError - .03) * .75 - clamp(player.pivot || 0, 0, 1) * .10;
  const ball = { returnFrom: { x: contact.x, y: contact.y }, returnTarget: target, returnHeight: contact.z, returnEndHeight: shot.endHeight, returnDuration: shot.duration, returnArc: arc };
  return { ...shot, target, arc, fault: returnFault(ball) };
}
function incomingPosition(ball) {
  const t = clamp(ball.age / ball.duration, 0, 1);
  return { x: ball.from.x + (ball.target.x - ball.from.x) * t,
    y: ball.from.y + (ball.target.y - ball.from.y) * t,
    z: (ball.fromHeight ?? 25) * (1 - t) + 25 * t + Math.sin(t * Math.PI) * (ball.flightArc ?? 195) };
}
function returnPosition(ball, age = ball.age) {
  const t = clamp(age / ball.returnDuration, 0, 1), from = ball.returnFrom, to = ball.returnTarget;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: ball.returnHeight * (1 - t) + ball.returnEndHeight * t + Math.sin(t * Math.PI) * ball.returnArc };
}
function returnFault(ball) {
  const from = ball.returnFrom, to = ball.returnTarget;
  if (to.y >= 0) return { type: 'net', age: ball.returnDuration, point: returnPosition(ball, ball.returnDuration) };
  if (from.y > 0) {
    const netAge = ball.returnDuration * from.y / (from.y - to.y);
    const crossing = returnPosition(ball, netAge);
    if (crossing.z < NET_HEIGHT) return { type: 'net', age: netAge, point: { ...crossing, y: 0 } };
  }
  if (to.x < SERVICE.sideline || to.x > 1 - SERVICE.sideline || to.y < -SERVICE.baseline) {
    return { type: 'out', age: ball.returnDuration, point: returnPosition(ball, ball.returnDuration) };
  }
  return null;
}
function difficulty(returns) {
  const level = 1 + Math.floor(returns / 5);
  return { level, flight: Math.max(1.05, 2.35 - (level - 1) * 0.14), gap: Math.max(0.38, 0.85 - (level - 1) * 0.045) };
}
function advanceFootwork(actor, dx, dy, dt, speed, bounds, targetScale = 1) {
  const direction = Math.hypot(dx, dy), oldX = actor.vx || 0, oldY = actor.vy || 0;
  const targetX = direction ? dx / direction * speed * targetScale : 0, targetY = direction ? dy / direction * speed * targetScale : 0;
  const turning = direction > 0 && Math.hypot(oldX, oldY) > .12 && oldX * targetX + oldY * targetY < -.02;
  const rate = (direction ? turning ? FOOTWORK.reversal : FOOTWORK.acceleration : FOOTWORK.braking) * speed / RULES.speed;
  const deltaX = targetX - oldX, deltaY = targetY - oldY, difference = Math.hypot(deltaX, deltaY);
  const reach = difference ? Math.min(dt, difference / rate) : 0;
  const fraction = difference ? reach * rate / difference : 0;
  const nextX = oldX + deltaX * fraction, nextY = oldY + deltaY * fraction;
  const travelX = (oldX + nextX) * .5 * reach + targetX * (dt - reach);
  const travelY = (oldY + nextY) * .5 * reach + targetY * (dt - reach);
  const x = actor.x + travelX, y = actor.y + travelY;
  actor.x = clamp(x, bounds.minX, bounds.maxX); actor.y = clamp(y, bounds.minY, bounds.maxY);
  actor.vx = x === actor.x ? nextX : 0; actor.vy = y === actor.y ? nextY : 0;
  actor.pivot = turning ? 1 : Math.max(0, (actor.pivot || 0) - dt * FOOTWORK.pivotRecovery);
  if (turning) { actor.plantX = dx / direction; actor.plantY = dy / direction; }
}
function movePlayer(player, dx, dy, dt) {
  advanceFootwork(player, dx, dy, dt, RULES.speed, { minX: .07, maxX: .93, minY: .08, maxY: .94 });
}
function makeDelivery(player, returns, random = Math.random) {
  const config = difficulty(returns);
  // Warm-up stays close; later feeds explore the full half-court.
  const spread = returns < 3 ? 0.22 : returns < 8 ? 0.40 : 0.68;
  const target = { x: clamp(player.x + (random() * 2 - 1) * spread, 0.12, 0.88), y: clamp(player.y + (random() * 2 - 1) * spread, 0.16, 0.86) };
  // Give every ball enough travel time for a reachable return, even at high levels.
  const travel = Math.hypot(target.x - player.x, target.y - player.y) / RULES.speed;
  const duration = Math.max(config.flight, travel + 0.55);
  return { target, duration, age: 0, from: { x: 0.5 + (random() - 0.5) * 0.35, y: -0.7 }, phase: 'incoming' };
}
// Feedback and hit grading share these checks, including the order of failure reasons.
function assessHit(player, delivery) {
  if (!delivery || delivery.phase !== 'incoming') return { grade: null, reason: 'no-ball' };
  if (delivery.from) {
    const point = incomingPosition(delivery);
    const distance = Math.hypot(player.x - point.x, player.y - point.y);
    const high = !isInterceptable(delivery), time = high ? delivery.age - contactTime(player, delivery) : 0;
    const reach = (high ? CONTACT.overheadHeight : CONTACT.lowHeight) + (player.height || 0);
    // Lateral reach remains available on both racket sides when the shuttle is
    // in front. An ellipse shrank that reach near its front edge, rejecting a
    // forehand beside a landing that admitted a backhand.
    const inReach = high ? Math.abs(point.x - player.x) <= RULES.radius
      && Math.abs(point.y - player.y + CONTACT.overheadForward) <= CONTACT.overheadDepth : distance <= RULES.radius;
    const reason = delivery.age > delivery.duration + RULES.late ? 'late' : point.y < .075 ? 'before-net' : high && time < -RULES.early ? 'early' : point.z > reach ? 'high' : !inReach ? 'far' : null;
    const perfect = distance <= RULES.perfectRadius && (high ? Math.abs(time) <= RULES.perfectTime : point.z <= 98 + (player.height || 0));
    return { point, distance, time, reach, reason, grade: reason ? null : perfect ? 'perfect' : 'good' };
  }
  const time = delivery.age - contactTime(player, delivery);
  const distance = Math.hypot(player.x - delivery.target.x, player.y - delivery.target.y);
  const reason = time > RULES.late ? 'late' : distance > RULES.radius ? 'far' : time < -RULES.early ? 'early' : null;
  return { point: delivery.target, distance, time, reason, grade: reason ? null : Math.abs(time) <= RULES.perfectTime && distance <= RULES.perfectRadius ? 'perfect' : 'good' };
}
function judgeHit(player, delivery) { return assessHit(player, delivery).grade; }
function assessJumpPreparation(player, delivery) {
  const future = { ...player, height: JUMP.velocity ** 2 / (2 * JUMP.gravity) - .5 * JUMP.gravity * SWING.impact ** 2, verticalVelocity: -JUMP.gravity * SWING.impact };
  const ball = { ...delivery, age: delivery.age + JUMP.velocity / JUMP.gravity + SWING.impact };
  const result = assessHit(future, ball);
  return { ...result, smash: Boolean(result.grade) && canPlayerSmash(future, result.point, ball) };
}
function pointsFor(grade, combo) { return (grade === 'perfect' ? 150 : 100) + Math.min(100, Math.floor(combo / 5) * 10); }
const MATCH_POINTS = Object.freeze([7, 15, 21]);
const MATCH_CAPS = Object.freeze({ 7: 11, 15: 21, 21: 30 });
const AI_LEVELS = Object.freeze({
  easy: Object.freeze({ speed: .82, reaction: .16, radius: .115, smashChance: .16, attackChance: .20, jumpChance: .18, driveChance: .16, flightDelay: 0, targetSide: .79, aimJitter: .09, strokeDelay: 0, paceScale: 1 }),
  normal: Object.freeze({ speed: 1.28, reaction: .045, radius: .13, smashChance: .38, attackChance: .34, jumpChance: .66, driveChance: .38, flightDelay: -.18, targetSide: .88, aimJitter: .025, strokeDelay: -.035, paceScale: 1.2, reachMargin: .16, pressureGain: .65, pressureRecovery: .95, composure: .65, earlyContact: true }),
  hard: Object.freeze({ speed: 1.45, reaction: .025, radius: .13, smashChance: .46, attackChance: .37, jumpChance: .78, driveChance: .46, flightDelay: -.21, targetSide: .90, aimJitter: .02, strokeDelay: -.05, paceScale: 1.3, reachMargin: .14, pressureGain: .50, pressureRecovery: 1.1, composure: .50, earlyContact: true })
});
const AI_STYLES = Object.freeze({
  balanced: Object.freeze({ name: 'Balanced', description: 'Mixes placement and attack from a central position.', smash: 1, attack: 1, jump: 1, drive: 1, baseOffset: 0, tempo: 0 }),
  attack: Object.freeze({ name: 'Attack', description: 'Takes the shuttle early and keeps the pressure on.', smash: 1.8, attack: 1.45, jump: 1.35, drive: 1.9, baseOffset: .075, tempo: -.07 }),
  defense: Object.freeze({ name: 'Defense', description: 'Stays deep and uses safe clears and lifts.', smash: .10, attack: .12, jump: .12, drive: .15, baseOffset: -.075, tempo: .09 }),
  rally: Object.freeze({ name: 'Rally', description: 'Alternates deep clears and drops to find an opening.', smash: .12, attack: .20, jump: .18, drive: .25, baseOffset: -.015, tempo: 0 })
});
const SERVICE = Object.freeze({ sideline: .075, shortLine: .29, baseline: 1, footMargin: .03 });
function serviceSetup(match) {
  const right = match[match.server] % 2 === 0;
  // Right/left is relative to each player facing the net, not the screen.
  const court = (side, screenRight) => ({ minX: screenRight ? .5 : SERVICE.sideline, maxX: screenRight ? 1 - SERVICE.sideline : .5, minY: side === 'player' ? SERVICE.shortLine : -SERVICE.baseline, maxY: side === 'player' ? SERVICE.baseline : -SERVICE.shortLine });
  const playerCourt = court('player', right), computerCourt = court('computer', !right);
  return { right, playerCourt, computerCourt, serverCourt: match.server === 'player' ? playerCourt : computerCourt, receiverCourt: match.server === 'player' ? computerCourt : playerCourt };
}
function inServiceCourt(point, court, feet = false) {
  const margin = feet ? SERVICE.footMargin : 0;
  return point.x >= court.minX + margin && point.x <= court.maxX - margin && point.y >= court.minY + margin && point.y <= court.maxY - margin;
}
function constrainToServiceCourt(player, court) {
  const m = SERVICE.footMargin;
  const x = clamp(player.x, court.minX + m, court.maxX - m), y = clamp(player.y, court.minY + m, court.maxY - m);
  if (x !== player.x) player.vx = 0;
  if (y !== player.y) player.vy = 0;
  player.x = x; player.y = y;
}
function serviceTarget(match, aim = .5, depth = .88) {
  const box = serviceSetup(match).receiverCourt;
  return { x: clamp(aim, box.minX + .06, box.maxX - .06), y: match.server === 'player' ? -clamp(depth, SERVICE.shortLine + .06, .94) : clamp(depth, SERVICE.shortLine + .06, .94) };
}
function planService(match, contact, requested = 'clear', aim = .5) {
  const short = requested !== 'clear', target = serviceTarget(match, aim, short ? .38 : .88);
  const shot = short ? { type: 'drop', power: 1, duration: .82, arc: 24, targetDepth: target.y, endHeight: 0, bonus: 0, overhead: false }
    : shotFor({ height: 0 }, contact, 'clear');
  const crossing = contact.y / (contact.y - target.y);
  const arc = Math.max(shot.arc, (NET_HEIGHT + 6 - contact.z * (1 - crossing)) / Math.sin(Math.PI * crossing));
  const ball = { returnFrom: contact, returnTarget: target, returnHeight: contact.z, returnEndHeight: 0, returnDuration: shot.duration, returnArc: arc };
  return { ...shot, arc, target, backhand: false, serviceKind: short ? 'short' : 'long', fault: returnFault(ball) };
}
function makeServiceDelivery(match, player, opponent, random = Math.random) {
  const target = serviceTarget(match, .22 + random() * .56, .65 + random() * .23);
  return { phase: 'incoming', service: true, from: { x: opponent.x, y: opponent.y }, fromHeight: 50, target, age: 0, duration: Math.max(2.1, Math.hypot(player.x - target.x, player.y - target.y) / RULES.speed + .55) };
}
function createMatch(target = 7) {
  if (!MATCH_POINTS.includes(target)) throw new RangeError('Match target must be 7, 15, or 21');
  return { target, cap: MATCH_CAPS[target], player: 0, computer: 0, server: 'computer', winner: null };
}
function awardPoint(match, winner) {
  if (winner !== 'player' && winner !== 'computer') throw new RangeError('Invalid point winner');
  if (match.winner) return false;
  match[winner]++; match.server = winner;
  if (match[winner] >= match.cap || (match[winner] >= match.target && match[winner] - match[winner === 'player' ? 'computer' : 'player'] >= 2)) match.winner = winner;
  return true;
}
function createOpponent(level = 'normal', style = 'balanced') {
  if (!AI_LEVELS[level]) level = 'normal';
  if (!AI_STYLES[style]) style = 'balanced';
  return { x: .5, y: -.65, vx: 0, vy: 0, pivot: 0, plantX: 0, plantY: 0, reaction: 0, strokeRecovery: 0, pressure: 0, chaseDistance: 0, intent: 'recover', moved: 0, height: 0, verticalVelocity: 0, jumpRecovery: 0, level, style, skill: AI_LEVELS[level] };
}
function moveOpponent(opponent, target, dt) {
  const startX = opponent.x, startY = opponent.y, speedLimit = opponent.skill?.speed ?? AI_LEVELS.normal.speed, bounds = { minX: .08, maxX: .92, minY: -.94, maxY: -.08 };
  const wait = Math.min(dt, Math.max(opponent.reaction || 0, opponent.strokeRecovery || 0));
  opponent.reaction = Math.max(0, (opponent.reaction || 0) - dt);
  opponent.strokeRecovery = Math.max(0, (opponent.strokeRecovery || 0) - dt); dt -= wait;
  if (wait) advanceFootwork(opponent, 0, 0, wait, speedLimit, bounds);
  if (dt > 0) {
    const dx = target.x - opponent.x, dy = target.y - opponent.y, distance = Math.hypot(dx, dy);
    const speed = distance < .06 ? Math.max(0, distance / .06) : 1;
    advanceFootwork(opponent, dx, dy, dt, speedLimit, bounds, speed);
    if (distance > 0 && (target.x - startX) * (target.x - opponent.x) + (target.y - startY) * (target.y - opponent.y) <= 0) {
      opponent.x = clamp(target.x, bounds.minX, bounds.maxX); opponent.y = clamp(target.y, bounds.minY, bounds.maxY);
      opponent.vx = opponent.vy = opponent.pivot = 0;
    }
  }
  opponent.moved = Math.hypot(opponent.x - startX, opponent.y - startY);
  if (opponent.intent === 'chase') {
    opponent.chaseDistance += opponent.moved;
    opponent.pressure = clamp(opponent.pressure + opponent.moved * .55 * (opponent.skill?.pressureGain ?? 1), 0, 1);
  }
}
function opponentBase(ball, opponent = null) {
  const type = ball?.incomingType;
  const offset = AI_STYLES[opponent?.style]?.baseOffset ?? 0;
  return { x: clamp(.5 + ((ball?.target?.x ?? .5) - .5) * .16, .38, .62), y: (isHighShot(type) ? -.57 : ['drop', 'block'].includes(type) ? -.39 : -.49) + offset };
}
function recoverOpponent(opponent, ball, dt) {
  opponent.intent = 'recover';
  moveOpponent(opponent, opponentBase(ball, opponent), dt);
  opponent.pressure = Math.max(0, opponent.pressure - dt * (opponent.skill?.pressureRecovery ?? .65));
}
function opponentShotQuality(opponent, contact) {
  const speed = Math.hypot(opponent.vx || 0, opponent.vy || 0) / (opponent.skill?.speed ?? .82);
  const corner = Math.max(0, Math.abs(opponent.x - .5) - .23) / .19;
  const reach = contact ? Math.hypot(opponent.x - contact.x, opponent.y - contact.y) : 0;
  const composure = opponent.skill?.composure ?? 1;
  // Experience helps with movement and sustained pressure, but a sharp pivot
  // still forces a defensive stroke at every level.
  return clamp(1 - speed * .15 * composure - (opponent.pivot || 0) * .38 - corner * .16 - Math.min(.12, Math.max(0, reach - .065) * 2) - (opponent.pressure || 0) * .18 * composure, .35, 1);
}
function opponentContactAge(ball, opponent = null, jumping = false) {
  if (ball.returnFrom && isHighShot(ball.shotType) && opponent?.skill?.earlyContact) {
    const reach = CONTACT.overheadHeight + (jumping ? JUMP.velocity ** 2 / (2 * JUMP.gravity) * .92 : 0);
    // Descending high balls can be intercepted before the old landing window.
    // This only plans a time: actual height, proximity and readiness still gate contact.
    for (let i = 50; i <= 100; i++) {
      const age = ball.returnDuration * i / 100, point = returnPosition(ball, age);
      if (point.y <= -.08 && point.z <= reach) return age;
    }
    return ball.returnDuration;
  }
  if (!ball.returnFrom || isHighShot(ball.shotType)) return Math.max(0, ball.returnDuration - .18);
  for (let i = 0; i <= 100; i++) {
    const age = ball.returnDuration * i / 100, point = returnPosition(ball, age);
    if (point.y <= -.08 && point.z <= 110) return age;
  }
  return ball.returnDuration;
}
function opponentIntercept(ball, opponent = null) {
  if (!ball.returnFrom) return ball.returnTarget;
  const age = opponent ? clamp(ball.age + (isHighShot(ball.shotType) ? .04 : Math.max(.13, opponent.reaction || 0)), opponentContactAge(ball, opponent, opponent.height > 0), ball.returnDuration) : opponentContactAge(ball);
  const point = returnPosition(ball, age);
  return { x: point.x, y: point.y };
}
function shouldOpponentJump(opponent, ball, random = Math.random) {
  if ((opponent.reaction || 0) > 0 || (opponent.strokeRecovery || 0) > 0) return false;
  if (ball.phase !== 'return' || !isHighShot(ball.shotType) || !ball.returnFrom || opponent.height > 0 || opponent.jumpRecovery > 0 || (opponent.pivot || 0) >= .45) return false;
  const contact = returnPosition(ball, opponentContactAge(ball, opponent, true)), point = { x: contact.x, y: contact.y };
  const peak = { ...opponent, height: JUMP.velocity ** 2 / (2 * JUMP.gravity), verticalVelocity: 0 };
  return canSmash(peak, contact) && Math.hypot(opponent.x - point.x, opponent.y - point.y) <= .28
    && random() < (opponent.skill?.jumpChance ?? AI_LEVELS.normal.jumpChance) * (AI_STYLES[opponent.style]?.jump ?? 1);
}
function opponentCanHit(opponent, ball) {
  if ((opponent.reaction || 0) > 0 || (opponent.strokeRecovery || 0) > 0) return false;
  if (ball.phase !== 'return') return false;
  if (ball.returnFrom && !isHighShot(ball.shotType)) {
    if (ball.age < opponentContactAge(ball, opponent) || ball.age > ball.returnDuration) return false;
    const point = returnPosition(ball);
    return point.y <= -.08 && point.z <= 110 + (opponent.height || 0) && Math.hypot(opponent.x - point.x, opponent.y - point.y) <= (opponent.skill?.radius ?? AI_LEVELS.normal.radius);
  }
  const point = ball.returnFrom ? returnPosition(ball) : opponentIntercept(ball);
  // Do not waste a planned jump on an immediate rising-phase clear. Near the
  // apex it can attack; on descent it can still make a legal defensive return.
  if (opponent.height > 0 && opponent.verticalVelocity > 145) return false;
  return ball.age >= opponentContactAge(ball, opponent, opponent.height > 0) && ball.age <= ball.returnDuration && point.y <= -.075 && (point.z ?? 0) <= CONTACT.overheadHeight + (opponent.height || 0) && Math.hypot(opponent.x - point.x, opponent.y - point.y) <= (opponent.skill?.radius ?? AI_LEVELS.normal.radius);
}
function advanceOpponentReturn(opponent, ball, dt, random = Math.random) {
  if (ball.phase !== 'return' || ball.fault) return { jumped: false, hit: false };
  moveOpponent(opponent, opponentIntercept(ball, opponent), dt);
  const lead = opponentContactAge(ball, opponent, true) - ball.age;
  let jumped = false;
  if (!ball.opponentJumpDecided && lead <= .34 && lead >= .23 && opponent.reaction === 0 && opponent.strokeRecovery === 0 && opponent.jumpRecovery === 0 && opponent.height === 0) {
    ball.opponentJumpDecided = true;
    jumped = shouldOpponentJump(opponent, ball, random) && startJump(opponent);
  }
  return { jumped, hit: opponentCanHit(opponent, ball) };
}
function chooseMatchShot(player, opponent, contact, receivedType = 'clear', random = Math.random) {
  const skill = opponent.skill ?? AI_LEVELS.normal, roll = random();
  const style = AI_STYLES[opponent.style] ?? AI_STYLES.balanced;
  const quality = opponentShotQuality(opponent, contact);
  const canAttack = quality >= .68 && isHighShot(receivedType) && (contact?.z ?? 0) >= 70 && (opponent.pivot || 0) < .45;
  const canStandSmash = canAttack && !(opponent.height > 0 || opponent.verticalVelocity > 0);
  const lowDefense = ['tap', 'smash', 'drive'].includes(receivedType) && contact && contact.z <= 90 + (opponent.height || 0);
  let type;
  const chasedForward = ['drop', 'block'].includes(opponent.lastShotType) && (opponent.lastPlayerY ?? player.y) - player.y >= .18;
  const chasedBack = isHighShot(opponent.lastShotType) && player.y - (opponent.lastPlayerY ?? player.y) >= .18;
  if (quality < .58) type = 'lift';
  else if (lowDefense) {
    const driveChance = (skill.driveChance ?? AI_LEVELS.normal.driveChance) * style.drive;
    if (contact.z >= 52 && roll < driveChance) type = 'drive';
    else if (opponent.style === 'defense') type = roll < .88 ? 'lift' : 'block';
    else if (player.y <= .42) type = roll < .80 ? 'lift' : 'block';
    else if (player.y >= .58) type = roll < .70 ? 'block' : 'lift';
    else type = roll < .55 ? 'block' : 'lift';
  }
  else if (canAttack && canSmash(opponent, contact)) type = 'jumpSmash';
  else if (canStandSmash && roll < skill.smashChance * style.smash) type = 'smash';
  else if (canAttack && roll < skill.smashChance * style.smash + skill.attackChance * style.attack) type = 'attack';
  else if (opponent.style === 'defense') type = roll < .92 ? 'clear' : 'drop';
  else if (player.y >= .58) type = roll < (opponent.style === 'rally' ? .90 : chasedBack ? .87 : .72) ? 'drop' : 'clear';
  else if (player.y <= .42) type = roll < (opponent.style === 'rally' ? .90 : chasedForward ? .87 : .72) ? 'clear' : 'drop';
  else if (opponent.style === 'rally' && (chasedForward || chasedBack)) type = roll < .85 ? (chasedForward ? 'clear' : 'drop') : (chasedForward ? 'drop' : 'clear');
  else if (opponent.style === 'rally') type = roll < .90 ? (isHighShot(opponent.lastShotType) ? 'drop' : 'clear') : (isHighShot(opponent.lastShotType) ? 'clear' : 'drop');
  else type = roll < .52 ? 'clear' : 'drop';
  // Low net contacts use an underhand lift or block instead of an overhead stroke.
  if (!isHighShot(receivedType) && (contact?.z ?? 100) <= 75) {
    if (type === 'clear') type = 'lift';
    else if (type === 'drop') type = 'block';
  }
  const right = skill.targetSide, left = 1 - right;
  const side = player.x < .44 ? right : player.x > .56 ? left : random() < .5 ? left : right;
  const x = clamp(side + (random() - .5) * skill.aimJitter, .12, .88);
  const deepStyle = ['defense', 'rally'].includes(opponent.style);
  let y = isHighShot(type) ? (deepStyle ? .83 : .77) + random() * (deepStyle ? .10 : .13) : type === 'block' ? .18 + random() * .12 : type === 'drop' ? (opponent.style === 'rally' ? .17 : .20) + random() * .13 : type === 'drive' ? .48 + random() * .16 : type === 'jumpSmash' ? .46 + random() * .14 : type === 'smash' ? .45 + random() * .15 : .39 + random() * .15;
  return { type, target: { x, y } };
}
function makeMatchDelivery(player, opponent, rally, contact = null, random = Math.random, receivedType = 'clear') {
  const choice = chooseMatchShot(player, opponent, contact, receivedType, random);
  const quality = opponentShotQuality(opponent, contact), weakness = 1 - quality;
  choice.target.x += (.5 - choice.target.x) * weakness * .4;
  if (isHighShot(choice.type)) choice.target.y -= weakness * .20;
  else if (['drop', 'block'].includes(choice.type)) choice.target.y += weakness * .12;
  const travel = Math.hypot(player.x - choice.target.x, player.y - choice.target.y) / RULES.speed;
  const base = choice.type === 'lift' ? 1.85 : choice.type === 'block' ? 1.12 : choice.type === 'drive' ? .92 : choice.type === 'clear' ? 1.58 : choice.type === 'drop' ? 1.18 : choice.type === 'attack' ? 1.04 : choice.type === 'smash' ? .98 : .90;
  const margin = isHighShot(choice.type) ? .52 : ['drop', 'block'].includes(choice.type) ? .48 : choice.type === 'attack' ? .40 : choice.type === 'smash' ? .36 : .34;
  const pace = Math.min(.12, Math.max(0, rally - 1) * .012) * (opponent.skill?.paceScale ?? 1);
  const flightDelay = (opponent.skill?.flightDelay ?? 0) + (AI_STYLES[opponent.style]?.tempo ?? 0);
  const reachMargin = opponent.skill?.reachMargin ?? .28;
  const ball = { phase: 'incoming', age: 0, from: contact ? { x: contact.x, y: contact.y } : { x: opponent.x, y: opponent.y }, fromHeight: contact?.z ?? 25, target: choice.target, incomingType: choice.type, flightArc: choice.type === 'lift' ? 245 : choice.type === 'block' ? 26 : choice.type === 'drive' ? 24 : choice.type === 'clear' ? 205 : choice.type === 'drop' ? 108 : choice.type === 'attack' ? 68 : choice.type === 'smash' ? 16 : 14, duration: Math.max(base - pace + flightDelay, travel + Math.max(reachMargin, margin - pace * .5 + flightDelay)) };
  if (opponent.style === 'defense' && isHighShot(choice.type)) ball.flightArc += 30;
  ball.quality = quality; ball.duration += weakness * .30;
  if (!['smash', 'jumpSmash'].includes(choice.type)) ball.flightArc += weakness * 28;
  if (['lift', 'block', 'drive'].includes(choice.type) && ball.from.y < 0) {
    const crossing = -ball.from.y / (ball.target.y - ball.from.y);
    const height = ball.fromHeight * (1 - crossing) + 25 * crossing;
    ball.flightArc = Math.max(ball.flightArc, (60 - height) / Math.sin(Math.PI * crossing));
  }
  opponent.lastShotType = choice.type; opponent.lastPlayerY = player.y;
  return ball;
}
const TRAINING = Object.freeze({ jump: 'Jump smash', net: 'Net Intercept', defense: 'Smash Defense' });
const TRAINING_SPEEDS = Object.freeze({ slow: 1.2, normal: 1, fast: .84 });
const TRAINING_ERRORS = Object.freeze({ position: 'Position', timing: 'Timing', height: 'Height', shot: 'Shot choice', out: 'Out', net: 'Net' });
function createTrainingSession(kind = 'jump', speed = 'normal', limit = 20) {
  if (!TRAINING[kind] || !TRAINING_SPEEDS[speed] || ![0, 20].includes(limit)) throw new RangeError('Invalid training configuration');
  return { kind, speed, limit, completed: 0, succeeded: 0, legalReturns: 0, streak: 0, bestStreak: 0, feedIndex: 0, errors: Object.fromEntries(Object.keys(TRAINING_ERRORS).map(key => [key, 0])) };
}
function makeTrainingDelivery(session) {
  const i = session.feedIndex % 3, multiplier = TRAINING_SPEEDS[session.speed];
  const common = { phase: 'incoming', age: 0, trainingRecorded: false };
  if (session.kind === 'jump') {
    const duration = 2 * multiplier;
    const lead = .56 - JUMP.velocity / JUMP.gravity - SWING.impact;
    // Keep continuous flight and calibrate absolute shuttle height, without
    // the extra jump-height compensation added for the 3D character.
    const flightArc = (110 - 25) / Math.sin(Math.PI * lead / duration);
    return { ...common, start: { x: .5, y: .65 }, from: { x: .5, y: -.7 }, fromHeight: 25,
      target: { x: [.5, .66, .34][i], y: .72 }, incomingType: 'clear', flightArc, duration };
  }
  if (session.kind === 'net') return { ...common, start: { x: .5, y: .43 }, from: { x: [.5, .28, .72][i], y: -.35 }, fromHeight: 55, target: { x: [.5, .28, .72][i], y: .58 }, incomingType: 'block', flightArc: 50, duration: 1.55 * multiplier };
  return { ...common, start: { x: .5, y: .58 }, from: { x: [.5, .30, .70][i], y: -.65 }, fromHeight: 130, target: { x: [.5, .30, .70][i], y: .56 }, incomingType: ['smash', 'attack', 'jumpSmash'][i], flightArc: 14, duration: 1.1 * multiplier };
}
function recordTrainingOutcome(session, outcome) {
  if (session.limit && session.completed >= session.limit) return null;
  let error = null;
  const legal = Boolean(outcome.shotType && !outcome.fault);
  if (outcome.fault) error = outcome.fault.type === 'out' ? 'out' : 'net';
  else if (!legal) error = outcome.missReason === 'far' ? 'position' : outcome.missReason === 'high' ? 'height' : 'timing';
  else if (session.kind === 'jump' && outcome.shotType !== 'smash') error = 'shot';
  else if (session.kind === 'net' && outcome.age > outcome.duration - .18) error = 'timing';
  else if (session.kind === 'defense' && !['lift', 'block', 'drive'].includes(outcome.shotType)) error = 'shot';
  session.completed++; if (legal) session.legalReturns++;
  if (error) { session.errors[error]++; session.streak = 0; }
  else { session.succeeded++; session.feedIndex++; session.streak++; session.bestStreak = Math.max(session.bestStreak, session.streak); }
  return { success: !error, error };
}
function trainingAdvice(session) {
  const worst = Object.keys(TRAINING_ERRORS).sort((a, b) => session.errors[b] - session.errors[a])[0];
  if (!session.completed) return 'No completed feeds yet. Follow the contact ring when you start.';
  if (!session.errors[worst]) return 'All goals met! Try a faster pace and stay consistent.';
  return { position: 'Move to the contact ring before swinging. Start early for wide shots.', timing: session.kind === 'net' ? 'Intercept after the shuttle crosses the net; do not wait for it to land.' : session.kind === 'jump' ? 'Jump on the cue, then right click near the apex.' : 'Follow the solid ring and return the shuttle within reach.', height: 'Wait for high shuttles to drop, or jump to reach them.', shot: session.kind === 'jump' ? 'Space to jump, then right click on the smash cue. Only jump smashes meet this goal.' : 'Defend with a left-click lift, Shift + left block, or low right-click drive.', out: 'Aim within the singles lines and reduce power if shots go long.', net: 'Settle your footing or left click to lift over the net.' }[worst];
}
globalThis.ShuttleCore = Object.freeze({ clamp, RULES, FOOTWORK, JUMP, SWING, POWER, NET_HEIGHT, CONTACT, BACKHAND, createPlayer, startJump, updateJump, contactTime, contactTimingError, isHighShot, isInterceptable, canSmash, isBackhand, canBackhandAttack, canPlayerSmash, aimHorizontal, defaultPowerFor, shotFor, planReturn, incomingPosition, returnPosition, returnFault, difficulty, movePlayer, makeDelivery, assessHit, judgeHit, assessJumpPreparation, pointsFor, MATCH_POINTS, SERVICE, AI_LEVELS, AI_STYLES, serviceSetup, inServiceCourt, constrainToServiceCourt, serviceTarget, planService, makeServiceDelivery, createMatch, awardPoint, createOpponent, moveOpponent, recoverOpponent, opponentBase, opponentShotQuality, opponentContactAge, opponentIntercept, shouldOpponentJump, opponentCanHit, advanceOpponentReturn, chooseMatchShot, makeMatchDelivery, TRAINING, TRAINING_SPEEDS, TRAINING_ERRORS, createTrainingSession, makeTrainingDelivery, recordTrainingOutcome, trainingAdvice });
})();
