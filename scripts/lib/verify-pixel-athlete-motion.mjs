// Validate exported animation data and mesh deformation, independently of authoring IK.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PIXEL_MOTIONS } from './pixel-athlete-motion.mjs';
import { createBackhandRacketCheck } from './verify-backhand-racket.mjs';
const V = () => new THREE.Vector3();
export function verifyPixelAthleteMotion(gltf) {
  const root = gltf.scene, sole = root.getObjectByName('Athlete_Sole'), mixer = new THREE.AnimationMixer(root);
  const racketClear = createBackhandRacketCheck(root);
  const bone = n => root.getObjectByName(n), pos = n => bone(n).getWorldPosition(V());
  const soles = { Left: [], Right: [] };
  for (let i = 0; i < sole.geometry.attributes.position.count; i++) soles[sole.geometry.attributes.position.getX(i) < 0 ? 'Right' : 'Left'].push(i);
  const torso = [[1.045, .162, .114], [1.075, .163, .113], [1.20, .145, .094], [1.32, .173, .105], [1.43, .205, .111], [1.465, .213, .099], [1.49, .198, .088]];
  function radii(y) {
    let i = 0; while (i < torso.length - 2 && y > torso[i + 1][0]) i++;
    const a = torso[i], b = torso[i + 1], t = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    return [THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t)];
  }
  const results = {};
  assert.deepEqual(gltf.animations.map(c => c.name).sort(), Object.keys(PIXEL_MOTIONS).sort());
  const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); });
  const pose = () => bones.map(b => ({ position: b.position.clone(), rotation: b.quaternion.clone() }));
  mixer.clipAction(gltf.animations.find(c => c.name === 'Idle')).reset().play(); mixer.update(0);
  const ready = pose();
  for (const clip of gltf.animations) {
    mixer.stopAllAction(); const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play(); action.clampWhenFinished = true;
    const stats = { minimumSole: Infinity, maximumGroundedSole: -Infinity, minimumKneeForward: Infinity,
      maximumKneeFlexion: 0, minimumFootSeparation: Infinity, maximumPlantedSlip: 0, minimumBackhandClearance: Infinity };
    mixer.update(0); const first = pose(), previous = {};
    for (let frame = 0; frame <= 120; frame++) {
      const t = frame / 120; action.time = Math.min(t * clip.duration, clip.duration - .000001); mixer.update(0);
      root.updateMatrixWorld(true); sole.skeleton.update();
      const minimum = {};
      for (const side of ['Left', 'Right']) {
        minimum[side] = Math.min(...soles[side].map(i => sole.getVertexPosition(i, V()).applyMatrix4(sole.matrixWorld).y));
        const hip = pos(`${side}UpperLeg`), knee = pos(`${side}LowerLeg`), ankle = pos(`${side}Foot`);
        const line = new THREE.Line3(hip, ankle), nearest = line.closestPointToPoint(knee, true, V());
        const forward = knee.z - nearest.z, flex = Math.PI - hip.clone().sub(knee).angleTo(ankle.clone().sub(knee));
        stats.minimumSole = Math.min(stats.minimumSole, minimum[side]);
        stats.minimumKneeForward = Math.min(stats.minimumKneeForward, forward); stats.maximumKneeFlexion = Math.max(stats.maximumKneeFlexion, flex);
        assert.ok(minimum[side] >= -.004, `${clip.name} ${t}: ${side} sole below floor ${minimum[side]}`);
        assert.ok(forward >= -.003, `${clip.name} ${t}: ${side} knee bends backwards ${forward}`);
        assert.ok(flex < 2.4, `${clip.name} ${t}: knee excessively folded`);
        const grounded = ['Idle', 'Forehand', 'Backhand', 'Serve'].includes(clip.name)
          || (['Jump', 'Smash'].includes(clip.name) && (t < .275 || t > .725));
        if (grounded) {
          stats.maximumGroundedSole = Math.max(stats.maximumGroundedSole, minimum[side]);
          assert.ok(minimum[side] < .010, `${clip.name} ${t}: grounded shoe floats ${minimum[side]}`);
        }
        if (['Idle', 'Sidestep'].includes(clip.name)) {
          const support = minimum[side] < .003;
          if (support && previous[side]?.support) {
            const slip = Math.hypot(ankle.x - previous[side].ankle.x, ankle.z - previous[side].ankle.z);
            stats.maximumPlantedSlip = Math.max(stats.maximumPlantedSlip, slip);
            assert.ok(slip < .002, `${clip.name} ${t}: planted foot slides ${slip}`);
          }
          previous[side] = { support, ankle };
        }
      }
      const gap = pos('LeftFoot').x - pos('RightFoot').x;
      stats.minimumFootSeparation = Math.min(stats.minimumFootSeparation, gap);
      assert.ok(gap > .24, `${clip.name} ${t}: shoes cross`);
      if (clip.name === 'Sidestep') assert.ok(Math.min(minimum.Left, minimum.Right) < .01, 'sidestep needs a support shoe');
      if (['Jump', 'Smash'].includes(clip.name) && t > .44 && t < .56) assert.ok(Math.min(minimum.Left, minimum.Right) > .27, `${clip.name} feet do not lift with body`);
      if (clip.name === 'Backhand') {
        assert.ok(racketClear(), `Backhand ${t}: racket shaft/rim/string plane crosses actual jersey or head`);
        if (frame === 58) {
          const space = bone('Chest').matrixWorld.clone().invert();
          const hand = pos('RightHand').applyMatrix4(space), head = pos('RacketContact').applyMatrix4(space);
          assert.ok(head.x > hand.x + .20 && head.z > hand.z + .02, 'backhand contact points toward anatomical left and forward');
        }
        const inverse = bone('Chest').matrixWorld.clone().invert();
        for (const [a, b, radius, start] of [['RightUpperArm', 'RightForeArm', .057, 9], ['RightForeArm', 'RightHand', .047, 1]]) {
          for (let i = start; i < 16; i++) {
            const p = pos(a).lerp(pos(b), i / 16).applyMatrix4(inverse).add(new THREE.Vector3(0, 1.41, 0));
            if (p.y < 1.08 || p.y > 1.49) continue;
            const [rx, rz] = radii(p.y), clearance = (p.x / (rx + radius)) ** 2 + (p.z / (rz + radius)) ** 2;
            stats.minimumBackhandClearance = Math.min(stats.minimumBackhandClearance, clearance);
            assert.ok(clearance >= 1, `Backhand ${t}: ${a} intersects chest envelope ${clearance}`);
          }
        }
      }
    }
    const end = pose(), target = PIXEL_MOTIONS[clip.name].loop ? first : ready;
    stats.maximumEndRotationMismatch = Math.max(...end.map((p, i) => p.rotation.angleTo(target[i].rotation)));
    stats.maximumEndPositionMismatch = Math.max(...end.map((p, i) => p.position.distanceTo(target[i].position)));
    assert.ok(stats.maximumEndRotationMismatch < .003, `${clip.name}: loop/recovery rotation snaps`);
    assert.ok(stats.maximumEndPositionMismatch < .0001, `${clip.name}: loop/recovery position jumps`);
    results[clip.name] = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Number.isFinite(v) ? v : null]));
    if (clip.name === 'Backhand') results[clip.name].racketAgainstDeformedJerseyAndHead = true;
  }
  mixer.stopAllAction();
  root.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); }); root.updateMatrixWorld(true);
  return results;
}
