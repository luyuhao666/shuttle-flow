// Original procedural athlete. Metres, Y up, +Z forward; anatomical right is -X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAthleteAnimations } from './athlete-motion.mjs';

export const MODEL_VERSION = '1.1.0';
export const JOINT_COUNT = 29;
export const ANIMATION_NAMES = ['Idle', 'Run', 'Sidestep', 'Jump', 'Forehand', 'Backhand', 'Smash'];
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const smooth = x => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export function createAthlete() {
  const root = new THREE.Scene(); root.name = 'ShuttleFlowAthlete';
  root.userData = { version: MODEL_VERSION, units: 'metres', forward: '+Z', handedness: 'right',
    description: 'Original simplified anime badminton athlete; procedural mesh and skin, no external textures.',
    animationNote: 'Prototype preview clips. Gameplay adapter removes root travel and solves live racket contact.' };
  const bones = [], byName = {}, rest = {};
  const joint = (name, parent, point) => {
    const bone = new THREE.Bone(); bone.name = name;
    bone.position.copy(point).sub(parent ? rest[parent] : V(0, 0));
    (parent ? byName[parent] : root).add(bone);
    byName[name] = bone; rest[name] = point.clone(); bones.push(bone); return bone;
  };
  joint('Hips', null, V(0, 1.01));
  joint('Spine', 'Hips', V(0, 1.17));
  joint('Chest', 'Spine', V(0, 1.41));
  joint('Neck', 'Chest', V(0, 1.565));
  joint('Head', 'Neck', V(0, 1.715));
  for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
    joint(`${side}Shoulder`, 'Chest', V(sign * .205, 1.47));
    joint(`${side}UpperArm`, `${side}Shoulder`, V(sign * .226, 1.455));
    joint(`${side}ForeArm`, `${side}UpperArm`, V(sign * .35, 1.214, .005));
    joint(`${side}Hand`, `${side}ForeArm`, V(sign * .422, .978, .021));
    joint(`${side}UpperLeg`, 'Hips', V(sign * .104, .989));
    joint(`${side}LowerLeg`, `${side}UpperLeg`, V(sign * .121, .564, .018));
    joint(`${side}UpperLegTwist`, `${side}UpperLeg`, rest[`${side}UpperLeg`].clone().lerp(rest[`${side}LowerLeg`], .45));
    joint(`${side}Foot`, `${side}LowerLeg`, V(sign * .125, .132, .01));
    joint(`${side}LowerLegTwist`, `${side}LowerLeg`, rest[`${side}LowerLeg`].clone().lerp(rest[`${side}Foot`], .5));
    joint(`${side}Heel`, `${side}Foot`, V(sign * .125, .054, -.035));
    joint(`${side}Toe`, `${side}Foot`, V(sign * .125, .073, .108));
    joint(`${side}ToeTip`, `${side}Toe`, V(sign * .125, .059, .198));
  }
  root.updateMatrixWorld(true);
  const index = Object.fromEntries(bones.map((bone, i) => [bone.name, i]));
  const materials = Object.fromEntries(Object.entries({
    Skin: '#e6b28e', Jersey: '#acc7ac', JerseySide: '#31585a', JerseyTrim: '#d8e4cf',
    Shorts: '#254b53', ShortsTrim: '#547a7a', Hair: '#20242b', HairHighlight: '#303740',
    EyeWhite: '#f5f1df', Iris: '#4f3227', Pupil: '#131b23', Mouth: '#975e52',
    White: '#f1f2e9', Sole: '#cfcec0', ShoeTeal: '#416b70', Racket: '#204b51', Strings: '#c5d9d4'
  }).map(([name, color]) => [name, new THREE.MeshStandardMaterial({ name, color,
    roughness: name === 'Racket' ? .42 : .86, metalness: name === 'Racket' ? .15 : 0 })]));
  const parts = new Map();
  const add = (geometry, material, bone, blend) => {
    const count = geometry.attributes.position.count;
    const skinIndices = new Uint16Array(count * 4), skinWeights = new Float32Array(count * 4);
    const pos = geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      const weights = blend ? blend(V(pos.getX(i), pos.getY(i), pos.getZ(i))) : [[bone, 1]];
      for (let n = 0; n < weights.length; n++) {
        skinIndices[i * 4 + n] = weights[n][1] > 0 ? index[weights[n][0]] : 0; skinWeights[i * 4 + n] = weights[n][1];
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.deleteAttribute('uv');
    const normals = geometry.attributes.normal;
    for (let i = 0; i < count; i++) {
      if (Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < 1e-6) normals.setXYZ(i, 0, 1, 0);
    }
    if (!parts.has(material)) parts.set(material, []); parts.get(material).push(geometry);
  };
  const ellipsoid = (center, radii, mat, bone, segments = 20) => {
    const geometry = new THREE.SphereGeometry(1, segments, Math.max(10, segments / 2));
    geometry.scale(...radii).translate(...center); add(geometry, mat, bone, footWeights(bone));
  };
  const segment = (a, b, radiusA, radiusB, mat, bone, segments = 16) => {
    const delta = b.clone().sub(a), center = a.clone().add(b).multiplyScalar(.5);
    const geometry = new THREE.CylinderGeometry(radiusB, radiusA, delta.length(), segments, 3);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1), delta.normalize()));
    geometry.translate(center.x, center.y, center.z); add(geometry, mat, bone, footWeights(bone));
  };
  const tube = (points, radius, mat, bone, resolution = 16) => {
    const path = new THREE.CatmullRomCurve3(points.map(p => V(...p)));
    add(new THREE.TubeGeometry(path, resolution, radius, 6, false), mat, bone, footWeights(bone));
  };
  // Shoe geometry is now bound to heel, ankle, toe and tip, instead of one rigid foot.
  function footWeights(bone) {
    if (!bone.endsWith('Foot')) return undefined;
    const side = bone.slice(0, -4);
    return p => {
      if (p.z < .008) { const heel = 1 - smooth((p.z + .04) / .048); return [[`${side}Heel`, heel], [bone, 1 - heel]]; }
      if (p.z < .138) { const toe = smooth((p.z - .078) / .06); return [[bone, 1 - toe], [`${side}Toe`, toe]]; }
      const tip = smooth((p.z - .166) / .048); return [[`${side}Toe`, 1 - tip], [`${side}ToeTip`, tip]];
    };
  }
  // Elliptical ring loft: compact rounded torso and tailored shorts.
  const loft = (rings, mat, bone, blend, sectors = 32) => {
    const p = [], indices = [];
    for (const [y, rx, rz, cx = 0, cz = 0] of rings) {
      for (let j = 0; j <= sectors; j++) {
        const angle = j / sectors * Math.PI * 2;
        p.push(cx + Math.sin(angle) * rx, y, cz + Math.cos(angle) * rz);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sectors; j++) {
      const a = i * (sectors + 1) + j, b = a + sectors + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); add(geometry, mat, bone, blend);
  };
  const torsoWeights = p => {
    if (p.y < 1.20) { const t = smooth((p.y - 1.075) / .125); return [['Hips', 1 - t], ['Spine', t]]; }
    const t = smooth((p.y - 1.28) / .16); return [['Spine', 1 - t], ['Chest', t]];
  };
  loft([[1.042, .144, .093], [1.065, .152, .098], [1.16, .143, .091],
    [1.28, .159, .098], [1.405, .195, .105], [1.455, .198, .096],
    [1.492, .164, .083], [1.526, .071, .056]], 'Jersey', 'Spine', torsoWeights);
  loft([[1.517, .071, .056], [1.526, .072, .057], [1.53, .067, .054]], 'JerseySide', 'Chest');
  loft([[1.044, .145, .094], [1.059, .151, .098]], 'JerseyTrim', 'Hips');
  // Dark side inserts follow the torso and flex with the same skinning as the shirt.
  for (const sign of [-1, 1]) {
    const rings = [[1.062, .153, .099], [1.16, .144, .092], [1.28, .160, .099], [1.398, .195, .106]];
    const vertices = [], triangles = [], steps = 6;
    for (const [y, rx, rz] of rings) for (let j = 0; j <= steps; j++) {
      const angle = sign * Math.PI / 2 + (j / steps - .5) * .53;
      vertices.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz);
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < steps; j++) {
      const a = i * (steps + 1) + j, b = a + steps + 1;
      triangles.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setIndex(triangles); g.computeVertexNormals(); add(g, 'JerseySide', 'Spine', torsoWeights);
    tube([[sign * .077, 1.52, .032], [sign * .135, 1.491, .057], [sign * .196, 1.445, .057]], .0022, 'JerseySide', 'Chest');
  }
  segment(V(0, 1.525), V(0, 1.616), .047, .046, 'Skin', 'Neck');
  loft([[.959, .14, .097], [1.045, .145, .10], [1.062, .143, .098]], 'Shorts', 'Hips');
  loft([[1.043, .146, .101], [1.063, .145, .10]], 'ShortsTrim', 'Hips');

  for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
    const upper = `${side}UpperArm`, fore = `${side}ForeArm`, hand = `${side}Hand`;
    const shoulder = rest[upper], elbow = rest[fore], wrist = rest[hand];
    segment(shoulder, elbow, .044, .034, 'Skin', upper);
    ellipsoid(elbow.toArray(), [.035, .036, .036], 'Skin', fore);
    segment(elbow, wrist, .035, .023, 'Skin', fore);
    ellipsoid(shoulder.toArray(), [.071, .072, .067], 'Jersey', upper);
    const sleeveEnd = shoulder.clone().lerp(elbow, .53);
    segment(shoulder, sleeveEnd, .069, .055, 'Jersey', upper);
    segment(sleeveEnd.clone().lerp(shoulder, .07), sleeveEnd, .056, .055, 'JerseyTrim', upper);
    if (side === 'Right') {
      const bandTop = wrist.clone().lerp(elbow, .15), bandBottom = wrist.clone().lerp(elbow, .025);
      segment(bandTop, bandBottom, .027, .025, 'White', fore);
    }
    const handCenter = wrist.clone().add(V(sign * .019, -.039, .005));
    ellipsoid(handCenter.toArray(), [.032, .048, .024], 'Skin', hand, 16);
    for (let finger = 0; finger < 4; finger++) {
      const z = -.013 + finger * .011;
      const start = handCenter.clone().add(V(sign * .008, -.031, z));
      const length = [.032, .040, .037, .029][finger];
      const end = start.clone().add(V(sign * .006, -length, .006));
      segment(start, end, .007, .0057, 'Skin', hand, 8);
      ellipsoid(end.toArray(), [.006, .008, .006], 'Skin', hand, 10);
    }
    segment(handCenter.clone().add(V(-sign * .021, .006, .005)), handCenter.clone().add(V(-sign * .04, -.015, .015)), .011, .008, 'Skin', hand, 10);
    const thigh = `${side}UpperLeg`, calf = `${side}LowerLeg`, foot = `${side}Foot`;
    const hip = rest[thigh], knee = rest[calf], ankle = rest[foot];
    const legBlend = p => {
      const thighWeight = smooth((p.y - .515) / .10);
      const thighTwist = .5 * (1 - smooth((p.y - .68) / .22));
      const calfTwist = .65 * (1 - smooth((p.y - .23) / .23));
      return [[thigh, thighWeight * (1 - thighTwist)], [`${side}UpperLegTwist`, thighWeight * thighTwist],
        [calf, (1 - thighWeight) * (1 - calfTwist)], [`${side}LowerLegTwist`, (1 - thighWeight) * calfTwist]];
    };
    loft([[.132, .027, .029, sign * .125, .010], [.245, .033, .036, sign * .124, .005],
      [.37, .043, .045, sign * .123, .003], [.47, .043, .046, sign * .122, .008],
      [.51, .042, .045, sign * .122, .014], [.535, .042, .044, sign * .121, .017],
      [.564, .042, .044, sign * .121, .018], [.59, .043, .045, sign * .120, .016],
      [.615, .045, .047, sign * .119, .014], [.66, .049, .052, sign * .117, .012],
      [.83, .066, .068, sign * .109, .005], [.989, .070, .072, sign * .104, 0]], 'Skin', thigh, legBlend, 24);
    loft([[.739, .091, .099, sign * .105], [.761, .094, .101, sign * .105],
      [.935, .094, .107, sign * .097], [1.018, .08, .101, sign * .10]], 'Shorts', thigh, p => {
        const hips = smooth((p.y - .90) / .118); return [[thigh, 1 - hips], ['Hips', hips]];
      });
    loft([[.736, .092, .100, sign * .105], [.753, .094, .102, sign * .105]], 'ShortsTrim', thigh);
    tube([[sign * .196, .766, 0], [sign * .194, .868, 0], [sign * .180, .97, 0]], .004, 'ShortsTrim', thigh);
    segment(ankle, ankle.clone().lerp(knee, .34), .03, .035, 'White', `${side}LowerLegTwist`);
    segment(ankle.clone().lerp(knee, .30), ankle.clone().lerp(knee, .35), .0357, .0357, 'JerseyTrim', `${side}LowerLegTwist`);
    const shoeX = sign * .125;
    ellipsoid([shoeX, .067, .075], [.055, .032, .139], 'Sole', foot);
    ellipsoid([shoeX, .089, .074], [.052, .036, .132], 'White', foot);
    ellipsoid([shoeX, .121, -.007], [.043, .041, .056], 'White', foot);
    ellipsoid([shoeX, .124, -.037], [.044, .034, .026], 'ShoeTeal', foot);
    for (const lateral of [-1, 1]) {
      tube([[shoeX + lateral * .048, .084, -.035], [shoeX + lateral * .052, .092, .025],
        [shoeX + lateral * .047, .083, .10]], .007, 'ShoeTeal', foot);
    }
    for (let lace = 0; lace < 4; lace++) {
      const z = .017 + lace * .019;
      tube([[shoeX - .023, .13 - lace * .003, z], [shoeX, .138 - lace * .003, z + .004],
        [shoeX + .023, .13 - lace * .003, z]], .0023, 'White', foot, 6);
    }
  }
  // Simplified anime face: readable eyes and brows; no texture dependency.
  const headGeometry = new THREE.SphereGeometry(1, 32, 24), headPositions = headGeometry.attributes.position;
  for (let i = 0; i < headPositions.count; i++) {
    const x = headPositions.getX(i), y = headPositions.getY(i), z = headPositions.getZ(i);
    const jaw = smooth((-y - .25) / .75);
    headPositions.setXYZ(i, x * .117 * (1 - jaw * .22), 1.715 + y * .149, z * .112 + jaw * .006);
  }
  headGeometry.computeVertexNormals(); add(headGeometry, 'Skin', 'Head');
  for (const sign of [-1, 1]) {
    ellipsoid([sign * .116, 1.706, -.001], [.019, .031, .019], 'Skin', 'Head', 16);
    ellipsoid([sign * .043, 1.746, .103], [.025, .012, .010], 'EyeWhite', 'Head', 20);
    ellipsoid([sign * .043, 1.746, .112], [.0095, .0115, .004], 'Iris', 'Head', 16);
    ellipsoid([sign * .043, 1.747, .115], [.0052, .008, .002], 'Pupil', 'Head', 12);
    ellipsoid([sign * .043 - .002, 1.751, .117], [.0025, .0025, .0013], 'White', 'Head', 10);
    tube([[sign * .022, 1.771, .103], [sign * .044, 1.776, .102], [sign * .065, 1.773, .091]], .0034, 'Hair', 'Head', 10);
    tube([[sign * .02, 1.751, .109], [sign * .043, 1.760, .11], [sign * .066, 1.752, .10]], .0021, 'Hair', 'Head', 10);
  }
  ellipsoid([0, 1.703, .113], [.013, .024, .015], 'Skin', 'Head', 16);
  tube([[-.023, 1.659, .105], [0, 1.656, .110], [.023, 1.659, .105]], .0018, 'Mouth', 'Head', 12);
  // Hair cap and deliberately broad, tapered locks rather than individual strands.
  // Raise the front hairline so the cap cannot cover the eyes; keep sides/back lower.
  const hairVertices = [], hairIndices = [], capRings = 16, capSectors = 40;
  for (let i = 0; i <= capRings; i++) for (let j = 0; j <= capSectors; j++) {
    const angle = j / capSectors * Math.PI * 2;
    const front = Math.max(0, Math.cos(angle));
    const theta = i / capRings * (1.82 - .65 * front * front);
    hairVertices.push(Math.sin(angle) * Math.sin(theta) * .124,
      1.745 + Math.cos(theta) * .151, -.006 + Math.cos(angle) * Math.sin(theta) * .119);
  }
  for (let i = 0; i < capRings; i++) for (let j = 0; j < capSectors; j++) {
    const a = i * (capSectors + 1) + j, b = a + capSectors + 1;
    hairIndices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const hairCap = new THREE.BufferGeometry(); hairCap.setAttribute('position', new THREE.Float32BufferAttribute(hairVertices, 3));
  hairCap.setIndex(hairIndices); hairCap.computeVertexNormals(); add(hairCap, 'Hair', 'Head');
  const hairLock = (points, width, depth, mat = 'Hair') => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => V(...p)));
    const positions = [], triangles = [], rings = 8, sides = 8;
    const frames = curve.computeFrenetFrames(rings, false);
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, point = curve.getPointAt(t), taper = Math.max(.025, Math.sin((.13 + .87 * t) * Math.PI));
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        const p = point.clone().addScaledVector(frames.normals[i], Math.cos(angle) * width * taper)
          .addScaledVector(frames.binormals[i], Math.sin(angle) * depth * taper);
        positions.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      triangles.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(triangles); g.computeVertexNormals(); add(g, mat, 'Head');
  };
  hairLock([[-.079, 1.843, .068], [-.087, 1.794, .10], [-.09, 1.736, .083]], .034, .017);
  hairLock([[-.03, 1.874, .072], [-.04, 1.827, .113], [-.057, 1.763, .114]], .035, .018);
  hairLock([[.03, 1.876, .067], [.033, 1.832, .113], [.017, 1.774, .123]], .032, .019);
  hairLock([[.075, 1.843, .056], [.079, 1.798, .09], [.093, 1.744, .073]], .029, .015);
  for (const sign of [-1, 1]) {
    hairLock([[sign * .075, 1.867, -.024], [sign * .118, 1.83, -.025], [sign * .139, 1.798, -.022]], .034, .023);
    hairLock([[sign * .097, 1.805, -.021], [sign * .124, 1.756, -.028], [sign * .118, 1.701, -.025]], .024, .015);
    hairLock([[sign * .065, 1.86, -.066], [sign * .088, 1.807, -.113], [sign * .091, 1.737, -.113]], .033, .021);
  }
  hairLock([[0, 1.873, -.05], [.029, 1.911, -.033], [.068, 1.901, -.012]], .031, .022, 'HairHighlight');
  hairLock([[-.043, 1.866, -.042], [-.011, 1.898, .008], [.026, 1.881, .067]], .028, .014, 'HairHighlight');

  const skeleton = new THREE.Skeleton(bones);
  for (const [material, geometries] of parts) {
    const merged = mergeGeometries(geometries);
    if (!merged) throw new Error(`Cannot merge athlete material: ${material}`);
    const mesh = new THREE.SkinnedMesh(merged, materials[material]); mesh.name = `Athlete_${material}`;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton); mesh.normalizeSkinWeights();
    for (const g of geometries) g.dispose();
  }
  // Independent accessory attached to the hand; the named face locator drives contact IK.
  const racket = new THREE.Group(); racket.name = 'BadmintonRacket';
  racket.position.set(-.018, -.061, .015);
  racket.rotation.z = -.18; byName.RightHand.add(racket);
  const racketMesh = (geometry, mat, name) => {
    geometry.deleteAttribute('uv');
    const mesh = new THREE.Mesh(geometry, materials[mat]); mesh.name = name;
    mesh.castShadow = true; racket.add(mesh); return mesh;
  };
  const shaft = racketMesh(new THREE.CylinderGeometry(.0035, .0035, .30, 12), 'Racket', 'RacketShaft');
  shaft.position.y = -.222;
  const grip = racketMesh(new THREE.CylinderGeometry(.0085, .010, .105, 12), 'White', 'RacketGrip');
  grip.position.y = -.027;
  const butt = racketMesh(new THREE.CylinderGeometry(.011, .011, .01, 12), 'Racket', 'RacketGripCap'); butt.position.y = .027;
  const rim = racketMesh(new THREE.TorusGeometry(.105, .0042, 8, 64), 'Racket', 'RacketFrame');
  rim.scale.y = 1.32; rim.position.y = -.475;
  const strings = [], spacing = .016;
  for (let i = -6; i <= 6; i++) {
    const x = i * spacing, extent = Math.sqrt(Math.max(0, 1 - (x / .105) ** 2)) * .1386;
    strings.push([V(x, -.475 - extent, 0), V(x, -.475 + extent, 0)]);
  }
  for (let i = -8; i <= 8; i++) {
    const y = i * spacing, extent = Math.sqrt(Math.max(0, 1 - (y / .1386) ** 2)) * .105;
    strings.push([V(-extent, -.475 + y, 0), V(extent, -.475 + y, 0)]);
  }
  const stringGeometries = strings.map(([a, b]) => {
    const g = new THREE.CylinderGeometry(.00055, .00055, a.distanceTo(b), 4);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1), b.clone().sub(a).normalize()));
    const middle = a.clone().add(b).multiplyScalar(.5); g.translate(middle.x, middle.y, middle.z); return g;
  });
  racketMesh(mergeGeometries(stringGeometries), 'Strings', 'RacketStrings');
  stringGeometries.forEach(g => g.dispose());
  const contact = new THREE.Object3D(); contact.name = 'RacketContact'; contact.position.set(0, -.475, 0); racket.add(contact);
  root.updateMatrixWorld(true);
  const animations = createAthleteAnimations(byName);
  root.animations = animations;
  return { root, bones, skeleton, animations, materials, racket, contact };
}

