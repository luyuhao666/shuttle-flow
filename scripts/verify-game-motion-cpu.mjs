// Exercise the production bone/mixer/IK adapter without a GPU. This verifies
// geometry and timing; it deliberately does not claim to verify rendered pixels.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import '../core.js';
import '../appearance.js';
const root=fileURLToPath(new URL('../',import.meta.url)), scripts=join(root,'scripts');
const core=globalThis.ShuttleCore;
const game=await readFile(join(root,'game.js'),'utf8');
const projectSource=game.slice(game.indexOf('function project('),game.indexOf('function path('));
const poseSource=game.slice(game.indexOf('function updatePose('),game.indexOf('function update(dt)'));
const {project,updatePose}=runInNewContext(`${projectSource}\n${poseSource}\n({project,updatePose})`,{...core});
const createMotion=runInNewContext(`(${game.match(/const createMotion = (.+);/)[1]})`);
const bytes=await readFile(join(root,'assets','characters','pixel-athlete-v2','athlete.glb'));
let source=await readFile(join(scripts,'pixel-athlete-game.mjs'),'utf8');
assert.ok(source.includes('new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })'));
source=source.replace('new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })','new globalThis.__CpuRenderer()')
  .replace('__ATHLETE_GLB__',JSON.stringify(bytes.toString('base64')));
