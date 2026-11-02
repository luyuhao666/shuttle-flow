import test from 'node:test';
import assert from 'node:assert/strict';
import { gameFixture } from './scripts/lib/game-fixture.mjs';

const injection = `
  input: movementInput, controls: touchControls, prediction: contactPrediction,
  details: () => ({swing, aimX, selectedPower, previewShot, cooldown, returns}),
  defend(backhand=false) {
    state='playing';roundBreak=0;cooldown=0;swing=null;keys.clear();touchControls.reset();
    delivery={phase:'incoming',incomingType:'smash',from:{x:.5,y:-.65},target:{x:.5,y:.65},fromHeight:145,flightArc:15,duration:.65,age:.49};
    const point=incomingPosition({...delivery,age:delivery.age+SWING.impact});
    player={...createPlayer(),x:point.x+(backhand?.035:0),y:point.y};
    setAim(.5);resetPowerForIncoming();updateShotOptions();
  },
  serve() { mode='match';match=createMatch(7);match.server='player';prepareService(0);roundBreak=0;updateShotOptions(); },
  keyboard(code) { keys.add(code); },
  begin() { startGame(); }
`;
function setup() {
  const ui = gameFixture(injection);
  ui.byId.get('touch-stick').getBoundingClientRect = () => ({left:16,top:500,width:112,height:112});
  ui.byId.get('start').onclick();
  ui.byId.get('touch-power-options').hidden = true;
  ui.send = (id, type, pointerId=1, clientX=72, clientY=556, extra={}) => ui.byId.get(id).dispatchEvent({type,pointerId,clientX,clientY,button:0,pointerType:'touch',...extra});
  ui.tap = id => { ui.send(id,'pointerdown',2,250,550); ui.send(id,'pointerup',2,250,550); };
  return ui;
}
const zero = input => { assert.equal(input.dx,0); assert.equal(input.dy,0); };

test('stick dead zone, diagonal footwork and contact prediction use the existing physics', () => {
  const ui=setup(); ui.api.defend();
  ui.send('touch-stick','pointerdown'); zero(ui.api.input());
  ui.send('touch-stick','pointermove',1,76,559); zero(ui.api.input());
  ui.send('touch-stick','pointermove',1,110,518);
  const input=ui.api.input(); assert.ok(input.dx>0 && input.dy<0); assert.ok(Math.abs(Math.hypot(input.dx,input.dy)-1)<1e-12);
  const before=ui.api.snapshot().player, expected={...before};
  ShuttleCore.updateJump(expected,ShuttleCore.SWING.impact);
  ShuttleCore.movePlayer(expected,input.dx,input.dy,ShuttleCore.SWING.impact);
  const predicted=ui.api.prediction().player;
  for(const key of ['x','y','vx','vy','pivot']) assert.equal(predicted[key],expected[key],key);
  const actual={...before};ShuttleCore.updateJump(actual,.01);ShuttleCore.movePlayer(actual,input.dx,input.dy,.01);ui.api.update(.01);
  for(const key of ['x','y','vx','vy','pivot'])assert.equal(ui.api.snapshot().player[key],actual[key],key);
  ui.send('touch-stick','pointerup');zero(ui.api.input());
});

test('two pointers move and aim independently; releasing a hit never releases the stick', () => {
  const ui=setup();ui.api.defend();
  ui.send('touch-stick','pointerdown',1,110,556);
  ui.send('touch-stick','pointerup',9);assert.ok(ui.api.input().dx>0,'an unrelated finger cannot stop movement');
  ui.send('touch-hit','pointerdown',2,250,550);
  assert.equal(ui.byId.get('touch-instruction').textContent,'Release to hit · Drag to aim');
  assert.ok(ui.byId.get('touch-aim-track').classList.contains('aiming'));
  ui.send('touch-hit','pointermove',9,180,550);assert.equal(ui.api.details().aimX,.5);
  ui.send('touch-hit','pointermove',2,282,550);assert.ok(ui.api.details().aimX>.5);
  assert.equal(ui.api.details().swing,null,'dragging only aims');
  ui.send('touch-hit','pointerup',2,282,550);assert.ok(ui.api.details().swing);assert.ok(ui.api.input().dx>0);
  assert.equal(ui.byId.get('touch-instruction').textContent,'Tap to hit · Drag to aim');
  assert.equal(ui.byId.get('touch-aim-track').classList.contains('aiming'),false);
  ui.send('touch-stick','lostpointercapture',1);zero(ui.api.input());
});

function phoneSetup() {
  const ui = gameFixture(injection);
  ui.window.innerWidth=390;ui.window.innerHeight=844;
  ui.window.matchMedia=()=>({matches:true});
  ui.byId.get('choose-match').onclick();
  return ui;
}

