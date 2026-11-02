import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { solveLimb, shoeSupportHeight } from './lib/athlete-motion.mjs';

// A transparent, offline 3D character layer. Court projection and all gameplay
// remain owned by game.js; GLB root motion never moves the gameplay actor.
const api = globalThis.ShuttleAthletes = { ready: false, error: null, last: {} };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const legTrack = name => /^(Hips|Right(?:UpperLeg|LowerLeg|Foot|Heel|Toe)|Left(?:UpperLeg|LowerLeg|Foot|Heel|Toe))/.test(name);

async function initialize() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#fff9e9', '#8aa098', 2));
  const key = new THREE.DirectionalLight('#fff4df', 2.7); key.position.set(-3, 5, -4); scene.add(key);
  const fill = new THREE.DirectionalLight('#dcebf0', 1.3); fill.position.set(3, 2, 4); scene.add(fill);
  // Fixed orientation matches the game's view from behind the player's baseline.
  const camera = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, .01, 20);
  camera.position.set(0, 1.7, -6); camera.lookAt(0, 1.1, 0); camera.updateMatrixWorld();
  const bytes = Uint8Array.from(atob(__ATHLETE_GLB__), c => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const actors = {};
  for (const role of ['player', 'opponent']) {
    const model = clone(gltf.scene), group = new THREE.Group(); group.add(model); scene.add(group);
    group.rotation.y = role === 'opponent' ? Math.PI : 0;
    const bones = {}, rest = {};
    model.traverse(object => {
      if (object.isBone) { bones[object.name] = object; rest[object.name] = object.position.clone(); }
      if (object.isMesh) {
        object.frustumCulled = false;
        if (role === 'opponent') {
          object.material = object.material.clone();
          if (object.name === 'Athlete_Jersey') object.material.color.set('#f0ddbd');
          if (object.name === 'Athlete_Shorts') object.material.color.set('#465f75');
        }
      }
    });
    const mixer = new THREE.AnimationMixer(model), legs = {}, upper = {};
    for (const clip of gltf.animations) {
      for (const [name, filter, actions] of [
        ['Legs', track => legTrack(track.name), legs], ['Upper', track => !legTrack(track.name), upper]
      ]) {
        const split = new THREE.AnimationClip(`${clip.name}${name}`, clip.duration, clip.tracks.filter(filter));
        actions[clip.name] = mixer.clipAction(split).setLoop(THREE.LoopOnce, 1);
        actions[clip.name].clampWhenFinished = true;
      }
    }
    actors[role] = { model, group, mixer, legs, upper, bones, rest,
      racket: model.getObjectByName('BadmintonRacket'), contact: model.getObjectByName('RacketContact') };
  }
  const ndc = world => world.clone().project(camera);
  const origin = ndc(V());
  const pixelPoint = (world, options) => {
    const p = ndc(world), scale = options.unit * 1.7;
    return { x: options.x + (p.x - origin.x) * scale,
      y: options.y - options.height * options.yScale - (p.y - origin.y) * scale * options.yScale };
  };
  const worldPoint = (point, options, z) => {
    const scale = options.unit * 1.7;
    const x = origin.x + (point.x - options.x) / scale;
    const y = origin.y - (point.y - options.y + options.height * options.yScale) / (scale * options.yScale);
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), camera);
    return ray.ray.intersectPlane(new THREE.Plane(V(0, 0, 1), -z), V());
  };
  function sample(actor, actions, weights) {
    for (const action of Object.values(actions)) action.stop();
    for (const [name, time, weight] of weights) {
      if (!weight) continue;
      const action = actions[name]; action.reset().play(); action.paused = true;
      action.time = clamp(time, 0, action.getClip().duration - .000001); action.setEffectiveWeight(weight);
    }
  }
  function aimRacket(actor, target, strength) {
    const { bones: b, rest, group, racket, contact } = actor;
    group.updateMatrixWorld(true);
    const shoulder = b.RightUpperArm.getWorldPosition(V());
    // Keep the racket shaft in the vertical court plane. Its wrist then stays
    // in front of the chest, even when the head passes close to the shoulder;
    // a shoulder-to-head 3D ray would fold the wrist into the torso here.
    const direction = target.clone().sub(shoulder); direction.z = 0;
    if (direction.lengthSq() < .000001) direction.set(0, 1, 0);
    direction.normalize();
    // The racket is modelled along -Y; rotate its strings into the camera plane.
    const racketWorld = new THREE.Quaternion().setFromUnitVectors(V(0, -1), direction);
    const desiredHand = racketWorld.clone().multiply(racket.quaternion.clone().invert());
    const contactOffset = contact.position.clone().applyQuaternion(racket.quaternion).add(racket.position);
    const goal = target.clone().sub(contactOffset.applyQuaternion(desiredHand));
    const oldGoal = b.RightHand.getWorldPosition(V()); goal.lerp(oldGoal, 1 - strength);
    const oldHand = b.RightHand.getWorldQuaternion(new THREE.Quaternion());
    desiredHand.slerp(oldHand, 1 - strength);
    const upperVector = rest.RightForeArm, lowerVector = rest.RightHand;
    const delta = goal.clone().sub(shoulder), distance = delta.length();
    // The existing forgiving contact radius can exceed anatomical arm reach.
    // Only the contact pose extends the segments; physics still judges the hit.
    const extension = Math.max(1, (distance + .001) / (upperVector.length() + lowerVector.length()));
    b.RightForeArm.position.copy(upperVector).multiplyScalar(extension);
    b.RightHand.position.copy(lowerVector).multiplyScalar(extension);
    const l1 = upperVector.length() * extension, l2 = lowerVector.length() * extension;
    const reach = clamp(distance, Math.abs(l1 - l2) + .0001, l1 + l2 - .0001);
    const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
    delta.normalize();
    const pole = V(-1, .05, 1.25).applyQuaternion(group.quaternion);
    const bend = pole.addScaledVector(delta, -pole.dot(delta)).normalize();
    const elbow = shoulder.clone().addScaledVector(delta, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    const parent = b.RightUpperArm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    b.RightUpperArm.quaternion.setFromUnitVectors(upperVector.clone().normalize(), elbow.sub(shoulder).normalize().applyQuaternion(parent));
    group.updateMatrixWorld(true);
    const endpoint = shoulder.clone().addScaledVector(delta, reach);
    const lowerDirection = endpoint.sub(b.RightForeArm.getWorldPosition(V())).normalize()
      .applyQuaternion(b.RightUpperArm.getWorldQuaternion(new THREE.Quaternion()).invert());
    b.RightForeArm.quaternion.setFromUnitVectors(lowerVector.clone().normalize(), lowerDirection);
    group.updateMatrixWorld(true);
    b.RightHand.quaternion.copy(b.RightForeArm.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredHand));
    return extension;
  }
  api.draw = (ctx, options) => {
    const role = options.opponent ? 'opponent' : 'player', actor = actors[role];
    const { bones: b, rest, group, mixer, legs, upper } = actor;
    const m = options.motion, swing = options.swing, run = clamp(m.run || 0, 0, 1);
    const lateral = Math.abs(options.vx) > Math.abs(options.vy);
    const planted = clamp(Math.max(options.pivot || 0, m.brake || 0), 0, 1);
    const sideWeight = options.height || options.recovery ? 0 : clamp(Math.max(lateral ? run : 0,
      Math.abs(options.vy) < .08 ? Math.abs(options.plantX || 0) * planted * .85 : 0), 0, 1);
    const facing = options.opponent ? 1 : -1;
    const ready = options.height || options.recovery ? 0 : clamp(m.ready ?? (swing ? 0 : 1), 0, 1);
    // Sidestep clips contain an out-and-back pair; play only the corresponding
    // outward half in a continuous direction. Discard their baked hip travel.
    let legPose = lateral ? 'Sidestep' : 'Run', phase = ((m.gait || 0) / (Math.PI * 2)) % 1;
    let legTime = phase * (lateral ? .9 : .85);
    if (lateral && ((options.vx > 0) !== options.opponent)) legTime += .9;
    if (!lateral && ((options.vy > 0) !== options.opponent)) legTime = (1 - phase) * .85;
    let rootAir = 0;
    if (options.height > 0 || options.recovery > 0) {
      legPose = 'Jump';
      const progress = clamp((360 - options.verticalVelocity) / 720, 0, 1);
      const t = options.height > 0 ? .28 + .44 * progress : .72 + .28 * (1 - clamp(options.recovery / .18, 0, 1));
      legTime = t * 1.55; rootAir = options.height > 0 ? .36 * 4 * progress * (1 - progress) : 0;
      sample(actor, legs, [['Jump', legTime, 1]]);
    } else sample(actor, legs, [['Idle', (options.time || 0) % 2.4, 1 - run], [legPose, legTime, run]]);
    let upperPose = 'Idle', upperTime = (options.time || 0) % 2.4;
    if (swing) {
      upperPose = swing.backhand ? 'Backhand' : swing.type === 'smash' ? 'Smash' : 'Forehand';
      const duration = upper[upperPose].getClip().duration;
      const t = swing.age <= .045 ? .48 * swing.age / .045 : .48 + .52 * (swing.age - .045) / (.38 - .045);
      upperTime = clamp(t, 0, 1) * duration;
    }
    sample(actor, upper, [[upperPose, upperTime, 1]]); mixer.update(0);
    b.Hips.position.x = rest.Hips.x; b.Hips.position.z = rest.Hips.z;
    b.Hips.position.y -= rootAir;
    b.RightForeArm.position.copy(rest.RightForeArm); b.RightHand.position.copy(rest.RightHand);
    group.updateMatrixWorld(true);
    if (!options.height && !options.recovery) {
      const support = ['Right', 'Left'].map(side => ({ side,
        target: b[`${side}Foot`].getWorldPosition(V()), rotation: b[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion()) }));
      // Low, wide lateral stance: alternate the leading and closing shoe while
      // the pelvis transfers weight. Preserve the actual gameplay centre.
      const direction = facing * Math.sign(Math.abs(options.vx) > .025 ? options.vx : m.lean || 1);
      const cycle = phase * Math.PI * 2, sway = Math.sin(cycle);
      b.Hips.position.x += facing * ((m.lean || 0) * .018 - (options.plantX || 0) * planted * .11)
        + direction * .07 * sway * sideWeight;
      b.Hips.position.y -= .32 * sideWeight + .06 * ready * (1 - sideWeight * .5)
        + .018 * (1 - Math.cos(2 * cycle)) * sideWeight
        + .035 * (m.split || 0) + .085 * (m.lunge || 0) + .055 * planted;
      group.updateMatrixWorld(true);
      for (const { side, target, rotation } of support) {
        const sign = side === 'Right' ? -1 : 1;
        const isLead = sign === direction;
        const moving = phase < .5 ? isLead : !isLead;
        const u = phase < .5 ? phase * 2 : (phase - .5) * 2;
        const lift = moving ? .055 * Math.sin(Math.PI * u) ** 2 : 0;
        const spread = .30 + planted * .045 + (moving ? .035 * Math.sin(Math.PI * u) ** 2 : 0);
        const shoeRotation = group.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1), sign * .12));
        const sideTarget = actor.model.localToWorld(V(sign * spread - direction * .065 * Math.cos(cycle),
          shoeSupportHeight(shoeRotation) + lift, .01));
        target.lerp(sideTarget, sideWeight); rotation.slerp(shoeRotation, sideWeight);
        const pole = V(side === 'Right' ? -.025 : .025, 0, 1).applyQuaternion(group.quaternion);
        solveLimb(b[`${side}UpperLeg`], b[`${side}LowerLeg`], b[`${side}Foot`], target, pole, rest);
        b[`${side}Foot`].quaternion.copy(b[`${side}LowerLeg`].getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      }
    }
    b.Spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.14 * ready + (m.pitch || 0) * .018, 0,
      -facing * ((m.lean || 0) * .036 - (options.plantX || 0) * planted * .16))));
    b.Chest.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1), (m.turn || 0) * .18));
    group.updateMatrixWorld(true);
    let extension = 1;
    const contactPoint = swing?.contactScreen ?? swing?.predictedScreen;
    if (contactPoint) {
      const strength = swing.age <= .11 ? (swing.age >= .045 ? 1 : smooth(swing.age / .045)) : 1 - smooth((swing.age - .11) / .27);
      const z = options.opponent ? -.34 : .34;
      extension = aimRacket(actor, worldPoint(contactPoint, options, z), strength);
    }
    group.updateMatrixWorld(true);
    for (const other of Object.values(actors)) other.group.visible = other === actor;
    // Bitmap density follows actual screen size; avoid large hidden WebGL buffers
    // on portrait screens, while preserving enlarged appearance previews.
    const density = Math.max(1, Math.min(3, options.pixelRatio || 1));
    const size = Math.max(192, Math.min(768, Math.ceil(options.unit * 3.4 * density)));
    if (renderer.domElement.width !== size) renderer.setSize(size, size, false);
    renderer.render(scene, camera);
    const span = options.unit * 3.4;
    ctx.drawImage(renderer.domElement, options.x - (origin.x + 1) * span / 2,
      options.y - options.height * options.yScale - (1 - origin.y) * span * options.yScale / 2,
      span, span * options.yScale);
    const head = pixelPoint(actor.contact.getWorldPosition(V()), options);
    api.last[role] = { head, legPose: options.height > 0 ? 'Jump' : sideWeight > .05 ? 'Sidestep' : run > .05 ? legPose : 'Idle', upperPose,
      height: options.height, extension, bones: Object.keys(b).length,
      feet: ['Left', 'Right'].map(side => pixelPoint(b[`${side}Foot`].getWorldPosition(V()), options)),
      footHeights: ['Left', 'Right'].map(side => b[`${side}Foot`].getWorldPosition(V()).y),
      soleHeights: ['Left', 'Right'].map(side => b[`${side}Foot`].getWorldPosition(V()).y
        - shoeSupportHeight(b[`${side}Foot`].getWorldQuaternion(new THREE.Quaternion())) + .002),
      hips: b.Hips.position.toArray(),
      sideWeight, planted, spineRoll: new THREE.Euler().setFromQuaternion(b.Spine.quaternion).z,
      ready, spinePitch: new THREE.Euler().setFromQuaternion(b.Spine.quaternion).x,
      stanceWidth: Math.abs(b.LeftFoot.getWorldPosition(V()).x - b.RightFoot.getWorldPosition(V()).x),
      triangles: renderer.info.render.triangles, bitmap: size };
    return true;
  };
  api.ready = true; api.renderer = renderer;
  window.dispatchEvent(new Event('shuttle-athletes-ready'));
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); api.ready = false; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { api.ready = true; window.dispatchEvent(new Event('shuttle-athletes-ready')); });
}
initialize().catch(error => { api.error = String(error); console.warn('3D athlete unavailable; using Canvas characters.', error); });