globalThis.__CpuRenderer=class {
  domElement={width:0,addEventListener(){}}; info={render:{triangles:0}};
  setClearColor(){} setSize(size){this.domElement.width=size;}
  render(scene){scene.updateMatrixWorld(true);scene.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});}
};
globalThis.window=new EventTarget();
const temporary=join(scripts,`.cpu-athlete-check-${randomUUID()}.mjs`),results={method:'production adapter, CPU bones/skin/camera; no pixel rendering',stances:[],contacts:[]};
const ctx={drawImage(){}};
let equipmentProfile;
const options=(actor,motion,swing=null)=>{
  const p=project(actor.x,actor.y);
  return {x:p.x,y:p.y,unit:48*p.scale,yScale:1,height:actor.height*.84,
    opponent:false,time:0,pixelRatio:1,racket:equipmentProfile,motion,swing,vx:actor.vx,vy:actor.vy,
    pivot:actor.pivot,plantX:actor.plantX,verticalVelocity:actor.verticalVelocity,recovery:actor.jumpRecovery};
};
try {
  await writeFile(temporary,source);await import(pathToFileURL(temporary).href);
  for(let i=0;i<100&&!globalThis.ShuttleAthletes.ready&&!globalThis.ShuttleAthletes.error;i++)await new Promise(r=>setTimeout(r,5));
  const api=globalThis.ShuttleAthletes;assert.equal(api.ready,true,api.error);
  const draw=(actor,motion,swing)=>{api.draw(ctx,options(actor,motion,swing));return structuredClone(api.last.player);};
  const waiting=draw(core.createPlayer(),createMotion());
  assert.ok(waiting.ready>.9&&waiting.spinePitch>.12&&waiting.hips[1]<.92);
  assert.ok(waiting.soleHeights.every(y=>y>=-.004));results.stances.push({name:'waiting',...waiting});
  for(const vx of [.5,-.5]) for(let i=0;i<24;i++) {
    const actor={...core.createPlayer(),vx},motion={...createMotion(),run:.8,lean:Math.sign(vx)*3,gait:i/24*Math.PI*2};
    const rig=draw(actor,motion);
    assert.ok(rig.stanceWidth>.44&&rig.hips[1]<.8);assert.ok(rig.soleHeights.every(y=>y>=-.004));
    results.stances.push({name:'sidestep',vx,phase:i/24,...rig});
  }
  let previousLanding=null;
  for(let frame=0;frame<=44;frame++) {
    const recovery=.18*(1-frame/44);
    const actor={...core.createPlayer(),vx:.3,jumpRecovery:recovery},motion={...createMotion(),run:.5,lean:1.5,gait:1};
    const rig=draw(actor,motion);assert.ok(rig.soleHeights.every(y=>y>=-.004));
    if(previousLanding) {
      assert.ok(rig.landingWeight<previousLanding.landingWeight,'landing contribution decreases through recovery');
      assert.ok(Math.abs(rig.hips[1]-previousLanding.hips[1])<.025,'pelvis has no visible one-frame jump during recovery');
    }
    if(recovery===.18)assert.equal(rig.landingWeight,1);
    if(recovery===0)assert.equal(rig.landingWeight,0);
    previousLanding=rig;
    results.stances.push({name:'landing',recovery,...rig});
  }
  const preparedActor=core.createPlayer(),preparedMotion=createMotion();
  for(let i=0;i<24;i++)updatePose(preparedActor,preparedMotion,null,{x:.46,y:.65,z:125},1/240);
  const preparedRig=draw(preparedActor,preparedMotion);
  assert.ok(preparedMotion.prepare>.5&&preparedRig.prepare>.5,'nearby high shuttle prepares an overhead before the click');
  assert.equal(api.checkBackhand(),true,'prepared racket clears the real skinned torso');
  results.preparation=preparedRig;
  const equipment=globalThis.ShuttleAppearance;
  const profiles=process.argv.includes('--rackets')?Object.keys(equipment.racketStyles).flatMap(style=>Object.keys(equipment.racketSizes).map(size=>equipment.racketAppearance(style,size,'#2288ff','#ff9933'))):[equipment.racketAppearance()];
  for(const profile of profiles) {
    equipmentProfile=profile;
    draw(preparedActor,preparedMotion,null);
    assert.equal(api.checkBackhand(),true,`${profile.style}/${profile.size}: prepared racket avoids body`);
  for(const scenario of ['backhand-jump','backhand-defense','forehand-jump']) for(const requested of ['clear','drop','smash']) for(const age of [.025,.05,.09,.16,.25,.36]) {
    const actor=core.createPlayer(),motion=createMotion();let ball;
    if(scenario==='backhand-defense')ball={phase:'incoming',incomingType:'smash',from:{x:.46,y:-.7},fromHeight:90,target:{x:.46,y:.6},flightArc:16,duration:1.1,age:.85};
    else {
      const apex=core.JUMP.velocity**2/(2*core.JUMP.gravity);
      actor.height=apex-.5*core.JUMP.gravity*core.SWING.impact**2;actor.verticalVelocity=core.JUMP.gravity*core.SWING.impact;
      const x=scenario==='forehand-jump'?.54:.46;
      ball={phase:'incoming',incomingType:'clear',from:{x,y:-.7},fromHeight:25,target:{x,y:.72},flightArc:380,duration:2,age:2-apex/260-core.SWING.impact};
    }
    const startAge=ball.age,predicted=core.incomingPosition({...ball,age:ball.age+core.SWING.impact});actor.y=predicted.y+.025;
    const shot=core.shotFor(actor,predicted,requested,2,ball),swing={age:0,type:shot.type,backhand:shot.backhand,overhead:shot.overhead,serving:false};
    const screen=point=>{const p=project(point.x,point.y);return{x:p.x,y:p.y-point.z};};
    swing.predictedScreen=screen(predicted);draw(actor,motion,null);
    let contact=null;
    for(let t=0;t<age-.000001;t+=.005) {
      const dt=Math.min(.005,age-t);core.updateJump(actor,dt);swing.age+=dt;
      if(!contact){ball.age=startAge+swing.age;if(swing.age>=core.SWING.impact-1e-8){contact=core.incomingPosition(ball);swing.contactScreen=screen(contact);}}
      updatePose(actor,motion,swing,contact?null:core.incomingPosition(ball),dt);
      draw(actor,motion,swing);
    }
    const rig=draw(actor,motion,swing);
    if(scenario.startsWith('backhand'))assert.equal(api.checkBackhand(),true,`${scenario}/${requested}/${age}: racket/skin collision`);
    if(age===.05||age===.09)assert.ok(Math.hypot(rig.head.x-swing.contactScreen.x,rig.head.y-swing.contactScreen.y)<.01,'real camera-space contact');
    assert.ok(rig.extension<=rig.unassistedExtension+.01,'torso never increases extension');
    assert.equal(rig.racketStyle,profile.style);assert.equal(rig.racketSize,profile.size);
    assert.equal(rig.racketFrameColor,profile.frame.slice(1));assert.equal(rig.racketGripColor,profile.grip.slice(1));
    results.contacts.push({scenario,requested,age,...rig});
  }
    api.drawRacketPreview(ctx,{racket:profile,pixelRatio:1});
    const afterPreview=draw(preparedActor,preparedMotion,null);
    assert.equal(api.checkBackhand(),true,'equipment preview restores character visibility and actual pose');
    assert.ok(afterPreview.soleHeights.every(y=>y>=-.004));
  }
  if(process.argv.includes('--rackets')) {
    const other=equipment.racketAppearance('slim','original','#cc2255','#222222');
    api.draw(ctx,{...options(core.createPlayer(),createMotion()),opponent:true,racket:other});
    assert.equal(api.last.opponent.racketFrameColor,'cc2255');
    assert.equal(api.last.player.racketFrameColor,'2288ff','other athlete has separate materials');
    assert.equal(api.last.opponent.jerseyColor,'f0ddbd','equipment leaves original jersey color');
    assert.equal(api.last.opponent.sockStripeColor,'f0ddbd');
    api.drawRacketPreview(ctx,{opponent:true,racket:other,pixelRatio:1});
    const back=draw(preparedActor,preparedMotion,null);assert.equal(back.racketFrameColor,'2288ff');
  }
  const actor={...core.createPlayer(),height:50},motion=createMotion(),swing={age:.05,type:'smash',overhead:true};
  assert.equal(draw(actor,motion,swing).upperPose,'Smash');actor.height=0;actor.jumpRecovery=.12;swing.age=.16;
  assert.equal(draw(actor,motion,swing).upperPose,'Smash','stroke stays consistent through landing');
  swing.backhand=true;assert.equal(draw(actor,motion,swing).upperPose,'Backhand','actual side corrections still take effect');
  await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts',process.argv.includes('--rackets')?'racket-motion-cpu-checks.json':'game-motion-cpu-checks.json'),JSON.stringify(results,null,2));
  console.log(`CPU motion checks passed: ${results.stances.length} support poses, ${results.contacts.length} live contacts, stroke continuity and side correction.`);
} finally {
  if(dirname(temporary)===scripts&&temporary.includes('.cpu-athlete-check-'))await rm(temporary,{force:true});
  delete globalThis.__CpuRenderer;
}
