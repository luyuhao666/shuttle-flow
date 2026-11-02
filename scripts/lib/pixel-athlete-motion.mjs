// Author motions against the finished v2 mesh. Feet use its actual deformed soles.
import * as THREE from 'three';
import { solveLimb } from './athlete-motion.mjs';

export const PIXEL_MOTIONS = {
  Idle: { label: '弓腰候球', duration: 2.4, loop: true },
  Sidestep: { label: '左右并步', duration: 1.8, loop: true },
  Run: { label: '跑动', duration: .85, loop: true, treadmillSpeed: .44 / (.58 * .85) },
  Jump: { label: '起跳落地', duration: 1.55, loop: false, takeoff: .28, landing: .72 },
  Forehand: { label: '正手挥拍', duration: 1.45, loop: false, contact: .48 },
  Backhand: { label: '反手挥拍', duration: 1.55, loop: false, contact: .48 },
  Smash: { label: '跳杀', duration: 1.65, loop: false, takeoff: .28, landing: .72, contact: .49 },
  Lunge: { label: '网前跨步', duration: 1.35, loop: false, contact: .48 },
  Serve: { label: '低手发球', duration: 1.25, loop: false, contact: .48 }
};
const SIDES = [['Right', -1], ['Left', 1]];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = t => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;
const quat = a => new THREE.Quaternion().setFromEuler(new THREE.Euler(...a, 'XYZ'));
function keyframe(keys, t) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1], u = smooth((t - a.t) / (b.t - a.t));
  return Object.fromEntries(Object.keys(a).filter(k => k !== 't').map(k => [k, a[k].map((v, j) => lerp(v, b[k][j], u))]));
}

