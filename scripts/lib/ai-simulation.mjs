// Uses the same footwork, return planner and per-frame AI decision as game.js.
// The scripted player is a reproducible probe, not a model of human skill.
export function seededRandom(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
export function stepReturn(core, actor, ball, dt, random) {
  if (core.advanceOpponentReturn) return core.advanceOpponentReturn(actor, ball, dt, random);
  // Previous packaged game, used only for the before/after comparison.
  core.moveOpponent(actor, core.opponentIntercept(ball, actor), dt);
  const lead = core.opponentContactAge(ball) - ball.age;
  let jumped = false;
  if (!ball.opponentJumpDecided && lead <= .31) {
    ball.opponentJumpDecided = true;
    jumped = lead >= .23 && core.shouldOpponentJump(actor, ball, random) && core.startJump(actor);
  }
  return { jumped, hit: core.opponentCanHit(actor, ball) };
}
export function pursuitProbe(core, level, style) {
  let tested = 0, returned = 0, jumps = 0;
  const shots = {}, random = seededRandom(104729);
  for (const x of [.12, .5, .88]) for (const y of [-.25, -.6, -.92]) for (const duration of [.45, .65, .85, 1.2, 1.6]) for (const type of ['clear', 'drop', 'drive']) {
    const actor = core.createOpponent(level, style);
    actor.reaction = actor.skill.reaction; actor.intent = 'chase';
    const ball = { phase: 'return', shotType: type, age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x, y }, returnHeight: 85, returnEndHeight: 0, returnArc: type === 'clear' ? 215 : type === 'drop' ? 60 : 35, returnDuration: duration };
    if (core.returnFault(ball)) throw new Error('Probe must use legal returns');
    tested++;
    for (let frame = 1; frame / 240 <= duration; frame++) {
      ball.age = frame / 240; core.updateJump(actor, 1 / 240);
      const action = stepReturn(core, actor, ball, 1 / 240, random);
      if (action.jumped) jumps++;
      if (action.hit) {
        returned++;
        const contact = core.returnPosition(ball);
        const next = core.makeMatchDelivery({ x: .5, y: .65 }, actor, 4, contact, random, type);
        shots[next.incomingType] = (shots[next.incomingType] || 0) + 1;
        break;
      }
    }
  }
  return { tested, returned, returnRate: returned / tested, jumps, shots };
}
export function smashDefenseProbe(core, level, style = 'balanced', rate = 120) {
  const totals = { tap: { tested: 0, returned: 0 }, smash: { tested: 0, returned: 0 } };
  const starts = [[.5, -.55], [.5, -.82], [.22, -.65], [.78, -.65], [.5, -.27]];
  const random = seededRandom(32771), dt = 1 / rate;
  let skippedFaults = 0, maximumReach = 0, netMinimum = Infinity;
  for (const x of [.2, .5, .8]) for (const y of [.4, .65, .85]) for (const aim of [.12, .3, .5, .7, .88]) for (const power of [1, 2, 3]) for (const jumping of [false, true]) {
    const player = { ...core.createPlayer(), x, y, height: jumping ? 55 : 0 };
    const contact = { x, y, z: jumping ? 145 : 95 };
    const plan = core.planReturn(player, contact, 'smash', power, aim);
    if (plan.fault) { skippedFaults++; continue; }
    if (!['tap', 'smash'].includes(plan.type)) throw new Error('Smash probe must use actual player attacks');
    for (const [startX, startY] of starts) for (const moving of [false, true]) {
      const actor = core.createOpponent(level, style);
      Object.assign(actor, { x: startX, y: startY, vx: moving ? (startX < .5 ? -.35 : .35) : 0, reaction: actor.skill.reaction, intent: 'chase' });
      const ball = { phase: 'return', shotType: plan.type, age: 0, returnFrom: contact, returnTarget: plan.target, returnHeight: contact.z, returnEndHeight: plan.endHeight, returnArc: plan.arc, returnDuration: plan.duration };
      totals[plan.type].tested++;
      for (let frame = 1; frame * dt <= ball.returnDuration; frame++) {
        ball.age = frame * dt; core.updateJump(actor, dt);
        if (!stepReturn(core, actor, ball, dt, random).hit) continue;
        const point = core.returnPosition(ball);
        maximumReach = Math.max(maximumReach, Math.hypot(actor.x - point.x, actor.y - point.y));
        if (point.y > -.08 || point.z > 110 + actor.height || actor.reaction > 0 || actor.strokeRecovery > 0) throw new Error('Illegal AI smash contact');
        const reply = core.makeMatchDelivery(player, actor, 3, point, random, plan.type);
        const age = reply.duration * -reply.from.y / (reply.target.y - reply.from.y);
        netMinimum = Math.min(netMinimum, core.incomingPosition({ ...reply, age }).z);
        totals[plan.type].returned++; break;
      }
    }
  }
  for (const result of Object.values(totals)) result.returnRate = result.returned / result.tested;
  return { totals, skippedFaults, maximumReach, netMinimum };
}
export function rallyProbe(core, level, style, points = 80) {
  const random = seededRandom(65537), dt = 1 / 120, shots = {};
  let computerPoints = 0, playerPoints = 0, capped = 0, returns = 0, jumps = 0, jumpSmashes = 0;
  let totalDuration = 0, front = 0, back = 0, deepTransitions = 0, consecutiveDeep = 0, netMinimum = Infinity;
  for (let point = 0; point < points; point++) {
    const actor = core.createOpponent(level, style), player = core.createPlayer();
    // Every point starts with the same legal player return, alternately clear/drop/drive.
    const type = ['clear', 'drop', 'drive'][point % 3];
    let ball = { phase: 'return', shotType: type, age: 0, returnFrom: { x: .5, y: .6 }, returnTarget: { x: point % 2 ? .28 : .72, y: type === 'clear' ? -.86 : type === 'drop' ? -.24 : -.65 }, returnHeight: 85, returnEndHeight: 0, returnArc: type === 'clear' ? 215 : type === 'drop' ? 60 : 35, returnDuration: type === 'clear' ? 1.3 : type === 'drop' ? .7 : .58 };
    actor.intent = 'chase'; actor.reaction = actor.skill.reaction;
    let rallies = 0, elapsed = 0, playerWait = 0, lastDeep = null;
    while (elapsed < 90 && rallies < 40) {
      elapsed += dt; ball.age += dt; core.updateJump(actor, dt);
      if (ball.phase === 'return') {
        // Player regains the central base while watching their outgoing return.
        const dx = .5 - player.x, dy = .58 - player.y;
        core.movePlayer(player, Math.abs(dx) > .025 ? dx : 0, Math.abs(dy) > .025 ? dy : 0, dt);
        if (ball.fault && ball.age >= ball.fault.age) { computerPoints++; break; }
        const action = stepReturn(core, actor, ball, dt, random);
        if (action.jumped) jumps++;
        if (action.hit) {
          const received = ball.shotType, contact = core.returnPosition(ball);
          ball = core.makeMatchDelivery(player, actor, ++rallies, contact, random, received);
          shots[ball.incomingType] = (shots[ball.incomingType] || 0) + 1; returns++;
          if (ball.incomingType === 'jumpSmash') jumpSmashes++;
          totalDuration += ball.duration;
          if (ball.target.y < .4) front++;
          if (ball.target.y > .75) back++;
          if (['clear', 'lift', 'drop', 'block'].includes(ball.incomingType)) {
            const deep = core.isHighShot(ball.incomingType);
            if (lastDeep !== null) { consecutiveDeep++; if (deep !== lastDeep) deepTransitions++; }
            lastDeep = deep;
          } else lastDeep = null;
          const crossAge = ball.duration * -ball.from.y / (ball.target.y - ball.from.y);
          netMinimum = Math.min(netMinimum, core.incomingPosition({ ...ball, age: crossAge }).z);
          actor.strokeRecovery = .13 + (actor.skill.strokeDelay ?? 0) + (1 - ball.quality) * .22 + (['smash', 'jumpSmash'].includes(ball.incomingType) ? .08 : 0);
          actor.reaction = 0; playerWait = .18;
        } else if (ball.age > ball.returnDuration + .09) { playerPoints++; break; }
      } else {
        core.recoverOpponent(actor, ball, dt);
        playerWait = Math.max(0, playerWait - dt);
        const target = ball.target;
        const dx = target.x - player.x, dy = target.y - player.y;
        core.movePlayer(player, playerWait === 0 && Math.abs(dx) > .025 ? dx : 0, playerWait === 0 && Math.abs(dy) > .025 ? dy : 0, dt);
        const hit = core.assessHit(player, ball);
        if (hit.grade && (core.isInterceptable(ball) || hit.time >= -.03)) {
          const roll = random(), requested = roll < .45 ? 'clear' : roll < .8 ? 'drop' : 'smash';
          const plan = core.planReturn(player, hit.point, requested, requested === 'drop' ? 1 : 3, actor.x > .5 ? .14 : .86, hit.time, ball);
          ball = { phase: 'return', age: 0, shotType: plan.type, returnFrom: { x: hit.point.x, y: hit.point.y }, returnHeight: hit.point.z, returnTarget: plan.target, returnEndHeight: plan.endHeight, returnArc: plan.arc, returnDuration: plan.duration, fault: plan.fault };
          actor.reaction = actor.skill.reaction; actor.intent = 'chase'; actor.chaseDistance = 0;
        } else if (ball.age > ball.duration + core.RULES.late) { computerPoints++; break; }
      }
    }
    if (rallies >= 40 || elapsed >= 90) capped++;
  }
  return { points, computerPoints, playerPoints, capped, returns, jumps, jumpSmashes, shots, meanFlight: totalDuration / Math.max(1, returns), front, back, alternationRate: deepTransitions / Math.max(1, consecutiveDeep), netMinimum };
}
