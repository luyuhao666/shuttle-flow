(() => {
  'use strict';
  const { makeDelivery, SERVICE } = globalThis.ShuttleCore;
  const kinds = Object.freeze({ mixed: 'All targets', deep: 'Deep targets', net: 'Net targets' });
  const depths = Object.freeze({ net: [-.36, -.08], middle: [-.72, -.40], deep: [-.98, -.73] });
  const sequence = ['net-left', 'deep-right', 'middle-left', 'net-right', 'deep-left', 'middle-right'];
  const zones = Object.freeze(Object.fromEntries(sequence.map(id => {
    const [depth, side] = id.split('-'), [minY, maxY] = depths[depth];
    const [minX, maxX] = side === 'left' ? [.16, .40] : [.60, .84];
    return [id, Object.freeze({ id, depth, name: `${side === 'left' ? 'Left ' : 'Right '}${{ net: 'Net', middle: 'Midcourt', deep: 'Deep' }[depth]}`, minX, maxX, minY, maxY,
      x: (minX + maxX) / 2, y: (minY + maxY) / 2 })];
  })));
  function createSession(kind = 'mixed', limit = 20) {
    if (!Object.hasOwn(kinds, kind) || ![0, 20].includes(limit)) throw new RangeError('Invalid landing challenge');
    return { kind, limit, completed: 0, hits: 0, centers: 0, score: 0, streak: 0, bestStreak: 0,
      errors: { miss: 0, target: 0, out: 0, net: 0 }, byZone: Object.fromEntries(sequence.map(id => [id, { attempts: 0, hits: 0 }])) };
  }
  function targetFor(session) {
    const choices = sequence.filter(id => session.kind === 'mixed' || zones[id].depth === session.kind);
    return zones[choices[session.completed % choices.length]];
  }
  function contains(zone, point, scale = 1) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y)
      && Math.abs(point.x - zone.x) <= (zone.maxX - zone.minX) * scale / 2 + 1e-10
      && Math.abs(point.y - zone.y) <= (zone.maxY - zone.minY) * scale / 2 + 1e-10;
  }
  function judgeLanding(zone, outcome) {
    const point = outcome.point;
    const error = outcome.fault ? outcome.fault.type === 'out' ? 'out' : 'net'
      : !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ? 'miss'
      : point.y >= 0 ? 'net'
      : point.x < SERVICE.sideline || point.x > 1 - SERVICE.sideline || point.y < -SERVICE.baseline ? 'out'
      : !contains(zone, point) ? 'target' : null;
    const center = !error && contains(zone, point, .5);
    return { success: !error, center, error, points: error ? 0 : center ? 150 : 100 };
  }
  function recordOutcome(session, zone, outcome) {
    if ((session.limit && session.completed >= session.limit) || zone.id !== targetFor(session).id) return null;
    const result = judgeLanding(zone, outcome);
    session.completed++; session.byZone[zone.id].attempts++;
    if (result.success) {
      session.hits++; session.byZone[zone.id].hits++; session.streak++; session.score += result.points;
      if (result.center) session.centers++;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
    } else { session.errors[result.error]++; session.streak = 0; }
    return result;
  }
  function makeFeed(player, session, random = Math.random) {
    // Reuse the original warm-up flight and hit rules; challenge feeds never accelerate.
    return { ...makeDelivery(player, 0, random), challengeTarget: targetFor(session), challengeRecorded: false };
  }
  function advice(session) {
    if (!session.completed) return 'Aim left or right; use shot type and power to control depth.';
    const worst = Object.keys(session.errors).sort((a, b) => session.errors[b] - session.errors[a])[0];
    if (!session.errors[worst]) return 'Consistent placement. Now aim for the center.';
    return { miss: 'Move to the contact ring and swing within reach.', target: 'Try a strong clear for deep targets or a light drop at the net.', out: 'Aim inside the singles lines. Reduce power for long shots.', net: 'Settle your footing; left click to lift a low shuttle.' }[worst];
  }
  globalThis.ShuttleTargets = Object.freeze({ kinds, zones, createSession, targetFor, contains, judgeLanding, recordOutcome, makeFeed, advice });
})();