test('portrait phone guidance waits before starting and Back preserves the match setup', () => {
  const ui=phoneSetup();ui.click('[data-ai-level="hard"]');ui.click('[data-points="15"]');
  ui.byId.get('start').onclick();
  assert.equal(ui.api.snapshot().state,'ready');
  assert.equal(ui.byId.get('phone-ready').classList.contains('hidden'),false);
  ui.step(2);assert.equal(ui.api.snapshot().delivery,null);
  ui.byId.get('phone-ready-back').onclick();
  assert.equal(ui.byId.get('mode-setup').classList.contains('hidden'),false);
  ui.byId.get('start').onclick();ui.byId.get('phone-ready-play').onclick();
  assert.equal(ui.api.snapshot().match.target,15);assert.equal(ui.api.snapshot().aiLevel,'hard');
});

test('rotating the phone prompt updates the choice and still waits for an explicit start', () => {
  const ui=phoneSetup();ui.byId.get('start').onclick();
  ui.window.innerWidth=844;ui.window.innerHeight=390;ui.window.dispatchEvent({type:'resize'});
  assert.equal(ui.api.snapshot().state,'ready');
  assert.equal(ui.byId.get('phone-ready-title').textContent,'Ready for the court');
  assert.match(ui.byId.get('phone-ready-play').firstChild.textContent,/landscape/);
  ui.byId.get('phone-ready-play').onclick();assert.equal(ui.api.snapshot().state,'playing');
});

test('portrait can continue and the phone suggestion does not repeat within the session', () => {
  const ui=phoneSetup();ui.byId.get('start').onclick();ui.byId.get('phone-ready-play').onclick();
  assert.equal(ui.api.snapshot().state,'playing');ui.api.finish();ui.api.leave();
  ui.byId.get('start').onclick();assert.equal(ui.api.snapshot().state,'playing');
  assert.equal(ui.byId.get('phone-ready').classList.contains('hidden'),true);
});

test('a phone orientation change pauses safely while a resize in the same direction keeps playing', () => {
  const ui=phoneSetup();ui.window.innerWidth=844;ui.window.innerHeight=390;ui.byId.get('start').onclick();
  ui.window.innerHeight=360;ui.window.dispatchEvent({type:'resize'});assert.equal(ui.api.snapshot().state,'playing');
  ui.api.defend();
  ui.byId.get('touch-hit').dispatchEvent({type:'pointerdown',pointerId:2,clientX:700,clientY:200,button:0});
  ui.window.innerWidth=390;ui.window.innerHeight=844;ui.window.dispatchEvent({type:'resize'});
  assert.equal(ui.api.snapshot().state,'paused');assert.equal(ui.byId.get('touch-hit').classList.contains('held'),false);
  ui.api.togglePause();ui.byId.get('touch-hit').dispatchEvent({type:'pointerup',pointerId:2,clientX:700,clientY:200});
  assert.equal(ui.api.details().swing,null);
});

test('desktop keyboard and mouse sessions start directly even in a narrow window', () => {
  const ui=gameFixture(injection);ui.window.innerWidth=390;ui.window.innerHeight=844;ui.window.matchMedia=()=>({matches:false});
  ui.byId.get('start').onclick();assert.equal(ui.api.snapshot().state,'playing');
  ui.window.innerWidth=844;ui.window.innerHeight=390;ui.window.dispatchEvent({type:'resize'});
  assert.equal(ui.api.snapshot().state,'playing');assert.equal(ui.byId.get('phone-ready').classList.contains('hidden'),true);
});

test('shot selectors do not swing; all three touch choices produce legal defense shots', () => {
  for(const [button,type,label] of [['touch-clear','lift','Lift'],['touch-drop','block','Block'],['touch-smash','drive','Drive']]) {
    const ui=setup();ui.api.defend(true);ui.tap(button);
    assert.equal(ui.api.details().swing,null);
    assert.equal(ui.byId.get(button).getAttribute('aria-pressed'),'true');
    assert.equal(ui.byId.get('touch-hit').textContent,label);
    assert.match(ui.byId.get('touch-hit').getAttribute('aria-label'),/Backhand/);
    ui.tap('touch-hit');ui.api.update(.05);
    assert.equal(ui.api.snapshot().delivery.phase,'return');
    assert.equal(ui.api.snapshot().delivery.shotType,type);
    assert.equal(ui.api.snapshot().delivery.fault,null);
  }
});

test('aim is captured at release, a native click cannot double-hit, and power follows the existing defaults', () => {
  const ui=setup();ui.api.defend();
  ui.send('touch-hit','pointerdown',2,250,550);
  ui.send('touch-hit','pointerup',2,298,550);
  const stroke=ui.api.details().swing;assert.ok(Math.abs(stroke.aimX-ShuttleCore.aimHorizontal(.875))<1e-12);
  assert.equal(stroke.power,ShuttleCore.POWER.defaults.clear);
  ui.send('touch-hit','click',2,298,550,{detail:1});assert.equal(ui.api.details().swing,stroke);
  ui.api.update(.05);assert.ok(Math.abs(ui.api.snapshot().delivery.returnTarget.x-stroke.aimX)<1e-12);
});

