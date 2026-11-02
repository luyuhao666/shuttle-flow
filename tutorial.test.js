import test from 'node:test';
import assert from 'node:assert/strict';
import {gameFixture} from './scripts/lib/game-fixture.mjs';

const extra=`
  lesson: () => tutorials.lessonFor(tutorial),
  tutorialState: () => ({...tutorial,best,tutorialCompleted,aimX,mode,state}),
  target: () => {const p=incomingPosition({...delivery,age:delivery.age+SWING.impact});return {x:p.x-.04,y:p.y+.025};},
  pointerX: fraction => project(fraction,-.5).x,
  cue: contactCue,
  seedBest: () => {best=previousBest=321;localStorage.setItem('shuttle-club-best','321');},
  input: movementInput
`;
function setup(mobile=false) {
  const ui=gameFixture(extra);if(mobile)ui.window.matchMedia=()=>({matches:true});
  ui.byId.get('tutorial-entry').onclick();
  ui.action=()=>ui.byId.get('tutorial-action').onclick();
  ui.key=(code,down=true)=>ui.window.dispatchEvent({type:down?'keydown':'keyup',code});
  ui.mouse=(shot,aim=.5)=>ui.byId.get('court').dispatchEvent({type:'pointerdown',pointerType:'mouse',button:shot==='smash'?2:0,clientX:ui.api.pointerX(aim),clientY:500,shiftKey:shot==='drop'});
  ui.touch=(id,type,x=250,pointerId=2)=>ui.byId.get(id).dispatchEvent({type,button:0,pointerType:'touch',pointerId,clientX:x,clientY:500});
  ui.tap=id=>{ui.touch(id,'pointerdown');ui.touch(id,'pointerup');};
  return ui;
}
function wait(ui,seconds,dt=.01) {for(let age=0;age<seconds;age+=dt)ui.api.update(dt);}
function reach(ui,dt=.01) {
  for(let i=0;i<600;i++) {
    const p=ui.api.snapshot().player,t=ui.api.target(),dx=t.x-p.x,dy=t.y-p.y;
    for(const [code,on] of [['KeyA',dx<-.025],['KeyD',dx>.025],['KeyW',dy<-.025],['KeyS',dy>.025]])ui.key(code,on);
    ui.api.update(dt);
    if(Math.hypot(dx,dy)<.04)break;
  }
  for(const code of ['KeyA','KeyD','KeyW','KeyS'])ui.key(code,false);
  wait(ui,.15,dt);
}
function beginAttempt(ui,dt=.01) {
  ui.action();wait(ui,3,dt);assert.equal(ui.api.tutorialState().phase,'explain');
  const ball=JSON.stringify(ui.api.snapshot().delivery),actor=JSON.stringify(ui.api.snapshot().player);
  wait(ui,2,dt);assert.equal(JSON.stringify(ui.api.snapshot().delivery),ball);assert.equal(JSON.stringify(ui.api.snapshot().player),actor);
  ui.action();assert.equal(ui.api.tutorialState().phase,'try');
}
function playLesson(ui,{mobile=false,dt=.01,shot,aim}={}) {
  const lesson=ui.api.lesson();beginAttempt(ui,dt);reach(ui,dt);
  if(mobile)ui.tap({clear:'touch-clear',drop:'touch-drop',smash:'touch-smash'}[shot??lesson.shot]);
  if(lesson.jump) {
    if(mobile)ui.tap('touch-jump');else ui.key('Space');
    wait(ui,.5,dt);assert.equal(ui.api.tutorialState().phase,'apex');
    const actor=JSON.stringify(ui.api.snapshot().player),age=ui.api.snapshot().delivery.age;
    wait(ui,2,dt);assert.equal(JSON.stringify(ui.api.snapshot().player),actor);assert.equal(ui.api.snapshot().delivery.age,age);
  }
  if(mobile) {ui.touch('touch-hit','pointerdown');ui.touch('touch-hit','pointerup',lesson.aim==='left'?210:250);}
  else ui.mouse(shot??lesson.shot,aim??(lesson.aim==='left'?.2:.5));
  wait(ui,3,dt);return ui.api.tutorialState();
}