export function createPixelAthleteAnimations(root, bones) {
  const names = Object.keys(bones), positions = Object.fromEntries(names.map(n => [n, bones[n].position.clone()]));
  const rotations = Object.fromEntries(names.map(n => [n, bones[n].quaternion.clone()]));
  const sole = root.getObjectByName('Athlete_Sole');
  const soleIndices = Object.fromEntries(SIDES.map(([side, sign]) => [side,
    Array.from({ length: sole.geometry.attributes.position.count }, (_, i) => i)
      .filter(i => Math.sign(sole.geometry.attributes.position.getX(i)) === sign)]));
  function update() { root.updateMatrixWorld(true); sole.skeleton.update(); }
  function minimum(side) {
    let low = Infinity; const p = V();
    for (const i of soleIndices[side]) low = Math.min(low, sole.getVertexPosition(i, p).applyMatrix4(sole.matrixWorld).y);
    return low;
  }
  const readyHand = [-.24, 1.39, .30], readyWrist = [2.65, 0, -.12], readyPole = [-1.2, -1.0, .55];
  const base = () => ({ hips: [0, -.15, 0], angles: { Spine: [.21, 0, 0], Chest: [.025, 0, 0], Head: [-.19, 0, 0] },
    hands: { Right: { position: [...readyHand], rotation: [...readyWrist], pole: [...readyPole] },
      Left: { position: [.24, 1.29, .25], rotation: [.15, 0, .10], pole: [.3, -1.5, .2] } },
    feet: Object.fromEntries(SIDES.map(([side, sign]) => [side, { x: sign * .18, z: .01, lift: 0, pitch: 0, yaw: sign * .035, toe: 0 }])) });
  function apply(rig) {
    for (const n of names) {
      bones[n].position.copy(positions[n]); bones[n].quaternion.copy(rotations[n]);
      if (rig.angles[n]) bones[n].quaternion.copy(quat(rig.angles[n]));
    }
    bones.Hips.position.add(V(...rig.hips)); update();
    for (const [side, sign] of SIDES) {
      const f = rig.feet[side], desired = quat([f.pitch, f.yaw, 0]);
      const goal = V(f.x, .099 + f.lift, f.z);
      function leg() {
        solveLimb(bones[`${side}UpperLeg`], bones[`${side}LowerLeg`], bones[`${side}Foot`], goal, V(sign * .04, 0, 1), positions);
        bones[`${side}Foot`].quaternion.copy(bones[`${side}LowerLeg`].getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
        bones[`${side}UpperLegTwist`].quaternion.setFromAxisAngle(positions[`${side}LowerLeg`].clone().normalize(), f.yaw * .18);
        bones[`${side}LowerLegTwist`].quaternion.setFromAxisAngle(positions[`${side}Foot`].clone().normalize(), f.yaw * .25);
        bones[`${side}Toe`].quaternion.copy(quat([f.toe, 0, 0]));
        bones[`${side}ToeTip`].quaternion.copy(quat([f.toe * .30, 0, 0]));
        update();
      }
      leg(); goal.y += .002 + f.lift - minimum(side); leg();
    }
    for (const [side] of SIDES) {
      const hand = rig.hands[side];
      const goal = V(...hand.position).sub(V(0, 1.41)).applyMatrix4(bones.Chest.matrixWorld);
      const pole = V(...hand.pole).applyQuaternion(bones.Chest.getWorldQuaternion(new THREE.Quaternion()));
      solveLimb(bones[`${side}UpperArm`], bones[`${side}ForeArm`], bones[`${side}Hand`], goal, pole, positions);
      const desired = bones.Chest.getWorldQuaternion(new THREE.Quaternion()).multiply(quat(hand.rotation));
      bones[`${side}Hand`].quaternion.copy(bones[`${side}ForeArm`].getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      update();
    }
  }
  function make(name, author, samples = 120) {
    const duration = PIXEL_MOTIONS[name].duration, times = [], values = Object.fromEntries(names.map(n => [n, []])), hips = [], previous = {};
    for (let i = 0; i <= samples; i++) {
      const t = i / samples, rig = base(); author(t, rig); apply(rig); times.push(t * duration);
      for (const n of names) {
        const q = bones[n].quaternion.clone(); if (previous[n] && previous[n].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        previous[n] = q; values[n].push(q.x, q.y, q.z, q.w);
      }
      hips.push(...bones.Hips.position.toArray());
    }
    const tracks = names.map(n => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, values[n]));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
    return new THREE.AnimationClip(name, duration, tracks);
  }
  const idle = make('Idle', (t, r) => {
    const breath = Math.sin(2 * Math.PI * t);
    r.hips[1] += breath * .003; r.angles.Chest[0] += breath * .007; r.angles.Head[1] = breath * .008;
    r.hands.Right.position[1] += breath * .003;
  });
  const sidestep = make('Sidestep', (t, r) => {
    const left = r.feet.Left, right = r.feet.Right;
    let u, lift;
    if (t < .08) { r.hips[0] = -.023 * smooth(t / .08); }
    else if (t < .32) {
      u = (t - .08) / .24; lift = Math.sin(Math.PI * u) ** 2;
      left.x = lerp(.18, .47, smooth(u)); left.lift = .040 * lift;
      r.hips[0] = lerp(-.023, .11, smooth(u)); r.angles.Spine[2] = -.055 * Math.sin(Math.PI * u);
    } else if (t < .50) {
      u = (t - .32) / .18; lift = Math.sin(Math.PI * u) ** 2;
      left.x = .47; right.x = lerp(-.18, .11, smooth(u)); right.lift = .028 * lift;
      r.hips[0] = lerp(.11, .29, smooth(u)); r.angles.Chest[2] = .02 * lift;
    } else if (t < .58) {
      left.x = .47; right.x = .11; r.hips[0] = .29 + .023 * smooth((t - .50) / .08);
    } else if (t < .82) {
      u = (t - .58) / .24; lift = Math.sin(Math.PI * u) ** 2;
      left.x = .47; right.x = lerp(.11, -.18, smooth(u)); right.lift = .040 * lift;
      r.hips[0] = lerp(.313, .18, smooth(u)); r.angles.Spine[2] = .055 * Math.sin(Math.PI * u);
    } else {
      u = (t - .82) / .18; lift = Math.sin(Math.PI * u) ** 2;
      right.x = -.18; left.x = lerp(.47, .18, smooth(u)); left.lift = .028 * lift;
      r.hips[0] = lerp(.18, 0, smooth(u)); r.angles.Chest[2] = -.02 * lift;
    }
    r.hips[1] = -.16 - .014 * (lift ?? 0); r.angles.Spine[0] = .19;
    r.hands.Left.position[0] += .02 * (1 - 2 * smooth(r.hips[0] / .29));
  }, 180);
  const run = make('Run', (t, r) => {
    const stride = Math.sin(t * Math.PI * 2);
    r.hips[1] = -.10 + .013 * Math.cos(t * Math.PI * 4); r.angles.Spine[0] = .15;
    r.angles.Chest[1] = stride * .045; r.angles.Head[1] = -stride * .03;
    r.hands.Right.position[2] += stride * .06; r.hands.Left.position[2] -= stride * .09;
    r.hands.Left.position[1] += stride * .045;
    for (const [side, sign] of SIDES) {
      const phase = (t + (side === 'Left' ? .5 : 0)) % 1, f = r.feet[side];
      f.x = sign * .16;
      if (phase < .58) { f.z = lerp(.22, -.22, phase / .58); f.pitch = .07 * smooth((phase - .40) / .18); }
      else {
        const u = (phase - .58) / .42;
        f.z = lerp(-.22, .22, smooth(u)); f.lift = .13 * Math.sin(Math.PI * u) ** 2;
        f.pitch = -.16 * Math.sin(Math.PI * u); f.toe = -.025 * Math.sin(Math.PI * u);
      }
    }
  }, 180);
  function jumpBody(t, r, amplitude = .36) {
    if (t < .18) r.hips[1] = lerp(-.15, -.27, smooth(t / .18));
    else if (t < .28) {
      const u = (t - .18) / .10; r.hips[1] = lerp(-.27, -.045, u * u);
      for (const [side] of SIDES) { r.feet[side].pitch = .10 * u * u; r.feet[side].toe = -.08 * u * u; }
    }
    else if (t <= .72) {
      const u = (t - .28) / .44, arc = 4 * u * (1 - u), tuck = Math.sin(Math.PI * u) ** 2;
      r.hips[1] = -.045 + amplitude * arc;
      for (const [side] of SIDES) {
        const f = r.feet[side]; f.lift = amplitude * arc + (side === 'Left' ? .075 : .095) * tuck;
        f.z = .01 - (side === 'Left' ? .055 : .07) * tuck; f.pitch = .10 * (1 - u) - .14 * tuck; f.toe = -.08 * (1 - u) - .025 * tuck;
      }
    } else if (t < .84) r.hips[1] = lerp(-.045, -.24, smooth((t - .72) / .12));
    else r.hips[1] = lerp(-.24, -.15, smooth((t - .84) / .16));
    r.angles.Spine[0] = t < .18 ? lerp(.21, .31, smooth(t / .18))
      : t < .28 ? lerp(.31, .11, smooth((t - .18) / .10))
      : t < .84 ? .11 : lerp(.11, .21, smooth((t - .84) / .16));
    r.angles.Head[0] = -.19 + (.21 - r.angles.Spine[0]) * .8;
  }
  const jump = make('Jump', (t, r) => {
    jumpBody(t, r); const air = t > .28 && t < .72 ? Math.sin(Math.PI * (t - .28) / .44) ** 2 : 0;
    r.hands.Right.position[1] += .11 * air; r.hands.Left.position[1] += .13 * air;
    r.hands.Left.position[0] += .06 * air;
  }, 180);
  function stroke(name, smash) {
    return make(name, (t, r) => {
      const k = keyframe([
        { t: 0, hand: readyHand, wrist: readyWrist, chest: [0, 0, 0] },
        { t: .34, hand: [-.30, 1.65, -.08], wrist: [2.65, -.30, .20], chest: [-.04, -.29, -.025] },
        { t: .48, hand: [-.20, 1.84, .26], wrist: [2.70, .10, -.14], chest: [.04, .06, 0] },
        { t: .60, hand: [-.07, 1.30, .41], wrist: [1.05, .35, -.20], chest: [.12, .24, .025] },
        { t: .85, hand: [-.25, 1.17, .31], wrist: [2.30, .08, -.08], chest: [.03, .07, 0] },
        { t: 1, hand: readyHand, wrist: readyWrist, chest: [0, 0, 0] }
      ], t);
      r.hands.Right.position = k.hand; r.hands.Right.rotation = k.wrist;
      const strokePole = [-2, .10, lerp(.45, 1.2, smooth((t - .30) / .20))];
      const engaged = smooth(t / .20) * (1 - smooth((t - .80) / .20));
      r.hands.Right.pole = readyPole.map((v, i) => lerp(v, strokePole[i], engaged));
      r.angles.Chest = [k.chest[0] + .025, k.chest[1], k.chest[2]];
      r.angles.Hips = [0, k.chest[1] * .34, 0];
      const balance = Math.sin(Math.PI * t) ** 2;
      r.hands.Left.position[0] -= .045 * balance; r.hands.Left.position[1] += .25 * balance;
      r.hands.Left.position[2] += .06 * balance;
      if (smash) jumpBody(t, r, .35);
      else r.hips[1] -= .025 * balance;
    }, 180);
  }
  const backhand = make('Backhand', (t, r) => {
    const k = keyframe([
      { t: 0, hand: readyHand, wrist: readyWrist, chest: [0, 0, 0] },
      { t: .30, hand: [.015, 1.39, .37], wrist: [2.65, .12, .85], chest: [.02, -.26, 0] },
      { t: .48, hand: [.12, 1.42, .32], wrist: [3.45, -.08, .85], chest: [.035, .025, 0] },
      { t: .64, hand: [.11, 1.37, .34], wrist: [3.95, -.08, .55], chest: [.05, .20, .015] },
      { t: .85, hand: [-.08, 1.39, .39], wrist: [3.35, 0, .22], chest: [.02, .05, 0] },
      { t: 1, hand: readyHand, wrist: readyWrist, chest: [0, 0, 0] }
    ], t);
    r.hands.Right.position = k.hand; r.hands.Right.rotation = k.wrist;
    const engaged = smooth(t / .20) * (1 - smooth((t - .80) / .20));
    r.hands.Right.pole = readyPole.map((v, i) => lerp(v, [-2, -.1, 3.0][i], engaged));
    r.angles.Chest = [k.chest[0] + .025, k.chest[1], k.chest[2]];
    r.angles.Hips = [0, k.chest[1] * .25, 0];
    r.hips[1] -= .025 * Math.sin(Math.PI * t) ** 2;
    const ease = Math.sin(Math.PI * t) ** 2;
    r.hands.Left.position[0] += .05 * ease; r.hands.Left.position[2] -= .05 * ease;
  }, 180);
  const lunge = make('Lunge', (t, r) => {
    const reach = t < .48 ? smooth(t / .48) : 1 - smooth((t - .48) / .52);
    r.hips = [-.035 * reach, -.15 - .13 * reach, .12 * reach];
    r.feet.Right.z = .01 + .39 * reach; r.feet.Right.lift = t < .48 ? .045 * Math.sin(Math.PI * t / .48) ** 2 : .035 * Math.sin(Math.PI * (t - .48) / .52) ** 2;
    r.feet.Left.z = .01 - .18 * reach; r.feet.Left.pitch = .10 * reach;
    r.angles.Spine[0] = .21 + .12 * reach; r.angles.Head[0] = -.19 - .08 * reach;
    r.hands.Right.position = readyHand.map((v, i) => lerp(v, [-.38, 1.16, .38][i], reach));
    r.hands.Right.rotation = readyWrist.map((v, i) => lerp(v, [.45, -.12, -.25][i], reach));
    r.hands.Left.position[0] += .12 * reach;
  }, 160);
  const serve = make('Serve', (t, r) => {
    const k = keyframe([
      { t: 0, hand: readyHand, wrist: readyWrist },
      { t: .28, hand: [-.27, 1.08, .23], wrist: [.15, 0, -.10] },
      { t: .48, hand: [-.23, 1.13, .38], wrist: [-1.10, .10, -.10] },
      { t: .67, hand: [-.21, 1.28, .37], wrist: [-2.00, .10, -.10] },
      { t: 1, hand: readyHand, wrist: readyWrist }
    ], t);
    r.hands.Right.position = k.hand; r.hands.Right.rotation = k.wrist;
    const ease = Math.sin(Math.PI * t) ** 2;
    r.hands.Left.position = r.hands.Left.position.map((v, i) => lerp(v, [.05, 1.16, .33][i], ease));
    r.angles.Chest[1] = .08 * ease;
  }, 160);
  const forehand = stroke('Forehand', false), smash = stroke('Smash', true);
  for (const n of names) { bones[n].position.copy(positions[n]); bones[n].quaternion.copy(rotations[n]); }
  update();
  return [idle, run, sidestep, jump, forehand, backhand, smash, lunge, serve];
}