test('pointer cancellation, lost capture and rotation cancel a pending hit without firing it', () => {
  for(const reason of ['pointercancel','lostpointercapture','resize']) {
    const ui=setup();ui.api.defend();ui.send('touch-stick','pointerdown',1,110,556);ui.send('touch-hit','pointerdown',2,250,550);
    if(reason==='resize')ui.window.dispatchEvent({type:'resize'});
    else {ui.send('touch-hit',reason,2);ui.send('touch-stick',reason,1);}
    ui.send('touch-hit','pointerup',2,250,550);assert.equal(ui.api.details().swing,null);zero(ui.api.input());
  }
});

test('pause and loss of focus release fingers and cannot replay a held strike on resume', () => {
  for(const reason of ['pause','blur']) {
    const ui=setup();ui.api.defend();ui.send('touch-stick','pointerdown',1,110,556);ui.send('touch-hit','pointerdown',2,250,550);
    if(reason==='pause')ui.api.togglePause();else ui.window.dispatchEvent({type:'blur'});
    assert.equal(ui.api.snapshot().state,'paused');zero(ui.api.input());ui.api.togglePause();
    ui.send('touch-hit','pointerup',2,250,550);assert.equal(ui.api.details().swing,null);zero(ui.api.input());
    ui.api.finish();ui.tap('touch-smash');ui.tap('touch-hit');assert.equal(ui.api.details().swing,null,'result panel blocks touch input');
  }
});

test('touch serves retain the stop-moving rule and support long and short choices', () => {
  for(const [button,kind] of [['touch-clear','long'],['touch-smash','short']]) {
    const ui=setup();ui.api.serve();assert.equal(ui.byId.get('touch-drop').hidden,true);assert.equal(ui.byId.get('touch-jump').disabled,true);
    ui.tap(button);ui.send('touch-stick','pointerdown',1,110,556);ui.tap('touch-hit');
    assert.equal(ui.api.details().swing,null,'even a fresh stick input blocks a serve before velocity builds');
    ui.send('touch-stick','pointerup');ui.tap('touch-hit');ui.api.update(.05);
    assert.equal(ui.api.snapshot().delivery.serviceKind,kind);assert.equal(ui.api.snapshot().delivery.fault,null);
    assert.equal(ui.byId.get('touch-drop').hidden,false);
  }
});

test('temporary touch power resets next ball; selection survives a rally but a new game starts with clear', () => {
  const ui=setup();ui.api.defend();ui.tap('touch-smash');
  ui.send('touch-power-toggle','click',2,0,0,{detail:1});assert.equal(ui.byId.get('touch-power-options').hidden,false);
  ui.document.querySelector('[data-power="1"]').dispatchEvent({type:'pointerdown'});assert.equal(ui.api.details().selectedPower,1);
  ui.tap('touch-hit');ui.api.update(.05);assert.equal(ui.api.snapshot().delivery.power,1);
  ui.api.defend();assert.equal(ui.api.details().selectedPower,null);assert.equal(ui.api.controls.requested(),'smash');
  ui.api.begin();assert.equal(ui.api.controls.requested(),'clear');assert.equal(ui.byId.get('touch-power-options').hidden,true);
});

test('keyboard movement has priority and still follows the original WASD direction calculation', () => {
  const ui=setup();ui.send('touch-stick','pointerdown',1,110,556);ui.api.keyboard('KeyA');
  assert.equal(ui.api.input().dx,-1);assert.equal(ui.api.input().dy,0);
  ui.api.keyboard('KeyW');assert.equal(ui.api.input().dx,-1);assert.equal(ui.api.input().dy,-1);
  const server=setup();server.api.serve();server.api.keyboard('KeyA');server.api.keyboard('KeyD');server.tap('touch-hit');
  assert.equal(server.api.details().swing,null,'opposed keyboard keys retain the original serve guard');
});

test('jump is deliberate and uses the original jump physics, without automatically swinging', () => {
  const ui=setup();ui.api.defend();ui.tap('touch-smash');ui.tap('touch-jump');
  assert.equal(ui.api.snapshot().player.verticalVelocity,ShuttleCore.JUMP.velocity);
  assert.equal(ui.api.details().swing,null);ui.api.update(.1);assert.ok(ui.api.snapshot().player.height>0);
});

test('backgrounding and returning to the menu clear captured input', () => {
  const ui=setup();ui.api.defend();ui.send('touch-stick','pointerdown',1,110,556);ui.send('touch-hit','pointerdown',2,250,550);
  ui.document.hidden=true;ui.document.dispatchEvent({type:'visibilitychange'});
  assert.equal(ui.api.snapshot().state,'paused');zero(ui.api.input());
  ui.document.hidden=false;ui.api.togglePause();ui.send('touch-hit','pointerup',2,250,550);assert.equal(ui.api.details().swing,null);
  ui.send('touch-stick','pointerdown',1,110,556);ui.api.finish();ui.api.leave();
  assert.equal(ui.api.snapshot().state,'ready');zero(ui.api.input());
});