for(const fps of [30,60,120,240])test(`all eight lessons complete through real mouse/key handlers at ${fps}fps`,()=>{
  const ui=setup();ui.api.seedBest();
  for(let i=0;i<8;i++) {
    const result=playLesson(ui,{dt:1/fps});
    assert.equal(result.phase,'success',`${ui.api.lesson().id}: ${JSON.stringify(result.result)}`);
    assert.equal(result.completed,i+1);assert.equal(ui.api.snapshot().delivery.shotType,ui.api.lesson().expected);
    ui.action();
  }
  assert.equal(ui.api.snapshot().state,'over');assert.equal(ui.storage.get('shuttle-club-best'),'321');
  assert.equal(JSON.parse(ui.storage.get('shuttle-flow-tutorial')).completed,true);
  assert.equal(ui.byId.get('restart').innerHTML,'Replay Tutorial <span>↗</span>');
  ui.byId.get('restart').onclick();assert.equal(ui.api.tutorialState().completed,0);assert.equal(ui.api.tutorialState().index,0);
  ui.byId.get('tutorial-exit').onclick();assert.equal(ui.api.snapshot().state,'ready');assert.equal(ui.document.body.classList.contains('tutorial-mode'),false);
});

test('touch controls complete the same lessons with a real drag-to-aim and a deliberate jump',()=>{
  const ui=setup(true);
  for(let i=0;i<8;i++) {
    const result=playLesson(ui,{mobile:true});assert.equal(result.phase,'success',`${ui.api.lesson().id}: ${JSON.stringify(result.result)}`);ui.action();
  }
  assert.equal(ui.api.snapshot().state,'over');
});

test('wrong shots and wrong aim are shown but do not advance; retry restores the same paused ball',()=>{
  const ui=setup();let result=playLesson(ui,{shot:'drop'});
  assert.equal(result.phase,'retry');assert.equal(result.result.error,'shot');assert.equal(result.completed,0);
  ui.action();assert.equal(ui.api.tutorialState().phase,'explain');ui.action();reach(ui);ui.mouse('clear');wait(ui,3);
  assert.equal(ui.api.tutorialState().phase,'success');ui.action();
  result=playLesson(ui,{aim:.7});assert.equal(result.phase,'retry');assert.equal(result.result.error,'aim');assert.equal(result.completed,1);
});

test('out and net faults fail on their real flight time and cannot record a duplicate lesson',()=>{
  for(const type of ['out','net']) {
    const ui=setup();beginAttempt(ui);reach(ui);ui.mouse('clear');wait(ui,.06);
    assert.equal(ui.api.snapshot().delivery.phase,'return');
    ui.api.snapshot().delivery.fault={type,age:.3,point:{x:.5,y:0,z:20}};
    wait(ui,.15);assert.equal(ui.api.tutorialState().phase,'flight');wait(ui,.2);
    assert.equal(ui.api.tutorialState().phase,'retry');assert.equal(ui.api.tutorialState().result.error,type);assert.equal(ui.api.tutorialState().completed,0);
    wait(ui,10);assert.equal(ui.api.tutorialState().attempts,1);
  }
});

test('a swing outside the contact ring must be retried, and instructions ignore early swings',()=>{
  const ui=setup();ui.mouse('clear');assert.equal(ui.api.tutorialState().phase,'intro');
  beginAttempt(ui);ui.mouse('clear');wait(ui,.06);
  assert.equal(ui.api.tutorialState().phase,'retry');assert.equal(ui.api.tutorialState().result.error,'far');assert.equal(ui.api.tutorialState().completed,0);
});

test('pause/help/settings preserve a frozen lesson and exit keeps normal match settings',()=>{
  const ui=setup();beginAttempt(ui);
  const old=JSON.stringify(ui.api.snapshot());ui.api.togglePause();wait(ui,3);
  assert.equal(ui.api.snapshot().delivery.age,JSON.parse(old).delivery.age);
  ui.byId.get('help-open').onclick();ui.byId.get('help-close').onclick();assert.equal(ui.api.snapshot().state,'paused');
  ui.byId.get('settings-open').onclick();ui.byId.get('settings-close').onclick();assert.equal(ui.api.snapshot().state,'paused');
  ui.byId.get('resume').onclick();assert.equal(ui.api.tutorialState().phase,'try');
  ui.byId.get('tutorial-exit').onclick();ui.byId.get('choose-match').onclick();ui.click('[data-ai-level="hard"]');ui.byId.get('start').onclick();
  assert.equal(ui.api.snapshot().mode,'match');assert.equal(ui.api.snapshot().opponent.level,'hard');assert.equal(ui.document.body.classList.contains('tutorial-mode'),false);
});

test('a captured hit before Try it is canceled at the phase boundary',()=>{
  const ui=setup(true);ui.action();wait(ui,3);
  ui.touch('touch-hit','pointerdown');ui.action();ui.touch('touch-hit','pointerup');
  assert.equal(ui.api.tutorialState().phase,'try');assert.equal(ui.api.snapshot().delivery.phase,'incoming');assert.equal(ui.api.tutorialState().attempts,0);
});
