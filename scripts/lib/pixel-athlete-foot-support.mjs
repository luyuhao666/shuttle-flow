import * as THREE from 'three';
import { solveLimb } from './athlete-motion.mjs';
const V = () => new THREE.Vector3();
// Use the new shoe's actual skinning, including heel and articulated toe weights.
export function createPixelFootSupport(model, bones, rest) {
  const sole = model.getObjectByName('Athlete_Sole'), vertex = V();
  const indices = { Left: [], Right: [] };
  for (let i = 0; i < sole.geometry.attributes.position.count; i++) {
    indices[sole.geometry.attributes.position.getX(i) < 0 ? 'Right' : 'Left'].push(i);
  }
  const update = () => { model.updateWorldMatrix(true, true); sole.skeleton.update(); };
  const minimum = side => {
    update(); let y = Infinity;
    for (const i of indices[side]) y = Math.min(y, sole.getVertexPosition(i, vertex).applyMatrix4(sole.matrixWorld).y);
    return y;
  };
  const solve = (side, target, rotation, pole, lift = 0) => {
    const upper = bones[`${side}UpperLeg`], lower = bones[`${side}LowerLeg`], foot = bones[`${side}Foot`];
    const goal = target.clone();
    const pose = () => {
      solveLimb(upper, lower, foot, goal, pole, rest);
      foot.quaternion.copy(lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      update();
    };
    pose(); goal.y += .002 + lift - minimum(side); pose();
  };
  return { minimum, solve };
}
