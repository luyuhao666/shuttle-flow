// Regression checks on the imported GLB, independent of the authoring IK solver.
import assert from 'node:assert/strict';
import * as THREE from 'three';

export function verifyAthleteMotion(gltf) {
  const model = gltf.scene, mixer = new THREE.AnimationMixer(model);
  const joint = name => { const value = model.getObjectByName(name); assert.ok(value, name); return value; };
  const position = name => joint(name).getWorldPosition(new THREE.Vector3());
  const soles = joint('Athlete_Sole');
  const metrics = {};
  const torso = [[1.065, .152, .098], [1.16, .143, .091], [1.28, .159, .098], [1.405, .195, .105], [1.455, .198, .096], [1.492, .164, .083]];
  const radii = y => {
    let i = 0; while (i < torso.length - 2 && y > torso[i + 1][0]) i++;
    const a = torso[i], b = torso[i + 1], u = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    return [THREE.MathUtils.lerp(a[1], b[1], u), THREE.MathUtils.lerp(a[2], b[2], u)];
  };
  for (const clip of gltf.animations) {
    mixer.stopAllAction(); const action = mixer.clipAction(clip).reset().play();
    const stats = { minimumKneeForward: Infinity, maximumKneeFlexion: 0, minimumSoleHeight: Infinity,
      minimumFootSeparation: Infinity, minimumBackhandTorsoClearance: Infinity, maximumSupportSlip: 0 };
    const oldSupport = {};
    for (let frame = 0; frame <= 120; frame++) {
      const fraction = frame / 120;
      action.time = Math.min(clip.duration * fraction, clip.duration - .000001); mixer.update(0);
      model.updateMatrixWorld(true); soles.skeleton.update();
      const footMinimum = { Left: Infinity, Right: Infinity };
      const bind = soles.geometry.attributes.position;
      for (let i = 0; i < bind.count; i++) {
        const p = soles.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(soles.matrixWorld);
        const side = bind.getX(i) < 0 ? 'Right' : 'Left'; footMinimum[side] = Math.min(footMinimum[side], p.y);
      }
      for (const side of ['Right', 'Left']) {
        const hip = position(`${side}UpperLeg`), knee = position(`${side}LowerLeg`), ankle = position(`${side}Foot`);
        const line = new THREE.Line3(hip, ankle), projection = line.closestPointToPoint(knee, true, new THREE.Vector3());
        const forward = knee.z - projection.z;
        const flexion = Math.PI - hip.clone().sub(knee).angleTo(ankle.clone().sub(knee));
        stats.minimumKneeForward = Math.min(stats.minimumKneeForward, forward);
        stats.maximumKneeFlexion = Math.max(stats.maximumKneeFlexion, flexion);
        stats.minimumSoleHeight = Math.min(stats.minimumSoleHeight, footMinimum[side]);
        assert.ok(forward >= -.002, `${clip.name} ${fraction}: ${side} knee bends backwards (${forward})`);
        assert.ok(flexion <= 2.4, `${clip.name} ${fraction}: ${side} knee overfolds (${flexion})`);
        assert.ok(footMinimum[side] >= -.004, `${clip.name} ${fraction}: ${side} shoe penetrates floor (${footMinimum[side]})`);
        if (clip.name === 'Idle' || (['Jump', 'Smash'].includes(clip.name) && (fraction <= .275 || fraction >= .725))) {
          assert.ok(footMinimum[side] < .007, `${clip.name} ${fraction}: grounded ${side} shoe floats (${footMinimum[side]})`);
        }
        if (clip.name === 'Sidestep') {
          // Read support status from the exported shoe, then check its horizontal movement.
          const support = footMinimum[side] < .003;
          if (support && oldSupport[side]?.support) {
            const slip = Math.hypot(ankle.x - oldSupport[side].ankle.x, ankle.z - oldSupport[side].ankle.z);
            stats.maximumSupportSlip = Math.max(stats.maximumSupportSlip, slip);
            assert.ok(slip < .002, `Sidestep ${fraction}: planted ${side} ankle slides ${slip}`);
          }
          oldSupport[side] = { support, ankle: ankle.clone() };
        }
      }
      const separation = position('LeftFoot').x - position('RightFoot').x;
      stats.minimumFootSeparation = Math.min(stats.minimumFootSeparation, separation);
      if (clip.name === 'Sidestep') {
        assert.ok(separation > .19, `Sidestep ${fraction}: feet cross or close too tightly (${separation})`);
        assert.ok(Math.min(footMinimum.Left, footMinimum.Right) < .007, `Sidestep ${fraction}: both feet float`);
      }
      if (['Jump', 'Smash'].includes(clip.name) && fraction > .42 && fraction < .58) {
        assert.ok(Math.min(footMinimum.Left, footMinimum.Right) > .25, `${clip.name}: feet do not lift with the body`);
      }
      if (clip.name === 'Backhand') {
        const chestInverse = joint('Chest').matrixWorld.clone().invert();
        for (const [start, end, radius] of [['RightUpperArm', 'RightForeArm', .041], ['RightForeArm', 'RightHand', .035]]) {
          const a = position(start), b = position(end);
          // The proximal upper arm joins the torso inside the shoulder/sleeve.
          // Check its exposed section and the entire forearm against the chest.
          for (let sample = start === 'RightUpperArm' ? 6 : 1; sample <= 15; sample++) {
            const p = a.clone().lerp(b, sample / 16).applyMatrix4(chestInverse).add(new THREE.Vector3(0, 1.41, 0));
            if (p.y < 1.08 || p.y > 1.49) continue;
            const [rx, rz] = radii(p.y);
            const clearance = (p.x / (rx + radius)) ** 2 + (p.z / (rz + radius)) ** 2;
            stats.minimumBackhandTorsoClearance = Math.min(stats.minimumBackhandTorsoClearance, clearance);
            assert.ok(clearance >= 1, `Backhand ${fraction}: ${start} enters the torso (${clearance}, point ${p.toArray()})`);
          }
        }
      }
    }
    metrics[clip.name] = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Number.isFinite(v) ? v : null]));
  }
  mixer.stopAllAction();
  return metrics;
}
