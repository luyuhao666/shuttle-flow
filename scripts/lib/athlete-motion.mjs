// Animation authoring in world space. +Z is forward: knees bend forward,
// elbows stay outside the chest, and support shoes stay on the floor.
import * as THREE from 'three';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const smooth = x => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const lerp = THREE.MathUtils.lerp;
const Q = euler => new THREE.Quaternion().setFromEuler(new THREE.Euler(...euler, 'XYZ'));
const SIDES = [['Right', -1], ['Left', 1]];

// Solve rotations only: both limb lengths and all bone offsets remain constant.
export function solveLimb(upper, lower, end, target, pole, restPositions) {
  const anchor = upper.getWorldPosition(V(0, 0));
  const upperVector = restPositions[lower.name], lowerVector = restPositions[end.name];
  const l1 = upperVector.length(), l2 = lowerVector.length();
  const direction = target.clone().sub(anchor);
  const reach = THREE.MathUtils.clamp(direction.length(), Math.abs(l1 - l2) + .001, l1 + l2 - .0005);
  direction.normalize();
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
  const joint = anchor.clone().addScaledVector(direction, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  const parentQuaternion = upper.parent.getWorldQuaternion(new THREE.Quaternion());
  const first = joint.clone().sub(anchor).normalize().applyQuaternion(parentQuaternion.clone().invert());
  upper.quaternion.setFromUnitVectors(upperVector.clone().normalize(), first);
  upper.updateWorldMatrix(true, true);
  const endpoint = anchor.clone().addScaledVector(direction, reach);
  const second = endpoint.sub(lower.getWorldPosition(V(0, 0))).normalize()
    .applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
  lower.quaternion.setFromUnitVectors(lowerVector.clone().normalize(), second);
  lower.updateWorldMatrix(true, true);
}

export function shoeSupportHeight(quaternion) {
  // The actual sole is an ellipsoid centred at (0,-.065,.065) from the ankle.
  // Its lowest transformed point keeps a pitched/yawed planted shoe above the floor.
  const up = V(0, 1).applyQuaternion(quaternion.clone().invert());
  const lowest = V(0, -.065, .065).dot(up)
    - Math.hypot(.055 * up.x, .032 * up.y, .139 * up.z);
  return .002 - lowest;
}

export function createAthleteAnimations(bones) {
  const names = Object.keys(bones);
  const restPositions = Object.fromEntries(names.map(name => [name, bones[name].position.clone()]));
  const restQuaternions = Object.fromEntries(names.map(name => [name, bones[name].quaternion.clone()]));
  const refresh = () => bones.Hips.updateWorldMatrix(true, true);
  const standingFeet = () => Object.fromEntries(SIDES.map(([side, sign]) => [side,
    { x: sign * .145, z: .01, lift: 0, pitch: 0, yaw: sign * .045, toe: 0 }]));
  const base = () => ({ Spine: [.03, 0, 0], Chest: [0, 0, 0], Head: [-.03, 0, 0],
    RightUpperArm: [-.12, 0, .25], LeftUpperArm: [.03, 0, -.25],
    RightForeArm: [-.75, 0, 0], LeftForeArm: [-.16, 0, 0] });

  const make = (name, duration, poseAt, samples = 80) => {
    const rotations = Object.fromEntries(names.map(key => [key, []]));
    const hips = [], times = [], previous = {};
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, pose = base();
      const rig = { hips: [0, -.05, 0], feet: standingFeet() };
      poseAt(t, pose, rig);
      for (const key of names) {
        bones[key].position.copy(restPositions[key]); bones[key].quaternion.copy(restQuaternions[key]);
        if (pose[key]) bones[key].quaternion.copy(Q(pose[key]));
      }
      bones.Hips.position.add(V(...rig.hips)); refresh();
      for (const [side, sign] of SIDES) {
        const foot = rig.feet[side], footQuaternion = Q([foot.pitch, foot.yaw, 0]);
        const goal = V(foot.x, shoeSupportHeight(footQuaternion) + foot.lift, foot.z);
        solveLimb(bones[`${side}UpperLeg`], bones[`${side}LowerLeg`], bones[`${side}Foot`],
          goal, V(sign * .025, 0, 1), restPositions);
        const lowerQuaternion = bones[`${side}LowerLeg`].getWorldQuaternion(new THREE.Quaternion());
        bones[`${side}Foot`].quaternion.copy(lowerQuaternion.invert().multiply(footQuaternion));
        // Auxiliary twist joints share the turn across the leg rather than twisting at the ankle.
        bones[`${side}UpperLegTwist`].quaternion.setFromAxisAngle(restPositions[`${side}LowerLeg`].clone().normalize(), foot.yaw * .25);
        bones[`${side}LowerLegTwist`].quaternion.setFromAxisAngle(restPositions[`${side}Foot`].clone().normalize(), foot.yaw * .45);
        bones[`${side}Toe`].quaternion.copy(Q([foot.toe, 0, 0]));
        bones[`${side}ToeTip`].quaternion.copy(Q([foot.toe * .35, 0, 0]));
      }
      refresh();
      if (rig.hand) {
        // Hand paths are specified relative to the unposed chest, then follow its turn.
        const goal = V(...rig.hand.position).sub(V(0, 1.41)).applyMatrix4(bones.Chest.matrixWorld);
        const pole = V(-2.5, 0, 1).applyQuaternion(bones.Chest.getWorldQuaternion(new THREE.Quaternion()));
        solveLimb(bones.RightUpperArm, bones.RightForeArm, bones.RightHand, goal, pole, restPositions);
        const desired = bones.Chest.getWorldQuaternion(new THREE.Quaternion()).multiply(Q(rig.hand.rotation));
        bones.RightHand.quaternion.copy(bones.RightForeArm.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      }
      refresh(); times.push(t * duration);
      for (const [key, values] of Object.entries(rotations)) {
        const q = bones[key].quaternion.clone();
        if (previous[key] && previous[key].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        previous[key] = q.clone(); values.push(q.x, q.y, q.z, q.w);
      }
      hips.push(...bones.Hips.position.toArray());
    }
    const tracks = names.map(key => new THREE.QuaternionKeyframeTrack(`${key}.quaternion`, times, rotations[key]));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
    return new THREE.AnimationClip(name, duration, tracks);
  };

  const idle = make('Idle', 2.4, (t, p, rig) => {
    const breath = Math.sin(t * Math.PI * 2);
    rig.hips[1] += breath * .003; p.Chest[0] = breath * .01; p.Head[1] = breath * .012;
  });
  const run = make('Run', .85, (t, p, rig) => {
    const stride = Math.sin(t * Math.PI * 2);
    rig.hips[1] = -.063 + .012 * Math.cos(t * Math.PI * 4);
    p.Spine[0] = .07; p.Chest[1] = stride * .045;
    p.RightUpperArm[0] -= stride * .25; p.LeftUpperArm[0] += stride * .30;
    for (const [side, sign] of SIDES) {
      const phase = (t + (side === 'Left' ? .5 : 0)) % 1;
      const f = rig.feet[side];
      if (phase < .60) { f.z = lerp(.12, -.13, smooth(phase / .6)); f.pitch = .11 * smooth((phase - .40) / .2); }
      else {
        const u = (phase - .60) / .40;
        f.z = lerp(-.13, .12, smooth(u)); f.lift = .115 * Math.sin(u * Math.PI) ** 2;
        f.pitch = -.16 * Math.sin(u * Math.PI); f.toe = -.04 * Math.sin(u * Math.PI);
      }
      f.x = sign * .145;
    }
  }, 100);
  const sidestep = make('Sidestep', 1.8, (t, p, rig) => {
    // Lead foot out, trailing foot closes, then the opposite pair returns.
    // Only one shoe moves at a time. A visible gap remains between the feet.
    const quarter = Math.min(3, Math.floor(t * 4)), u = t === 1 ? 1 : t * 4 - quarter;
    const s = smooth(u), lift = Math.sin(u * Math.PI) ** 2;
    const left = rig.feet.Left, right = rig.feet.Right;
    const hipKeys = [0, .115, .29, .115, 0];
    rig.hips = [lerp(hipKeys[quarter], hipKeys[quarter + 1], s), -.078 - .012 * lift, 0];
    if (quarter === 0) { left.x = lerp(.145, .42, s); left.lift = .055 * lift; }
    if (quarter === 1) { left.x = .42; right.x = lerp(-.145, .17, s); right.lift = .035 * lift; }
    if (quarter === 2) { left.x = .42; right.x = lerp(.17, -.145, s); right.lift = .055 * lift; }
    if (quarter === 3) { right.x = -.145; left.x = lerp(.42, .145, s); left.lift = .035 * lift; }
    p.Spine[2] = (quarter < 2 ? -.025 : .025) * Math.sin(u * Math.PI) ** 2;
    p.RightUpperArm[2] = .07; p.LeftUpperArm[2] = -.07;
  }, 120);

  function jumpRig(t, rig, amplitude = .36) {
    const crouchEnd = .18, takeoff = .28, touchdown = .72, absorbEnd = .83;
    if (t < crouchEnd) rig.hips[1] = lerp(-.05, -.21, smooth(t / crouchEnd));
    else if (t < takeoff) rig.hips[1] = lerp(-.21, -.035, smooth((t - crouchEnd) / (takeoff - crouchEnd)));
    else if (t <= touchdown) {
      const u = (t - takeoff) / (touchdown - takeoff), arc = 4 * u * (1 - u), tuck = Math.sin(u * Math.PI) ** 2;
      rig.hips[1] = -.035 + amplitude * arc;
      for (const [side] of SIDES) {
        const f = rig.feet[side]; f.lift = amplitude * arc + (side === 'Left' ? .085 : .055) * tuck;
        f.z = .01 - (side === 'Left' ? .04 : .065) * tuck;
        f.pitch = -.13 * tuck; f.toe = -.05 * tuck;
      }
    } else if (t < absorbEnd) rig.hips[1] = lerp(-.035, -.18, smooth((t - touchdown) / (absorbEnd - touchdown)));
    else rig.hips[1] = lerp(-.18, -.05, smooth((t - absorbEnd) / (1 - absorbEnd)));
  }
  const jump = make('Jump', 1.55, (t, p, rig) => {
    jumpRig(t, rig);
    const lift = t > .28 && t < .72 ? Math.sin((t - .28) / .44 * Math.PI) : 0;
    p.Spine[0] = t < .28 ? .03 + .1 * Math.sin(t / .28 * Math.PI) ** 2 : .03;
    p.RightUpperArm[0] -= lift * .6; p.LeftUpperArm[0] -= lift * .65;
  }, 120);

  const interpolate = (points, t) => {
    let i = 0; while (i < points.length - 2 && t > points[i + 1].t) i++;
    const a = points[i], b = points[i + 1], u = smooth((t - a.t) / (b.t - a.t));
    return Object.fromEntries(Object.keys(a).filter(key => key !== 't').map(key => [key, a[key].map((v, n) => lerp(v, b[key][n], u))]));
  };
  const backhand = make('Backhand', 1.55, (t, p, rig) => {
    const key = interpolate([
      { t: 0, hand: [-.30, 1.10, .22], wrist: [-.35, 0, .12], chest: [0, 0, 0] },
      { t: .28, hand: [.02, 1.34, .32], wrist: [-1.0, .1, .25], chest: [0, -.22, 0] },
      { t: .48, hand: [.04, 1.36, .32], wrist: [-.35, 0, 1.25], chest: [.02, .06, 0] },
      { t: .68, hand: [.06, 1.29, .34], wrist: [-.15, 0, 1.50], chest: [.03, .19, 0] },
      { t: .88, hand: [-.13, 1.18, .33], wrist: [-.45, 0, .50], chest: [0, .04, 0] },
      { t: 1, hand: [-.30, 1.10, .22], wrist: [-.35, 0, .12], chest: [0, 0, 0] }
    ], t);
    rig.hand = { position: key.hand, rotation: key.wrist }; p.Chest = key.chest;
    p.LeftUpperArm = [-.05, 0, -.35]; p.LeftForeArm = [-.3, 0, 0];
    rig.hips[1] -= .018 * Math.sin(t * Math.PI) ** 2;
  }, 120);

  const stroke = (name, duration, isSmash) => make(name, duration, (t, p, rig) => {
    const key = interpolate([
      { t: 0, arm: [-.12, 0, .25], fore: [-.75, 0, 0], chest: [0, 0, 0] },
      { t: .30, arm: [-2.55, -.15, -.46], fore: [-1.05, 0, -.12], chest: [0, -.30, -.03] },
      { t: .48, arm: [-2.72, .10, -.18], fore: [-.20, 0, 0], chest: [.08, .08, 0] },
      { t: .73, arm: [-.95, .45, .10], fore: [-.36, 0, 0], chest: [.17, .32, .04] },
      { t: 1, arm: [-.12, 0, .25], fore: [-.75, 0, 0], chest: [0, 0, 0] }
    ], t);
    p.RightUpperArm = key.arm; p.RightForeArm = key.fore; p.Chest = key.chest;
    p.LeftUpperArm[0] = -.15 - Math.sin(t * Math.PI) * .6;
    p.LeftUpperArm[2] = -.25 - Math.sin(t * Math.PI) * .20;
    if (isSmash) jumpRig(t, rig, .34);
    else rig.hips[1] -= .015 * Math.sin(t * Math.PI) ** 2;
  }, 120);
  const clips = [idle, run, sidestep, jump, stroke('Forehand', 1.45, false), backhand, stroke('Smash', 1.65, true)];
  // Export the original bind pose, not the last sampled animation pose.
  for (const name of names) { bones[name].position.copy(restPositions[name]); bones[name].quaternion.copy(restQuaternions[name]); }
  refresh();
  return clips;
}
