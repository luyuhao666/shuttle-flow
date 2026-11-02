// Reference-based visual prototype. Existing joint positions and game scale stay intact.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAthlete } from './athlete-model.mjs';
import { createPixelAthleteAnimations } from './pixel-athlete-motion.mjs';

export const PIXEL_MODEL_VERSION = '0.3.1';
export const PIXEL_PALETTE = {
  Skin: '#edbb94', SkinShade: '#d79870', Jersey: '#2264c8', JerseyDark: '#174aa0',
  Stripe: '#53b5ee', SockStripe: '#2264c8', ShortsStripe: '#53b5ee', JerseyNumber: '#f5f3e8',
  White: '#f5f3e8', Shorts: '#202d46', Hair: '#493025',
  HairLight: '#694533', HairDark: '#302019', Orange: '#f77927', OrangeDark: '#d4531e',
  Guard: '#262e37', GuardTrim: '#69757b', Sole: '#dc9c44', Eye: '#35241f', Iris: '#824d2b', Lip: '#ad7465'
};
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const smooth = x => THREE.MathUtils.smoothstep(x, 0, 1);

export function createPixelAthlete() {
  const original = createAthlete();
  const { root, bones, skeleton, racket, contact } = original;
  // Retain the known skeleton and independent racket, replace body geometry only.
  for (const child of [...root.children]) if (child.isMesh) {
    root.remove(child); child.geometry.dispose();
  }
  root.name = 'ShuttleFlowPixelAthlete';
  root.userData = { version: PIXEL_MODEL_VERSION, units: 'metres', forward: '+Z', handedness: 'right',
    stage: 'Integrated in Shuttle Flow with gameplay-driven motion and contact timing.',
    reference: 'pixel-athlete-reference.png', bodyTop: 1.931166648864746, bodyFloor: .035 };
  const joints = Object.fromEntries(bones.map(b => [b.name, b]));
  const index = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  const rest = Object.fromEntries(bones.map(b => [b.name, b.getWorldPosition(new THREE.Vector3())]));
  const materials = Object.fromEntries(Object.entries(PIXEL_PALETTE).map(([name, color]) =>
    [name, new THREE.MeshStandardMaterial({ name, color, roughness: 1, metalness: 0, vertexColors: true })]));
  const groups = new Map();
  function add(geometry, material, bone, blend, rounded = false) {
    if (rounded) geometry.computeVertexNormals();
    if (geometry.index) geometry = geometry.toNonIndexed();
    geometry.deleteAttribute('uv');
    if (!rounded) geometry.computeVertexNormals();
    geometry.userData.rounded = rounded;
    const positions = geometry.attributes.position, count = positions.count;
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4), colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const point = V(positions.getX(i), positions.getY(i), positions.getZ(i));
      const influences = blend ? blend(point) : [[bone, 1]];
      influences.forEach(([name, weight], k) => { indices[i * 4 + k] = weight > 0 ? index[name] : 0; weights[i * 4 + k] = weight; });
      colors.set([1, 1, 1], i * 3);
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push(geometry);
  }
  const torsoWeights = p => p.y < 1.20
    ? [['Hips', 1 - smooth((p.y - 1.075) / .125)], ['Spine', smooth((p.y - 1.075) / .125)]]
    : [['Spine', 1 - smooth((p.y - 1.28) / .16)], ['Chest', smooth((p.y - 1.28) / .16)]];
  function loft(rings, material, bone, blend, sectors = 12, rounded = false) {
    const points = [], faces = [];
    for (const [y, rx, rz, x = 0, z = 0] of rings) for (let i = 0; i <= sectors; i++) {
      const angle = i / sectors * Math.PI * 2;
      points.push(x + Math.sin(angle) * rx, y, z + Math.cos(angle) * rz);
    }
    for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < sectors; i++) {
      const a = row * (sectors + 1) + i, b = a + sectors + 1;
      faces.push(a, a + 1, b, b, a + 1, b + 1);
    }
    // Close the ends so the GLB has solid silhouettes from above and below.
    for (const [row, flip] of [[0, true], [rings.length - 1, false]]) {
      const [y, , , x = 0, z = 0] = rings[row], center = points.length / 3;
      points.push(x, y, z);
      for (let i = 0; i < sectors; i++) {
        const a = row * (sectors + 1) + i;
        faces.push(...(flip ? [center, a + 1, a] : [center, a, a + 1]));
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    g.setIndex(faces); add(g, material, bone, blend, rounded);
  }
  function oval(center, radii, material, bone, segments = 12, blend) {
    const g = new THREE.SphereGeometry(1, segments, 8); g.scale(...radii).translate(...center);
    add(g, material, bone, blend, material === 'Skin' || material === 'SkinShade' || material === 'Iris' || material === 'Eye' || material === 'White');
  }
  function box(center, size, material, bone, rotation = 0, blend) {
    const g = new THREE.BoxGeometry(...size); g.rotateZ(rotation).translate(...center); add(g, material, bone, blend);
  }
  function segment(a, b, radiusA, radiusB, material, bone, sectors = 10, blend) {
    const delta = b.clone().sub(a), middle = a.clone().add(b).multiplyScalar(.5);
    const g = new THREE.CylinderGeometry(radiusB, radiusA, delta.length(), sectors, 3);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1), delta.normalize()));
    g.translate(middle.x, middle.y, middle.z); add(g, material, bone, blend, material === 'Skin');
  }
  function stroke(points, radius, material, bone, rounded = true) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)));
    add(new THREE.TubeGeometry(curve, 14, radius, 6, false), material, bone, undefined, rounded);
  }
  // A tailored broad-shouldered jersey, with a light V-neck and square pixel badges.
  loft([[1.045, .162, .114], [1.075, .163, .113], [1.20, .145, .094],
    [1.32, .173, .105], [1.43, .205, .111], [1.465, .213, .099], [1.49, .198, .088], [1.535, .071, .059]], 'Jersey', 'Spine', torsoWeights, 16);
  segment(V(0, 1.523), V(0, 1.623), .046, .043, 'Skin', 'Neck');
  for (const sign of [-1, 1]) {
    box([sign * .035, 1.515, .062], [.082, .016, .010], 'White', 'Chest', sign * .48);
  }
  // Front vertical stripe hugs the loft instead of floating on a rigid rectangle.
  const stripeLevels = [[1.048, .115], [1.075, .114], [1.20, .096], [1.32, .107], [1.43, .113], [1.486, .084]];
  function frontStripe(x, width, material) {
    const p = [], f = [];
    for (const [y, depth] of stripeLevels) p.push(x - width / 2, y, depth - .003, x + width / 2, y, depth - .003);
    for (let row = 0; row < stripeLevels.length - 1; row++) { const a = row * 2; f.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(f);
    add(g, material, 'Spine', torsoWeights);
  }
  frontStripe(-.065, .015, 'Stripe'); frontStripe(-.038, .009, 'Stripe');
  box([.107, 1.423, .099], [.027, .027, .007], 'White', 'Chest', Math.PI / 4);
  box([.107, 1.423, .105], [.015, .015, .005], 'Stripe', 'Chest', Math.PI / 4);
  box([.107, 1.412, .110], [.015, .007, .002], 'Orange', 'Chest');
  // Geometry-built 7: square cells are readable from the rear game camera.
  for (const [row, pattern] of ['11111', '00011', '00110', '00110', '01100', '01100', '01100'].entries()) {
    for (let col = 0; col < pattern.length; col++) if (pattern[col] === '1') {
      const y = 1.426 - row * .018, depth = y > 1.32 ? -.108 : -.102;
      box([(col - 2) * .017, y, depth - .003], [.0172, .0182, .005], 'JerseyNumber', 'Chest', 0, torsoWeights);
    }
  }
  loft([[.954, .142, .100], [1.045, .151, .107], [1.062, .149, .105]], 'Shorts', 'Hips');
  for (const sign of [-1, 1]) {
    box([sign * .015, 1.004, .108], [.005, .076, .006], 'White', 'Hips', sign * .025);
    box([sign * .015, .968, .111], [.006, .012, .007], 'Orange', 'Hips');
  }
  for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
    const upper = `${side}UpperArm`, fore = `${side}ForeArm`, hand = `${side}Hand`;
    const shoulder = rest[upper], elbow = rest[fore], wrist = rest[hand];
    segment(shoulder.clone().lerp(elbow, .53), elbow, .057, .046, 'Skin', upper, 16);
    oval(elbow.toArray(), [.045, .043, .044], 'Skin', fore, 16);
    segment(elbow, wrist, .047, .032, 'Skin', fore, 16);
    // A single sloping sleeve surface replaces the overlapping shoulder ball.
    const sleeveAxis = elbow.clone().sub(shoulder).normalize(), sideAxis = V(0, 0, 1);
    const radialAxis = sleeveAxis.clone().cross(sideAxis).normalize();
    const cuff = shoulder.clone().lerp(elbow, .66);
    const centers = [V(sign * .170, 1.440, .002), shoulder.clone().add(V(0, -.033, 0)),
      shoulder.clone().lerp(elbow, .31).add(V(0, -.018, 0)), cuff];
    const sleeveVertices = [], sleeveFaces = [], sleeveSectors = 16;
    for (let row = 0; row < centers.length; row++) for (let i = 0; i <= sleeveSectors; i++) {
      const angle = i / sleeveSectors * Math.PI * 2, radius = [.062, .072, .076, .069][row];
      const p = centers[row].clone().addScaledVector(radialAxis, Math.cos(angle) * radius)
        .addScaledVector(sideAxis, Math.sin(angle) * radius * 1.04);
      sleeveVertices.push(p.x, p.y, p.z);
    }
    for (let row = 0; row < centers.length - 1; row++) for (let i = 0; i < sleeveSectors; i++) {
      const a = row * (sleeveSectors + 1) + i, b = a + sleeveSectors + 1;
      sleeveFaces.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const capIndex = sleeveVertices.length / 3;
    sleeveVertices.push(...centers[0].toArray());
    for (let i = 0; i < sleeveSectors; i++) sleeveFaces.push(capIndex, i, i + 1);
    const sleeve = new THREE.BufferGeometry(); sleeve.setAttribute('position', new THREE.Float32BufferAttribute(sleeveVertices, 3)); sleeve.setIndex(sleeveFaces);
    const sleeveWeights = p => { const t = smooth((Math.abs(p.x) - .18) / .065); return [['Chest', 1 - t], [upper, t]]; };
    add(sleeve, 'Jersey', upper, sleeveWeights, true);
    segment(cuff.clone().lerp(shoulder, .10), cuff, .074, .074, 'White', upper, 20);
    if (side === 'Right') {
      segment(wrist.clone().lerp(elbow, .17), wrist.clone().lerp(elbow, .01), .037, .035, 'Orange', fore);
      segment(wrist.clone().lerp(elbow, .16), wrist.clone().lerp(elbow, .13), .038, .037, 'OrangeDark', fore);
    } else {
      segment(elbow.clone().lerp(wrist, .025), elbow.clone().lerp(wrist, .88), .050, .037, 'Guard', fore, 16);
      segment(elbow.clone().lerp(wrist, .12).add(V(0, 0, .047)), elbow.clone().lerp(wrist, .71).add(V(0, 0, .040)), .0025, .0025, 'GuardTrim', fore, 4);
    }
    const palm = wrist.clone().add(V(sign * .018, -.039, .014));
    oval(palm.toArray(), [.042, .045, .035], 'Skin', hand, 16);
    // A compact semi-closed hand, with four broad knuckles rather than long floating fingers.
    for (let k = 0; k < 4; k++) oval([palm.x + (k - 1.5) * .016, palm.y - .031, palm.z + .009], [.009, .016, .018], 'Skin', hand, 12);
    oval([palm.x - sign * .033, palm.y - .010, palm.z + .020], [.016, .028, .019], 'Skin', hand, 12);
    const thigh = `${side}UpperLeg`, calf = `${side}LowerLeg`, foot = `${side}Foot`;
    const legWeights = p => {
      // Covered upper thigh follows the waistband during deep knee bends.
      // Otherwise skin rotates out of the hip-bound shorts even with no static seam.
      if (p.y > .90) { const waist = smooth((p.y - .90) / .118); return [[thigh, 1 - waist], ['Hips', waist]]; }
      const t = smooth((p.y - .515) / .10), thighTwist = .5 * (1 - smooth((p.y - .68) / .22));
      const calfTwist = .65 * (1 - smooth((p.y - .23) / .23));
      return [[thigh, t * (1 - thighTwist)], [`${side}UpperLegTwist`, t * thighTwist],
        [calf, (1 - t) * (1 - calfTwist)], [`${side}LowerLegTwist`, (1 - t) * calfTwist]];
    };
    loft([[.132, .036, .036, sign * .125, .010], [.25, .045, .046, sign * .124],
      [.40, .059, .059, sign * .122], [.515, .053, .055, sign * .121, .014],
      [.564, .054, .056, sign * .121, .018], [.615, .058, .060, sign * .119, .014],
      [.73, .076, .080, sign * .113, .005], [.91, .089, .093, sign * .105], [.989, .085, .087, sign * .104]], 'Skin', thigh, legWeights, 20, true);
    const shortWeights = p => { const t = smooth((p.y - .90) / .118); return [[thigh, 1 - t], ['Hips', t]]; };
    loft([[.747, .110, .116, sign * .105], [.78, .111, .119, sign * .105],
      [.93, .102, .120, sign * .097], [1.018, .085, .111, sign * .100]], 'Shorts', thigh, shortWeights, 16);
    box([sign * .214, .859, .002], [.005, .196, .033], 'White', thigh, sign * -.040, shortWeights);
    box([sign * .218, .859, .002], [.004, .196, .014], 'ShortsStripe', thigh, sign * -.040, shortWeights);
    const knee = rest[calf], ankle = rest[foot];
    const sockBottom = ankle.clone(), sockTop = ankle.clone().lerp(knee, .54); sockTop.z = .002;
    segment(sockBottom, sockTop, .050, .064, 'White', `${side}LowerLegTwist`, 20);
    for (const t of [.41, .49]) segment(sockBottom.clone().lerp(sockTop, t / .54), sockBottom.clone().lerp(sockTop, (t + .026) / .54), .065, .065, 'SockStripe', `${side}LowerLegTwist`, 20);
    if (side === 'Right') {
      loft([[.485, .063, .067, sign * .122, .008], [.545, .068, .070, sign * .121, .017],
        [.59, .067, .069, sign * .120, .016], [.638, .067, .069, sign * .118, .012]], 'Guard', calf, legWeights, 20);
      oval([sign * .121, .566, .091], [.026, .026, .002], 'Skin', calf, 16, legWeights);
      box([sign * .185, .526, .024], [.006, .014, .055], 'Orange', calf, 0, legWeights);
    }
    const footWeights = p => {
      if (p.z < .008) { const t = 1 - smooth((p.z + .04) / .048); return [[`${side}Heel`, t], [foot, 1 - t]]; }
      if (p.z < .138) { const t = smooth((p.z - .078) / .06); return [[foot, 1 - t], [`${side}Toe`, t]]; }
      const t = smooth((p.z - .166) / .048); return [[`${side}Toe`, 1 - t], [`${side}ToeTip`, t]];
    };
    loft([[.035, .064, .145, sign * .125, .085], [.047, .071, .163, sign * .125, .085],
      [.067, .071, .160, sign * .125, .085]], 'Sole', foot, footWeights, 16);
    loft([[.067, .068, .156, sign * .125, .085], [.099, .066, .147, sign * .125, .080],
      [.135, .053, .092, sign * .125, .033], [.159, .047, .051, sign * .125, -.006]], 'White', foot, footWeights, 20, true);
    for (const lateral of [-1, 1]) {
      box([sign * .125 + lateral * .064, .089, .051], [.007, .014, .105], 'Orange', foot, 0, footWeights);
      box([sign * .125 + lateral * .066, .110, .021], [.007, .040, .051], 'Orange', foot, 0, footWeights);
    }
    box([sign * .125, .119, -.067], [.029, .054, .007], 'Orange', foot, 0, footWeights);
    box([sign * .125, .151, .041], [.031, .004, .051], 'Orange', foot, 0, footWeights);
    for (let row = 0; row < 4; row++) box([sign * .125, .151 - row * .007, .039 + row * .021], [.050, .004, .008], 'White', foot, 0, footWeights);
  }
  // Smooth anime facial planes, with features following the actual curved surface.
  const faceRings = [[1.601, .038, .045, 0, .022], [1.616, .065, .068, 0, .022],
    [1.642, .087, .086, 0, .012], [1.670, .108, .099, 0, .005],
    [1.705, .122, .109], [1.745, .125, .110], [1.78, .123, .108],
    [1.81, .118, .102], [1.84, .098, .089], [1.865, .064, .064]];
  loft(faceRings, 'Skin', 'Head', undefined, 48, true);
  function faceZ(x, y) {
    let row = 0; while (row < faceRings.length - 2 && y > faceRings[row + 1][0]) row++;
    const a = faceRings[row], b = faceRings[row + 1], t = THREE.MathUtils.clamp((y - a[0]) / (b[0] - a[0]), 0, 1);
    const rx = THREE.MathUtils.lerp(a[1], b[1], t), rz = THREE.MathUtils.lerp(a[2], b[2], t), z = THREE.MathUtils.lerp(a[4] ?? 0, b[4] ?? 0, t);
    return z + rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
  }
  for (const sign of [-1, 1]) {
    oval([sign * .121, 1.704, -.004], [.019, .029, .019], 'Skin', 'Head', 20);
    oval([sign * .132, 1.704, .001], [.006, .018, .010], 'SkinShade', 'Head', 16);
    const cx = sign * .049, cy = 1.746, halfWidth = .029, n = 32;
    const p = [cx, cy, faceZ(cx, cy) + .003], f = [], upperLid = [], lowerLid = [];
    for (let i = 0; i <= n; i++) {
      const angle = i / n * Math.PI * 2, x = cx + Math.cos(angle) * halfWidth;
      const y = cy + Math.sin(angle) * (Math.sin(angle) >= 0 ? .019 : .013)
        + sign * (x - cx) * .09;
      p.push(x, y, faceZ(x, y) + .0035);
      if (i < n) f.push(0, i + 1, i + 2);
      (i <= n / 2 ? upperLid : lowerLid).push([x, y, faceZ(x, y) + .005]);
    }
    const eye = new THREE.BufferGeometry(); eye.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); eye.setIndex(f); add(eye, 'White', 'Head', undefined, true);
    stroke(upperLid, .0020, 'Eye', 'Head'); stroke(lowerLid, .0008, 'SkinShade', 'Head');
    const irisX = sign * .047, depth = faceZ(irisX, cy);
    oval([irisX, cy + .001, depth + .006], [.013, .016, .003], 'Iris', 'Head', 24);
    oval([irisX, cy + .002, depth + .009], [.006, .013, .002], 'Eye', 'Head', 20);
    oval([irisX - .0035, cy + .008, depth + .011], [.003, .0035, .001], 'White', 'Head', 12);
    const eyebrow = [[sign * .023, 1.780], [sign * .048, 1.786], [sign * .077, 1.782]];
    stroke(eyebrow.map(([x, y]) => [x, y, faceZ(x, y) + .005]), .003, 'HairDark', 'Head');
  }
  // A tapered bridge and small tip replace the blunt spherical nose.
  const nose = new THREE.BufferGeometry();
  nose.setAttribute('position', new THREE.Float32BufferAttribute([
    -.008, 1.731, .112, .008, 1.731, .112,
    -.010, 1.698, .116, .010, 1.698, .116, 0, 1.704, .136, 0, 1.691, .122
  ], 3));
  nose.setIndex([0, 4, 1, 0, 2, 4, 1, 4, 3, 2, 5, 4, 4, 5, 3]); add(nose, 'Skin', 'Head', undefined, true);
  for (const sign of [-1, 1]) oval([sign * .0065, 1.697, .126], [.0025, .0012, .001], 'SkinShade', 'Head', 12);
  const mouth = [[-.019, 1.665], [-.010, 1.663], [0, 1.664], [.010, 1.663], [.019, 1.665]];
  stroke(mouth.map(([x, y]) => [x, y, faceZ(x, y) + .003]), .0016, 'Lip', 'Head');
  stroke([[-.012, 1.659], [0, 1.657], [.012, 1.659]].map(([x, y]) => [x, y, faceZ(x, y) + .0025]), .0010, 'SkinShade', 'Head');
  // Orange headband remains visible under the fringe and around the back.
  loft([[1.791, .143, .142], [1.822, .143, .142]], 'Orange', 'Head', undefined, 20);
  // Broad swept hair locks; low-sided rings give angular, readable clumps.
  const hp = [], hi = [], rows = 6, sectors = 20;
  for (let row = 0; row <= rows; row++) for (let i = 0; i <= sectors; i++) {
    const angle = i / sectors * Math.PI * 2, front = Math.max(0, Math.cos(angle));
    const theta = row / rows * (1.93 - .93 * front ** 2);
    hp.push(Math.sin(angle) * Math.sin(theta) * .137, 1.760 + Math.cos(theta) * .151,
      -.011 + Math.cos(angle) * Math.sin(theta) * .126);
  }
  for (let row = 0; row < rows; row++) for (let i = 0; i < sectors; i++) {
    const a = row * (sectors + 1) + i, b = a + sectors + 1; hi.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const cap = new THREE.BufferGeometry(); cap.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); cap.setIndex(hi); add(cap, 'HairDark', 'Head');
  function lock(points, width, depth, material = 'Hair') {
    const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p))), rings = 5, sides = 5;
    const frames = curve.computeFrenetFrames(rings, false), p = [], f = [];
    for (let row = 0; row <= rings; row++) {
      const t = row / rings, center = curve.getPointAt(t), taper = Math.max(.018, Math.sin((.18 + .82 * t) * Math.PI));
      for (let i = 0; i <= sides; i++) {
        const angle = i / sides * Math.PI * 2;
        const point = center.clone().addScaledVector(frames.normals[row], Math.cos(angle) * width * taper)
          .addScaledVector(frames.binormals[row], Math.sin(angle) * depth * taper);
        p.push(point.x, point.y, point.z);
      }
    }
    for (let row = 0; row < rings; row++) for (let i = 0; i < sides; i++) {
      const a = row * (sides + 1) + i, b = a + sides + 1; f.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(f); add(g, material, 'Head');
  }
  lock([[-.04, 1.902, .00], [-.096, 1.87, .074], [-.127, 1.824, .066]], .043, .023, 'HairLight');
  lock([[.03, 1.905, .015], [-.036, 1.872, .108], [-.061, 1.765, .116]], .042, .024);
  lock([[.055, 1.907, .001], [.079, 1.854, .105], [.100, 1.779, .077]], .044, .025, 'HairLight');
  lock([[-.018, 1.903, .04], [-.056, 1.843, .119], [-.086, 1.798, .10]], .033, .021);
  lock([[.023, 1.91, -.015], [.065, 1.889, .065], [.047, 1.784, .122]], .033, .020);
  for (const sign of [-1, 1]) {
    lock([[sign * .068, 1.89, -.035], [sign * .118, 1.861, -.029], [sign * .155, 1.834, -.035]], .036, .024);
    lock([[sign * .085, 1.843, -.026], [sign * .133, 1.799, -.029], [sign * .117, 1.716, -.035]], .030, .020);
    lock([[sign * .065, 1.868, -.070], [sign * .103, 1.808, -.12], [sign * .081, 1.727, -.129]], .035, .022);
    lock([[sign * .03, 1.826, -.109], [sign * .044, 1.766, -.135], [sign * .047, 1.717, -.115]], .025, .019, 'HairDark');
  }
  lock([[-.047, 1.895, -.025], [-.012, 1.923, -.033], [.034, 1.91, -.016]], .028, .017, 'HairLight');
  // Match the original body's exact floor and crown without scaling the whole character.
  const all = [...groups.values()].flat(), bounds = new THREE.Box3();
  for (const g of all) { g.computeBoundingBox(); bounds.union(g.boundingBox); }
  const top = root.userData.bodyTop, floor = root.userData.bodyFloor;
  if (bounds.max.y > 1.84) {
    const ratio = (top - 1.84) / (bounds.max.y - 1.84);
    for (const g of all) {
      const p = g.attributes.position; let changed = false;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 1.84) { p.setY(i, 1.84 + (p.getY(i) - 1.84) * ratio); changed = true; }
      if (changed && g.userData.rounded) {
        g.deleteAttribute('normal');
        const welded = mergeVertices(g, 1e-5); welded.computeVertexNormals();
        const expanded = welded.toNonIndexed(); g.setAttribute('normal', expanded.attributes.normal.clone());
        expanded.dispose(); welded.dispose();
      } else if (changed) g.computeVertexNormals();
    }
  }
  for (const [material, list] of groups) {
    for (const g of list) {
      const normals = g.attributes.normal;
      for (let i = 0; i < normals.count; i++) if (Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 1e-6) normals.setXYZ(i, 0, 1, 0);
    }
    const merged = mergeGeometries(list);
    const mesh = new THREE.SkinnedMesh(merged, materials[material]); mesh.name = `Athlete_${material}`;
    mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(mesh); mesh.bind(skeleton); mesh.normalizeSkinWeights();
    list.forEach(g => g.dispose());
  }
  racket.userData = { separateAccessory: true, gripSocket: 'RightHand', faceLocator: 'RacketContact', reusedFrom: 'anime-athlete-v1' };
  const animations = createPixelAthleteAnimations(root, joints);
  root.animations = animations;
  root.updateMatrixWorld(true);
  return { root, bones, skeleton, animations, materials, racket, contact, floor, top, joints };
}
