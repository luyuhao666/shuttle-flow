import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function racketOutline(profile, count = 64) {
  const rx = .105 * profile.scale * profile.width, ry = .1386 * profile.scale * profile.height;
  const power = 2 / profile.exponent;
  return Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
    return new THREE.Vector3(rx * Math.sign(c) * Math.abs(c) ** power, ry * Math.sign(s) * Math.abs(s) ** power, 0);
  });
}
const tube = (points, radius, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, 'centripetal'), points.length * 2, radius, 6, closed);
function stringGeometry(profile) {
  const rx = .105 * profile.scale * profile.width, ry = .1386 * profile.scale * profile.height;
  const parts = [];
  const add = (a, b) => {
    const geometry = new THREE.CylinderGeometry(.00065, .00065, a.distanceTo(b), 4);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    const middle = a.clone().add(b).multiplyScalar(.5); geometry.translate(middle.x, middle.y, 0); parts.push(geometry);
  };
  for (const vertical of [true, false]) {
    const across = vertical ? rx : ry, along = vertical ? ry : rx;
    const count = Math.floor(across / .016);
    for (let i = -count; i <= count; i++) {
      const offset = i * .016, extent = along * (1 - Math.abs(offset / across) ** profile.exponent) ** (1 / profile.exponent);
      add(vertical ? new THREE.Vector3(offset, -extent, 0) : new THREE.Vector3(-extent, offset, 0),
        vertical ? new THREE.Vector3(offset, extent, 0) : new THREE.Vector3(extent, offset, 0));
    }
  }
  const result = mergeGeometries(parts); parts.forEach(g => g.dispose()); return result;
}
export function applyRacketAppearance(racket, profile) {
  const frame = racket.getObjectByName('RacketFrame'), strings = racket.getObjectByName('RacketStrings');
  const shapeKey = `${profile.style}/${profile.size}`;
  if (racket.userData.shapeKey !== shapeKey) {
    const outline = racketOutline(profile), centerY = -.365 - .1386 * profile.scale * profile.height;
    // Each instance owns generated geometry. Keep the socket and grip fixed;
    // relocate the face locator so production IK uses the new face centre.
    if (racket.userData.generatedGeometry) {
      frame.geometry.dispose(); strings.geometry.dispose(); racket.getObjectByName('RacketAccent').geometry.dispose();
    }
    frame.geometry = tube(outline, profile.thickness, true); frame.scale.set(1, 1, 1); frame.position.set(0, centerY, 0);
    frame.userData.racketOutline = outline.map(p => p.toArray());
    strings.geometry = stringGeometry(profile); strings.position.set(0, centerY, 0);
    racket.getObjectByName('RacketContact').position.set(0, centerY, 0);
    const bands = [outline.slice(6, 12), outline.slice(21, 27)].map(points => tube(points, profile.thickness * 1.12));
    const accentGeometry = mergeGeometries(bands); bands.forEach(g => g.dispose());
    let accent = racket.getObjectByName('RacketAccent');
    if (!accent) { accent = new THREE.Mesh(accentGeometry, frame.material.clone()); accent.name = 'RacketAccent'; accent.frustumCulled = false; racket.add(accent); }
    else accent.geometry = accentGeometry;
    accent.position.copy(frame.position);
    racket.userData.shapeKey = shapeKey; racket.userData.generatedGeometry = true;
  }
  const colorKey = `${profile.frame}/${profile.grip}/${profile.accent}/${profile.strings}`;
  if (racket.userData.colorKey !== colorKey) {
    for (const [name, color] of [['RacketFrame', profile.frame], ['RacketShaft', profile.frame], ['RacketGripCap', profile.frame], ['RacketGrip', profile.grip], ['RacketAccent', profile.accent], ['RacketStrings', profile.strings]]) racket.getObjectByName(name).material.color.set(color);
    racket.userData.colorKey = colorKey;
  }
}
