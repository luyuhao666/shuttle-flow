// Optional Windows/Edge smoke check. Uses built-in Node CDP/WebSocket support.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(artifacts, '.browser-check-'));
// Exercise the real audio graph with a fake final output stream, independent of host audio devices.
const electronCheck = process.argv.includes('--electron');
const browserBinary = electronCheck ? createRequire(import.meta.url)('electron') : process.env.SHUTTLE_CHECK_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const browser = spawn(browserBinary, [
  ...(electronCheck ? [join(root,'desktop','athlete-preview.cjs'),'--athlete-check','--game-browser-check'] : []),
  ...(electronCheck ? ['--disable-audio-output'] : ['--headless=new', '--disable-audio-output', '--disable-gpu', '--enable-unsafe-swiftshader', '--in-process-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-features=msEdgeSidebarV2']),
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { env, windowsHide: true, stdio: ['ignore','ignore','pipe'] });
let browserLog = ''; browser.stderr.on('data', chunk => { browserLog += chunk; });
browser.on('exit', code => { if (code) console.error(electronCheck ? 'Electron exit' : 'Edge exit', code, browserLog.slice(-1800)); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let socket, send;
try {
  let port;
  for (let i = 0; i < 150; i++) {
    port = Number(browserLog.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]); if (port) break;
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await sleep(100); }
  }
  assert.ok(port, 'Browser exposes its debugging port');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  let sequence = 0;
  const pending = new Map(), listeners = new Map(), errors = [];
  socket.onclose = e => { for (const p of pending.values()) p.reject(new Error(`Browser debugging socket closed: ${e.code} ${e.reason}`)); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const p = pending.get(message.id); pending.delete(message.id); if (message.error) p.reject(message.error); else p.resolve(message.result); }
    else for (const handler of listeners.get(message.method) ?? []) handler(message.params);
  };
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve:r => {clearTimeout(timeout);resolve(r);}, reject:e => {clearTimeout(timeout);reject(e);} }); socket.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, callback) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(callback); };
  on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture:true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Debugger.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const game = await readFile(join(root, 'game.js'), 'utf8');
  const lineNumber = game.split('\n').findIndex(line => line.startsWith('function frame(now)'));
  // Hold only the fixture clock while CDP delivers real input, so slow software
  // rendering cannot age a defense ball out of reach between separate commands.
  const hook = `const checkUpdate=update;let inputClockHeld=false;
  update=dt=>{if(!inputClockHeld)checkUpdate(dt);};
  window.__courtCheck = {
    holdInputClock() { inputClockHeld=true; },
    touchState() { return {movement:movementInput(),aimX,swing,selectedPower,requested:touchControls.requested()}; },
    selectTouch(type) { touchControls.select(type); },
    tutorialState() { return {tutorial,lesson:tutorial?{...tutorials.lessonFor(tutorial)}:null,player,delivery,mode,state,best,tutorialCompleted,cue:contactCue()}; },
    tutorialTarget() {const p=incomingPosition({...delivery,age:delivery.age+SWING.impact});return {x:p.x-.04,y:p.y+.025};},
    tutorialFrames(seconds) {for(let i=0;i<Math.ceil(seconds*120);i++)checkUpdate(1/120);draw();},
    tutorialPointer(fraction) {const r=canvas.getBoundingClientRect(),p=project(fraction,-.5);return {x:r.left+p.x*r.width/1200,y:r.top+r.height*.8};},
    finishInput() { checkUpdate(.05);state='paused';inputClockHeld=false;draw(); },
    step(dt) { checkUpdate(dt); draw(); },
    freeze() { state = 'paused'; },
    guidanceProbe(kind='hit') {
      this.scenario('clear');feedback('检查提示','详细说明',false,kind);draw();
      return {mode:guidanceMode,labels:courtLabels.length,visible:document.getElementById('feedback').classList.contains('visible'),
        options:getComputedStyle(document.getElementById('shot-options')).display};
    },
    prepareScene() {
      this.scenario('live-high');for(let i=0;i<24;i++)update(1/240);state='paused';draw();
      return {motion:{...motion},rig:ShuttleAthletes.last.player};
    },
    landingStroke() {
      const saved=[returns,combo,score,perfects,maxCombo,lifts,blocks,drives,taps,smashes];
      try {
        this.scenario('jump');hit('smash');update(.05);draw();const air=ShuttleAthletes.last.player;
        player.height=0;player.verticalVelocity=0;player.jumpRecovery=.12;swing.age=.16;state='paused';draw();
        return {air,land:ShuttleAthletes.last.player};
      } finally {[returns,combo,score,perfects,maxCombo,lifts,blocks,drives,taps,smashes]=saved;}
    },
    showGuides() { state='playing';draw(); },
    aimPointer(fraction) { const rect=canvas.getBoundingClientRect();aimFromPointer({clientX:rect.left+project(fraction,-.5).x*rect.width/1200});return aimX; },
    rendering() { return {width:canvas.width,height:canvas.height,cacheWidth:courtBackdrop?.width,cacheHeight:courtBackdrop?.height}; },
    audioSettings() { return {volume,muted,created:!!masterGain,gain:masterGain?.gain.value,state:audio?.state,time:audio?.currentTime}; },
    advance(dt) { state='playing';update(dt);state='paused';draw(); },
    snapshot() { return { state, mode, training, player, opponent, swing, motion, opponentMotion, best, elapsed, score, returns, practiceMisses, practiceOuts, practiceNets, cue: contactCue(), turn: motion.turn, lunge: motion.lunge, high: motion.high, delivery, counts:{lifts,blocks,drives} }; },
    frames(seconds) { state='playing';for(let i=0;i<seconds*120 && state==='playing';i++) update(1/120);if(state==='playing')state='paused';draw(); },
    drillBall(goal=true) {
      state='playing'; if(!delivery) {nextFeed=0;update(.001);}
      const completed=training.completed; let launched=false;
      for(let i=0;i<1500 && state==='playing' && training.completed===completed;i++) {
        if(goal && delivery?.phase==='incoming') {
          const point=training.kind==='jump'?{x:delivery.from.x+(delivery.target.x-delivery.from.x)*.88-.035,y:delivery.target.y}:incomingPosition({...delivery,age:delivery.age+.08});
          keys.clear(); const tx=point.x-player.x,ty=(training.kind==='jump'?point.y:delivery.start.y)-player.y;
          if(Math.abs(tx)>.025)keys.add(tx>0?'KeyD':'KeyA');if(Math.abs(ty)>.025)keys.add(ty>0?'KeyS':'KeyW');
          if(training.kind==='jump' && !launched && delivery.duration-delivery.age<=.56) {jump();launched=true;}
          const requested=training.kind==='jump'?'smash':training.kind==='net'?'drop':'clear';
          const prediction=contactPrediction(),planned=shotFor(prediction.player,prediction.point,requested,defaultPowerFor(requested,powerDefaults),prediction.ball);
          if(contactCue().grade && !swing && !cooldown && (training.kind!=='jump'||planned.type==='smash' && Math.abs(contactTimingError(prediction.player,prediction.ball))<=.045) && (training.kind!=='net'||prediction.ball.age<=delivery.duration-.18))hit(requested);
        }
        update(1/120);
      }
      keys.clear();if(state==='playing')state='paused';draw();return training;
    },
    humanJumpBall(jumpReaction=.15,hitReaction=.10) {
      state='playing'; if(!delivery) {nextFeed=0;update(.001);}
      const completed=training.completed; let jumpCueAt=null,goldCueAt=null,launched=false,pressed=false;
      keys.clear();player={...createPlayer(),...delivery.target};cooldown=0;swing=null;
      for(let i=0;i<2000 && state==='playing' && training.completed===completed;i++) {
        if(delivery?.phase==='incoming') {
          if(!launched && jumpCueAt===null && /现在Jump/.test(document.getElementById('action-status').textContent))jumpCueAt=delivery.age;
          if(!launched && jumpCueAt!==null && delivery.age-jumpCueAt>=jumpReaction){jump();launched=true;}
          if(launched && goldCueAt===null && contactCue().smash)goldCueAt=delivery.age;
          if(!pressed && goldCueAt!==null && delivery.age-goldCueAt>=hitReaction){hit('smash');pressed=true;}
        }
        update(1/240);
      }
      if(state==='playing')state='paused';draw();return {completed:training.completed,succeeded:training.succeeded,jumpCueAt,goldCueAt,pressed,shot:delivery?.shotType};
    },
    practiceJumpBall(seed=.4) {
      state='playing';roundBreak=0;keys.clear();swing=null;cooldown=0;player=createPlayer();
      delivery=makeDelivery(player,returns,()=>seed);player={...player,...delivery.target};
      let jumpCueAt=null,goldCueAt=null,launched=false,pressed=false;
      for(let i=0;i<2000 && delivery?.phase==='incoming';i++) {
        if(!launched && jumpCueAt===null && delivery.duration-delivery.age<=.85 && assessJumpPreparation(player,delivery).smash)jumpCueAt=delivery.age;
        if(!launched && jumpCueAt!==null && delivery.age-jumpCueAt>=.10){jump();launched=true;}
        if(launched && goldCueAt===null && contactCue().smash)goldCueAt=delivery.age;
        if(!pressed && goldCueAt!==null && delivery.age-goldCueAt>=.06){hit('smash');pressed=true;}
        update(1/240);
      }
      state='paused';draw();return {jumpCueAt,goldCueAt,pressed,shot:delivery?.shotType,phase:delivery?.phase,fault:delivery?.fault,ballHeight:delivery?.returnHeight,playerHeight:player.height};
    },
    scenario(name) {
      state = 'playing'; roundBreak = 0; cooldown = 0; swing = null; keys.clear(); particles = []; impact = null;
      player = createPlayer();for(const key of Object.keys(motion))motion[key]=0;setAim(.5);resetPowerForIncoming();feedbackTime=0;document.getElementById('feedback').classList.remove('visible');
      if (name === 'clear') delivery = { phase:'incoming', from:{x:.5,y:-.7}, target:{x:.5,y:.65}, duration:2, age:1.91 };
      if (name === 'far') delivery = { phase:'incoming', from:{x:.5,y:-.7}, target:{x:.2,y:.4}, duration:2, age:1.91 };
      if (name === 'late') delivery = { phase:'incoming', from:{x:.5,y:-.7}, target:{x:.5,y:.65}, duration:2, age:2.10 };
      if (name === 'early') delivery = { phase:'incoming', from:{x:.5,y:-.7}, target:{x:.5,y:.65}, duration:2, age:1.2 };
      if (['drop','high','lunge'].includes(name)) {
        delivery = { phase:'incoming', incomingType:'drop', from:{x:.5,y:-.65}, target:{x:.5,y:.5}, fromHeight:90, flightArc:108, duration:1.4, age:name === 'high' ? .93 : name === 'lunge' ? 1.29 : 1.18 };
        const point = incomingPosition({ ...delivery, age:delivery.age + SWING.impact }); player.x = point.x; player.y = point.y;
      }
      if (name === 'jump') {
        startJump(player); updateJump(player,.31);
        delivery = { phase:'incoming', from:{x:.55,y:-.7}, target:{x:.5,y:.65}, flightArc:330, duration:2, age:1.7 };
      }
      if (['phantom-high', 'live-high'].includes(name)) {
        delivery={phase:'incoming',incomingType:'clear',from:{x:.5,y:-.8},fromHeight:25,target:{x:.5,y:.88},flightArc:300,duration:2,age:1.65};
        player.height=55;player.verticalVelocity=0;player.y=.88;
        if(name==='live-high') {const point=incomingPosition({...delivery,age:delivery.age+SWING.impact});player.x=point.x;player.y=point.y;}
      }
      if (name === 'defense') {
        delivery={phase:'incoming',incomingType:'smash',from:{x:.65,y:-.7},fromHeight:90,target:{x:.4,y:.6},flightArc:16,duration:1.1,age:.85};
        const point=incomingPosition({...delivery,age:delivery.age+SWING.impact});player.x=point.x-.04;player.y=point.y;
      }
      if(name.startsWith('tap-')) {
        const z=name==='tap-low'?55:name==='tap-backhand'?105:80;
        delivery={phase:'incoming',incomingType:'clear',from:{x:.5,y:-.7},target:{x:.5,y:.72},fromHeight:25,duration:2,age:1.80};
        delivery.flightArc=(z-25)/Math.sin(Math.PI*(delivery.age+SWING.impact)/delivery.duration);
        const point=incomingPosition({...delivery,age:delivery.age+SWING.impact});
        player.x=point.x+(name==='tap-center'?.02:name==='tap-backhand'?.04:-.04);player.y=point.y+.025;
      }
      if (name.startsWith('backhand')) {
        if(name==='backhand-defense') {
          delivery={phase:'incoming',incomingType:'smash',from:{x:.46,y:-.7},fromHeight:90,target:{x:.46,y:.6},flightArc:16,duration:1.1,age:.85};
        } else {
          const apex=globalThis.ShuttleCore.JUMP.velocity**2/(2*globalThis.ShuttleCore.JUMP.gravity);
          player.height=apex-.5*1100*SWING.impact**2;player.verticalVelocity=1100*SWING.impact;
          delivery={phase:'incoming',incomingType:'clear',from:{x:.46,y:-.7},fromHeight:25,target:{x:.46,y:.72},flightArc:380,duration:2,age:2-apex/260-SWING.impact};
          if(name==='backhand-fail')player.pivot=.7;
        }
        const point=incomingPosition({...delivery,age:delivery.age+SWING.impact});player.y=point.y+.025;
      }
      updatePowerStatus();updateShotOptions(); draw(); return contactCue();
    },
    hit(type) { hit(type); },
    landingSide(x,side) {
      this.scenario('clear');delivery.target.x=x;delivery.age=1.865;
      player.x=x+side*.13;player.y=.65;updateShotOptions();draw();return contactCue();
    },
    poseScene(name) {
      state='playing';mode='practice';player=createPlayer();delivery=null;swing=null;cooldown=0;nextFeed=20;roundBreak=0;keys.clear();particles=[];impact=null;landing=null;feedbackTime=0;
      document.getElementById('feedback').classList.remove('visible');for(const key of Object.keys(motion))motion[key]=0;
      if(name==='split')delivery={phase:'incoming',from:{x:.5,y:-.7},target:{x:.5,y:.65},age:0,duration:2};
      if(name==='shuffle'||name==='brake')keys.add('KeyD');if(name==='retreat')keys.add('KeyS');
      if(['takeoff','apex','landing'].includes(name))startJump(player);
      const duration=name==='split'?.12:name==='brake'?.22:name==='apex'?.32:name==='landing'?.69:name==='takeoff'?.10:.22;
      for(let i=0;i<Math.round(duration*240);i++)update(1/240);
      if(name==='brake'){keys.clear();keys.add('KeyA');for(let i=0;i<12;i++)update(1/240);}
      state='paused';draw();return this.snapshot();
    },
    strike(type) { state='playing';hit(type);update(.05);state='paused';draw(); },
    probeBackhand(scenario,requested,age) {
      const saved=[returns,combo,score,perfects,maxCombo,lifts,blocks,drives,taps,smashes];
      try {
        this.scenario(scenario);hit(requested);
        for(let t=0;t<age-.000001;t+=.005)update(.005);
        state='paused';draw();const pose=ShuttleAthletes.last.player;
        return {clear:ShuttleAthletes.checkBackhand(),pose,contact:this.contactCheck()};
      } finally {[returns,combo,score,perfects,maxCombo,lifts,blocks,drives,taps,smashes]=saved;}
    },
    venuePreview(pose='idle') {
      this.poseScene(pose);return canvas.toDataURL('image/png').split(',')[1];
    },
    venueScene(style='classic') {
      guidanceMode='compact';document.body.dataset.guidance='compact';
      document.getElementById('choose-match').click();document.getElementById('start').click();appearanceSettings.court=style;courtBackdrop=null;
      match.player=4;match.computer=3;match.server='player';resetRally();
      this.scenario('clear');player.x=.38;player.y=.64;opponent.x=.61;opponent.y=-.65;
      delivery.age=1.35;setAim(.72);updateHud();state='paused';draw();
    },
    venueDetails() {
      guidanceMode='full';document.body.dataset.guidance='full';
      match.target=21;match.player=20;match.computer=19;updateHud();draw();
    },
    venueCache() {
      const cached=courtBackdrop,pixels=cached.toDataURL();draw();const reused=cached===courtBackdrop;
      courtBackdrop=null;const start=performance.now();draw();const rebuildMs=performance.now()-start;
      return {reused,deterministic:pixels===courtBackdrop.toDataURL(),rebuildMs};
    },
    venueDaylight() {
      const sample=(x,y)=>[...courtBackdrop.getContext('2d').getImageData(Math.round(x*courtBackdrop.width/1200),Math.round(y*courtBackdrop.height/720),1,1).data].slice(0,3);
      const far=project(.30,-.58),near=project(.79,.61),c=canvas.getBoundingClientRect();
      const text=[...document.querySelectorAll('#match-board strong,#match-board .match-side>span,#match-server,.power-status')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{
        const r=e.getBoundingClientRect();return {label:e.textContent,color:getComputedStyle(e).color,background:sample((r.x+r.width/2-c.x)*1200/c.width,(r.y+r.height/2-c.y)*720/c.height)};
      });
      return {walls:[[110,38],[1090,38],[450,132]].map(([x,y])=>sample(x,y)),floors:[sample(far.x,far.y),sample(near.x,near.y)],ink:courtTextInks[appearanceSettings.court],text};
    },
    guidePreview() {
      this.scenario('phantom-high');
      // Measure the ring's ink, rather than the larger new shoe covering that pixel.
      player.x=.25;
      setAim(.7);
      const p=project(delivery.target.x,delivery.target.y),scale=Math.SQRT1_2;
      const detail=Math.min(1.7,courtTextScale);
      const x=Math.round((p.x+20*p.scale*scale*detail)*canvas.width/1200),y=Math.round((p.y-8*p.scale*scale*detail*figureYScale)*canvas.height/720);
      const originalRing=drawGuideRing;let aimPoint;
      try {
        drawGuideRing=(...args)=>{aimPoint??={x:args[0],y:args[1]};originalRing(...args);};
        state='playing';draw();
        return {image:canvas.toDataURL('image/png').split(',')[1],marker:[...ctx.getImageData(x,y,1,1).data],aim:[...ctx.getImageData(Math.round(aimPoint.x*canvas.width/1200),Math.round(aimPoint.y*canvas.height/720),1,1).data],floor:[...courtBackdrop.getContext('2d').getImageData(x,y,1,1).data]};
      } finally {drawGuideRing=originalRing;state='paused';}
    },
    appearancePreview() {
      this.poseScene('idle');const originalScale=figureScale;
      try {
        figureScale=3.2;ctx.clearRect(0,0,1200,720);
        const background=ctx.createLinearGradient(0,0,1200,720);background.addColorStop(0,'#183b3e');background.addColorStop(1,'#102d30');
        ctx.fillStyle=background;ctx.fillRect(0,0,1200,720);
        ctx.fillStyle='#e5f1d4';ctx.font='26px Microsoft YaHei';ctx.textAlign='center';ctx.fillText('人物比例与服装细节',600,100);
        drawPerson(.28,.72);drawPerson(.72,.72,true);
        ctx.font='16px Microsoft YaHei';ctx.fillStyle='#a9c4b6';
        for(const [x,label] of [[.28,'Player · 01'],[.72,'CPU · 02']]){const point=project(x,.72);ctx.fillText(label,point.x,point.y+45);}
        return canvas.toDataURL('image/png').split(',')[1];
      } finally { figureScale=originalScale;draw(); }
    },
    switchToForehand() { player.vx=-RULES.speed; keys.add('KeyA'); },
    practiceAttempt(kind) {
      this.scenario('clear');
      if(kind==='miss') { delivery.age=delivery.duration+.12;update(.02); }
      else {
        if(kind==='out')setAim(1);
        if(kind==='net') {player.pivot=1;player.y=delivery.target.y=.94;delivery.age=delivery.duration+.065;}
        hit(kind==='net'?'drop':'clear');update(.05);
      }
      state='paused';draw();
    },
    drillJumpCue(y=null) { state='playing';delivery=makeTrainingDelivery(training);player={...createPlayer(),...delivery.target};if(y!==null)player.y=y;delivery.age=delivery.duration-.56;update(.001);draw();state='paused'; },
    aiReturn(type) { state='playing';delivery={phase:'return',shotType:type,age:.5,returnDuration:.7,returnFrom:{x:.5,y:.5},returnTarget:{x:.5,y:-.5},returnHeight:65,returnEndHeight:0,returnArc:30};opponentReturn();draw(); },
    score(p,c,server) { match.player=p; match.computer=c; match.server=server; match.winner=null; updateHud(); },
    resetMatchRound() { resetRally();state='paused';draw(); },
    playerService(score=1, moving=false) {
      match.server='player';match.player=score;resetRally();roundBreak=0;state='playing';
      if(moving){player.vx=.2;keys.add('KeyD');}
      updateShotOptions();updatePowerStatus();draw();
    },
    winMatch() { match.player=match.target;match.computer=0;match.winner='player';finish(); },
    defendPlayerAttack(jumping=false,aim=.5,startX=.5) {
      match=createMatch(selectedPoints);roundBreak=0;state='playing';swing=opponentSwing=null;
      player={...createPlayer(),x:.5,y:.65,height:jumping?55:0};opponent=createOpponent(aiLevel,aiStyle);
      Object.assign(opponent,{x:startX,y:-.65,reaction:opponent.skill.reaction,intent:'chase'});
      const contact={x:.5,y:.65,z:jumping?145:95},plan=planReturn(player,contact,'smash',2,aim);
      const ball={phase:'return',age:0,shotType:plan.type,returnFrom:contact,returnHeight:contact.z,returnTarget:plan.target,returnEndHeight:plan.endHeight,returnArc:plan.arc,returnDuration:plan.duration,fault:plan.fault};
      delivery=ball;
      for(let frame=0;frame<120&&delivery.phase==='return';frame++)checkUpdate(1/120);
      const returned=delivery.phase==='incoming',point=returnPosition(ball),reach=Math.hypot(opponent.x-point.x,opponent.y-point.y);
      state='paused';updateHud();draw();
      return {returned,reach,radius:opponent.skill.radius,level:opponent.level,type:plan.type};
    },
    contactCheck() {
      const point = swing?.contactScreen; if (!point) return null;
      if (globalThis.ShuttleAthletes?.ready) {
        drawPerson(player.x,player.y);
        return {point,head:ShuttleAthletes.last.player.head};
      }
      const heads = [];
      const savedEllipse = ctx.ellipse;
      ctx.ellipse = function(x,y,rx,ry,...args) {
        if (x===13 && y===-29 && rx===10 && ry===14) {
          const m=this.getTransform(); heads.push({x:(m.a*x+m.c*y+m.e)*1200/canvas.width,y:(m.b*x+m.d*y+m.f)*720/canvas.height});
        }
        return savedEllipse.call(this,x,y,rx,ry,...args);
      };
      try { drawPerson(player.x,player.y); } finally { ctx.ellipse=savedEllipse; }
      return {point,head:heads.at(-1)};
    }
  };`;
  let resolveHook;
  const hooked = new Promise(r => { resolveHook = r; });
  const bp = await send('Debugger.setBreakpointByUrl', { urlRegex: 'game\\.js$', lineNumber });
  on('Debugger.paused', async e => {
    try {
      const r = await send('Debugger.evaluateOnCallFrame', { callFrameId: e.callFrames[0].callFrameId, expression: hook });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      await send('Debugger.removeBreakpoint', { breakpointId: bp.breakpointId });
      await send('Debugger.resume'); resolveHook();
    } catch (error) { console.error(error); process.exitCode = 1; }
  });
  await send('Page.navigate', { url: pathToFileURL(join(root, 'index.html')).href });
  await Promise.race([hooked, sleep(10000).then(() => { throw new Error('Timed out waiting for game to run'); })]);
  await send('Debugger.disable');
  for (let i=0;i<150 && !await evaluate(`!!globalThis.ShuttleAthletes?.ready`);i++) await sleep(100);
  assert.equal(await evaluate(`globalThis.ShuttleAthletes?.ready`), true, 'offline game uses the real GLB athletes');
  assert.equal(await evaluate(`ShuttleAthletes.asset`), 'pixel-athlete-v2', 'production game has switched to the new character');
  assert.equal(await evaluate(`document.body.dataset.guidance`),'compact','new profiles start with the quieter court');
  const shot = async name => {
    const { data } = await send('Page.captureScreenshot', name.endsWith('.jpg') ? { format:'jpeg', quality:90, captureBeyondViewport:false } : { format:'png' });
    await writeFile(join(artifacts, process.argv.includes('--chinese') ? `chinese-${name}` : name), Buffer.from(data, 'base64'));
  };
  const bounds = async () => evaluate(`(() => { const r=document.querySelector('.game-shell').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,scroll:document.documentElement.scrollWidth};})()`);
  const tapTouch = async id => {
    const p=await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  if(process.argv.includes('--chinese'))await evaluate(`document.getElementById('settings-menu').click();document.querySelector('[data-language="zh-CN"]').click();document.getElementById('settings-close').click();`);
  verification: {
  if(process.argv.includes('--language')) {
    const report=[];
    const click=async id=>evaluate(`document.getElementById('${id}').click()`);
    const choose=async language=>evaluate(`document.querySelector('[data-language="${language}"]').click()`);
    const audit=async label=>{
      const result=await evaluate(`(()=>{
        const leftovers=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
        const untranslated=text=>/[A-Za-z]{2,}/.test(text.replace(/Shuttle Flow|Radmin VPN|Windows|IPv4|VPN|IP|English|WASD|Shift|SPACE|Space/g,''));
        while(walker.nextNode()) {const n=walker.currentNode;if(n.parentElement.closest('script,style'))continue;if(untranslated(n.nodeValue))leftovers.push({id:n.parentElement.id||n.parentElement.tagName,text:n.nodeValue.trim()});}
        for(const e of document.querySelectorAll('[title],[aria-label],[aria-valuetext]'))for(const key of ['title','aria-label','aria-valuetext'])if(untranslated(e.getAttribute(key)||''))leftovers.push({id:e.id||e.tagName,attribute:key,text:e.getAttribute(key)});
        const overflow=[...document.querySelectorAll('.panel:not(.hidden),.panel:not(.hidden) .panel-content')].filter(e=>e.getBoundingClientRect().width&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className);
        return {lang:document.documentElement.lang,leftovers,overflow};
      })()`);
      assert.equal(result.lang,'zh-CN');assert.deepEqual(result.leftovers,[],`${label}: all interface text and accessibility labels are Chinese`);assert.deepEqual(result.overflow,[],`${label}: no overflow`);
      report.push({label,...result});
    };
    await evaluate('__courtCheck.holdInputClock()');
    assert.equal(await evaluate('document.documentElement.lang'),'en','new profiles default to English');
    await click('settings-menu');await choose('zh-CN');await audit('initial Chinese settings');
    assert.equal(await evaluate(`localStorage.getItem('shuttle-flow-language')`),'zh-CN');
    assert.equal(await evaluate(`document.getElementById('settings-title').textContent`),'游戏设置');
    await click('settings-close');await audit('Chinese home');
    await click('help-open');await audit('Chinese help');await click('help-close');
    await click('personalize-menu');await audit('Chinese appearance');await shot('language-personalization-desktop.png');await click('personalization-close');
    for(const [label,width,height,mobile] of [['desktop',1400,900,false],['laptop',1024,640,false],['portrait',390,844,true],['small',320,568,true],['landscape',844,390,true],['short-landscape',568,320,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile});
      await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await sleep(100);
      await click('settings-menu');await audit(`${label} settings`);await shot(`language-settings-${label}.png`);
      assert.equal(await evaluate(`(()=>{const e=document.querySelector('[data-language="zh-CN"]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),true,'language control can be reached');
      await click('settings-close');await audit(`${label} home`);
      for(const mode of ['practice','match','drill']) {
        await click(`choose-${mode}`);await audit(`${label} ${mode} setup`);await click('start');
        if(await evaluate(`!document.getElementById('phone-ready').classList.contains('hidden')`)){await audit(`${label} phone suggestion`);await click('phone-ready-play');}
        await evaluate(`__courtCheck.holdInputClock();__courtCheck.step(.001);`);
        if(mode==='match')await evaluate(`__courtCheck.score(6,6,'player');__courtCheck.playerService(6);`);
        if(mobile&&width>height&&mode==='match')assert.equal(await evaluate(`(()=>{const c=document.getElementById('court').getBoundingClientRect();return ['action-status','power-status'].every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return !r.width||(r.left>=c.left&&r.right<=c.right);});})()`),true,'localized match cues stay inside the court and away from the joystick');
        await audit(`${label} ${mode} court`);await shot(`language-${mode}-${label}.png`);
        await click('settings-open');const before=await evaluate('JSON.stringify(__courtCheck.snapshot())');
        await choose('en');assert.equal(await evaluate('JSON.stringify(__courtCheck.snapshot())'),before,'English switch preserves the match');
        assert.equal(await evaluate(`document.getElementById('settings-title').textContent`),'Settings');
        await choose('zh-CN');assert.equal(await evaluate('JSON.stringify(__courtCheck.snapshot())'),before,'Chinese switch preserves the match');
        await audit(`${label} ${mode} paused settings`);await click('settings-close');await audit(`${label} ${mode} paused`);
        if(mode==='match')await evaluate('__courtCheck.winMatch()');
        else await click('pause-menu');
        await audit(`${label} ${mode} results`);await shot(`language-results-${mode}-${label}.png`);await click('result-menu');
      }
      await click('choose-practice');await evaluate(`document.querySelector('[data-practice="target"]').click();document.querySelector('[data-target-kind="net"]').click();`);
      assert.equal(await evaluate(`document.querySelector('[data-target-kind="net"]').textContent`),'网前');
      await audit(`${label} target setup`);await click('start');await evaluate(`__courtCheck.step(.01)`);await audit(`${label} target court`);
      await click('pause');await click('pause-menu');await audit(`${label} target results`);await click('result-menu');
      await evaluate(`document.getElementById('choose-practice').click();document.querySelector('[data-practice="feed"]').click();document.getElementById('setup-back').click();`);
    }
    await click('settings-menu');await choose('en');await click('settings-close');
    assert.equal(await evaluate(`document.getElementById('choose-match').textContent.includes('Match Mode')`),true,'English restores nested home labels');
    assert.equal(await evaluate(`document.documentElement.lang`),'en');
    // Reload through the real entrypoint to verify saved Chinese before any UI interaction.
    await click('settings-menu');await choose('zh-CN');
    await send('Page.reload');
    for(let attempt=0;attempt<100;attempt++){
      if(await evaluate('document.documentElement?.lang==="zh-CN"&&document.getElementById("settings-title")?.textContent==="游戏设置"'))break;
      await sleep(100);
    }
    assert.equal(await evaluate('document.documentElement.lang'),'zh-CN');assert.equal(await evaluate(`document.getElementById('settings-title').textContent`),'游戏设置');
    await shot('language-saved-reload.png');assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'language-browser-checks.json'),JSON.stringify({browser:browserBinary,report,errors,savedLanguageReload:true,actualPhoneTested:false},null,2));
    console.log(`Language: ${report.length} Chinese interface states across six viewports; live switching preserves games; English restoration and saved-language reload passed.`);
    break verification;
  }
  if (process.argv.includes('--tutorial')) {
    const report=[];
    const layouts=[];
    const key=async(code,down)=>send('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key:code==='Space'?' ':code.startsWith('Key')?code.slice(3).toLowerCase():code});
    const click=async id=>evaluate(`document.getElementById('${id}').click()`);
    const frames=async seconds=>evaluate(`__courtCheck.tutorialFrames(${seconds})`);
    const state=async()=>evaluate('__courtCheck.tutorialState()');
    const contact=async(lesson,mobile)=>{
      if(mobile) {
        await tapTouch({clear:'touch-clear',drop:'touch-drop',smash:'touch-smash'}[lesson.shot]);
        const p=await evaluate(`(()=>{const r=document.getElementById('touch-hit').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:2}]});
        if(lesson.aim==='left')await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x-48,y:p.y,id:2}]});
        await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      } else {
        const p=await evaluate(`__courtCheck.tutorialPointer(${lesson.aim==='left'?.2:.5})`),button=lesson.shot==='smash'?'right':'left',modifiers=lesson.shot==='drop'?8:0;
        await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button,buttons:button==='right'?2:1,clickCount:1,modifiers});
        await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button,buttons:0,clickCount:1,modifiers});
      }
    };
    for(const [label,width,height,mobile] of [['desktop',1400,900,false],['portrait',390,844,true],['small',320,568,true],['landscape',844,390,true],['compact-landscape',667,375,true],['short-landscape',568,320,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile});
      await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await sleep(100);
      assert.equal(await evaluate(`document.querySelectorAll('.home-navigation>button').length`),5,'tutorial does not become a sixth mode');
      await evaluate(`document.getElementById('tutorial-entry').scrollIntoView({block:'nearest'})`);await shot(`tutorial-home-${label}.png`);
      await click('tutorial-entry');
      if(await evaluate(`!document.getElementById('phone-ready').classList.contains('hidden')`))await click('phone-ready-play');
      await evaluate('__courtCheck.holdInputClock()');
      const lessonCount=label==='desktop'||label==='landscape'||label==='short-landscape'?8:1;
      for(let i=0;i<lessonCount;i++) {
        await click('tutorial-action');await frames(3);assert.equal((await state()).tutorial.phase,'explain');await sleep(100);
        const frozen=await state();await frames(1);assert.deepEqual((await state()).delivery,frozen.delivery,'instruction frame freezes the real shuttle');
        const layout=await evaluate(`(()=>{const r=id=>{const a=document.getElementById(id).getBoundingClientRect();return {left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:a.width,height:a.height};};return {viewport:{width:innerWidth,height:innerHeight},scroll:document.documentElement.scrollWidth,coach:r('tutorial-coach'),court:r('court'),action:r('tutorial-action'),exit:r('tutorial-exit')};})()`);
        assert.ok(layout.scroll<=width,`${label}: no horizontal overflow`);assert.ok(layout.coach.top>=0&&layout.coach.bottom<=height,'coach instructions stay visible');
        assert.ok(await evaluate(`(()=>{const b=document.getElementById('tutorial-action'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),'Try it is not covered');
        if(mobile) assert.ok(layout.coach.bottom<=layout.court.top+1,'mobile coach does not cover the shuttle');
        layouts.push({label,lesson:frozen.lesson.id,...layout});
        await shot(`tutorial-${label}-${frozen.lesson.id}-paused.png`);
        await click('tutorial-action');await sleep(100);
        if(mobile&&width>height)for(const id of ['touch-stick','touch-hit','touch-jump','touch-clear','touch-drop','touch-smash']) {
          assert.equal(await evaluate(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),true,`${label} tutorial ${id} stays visible and reachable`);
        }
        if(i===0) {
          if(mobile) {
            const m=await evaluate(`(()=>{const r=document.getElementById('touch-stick').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`),t=await evaluate('__courtCheck.tutorialTarget()'),p=(await state()).player;
            const distance=Math.hypot(t.x-p.x,t.y-p.y);
            await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...m,id:1}]});
            await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:m.x+(t.x-p.x)/distance*28,y:m.y+(t.y-p.y)/distance*28,id:1}]});await sleep(60);
            for(let n=0;n<60;n++) {await frames(.02);const a=(await state()).player;if(Math.hypot(t.x-a.x,t.y-a.y)<.04)break;}
            await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          } else {
            const pressed=new Set();
            for(let n=0;n<70;n++) {
              const t=await evaluate('__courtCheck.tutorialTarget()'),p=(await state()).player,dx=t.x-p.x,dy=t.y-p.y;
              for(const [code,on] of [['KeyA',dx<-.025],['KeyD',dx>.025],['KeyW',dy<-.025],['KeyS',dy>.025]]) {if(on&&!pressed.has(code)){await key(code,true);pressed.add(code);}if(!on&&pressed.has(code)){await key(code,false);pressed.delete(code);}}
              await frames(.02);if(Math.hypot(dx,dy)<.04)break;
            }
            for(const code of pressed)await key(code,false);
          }
          await frames(.15);assert.ok((await state()).cue.grade,'player moved into the real contact range');
        }
        const lesson=(await state()).lesson;
        if(lesson.jump) {
          if(mobile){await tapTouch('touch-smash');await tapTouch('touch-jump');}else {await key('Space',true);await key('Space',false);}
          await frames(.5);assert.equal((await state()).tutorial.phase,'apex');await sleep(100);await shot(`tutorial-${label}-jump-apex.png`);
          const peak=(await state()).player;await frames(1);assert.deepEqual((await state()).player,peak,'jump is paused at its physical apex');
        }
        await shot(`tutorial-${label}-${lesson.id}-try.png`);await contact(lesson,mobile);await frames(3);
        const result=await state();assert.equal(result.tutorial.phase,'success',JSON.stringify({label,lesson:lesson.id,result:result.tutorial.result}));
        assert.equal(result.delivery.shotType,lesson.expected);report.push({label,lesson:lesson.id,result:result.tutorial.result,shot:result.delivery.shotType});
        await click('tutorial-action');
      }
      if(lessonCount===8) {assert.equal((await state()).state,'over');await shot(`tutorial-complete-${label}.png`);await click('result-menu');}
      else await click('tutorial-exit');
      assert.equal((await state()).mode,'tutorial'); // Menu keeps the previous mode until a normal start.
      assert.equal(await evaluate(`document.body.classList.contains('tutorial-mode')`),false);
      assert.equal(await evaluate(`document.querySelectorAll('.home-navigation>button').length`),5);
    }
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,process.argv.includes('--chinese')?'tutorial-chinese-browser-checks.json':'tutorial-browser-checks.json'),JSON.stringify({browser:browserBinary,errors,report,layouts,actualPhoneTested:false},null,2));
    console.log('Tutorial: six viewports; full desktop/touch/short-landscape courses; real frozen flight, movement, aim, strokes, apex and completion verified.');
    break verification;
  }
  if (process.argv.includes('--mobile-controls')) {
    const report=[];
    const point=async id=>evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const touch=async(type,touchPoints)=>send('Input.dispatchTouchEvent',{type,touchPoints});
    const tap=async id=>{const p=await point(id);await touch('touchStart',[{...p,id:2}]);await touch('touchEnd',[]);};
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await evaluate(`document.getElementById('choose-match').click();document.getElementById('start').click();`);
    assert.equal(await evaluate(`document.getElementById('phone-ready').classList.contains('hidden')`),false,'phone portrait start suggests landscape');
    assert.equal((await evaluate('__courtCheck.snapshot()')).state,'ready','suggestion precedes the game clock');
    await shot('landscape-phone-prompt-portrait.png');
    await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true});await sleep(100);
    assert.equal(await evaluate(`document.getElementById('phone-ready-title').textContent`),'Ready for the court');
    assert.equal((await evaluate('__courtCheck.snapshot()')).state,'ready','rotation waits for the player');
    await shot('landscape-phone-prompt-ready.png');await tap('phone-ready-play');
    assert.equal((await evaluate('__courtCheck.snapshot()')).state,'playing','real touch can start from the suggestion');
    await evaluate('__courtCheck.holdInputClock()');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});await sleep(100);
    assert.equal((await evaluate('__courtCheck.snapshot()')).state,'paused','rotating during play pauses');
    await evaluate(`document.getElementById('pause-menu').click();`);
    for(const [width,height,name] of [[390,844,'portrait'],[320,568,'small'],[844,390,'landscape'],[667,375,'compact-landscape'],[568,320,'short-landscape'],[568,260,'browser-bars-landscape'],[932,430,'wide-landscape'],[768,1024,'tablet'],[1400,900,'desktop']]) {
      const mobile=name!=='desktop';
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:mobile?2:1,mobile});
      await send('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});
      await evaluate(`document.getElementById('choose-practice').click();document.getElementById('start').click();__courtCheck.holdInputClock();__courtCheck.scenario('defense');`);
      await sleep(150);
      const layout=await evaluate(`(()=>{const rect=id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,display:getComputedStyle(e).display};};return {width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,court:rect('court'),controls:rect('touch-controls'),stick:rect('touch-stick'),hit:rect('touch-hit'),jump:rect('touch-jump'),choices:['touch-clear','touch-drop','touch-smash'].map(rect)};})()`);
      assert.ok(layout.scroll<=width,`${name} has no horizontal overflow`);
      if(!mobile) { assert.equal(layout.controls.display,'none');await shot('mobile-controls-desktop.png'); }
      else {
        assert.equal(layout.controls.display,'flex');assert.ok(layout.controls.bottom<=height+1,`${name} controls stay on screen`);
        for(const r of [layout.hit,layout.jump,...layout.choices])assert.ok(r.width>=44&&r.height>=44,'touch controls are at least 44px');
        assert.ok(layout.hit.width*layout.hit.height>layout.choices[0].width*layout.choices[0].height*1.5,'primary hit is visibly larger');
        if(width>height) {
          assert.ok(layout.stick.right<layout.court.left);assert.ok(layout.hit.left>layout.court.right);
          assert.ok(layout.court.width>=width-296,'landscape reserves more width for the court');
          const touchables=await evaluate(`['touch-hit','touch-jump','touch-clear','touch-drop','touch-smash','touch-stick','pause','help-open','settings-open','sound'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,reachable:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})`);
          for(const r of touchables){assert.ok(r.left>=0&&r.right<=width&&r.top>=0&&r.bottom<=height,`${name} ${r.id} stays visible`);assert.ok(r.reachable,`${name} ${r.id} is reachable`);assert.ok(r.width>=44&&r.height>=44,`${name} ${r.id} is thumb-sized`);}
        }
        else assert.ok(layout.controls.top>=layout.court.bottom,'portrait controls do not cover the court');
        assert.equal(await evaluate(`(()=>{const a=document.getElementById('drill-end').getBoundingClientRect(),b=document.querySelector('.touch-shot-panel').getBoundingClientRect();return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;})()`),false,'End session does not overlap shot controls');
        await shot(`mobile-controls-${name}.png`);
        for(const [type,expected] of [['clear','lift'],['drop','block'],['smash','drive']]) {
          await evaluate(`__courtCheck.scenario('defense');__courtCheck.selectTouch('${type}');`);
          await tap('touch-hit');await evaluate(`__courtCheck.step(.05);__courtCheck.freeze()`);
          assert.equal((await evaluate('__courtCheck.snapshot()')).delivery.shotType,expected);
        }
        await evaluate(`__courtCheck.scenario('defense');__courtCheck.selectTouch('clear');`);
        const m=await point('touch-stick'),h=await point('touch-hit');
        await touch('touchStart',[{...m,id:1}]);
        await touch('touchMove',[{x:m.x+24,y:m.y,id:1}]);
        await touch('touchStart',[{x:m.x+24,y:m.y,id:1},{...h,id:2}]);
        await touch('touchMove',[{x:m.x+24,y:m.y,id:1},{x:h.x+32,y:h.y,id:2}]);
        await sleep(60); // Let Chromium deliver its coalesced pointer-move frame.
        let state=await evaluate('__courtCheck.touchState()');assert.ok(state.movement.dx>0);assert.ok(state.aimX>.5,JSON.stringify({name,state,m,h,held:await evaluate(`document.getElementById('touch-hit').classList.contains('held')`)}));assert.equal(state.swing,null);
        assert.equal(await evaluate(`document.getElementById('touch-instruction').textContent`),'Release to hit · Drag to aim');
        assert.equal(await evaluate(`document.getElementById('touch-aim-track').classList.contains('aiming')`),true);
        if(width>height)await shot(`mobile-controls-${name}-aiming.png`);
        await touch('touchEnd',[{x:h.x+32,y:h.y,id:2}]);
        state=await evaluate('__courtCheck.touchState()');assert.ok(state.swing,JSON.stringify({state,held:await evaluate(`document.getElementById('touch-hit').classList.contains('held')`)}));assert.ok(state.movement.dx>0,'releasing strike keeps movement');
        await touch('touchEnd',[]);assert.equal((await evaluate('__courtCheck.touchState()')).movement.dx,0);
        await evaluate(`__courtCheck.scenario('defense');`);await touch('touchStart',[{...h,id:2}]);await touch('touchCancel',[]);
        assert.equal((await evaluate('__courtCheck.touchState()')).swing,null,'canceled real touch never swings');
        await evaluate(`document.getElementById('touch-power-toggle').click();__courtCheck.freeze();`);
        assert.equal(await evaluate(`document.getElementById('touch-power-options').hidden`),false);
        assert.equal(await evaluate(`(()=>{const p=document.getElementById('touch-power-options').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight;})()`),true,'power choices stay visible');
        for(const id of ['touch-power-auto','touch-power-toggle'])assert.equal(await evaluate(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`),true,`${id} is reachable with power options open`);
        await shot(`mobile-controls-${name}-power.png`);
      }
      report.push({name,layout,realTouchChecks:mobile});
      await evaluate(`document.getElementById('help-open').click();document.getElementById('help-close').click();document.getElementById('pause-menu').click();document.getElementById('result-menu').click();`);
      if(mobile) {
        await evaluate(`document.getElementById('choose-match').click();document.getElementById('start').click();__courtCheck.scenario('defense');`);
        await sleep(100);await shot(`mobile-controls-${name}-match.png`);
        assert.equal(await evaluate(`(()=>{const a=document.getElementById('match-board').getBoundingClientRect(),b=document.getElementById('court').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right&&a.top>=b.top&&a.bottom<=b.bottom;})()`),true,'scoreboard fits the playable court');
        await evaluate(`document.getElementById('help-open').click();document.getElementById('help-close').click();document.getElementById('pause-menu').click();`);
      }
    }
    assert.deepEqual(errors,[]);
    await writeFile(join(artifacts,'mobile-controls-browser-checks.json'),JSON.stringify({browser:browserBinary,errors,report},null,2));
    console.log('Mobile controls: nine viewports, portrait suggestion/rotation pause, practice/match layout, thumb targets, real multi-touch movement/aim/defense/cancellation and screenshots passed.');
    break verification;
  }
  if (process.argv.includes('--menu-design')) {
    const report=[];
    const englishAudit=[];
    const dialogAudit=[];
    const aiAudit=[];
    const assertEnglish=async label=>{
      const content=await evaluate(`({lang:document.documentElement.lang,text:document.body.textContent,attributes:[...document.querySelectorAll('[aria-label],[aria-valuetext],[title]')].flatMap(e=>['aria-label','aria-valuetext','title'].map(a=>e.getAttribute(a)||'')),overflow:[...document.querySelectorAll('.panel:not(.hidden),.panel:not(.hidden) .panel-content')].filter(e=>e.getBoundingClientRect().width>0&&e.scrollWidth>e.clientWidth+2).map(e=>e.id||e.className)})`);
      assert.equal(content.lang,'en');
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.brand')).color`),'rgb(20, 48, 31)',`${label}: shared header text`);
      assert.ok(await evaluate(`getComputedStyle(document.body).backgroundImage.includes('rgb(247, 250, 245)')`),`${label}: shared daylight page background`);
      assert.ok(!/\p{Script=Han}/u.test(content.text.replaceAll('简体中文','')+content.attributes.join(' ')),`${label}: interface text, tooltips and accessible labels are English except the native language name`);
      assert.deepEqual(content.overflow,[],`${label}: no horizontal panel overflow`);
      const theme=await evaluate(`(()=>{
        const p=document.querySelector('.panel:not(.hidden)');if(!p||p.id==='welcome'||document.getElementById('overlay').classList.contains('hidden'))return null;
        const paint=e=>{const s=getComputedStyle(e);return {id:e.id||e.className,background:s.backgroundColor,color:s.color,radius:s.borderRadius};};
        return {panel:paint(p),content:paint(p.querySelector('.panel-content')),title:paint(p.querySelector('h2')),
          primary:[...p.querySelectorAll('.primary')].map(paint),secondary:[...p.querySelectorAll('.secondary')].map(paint),
          surfaces:[...p.querySelectorAll('.settings-section,.power-setting,.marker-colors,.jersey-colors,.color-field,.preview-caption,.training-errors>div,.help-keys p')].map(paint),
          selected:[...p.querySelectorAll('button[aria-pressed=true]')].filter(b=>!b.closest('.color-options')).map(paint)};})()`);
      if(theme){
        const white='rgb(255, 255, 255)',ink='rgb(20, 48, 31)',accent='rgb(216, 241, 78)',surface='rgb(239, 244, 239)';
        assert.equal(theme.panel.background,white,`${label}: white dialog surface`);assert.equal(theme.panel.radius,'20px');
        assert.equal(theme.content.background,white);assert.equal(theme.title.color,ink);
        for(const b of theme.primary){assert.equal(b.background,accent,`${label}: primary button accent`);assert.equal(b.color,ink);assert.equal(b.radius,'14px');}
        for(const b of theme.secondary){assert.equal(b.background,surface);assert.equal(b.radius,'12px');}
        for(const s of theme.surfaces)assert.ok([white,surface].includes(s.background),`${label}: ${s.id} shares daylight surfaces`);
        for(const b of theme.selected){assert.equal(b.background,accent,`${label}: selected ${b.id}`);assert.equal(b.color,ink);}
        assert.ok(await evaluate(`(()=>{const p=document.querySelector('.panel:not(.hidden)');return [...p.querySelectorAll('.panel-actions button')].every(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});})()`),`${label}: footer actions stay visible and clickable`);
        dialogAudit.push({label,...theme});
      }
      englishAudit.push(label);
    };
    const sourceFiles=['index.html','style.css','game.js','core.js','appearance.js','target-challenge.js','guidance.js','sounds.js','touch-input.js','tutorial.js','desktop/main.cjs','assets/images/venue-daylight.svg'];
    for(const file of sourceFiles) assert.ok(!/\p{Script=Han}/u.test((await readFile(join(root,file),'utf8')).replaceAll('简体中文','')),`${file}: English source text except the native language option`);
    await evaluate(`document.getElementById('cover-image').decode()`);
    assert.equal(await evaluate(`document.getElementById('cover-image').getAttribute('src')`),'assets/images/cover-daylight-smash.png','home uses the supplied daylight cover');
    for(const level of ['easy','normal','hard']) {
      await evaluate(`document.getElementById('choose-match').click();document.querySelector('[data-ai-level="${level}"]').click()`);
      assert.equal(await evaluate(`document.querySelector('[data-ai-level="${level}"]').textContent`),{easy:'Casual',normal:'Standard',hard:'Expert'}[level]);
      await evaluate(`document.getElementById('start').click();__courtCheck.freeze()`);
      assert.equal((await evaluate(`__courtCheck.snapshot()`)).opponent.level,level,'match launches the selected AI tier');
      const samples=[];
      for(const jumping of [false,true])for(const aim of [.12,.5,.88])for(const startX of [.22,.5,.78]) {
        const sample=await evaluate(`__courtCheck.defendPlayerAttack(${jumping},${aim},${startX})`);
        assert.equal(sample.level,level);assert.equal(sample.type,jumping?'smash':'tap');
        if(sample.returned)assert.ok(sample.reach<=sample.radius+1e-9,'production game returns only inside the real contact reach');
        samples.push(sample);
      }
      await shot(`ai-shift-${level}-game.png`);await assertEnglish(`ai-${level}-game`);
      aiAudit.push({level,samples});
      await evaluate(`document.getElementById('pause-menu').click()`);
    }
    await evaluate(`document.getElementById('choose-match').click();document.querySelector('[data-ai-level="normal"]').click();document.getElementById('setup-back').click()`);
    for (const [label,width,height,mobile] of [['desktop',1400,900,false],['laptop',1280,720,false],['mobile',390,844,true],['landscape',844,390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
      await evaluate(`document.getElementById('setup-back').click()`);await sleep(150);
      await shot(`menu-daylight-home-${label}.png`);
      await assertEnglish(`home-${label}`);
      await evaluate(`document.getElementById('choose-match').click()`);await sleep(100);
      const layout=await evaluate(`(()=>{
        const panel=document.getElementById('mode-setup'),shell=document.querySelector('.game-shell'),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
        return {panel:rect(panel),shell:rect(shell),overflow:document.documentElement.scrollWidth>innerWidth,
          options:[...document.querySelectorAll('#match-options button')].map(b=>({rect:rect(b),font:getComputedStyle(b).fontSize,after:getComputedStyle(b,'::after').content})),
          start:rect(document.getElementById('start')),title:document.getElementById('setup-title').textContent,contentBackground:getComputedStyle(panel.querySelector('.panel-content')).backgroundColor,
          notes:[...document.querySelectorAll('.match-setting .option-note')].map(n=>({font:getComputedStyle(n).fontSize,color:getComputedStyle(n).color})),
          groups:[...document.querySelectorAll('.match-choices')].map(g=>[...g.children].map(rect))};})()`);
      assert.equal(layout.title,'Match Mode');assert.ok(!layout.overflow);
      assert.equal(layout.contentBackground,'rgb(255, 255, 255)','panel content uses the daylight white surface');
      assert.ok(layout.panel.y>=height*.1-1 && layout.panel.bottom<=height*.9+1,'panel has at least ten percent viewport breathing space');
      await shot(`menu-daylight-match-${label}.png`);
      if(height>=720) assert.ok(await evaluate(`(()=>{const c=document.querySelector('#mode-setup .panel-content');return c.scrollHeight<=c.clientHeight+1;})()`),`${label}: all three groups are visible in normal-height windows`);
      if(width>1000) assert.ok(Math.abs(layout.panel.width/layout.shell.width-.54)<.01,'desktop panel width is 54%');
      for(const option of layout.options){assert.equal(option.rect.height,44);assert.equal(option.font,'15px');assert.ok(['none','normal'].includes(option.after));}
      for(const group of layout.groups) {assert.ok(group.every(r=>Math.abs(r.y-group[0].y)<1),'each group stays on one row');assert.ok(group.every(r=>Math.abs(r.width-group[0].width)<1),'equal width choices');}
      assert.equal(layout.start.height,52);assert.ok(layout.panel.bottom-layout.start.bottom>=24,'CTA has a comfortable lower inset');
      assert.ok(layout.notes.every(n=>n.font==='13px'&&n.color===layout.notes[0].color));
      assert.ok(await evaluate(`(()=>{const b=document.getElementById('start'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`),'start stays visible outside the scrolling content');
      await shot(`menu-daylight-match-${label}.png`);
      await evaluate(`document.querySelector('[data-points="15"]').click();document.querySelector('[data-ai-level="hard"]').click();document.querySelector('[data-ai-style="rally"]').click();document.querySelector('#mode-setup .panel-content').scrollTop=1000`);
      assert.equal(await evaluate(`document.getElementById('setup-summary').textContent`),'15 pts · Expert · Rally');
      assert.equal(await evaluate(`document.querySelectorAll('#match-options [aria-pressed="true"]').length`),3);
      await shot(`menu-daylight-match-${label}-selected.png`);
      await evaluate(`document.getElementById('setup-back').click();document.getElementById('choose-match').click()`);
      assert.equal(await evaluate(`document.getElementById('setup-summary').textContent`),'15 pts · Expert · Rally');
      await evaluate(`document.querySelector('[data-points="7"]').click();document.querySelector('[data-ai-level="normal"]').click();document.querySelector('[data-ai-style="balanced"]').click()`);
      report.push({label,...layout});
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,mobile:false,deviceScaleFactor:1});
    await evaluate(`document.getElementById('setup-back').click()`);
    for (const [entry,panel,close] of [['choose-practice','mode-setup','setup-back'],['choose-drill','mode-setup','setup-back'],['settings-menu','settings','settings-close'],['personalize-menu','personalization','personalization-close']]) {
      await evaluate(`document.getElementById('${entry}').click()`);await sleep(150);await shot(`menu-daylight-${panel}-${entry}.png`);
      await evaluate(`document.getElementById('${close}').click()`);
    }
    await evaluate(`document.getElementById('choose-match').click()`);
    await evaluate(`document.getElementById('start').click();__courtCheck.freeze()`);
    assert.ok(await evaluate(`document.body.classList.contains('focus-game')&&!document.getElementById('match-board').classList.contains('hidden')`),'Start Match launches the existing match');
    await evaluate(`document.getElementById('pause-menu').click();window.__paintedLabels=[];const originalFill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(__paintedLabels.length<10000)__paintedLabels.push(String(text));return originalFill.call(this,text,...args);}`);
    for(const [label,width,height,mobile] of [['desktop',1400,900,false],['mobile',390,844,true],['landscape',844,390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});
      await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
      for(const [entry,panel,close] of [['help-open','help','help-close'],['settings-menu','settings','settings-close'],['personalize-menu','personalization','personalization-close']]) {
        await evaluate(`document.getElementById('${entry}').click()`);await sleep(80);
        await assertEnglish(`${panel}-${label}`);await shot(`english-${panel}-${label}.png`);
        await evaluate(`document.querySelector('#${panel} .panel-content').scrollTop=10000`);
        await shot(`english-${panel}-${label}-bottom.png`);
        await evaluate(`document.getElementById('${close}').click()`);
      }
      await evaluate(`document.getElementById('choose-match').click()`);
      for(const selector of ['[data-ai-level]','[data-ai-style]']) {
        const values=await evaluate(`[...document.querySelectorAll('${selector}')].map(e=>e.outerHTML.match(/data-ai-(?:level|style)="([^"]+)"/)[1])`);
        for(const value of values) {await evaluate(`document.querySelector('${selector.slice(0,-1)}="${value}"]').click()`);await assertEnglish(`match-${value}-${label}`);}
      }
      await evaluate(`document.querySelector('[data-ai-level="normal"]').click();document.querySelector('[data-ai-style="balanced"]').click();document.getElementById('start').click();document.getElementById('pause').click()`);
      await assertEnglish(`pause-${label}`);await shot(`english-paused-${label}.png`);
      for(const [entry,panel,close] of [['#settings-paused','settings','settings-close'],['#paused [data-open-personalization]','personalization','personalization-close'],['#help-open','help','help-close']]) {
        await evaluate(`document.querySelector('${entry}').click()`);await sleep(80);
        await assertEnglish(`in-game-${panel}-${label}`);await shot(`dialog-${panel}-${label}.png`);
        if(panel==='settings'&&label==='desktop'){
          const point=await evaluate(`(()=>{const r=document.querySelector('[data-default-shot="clear"][data-default-power="1"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
          await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(30);
          assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-default-shot="clear"][data-default-power="1"]')).backgroundColor`),'rgb(232, 240, 232)','in-game hover stays in the shared pale green palette');
          await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
        }
        await evaluate(`document.querySelector('#${panel} .panel-content').scrollTop=10000`);await shot(`dialog-${panel}-${label}-bottom.png`);
        await evaluate(`document.getElementById('${close}').click()`);
        assert.equal(await evaluate(`document.getElementById('paused').classList.contains('hidden')`),false,'closing an in-game dialog returns to pause');
        assert.equal((await evaluate(`__courtCheck.snapshot()`)).state,'paused','dialog navigation keeps the game paused');
      }
      await evaluate(`document.getElementById('pause-menu').click()`);
      assert.equal((await evaluate(`__courtCheck.snapshot()`)).state,'ready','leaving a paused match returns to home');
      await assertEnglish(`exit-match-${label}`);
      await evaluate(`document.getElementById('choose-match').click();document.getElementById('start').click();document.getElementById('pause').click()`);
      await evaluate(`document.getElementById('resume').click();__courtCheck.playerService();__courtCheck.freeze()`);
      await assertEnglish(`serve-${label}`);await shot(`english-match-${label}.png`);
      await evaluate(`__courtCheck.score(6,6,'computer')`);await assertEnglish(`deuce-${label}`);
      await evaluate(`__courtCheck.winMatch()`);await assertEnglish(`match-results-${label}`);await shot(`english-match-results-${label}.png`);
      await evaluate(`document.getElementById('result-menu').click()`);
      for(const mode of ['feed','target','jump','net','defense']) {
        const practice=['feed','target'].includes(mode);
        await evaluate(`document.getElementById('${practice?'choose-practice':'choose-drill'}').click();document.querySelector('[data-${practice?'practice':'training'}="${mode}"]').click()`);
        await assertEnglish(`setup-${mode}-${label}`);await shot(`english-setup-${mode}-${label}.png`);
        await evaluate(`document.getElementById('start').click();__courtCheck.freeze()`);
        await assertEnglish(`play-${mode}-${label}`);await shot(`english-play-${mode}-${label}.png`);
        if(mode==='feed'){
          await evaluate(`document.getElementById('pause').click();document.getElementById('pause').click()`);
          await assertEnglish(`exit-practice-${label}`);await shot(`dialog-exit-practice-${label}.png`);
          await evaluate(`document.getElementById('pause-menu').click()`);
        }else await evaluate(`document.getElementById('drill-end').click()`);
        await assertEnglish(`results-${mode}-${label}`);await shot(`english-results-${mode}-${label}.png`);
        await evaluate(`document.getElementById('result-menu').click()`);
      }
    }
    const canvasLabels=await evaluate(`[...new Set(__paintedLabels)]`);
    assert.ok(canvasLabels.length>0);assert.ok(!/\p{Script=Han}/u.test(canvasLabels.join(' ')),'actual canvas labels are English');
    await writeFile(join(artifacts,'menu-daylight-checks.json'),JSON.stringify({browser:browserBinary,errors,sourceFiles,englishAudit,dialogAudit,aiAudit,canvasLabels,layouts:report},null,2));
    console.log(`Menu design and English interface verified: four viewports, ${englishAudit.length} interface states, ${dialogAudit.length} shared dialog palettes, in-game navigation, tooltips, accessible labels, canvas text and match/practice/training results.`);
    break verification;
  }
  if (process.argv.includes('--scene')) {
    const prefix=process.argv.includes('--daylight')?'scene-daylight':process.argv.includes('--before')?'scene-before':'scene-refined';
    const report=[];
    const luminance=rgb=>rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((s,c,i)=>s+c*[.2126,.7152,.0722][i],0);
    const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
    for (const [label,width,height,mobile,dpr] of [['desktop',1400,900,false,1],['mobile',390,844,true,3],['landscape',844,390,true,2]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:dpr});
      for (const style of label==='desktop'?['classic','sakura','sky','dusk']:['classic']) {
        await evaluate(`__courtCheck.venueScene('${style}')`);await sleep(150);
        await shot(`${prefix}-${label}-${style}.png`);
        assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'scene does not overflow');
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.match-board')).textShadow`),'none');
        const cache=await evaluate(`__courtCheck.venueCache()`);
        assert.ok(cache.reused && cache.deterministic,'venue reuses its bitmap and redraws identical grain');
        const daylight=process.argv.includes('--daylight')?await evaluate(`__courtCheck.venueDaylight()`):null;
        if(daylight){
          assert.ok(daylight.walls.every(rgb=>luminance(rgb)>.50),'daylight wall samples remain bright');
          assert.ok(daylight.floors.every(rgb=>luminance(rgb)>.20),'court mats retain daylight brightness');
          const ink=daylight.ink.slice(1).match(/../g).map(c=>parseInt(c,16));
          assert.ok(daylight.floors.every(rgb=>contrast(ink,rgb)>=4.5),'transparent court captions contrast with the actual mat');
          for(const t of daylight.text){const color=t.color.match(/[\d.]+/g).slice(0,3).map(Number);assert.ok(contrast(color,t.background)>=4.5,`${t.label}: court HUD contrast ${contrast(color,t.background).toFixed(2)} over ${JSON.stringify(t.background)}`);}
        }
        report.push({label,style,width,height,dpr,...cache,daylight});
      }
      await evaluate(`__courtCheck.venueDetails()`);await shot(`${prefix}-${label}-full.png`);
      assert.equal(await evaluate(`document.getElementById('match-player-score').textContent`),'20');
      assert.ok(await evaluate(`(()=>{const b=document.querySelector('.match-board').getBoundingClientRect(),c=document.getElementById('court').getBoundingClientRect();return b.left>=c.left&&b.right<=c.right&&b.bottom<c.top+c.height*179/720;})()`),'full score stays above the playing court');
    }
    await writeFile(join(artifacts,`${prefix}-checks.json`),JSON.stringify({renderer:'Edge headless / real Canvas + WebGL',errors,scenes:report},null,2));
    console.log('Scene screenshots captured: four courts, desktop / portrait / landscape, real offline 3D athletes.');
    break verification;
  }
  // Cover entries navigate to separate screens; footers never move with content.
  await evaluate(`document.getElementById('cover-image').decode()`);
  assert.ok(await evaluate(`document.getElementById('cover-image').naturalWidth>0`), 'offline cover image loads');
  assert.equal(await evaluate(`document.title`), 'Shuttle Flow');
  for (const [label,width,height,mobile] of [['desktop',1400,900,false],['mobile',390,844,true],['landscape',844,390,true]]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile});
    await send('Emulation.setTouchEmulationEnabled', {enabled:mobile});
    await sleep(80);
    assert.ok(await evaluate(`document.getElementById('welcome').contains(document.getElementById('start'))===false`), 'cover has no start/configuration controls');
    await shot(`home-navigation-${label}.jpg`);
    await shot(`home-text-${label}.png`);
    assert.ok(await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.home-navigation button')];return buttons.length===5&&new Set(buttons.map(b=>getComputedStyle(b).backgroundColor)).size===1&&buttons.every(b=>parseFloat(getComputedStyle(b).fontSize)>=16)&&!document.querySelector('.home-navigation small');})()`),'five equal cover entries have consistent filled colors and readable type');
    await evaluate(`document.getElementById('personalize-menu').click();`);
    assert.ok(await evaluate(`!document.getElementById('personalization').classList.contains('hidden')`),'personalization has a dedicated screen');
    const themePixels=[];
    for(const style of ['classic','sakura','sky','dusk']) {
      const beforeTheme=await evaluate(`__courtCheck.snapshot()`);
      await evaluate(`document.querySelector('[data-court-style="${style}"]').click();`);
      const afterTheme=await evaluate(`__courtCheck.snapshot()`);
      assert.deepEqual(afterTheme.player,beforeTheme.player,'court changes keep player geometry unchanged');
      assert.equal(afterTheme.state,beforeTheme.state,'court changes do not start or resume play');
      assert.equal(await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-appearance')).court`),style);
      const pixels=await evaluate(`(()=>{const sample=id=>{const c=document.getElementById(id);return [...c.getContext('2d').getImageData(Math.round(800*c.width/1200),Math.round(560*c.height/720),1,1).data];};return {main:sample('court'),preview:sample('appearance-preview')};})()`);
      assert.ok(pixels.main.every((channel,index)=>Math.abs(channel-pixels.preview[index])<=3),`personalization previews the actual rendered court with resolution-dependent sampling: ${JSON.stringify(pixels)}`);
      themePixels.push(JSON.stringify(pixels.main));
      if(label==='desktop') await writeFile(join(artifacts,`court-style-${style}.png`),Buffer.from(await evaluate(`document.getElementById('court').toDataURL('image/png').split(',')[1]`),'base64'));
    }
    assert.equal(new Set(themePixels).size,4,'all four courts render different floor colors after invalidating the cache');
    await evaluate(`(()=>{const original=Storage.prototype.setItem;try{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};document.querySelector('[data-court-style="sky"]').click();}finally{Storage.prototype.setItem=original;}})()`);
    assert.equal(await evaluate(`document.getElementById('appearance-save-status').textContent`),'Not saved','appearance save failures are reported accurately');
    await evaluate(`document.querySelector('[data-court-style="sakura"]').click();`);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'personalization has no horizontal overflow');
    assert.ok(await evaluate(`(()=>{const equipment=document.querySelector('.racket-customization').getBoundingClientRect(),preview=document.querySelector('.court-preview-section').getBoundingClientRect(),choices=document.getElementById('court-choices').getBoundingClientRect();return equipment.top>=Math.max(preview.bottom,choices.bottom);})()`),'personalization rows stay apart even in short landscape viewports');
    assert.ok(await evaluate(`(()=>{const b=document.getElementById('personalization-close'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`),'personalization footer stays visible');
    await shot(`personalization-${label}.jpg`);
    await evaluate(`(()=>{for(const [id,color] of [['landingColor-choices','#53b5ee'],['aimColor-choices','#ffcc33']]){const input=document.getElementById(id);input.querySelector('[data-color="' + color + '"]').click();}document.querySelector('#personalization .panel-content').scrollTop=document.querySelector('.marker-colors').offsetTop-100;})()`);
    assert.deepEqual(await evaluate(`(()=>{const saved=JSON.parse(localStorage.getItem('shuttle-club-appearance'));return [saved.landingColor,saved.aimColor];})()`),['#53b5ee','#ffcc33'],'both preset colors are saved');
    assert.ok(await evaluate(`(()=>{const input=document.getElementById('landingColor-choices').querySelector('[aria-pressed="true"]');input.scrollIntoView({block:'nearest'});const r=input.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.bottom<document.querySelector('#personalization .panel-actions').getBoundingClientRect().top;})()`),'color swatches are reachable inside the scrolling content');
    await shot(`personalization-colors-${label}.png`);
    await evaluate(`document.querySelector('[data-court-style="sky"]').click();`);
    assert.equal(await evaluate(`document.getElementById('landingColor-choices').dataset.selectedColor`),'#53b5ee','custom color survives court changes');
    await evaluate(`document.getElementById('marker-colors-reset').click();`);
    assert.equal(await evaluate(`document.getElementById('landingColor-choices').dataset.selectedColor`),'#153e60','reset uses the current court automatic palette');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-appearance')).aimColor`),null,'reset restores shot-dependent aim colors');
    // Shirt material changes must leave socks, shorts, the other athlete and gameplay alone.
    const beforeJersey=await evaluate(`({player:__courtCheck.snapshot().player,state:__courtCheck.snapshot().state,preview:document.getElementById('jersey-preview').toDataURL()})`);
    await evaluate(`document.querySelector('[data-jersey-role="player"]').click();document.getElementById('jersey-colors-reset').click();(()=>{const c=document.getElementById('jerseyColor-choices');c.querySelector('[data-color="' + '#d44a36' + '"]').click();})()`);
    const colored=await evaluate(`({player:ShuttleAthletes.last.player,opponent:ShuttleAthletes.last.opponent,saved:JSON.parse(localStorage.getItem('shuttle-club-appearance')),preview:document.getElementById('jersey-preview').toDataURL()})`);
    assert.equal(colored.player.jerseyColor,'d44a36');assert.notEqual(colored.player.stripeColor,'d44a36');
    assert.equal(colored.player.sockStripeColor,'2264c8');assert.equal(colored.player.shortsStripeColor,'53b5ee');
    assert.equal(colored.opponent.jerseyColor,'f0ddbd');assert.equal(colored.saved.playerJerseyStripe,null,'automatic accent is stored as automatic');
    assert.notEqual(colored.preview,beforeJersey.preview,'front/back preview actually changes');
    assert.deepEqual(await evaluate(`__courtCheck.snapshot().player`),beforeJersey.player);assert.equal(await evaluate(`__courtCheck.snapshot().state`),beforeJersey.state);
    await evaluate(`(()=>{const c=document.getElementById('jerseyStripe-choices');c.querySelector('[data-color="' + '#53b5ee' + '"]').click();const main=document.getElementById('jerseyColor-choices');main.querySelector('[data-color="' + '#aa77cc' + '"]').click();})()`);
    assert.equal(await evaluate(`ShuttleAthletes.last.player.stripeColor`),'53b5ee','manual stripes survive main-color changes');
    await evaluate(`document.getElementById('jersey-stripe-auto').click();`);
    assert.equal(await evaluate(`document.getElementById('jerseyStripe-value').textContent`),'Auto color');
    assert.notEqual(await evaluate(`ShuttleAthletes.last.player.stripeColor`),'53b5ee');
    await evaluate(`document.querySelector('[data-jersey-role="opponent"]').click();(()=>{const c=document.getElementById('jerseyColor-choices');c.querySelector('[data-color="' + '#f5f3e8' + '"]').click();})()`);
    assert.equal(await evaluate(`ShuttleAthletes.last.opponent.jerseyColor`),'f5f3e8');
    assert.equal(await evaluate(`ShuttleAthletes.last.opponent.numberColor`),'243348','pale shirts keep the number visible');
    assert.equal(await evaluate(`ShuttleAthletes.last.player.jerseyColor`),'aa77cc','opponent recoloring does not mutate the player material');
    assert.equal(await evaluate(`ShuttleAthletes.last.opponent.sockStripeColor`),'f0ddbd');
    assert.equal(await evaluate(`ShuttleAthletes.last.opponent.shortsStripeColor`),'c78336');
    await evaluate(`document.querySelector('[data-jersey-role="player"]').click();document.querySelector('.jersey-colors').scrollIntoView({block:'start'});`);
    assert.ok(await evaluate(`(()=>{const r=document.getElementById('jersey-preview').getBoundingClientRect();return Math.abs(r.width/r.height-600/320)<.01;})()`),'outfit preview preserves character proportions on phones and landscape');
    assert.ok(await evaluate(`(()=>{const p=document.getElementById('jerseyColor-choices').getBoundingClientRect(),b=document.getElementById('personalization-close').getBoundingClientRect();return p.width>=44&&p.height>=44&&b.bottom<=innerHeight;})()`),'jersey controls and footer remain usable on each layout');
    await shot(`personalization-jersey-${label}.png`);
    if(label==='desktop')await writeFile(join(artifacts,'jersey-colors-preview.png'),Buffer.from(await evaluate(`document.getElementById('jersey-preview').toDataURL('image/png').split(',')[1]`),'base64'));
    await evaluate(`(()=>{const original=Storage.prototype.setItem;try{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};const c=document.getElementById('jerseyColor-choices');c.querySelector('[data-color="' + '#17a371' + '"]').click();}finally{Storage.prototype.setItem=original;}})()`);
    assert.equal(await evaluate(`document.getElementById('appearance-save-status').textContent`),'Not saved');
    assert.equal(await evaluate(`ShuttleAthletes.last.player.jerseyColor`),'17a371','failed persistence still applies this session');
    await evaluate(`document.getElementById('jersey-colors-reset').click();`);
    assert.equal(await evaluate(`ShuttleAthletes.last.opponent.jerseyColor`),'f5f3e8','per-role reset leaves the other shirt alone');
    assert.equal(await evaluate(`document.getElementById('landingColor-choices').dataset.selectedColor`),'#153e60','shirt reset leaves court/marker choices alone');
    await evaluate(`document.querySelector('[data-jersey-role="opponent"]').click();document.getElementById('jersey-colors-reset').click();document.querySelector('[data-jersey-role="player"]').click();`);
    assert.equal(await evaluate(`ShuttleAthletes.last.player.jerseyColor`),'2264c8');assert.equal(await evaluate(`ShuttleAthletes.last.opponent.jerseyColor`),'f0ddbd');
    const beforeRacket=await evaluate(`({player:__courtCheck.snapshot().player,state:__courtCheck.snapshot().state,preview:document.getElementById('racket-preview').toDataURL()})`);
    await evaluate(`document.querySelector('[data-racket-role="player"]').click();document.querySelector('[data-racket-style="square"]').click();document.querySelector('[data-racket-size="extra"]').click();(()=>{for(const [id,color] of [['racketColor-choices','#2264c8'],['racketGrip-choices','#f77927']]){const c=document.getElementById(id);c.querySelector('[data-color="' + color + '"]').click();}})();document.querySelector('.racket-customization').scrollIntoView({block:'start'});`);
    const afterRacket=await evaluate(`({player:__courtCheck.snapshot().player,state:__courtCheck.snapshot().state,rig:ShuttleAthletes.last.player,saved:JSON.parse(localStorage.getItem('shuttle-club-appearance')),preview:document.getElementById('racket-preview').toDataURL()})`);
    assert.deepEqual(afterRacket.player,beforeRacket.player);assert.equal(afterRacket.state,beforeRacket.state);
    assert.equal(afterRacket.rig.racketStyle,'square');assert.equal(afterRacket.rig.racketSize,'extra');assert.equal(afterRacket.rig.racketFrameColor,'2264c8');assert.equal(afterRacket.rig.racketGripColor,'f77927');
    assert.notEqual(afterRacket.preview,beforeRacket.preview,'real equipment preview changes with profile');
    assert.equal(afterRacket.saved.playerRacketStyle,'square');assert.equal(afterRacket.saved.playerRacketColor,'#2264c8');
    assert.ok(await evaluate(`(()=>{const r=document.getElementById('racket-preview').getBoundingClientRect();return Math.abs(r.width/r.height-600/420)<.01&&document.documentElement.scrollWidth<=innerWidth;})()`),'racket proportions and layout on desktop, mobile and landscape');
    await shot(`personalization-racket-${label}.png`);
    await evaluate(`document.querySelector('[data-racket-role="opponent"]').click();document.querySelector('[data-racket-style="slim"]').click();(()=>{const c=document.getElementById('racketColor-choices');c.querySelector('[data-color="' + '#d75b8c' + '"]').click();})()`);
    assert.equal(await evaluate(`ShuttleAthletes.last.player.racketFrameColor`),'2264c8','other racket keeps its color');
    await evaluate(`document.querySelector('[data-racket-role="player"]').click();document.getElementById('racket-reset').click();`);
    assert.equal(await evaluate(`ShuttleAthletes.last.player.racketSize`),'large');assert.equal(await evaluate(`ShuttleAthletes.last.opponent.racketStyle`),'slim');
    assert.equal(await evaluate(`ShuttleAthletes.last.player.jerseyColor`),'2264c8','equipment reset keeps jersey');
    await evaluate(`document.querySelector('[data-racket-role="opponent"]').click();document.getElementById('racket-reset').click();document.querySelector('[data-racket-role="player"]').click();`);
    await evaluate(`document.querySelector('#personalization .panel-content').scrollTop=0;`);
    await evaluate(`document.getElementById('help-open').click();`);
    assert.ok(await evaluate(`(()=>{const b=document.getElementById('help-close'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`),'help footer stays reachable with larger text');
    await evaluate(`document.getElementById('help-close').click();`);
    assert.ok(await evaluate(`!document.getElementById('personalization').classList.contains('hidden')`),'help restores personalization');
    await evaluate(`document.querySelector('[data-court-style="classic"]').click();`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    assert.ok(await evaluate(`!document.getElementById('welcome').classList.contains('hidden')`),'Escape returns from personalization to cover');
    let startPosition;
    for (const mode of ['practice','match','drill']) {
      await evaluate(`document.getElementById('choose-${mode}').click();`);
      await sleep(80);
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `${label} ${mode} has no horizontal overflow`);
      assert.ok(await evaluate(`document.getElementById('welcome').classList.contains('hidden')&&!document.getElementById('mode-setup').classList.contains('hidden')`), 'entry opens dedicated mode screen');
      assert.equal(await evaluate(`getComputedStyle(document.getElementById('match-options')).display!=='none'`), mode==='match');
      assert.equal(await evaluate(`getComputedStyle(document.getElementById('drill-options')).display!=='none'`), mode==='drill');
      if(mode==='match') {
        await evaluate(`document.querySelector('[data-points="15"]').click();document.querySelector('[data-ai-level="easy"]').click();document.querySelector('[data-ai-style="rally"]').click();`);
        assert.equal(await evaluate(`document.getElementById('setup-summary').textContent`),'15 pts · Easy · Rally','match summary follows all selected options');
        assert.match(await evaluate(`document.getElementById('ai-level-note').textContent`),/Easy.*慢节奏/);
        assert.match(await evaluate(`document.getElementById('ai-style-note').textContent`),/调动/,'selected style has a readable explanation');
      } else if(mode==='drill') {
        await evaluate(`document.querySelector('[data-training="net"]').click();document.querySelector('[data-training-speed="fast"]').click();document.querySelector('[data-training-limit="0"]').click();`);
        assert.equal(await evaluate(`document.getElementById('setup-summary').textContent`),'Net Intercept · Fast · Unlimited','drill summary follows content, speed, and length');
      } else assert.equal(await evaluate(`document.getElementById('setup-summary').textContent`),'Feed Practice · Unlimited');
      if(mobile) assert.ok(await evaluate(`Array.from(document.querySelectorAll('#mode-setup button[aria-pressed]')).filter(b=>b.getBoundingClientRect().height>0).every(b=>b.getBoundingClientRect().width>=44&&b.getBoundingClientRect().height>=44)`),'touch mode choices are at least 44px');
      const position = await evaluate(`document.getElementById('start').getBoundingClientRect().y`);
      if (startPosition!==undefined) assert.ok(Math.abs(position-startPosition)<1, `${label} start button stays at the same position for every mode`);
      startPosition=position;
      assert.ok(await evaluate(`(()=>{const b=document.getElementById('start'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`), `${label} ${mode} start is visible without scrolling`);
      await evaluate(`document.querySelector('#mode-setup .panel-content').scrollTop=10000;`);
      assert.ok(Math.abs((await evaluate(`document.getElementById('start').getBoundingClientRect().y`))-position)<1, 'scrolling options does not move the start button');
      await evaluate(`document.querySelector('#mode-setup .panel-content').scrollTop=0;`);
      await shot(`mode-setup-${mode}-${label}.jpg`);
      if(mode==='match') await evaluate(`document.querySelector('[data-points="7"]').click();document.querySelector('[data-ai-level="normal"]').click();document.querySelector('[data-ai-style="balanced"]').click();`);
      if(mode==='drill') await evaluate(`document.querySelector('[data-training="jump"]').click();document.querySelector('[data-training-speed="normal"]').click();document.querySelector('[data-training-limit="20"]').click();`);
      await evaluate(`document.getElementById('setup-back').click();`);
      assert.ok(await evaluate(`!document.getElementById('welcome').classList.contains('hidden')`), 'back restores cover');
    }
    await evaluate(`document.getElementById('settings-menu').click();`);
    assert.ok(await evaluate(`!document.getElementById('settings').classList.contains('hidden')&&document.getElementById('welcome').classList.contains('hidden')`), 'settings has its own screen');
    assert.ok(await evaluate(`(()=>{const b=document.getElementById('settings-close'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`), 'settings footer is visible');
    await evaluate(`document.querySelector('#settings [data-open-personalization]').click();document.getElementById('personalization-close').click();`);
    assert.ok(await evaluate(`!document.getElementById('settings').classList.contains('hidden')`),'personalization restores settings as its source');
    await shot(`game-settings-${label}.jpg`);
    await shot(`settings-text-${label}.png`);
    if(mobile) assert.ok(await evaluate(`Array.from(document.querySelectorAll('#settings .power-setting button')).every(b=>b.getBoundingClientRect().width>=44&&b.getBoundingClientRect().height>=44)`),'touch power presets are at least 44px');
    if(mobile) {
      await evaluate(`document.querySelector('.settings-content').scrollTop=10000;`);
      assert.ok(await evaluate(`(()=>{const b=document.getElementById('reset-power'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`),'power reset is reachable after scrolling on phones');
      await shot(`game-settings-${label}-bottom.jpg`);
      await evaluate(`document.querySelector('.settings-content').scrollTop=0;`);
    }
    await evaluate(`document.getElementById('settings-close').click();`);
  }
  await send('Emulation.setDeviceMetricsOverride', {width:1400,height:900,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setTouchEmulationEnabled', {enabled:false});
  await evaluate(`document.querySelector('[data-guidance="full"]').click();`);
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-guidance'))`),{mode:'full'});
  await evaluate(`document.querySelector('[data-guidance="compact"]').click();`);
  await evaluate(`document.getElementById('choose-practice').click();document.getElementById('help-open').click();`);
  await evaluate(`document.getElementById('help-close').click();`);
  assert.ok(await evaluate(`!document.getElementById('mode-setup').classList.contains('hidden')`), 'help returns to the originating mode screen');
  await evaluate(`document.getElementById('settings-open').click();document.getElementById('settings-close').click();`);
  assert.ok(await evaluate(`!document.getElementById('mode-setup').classList.contains('hidden')`), 'settings returns to the originating mode screen');
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape'});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape'});
  assert.ok(await evaluate(`!document.getElementById('welcome').classList.contains('hidden')`), 'Escape returns from mode screen to cover');
  await evaluate(`document.getElementById('settings-menu').click();document.getElementById('volume').value=37;document.getElementById('volume').dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.equal(await evaluate(`document.getElementById('settings-save-status').textContent`),'✓ Saved','successful changes show real save feedback');
  await evaluate(`document.querySelector('[data-default-shot="clear"][data-default-power="1"]').click();document.querySelector('[data-default-shot="drop"][data-default-power="3"]').click();document.getElementById('settings-sound').click();document.getElementById('reset-audio').click();`);
  assert.equal(await evaluate(`document.getElementById('volume').value`),'100');
  assert.equal(await evaluate(`document.getElementById('settings-sound').getAttribute('aria-pressed')`),'true');
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-power-defaults'))`),{clear:1,drop:3,smash:2},'audio reset leaves power presets intact');
  await evaluate(`document.getElementById('volume').value=37;document.getElementById('volume').dispatchEvent(new Event('input'));document.getElementById('settings-sound').click();document.getElementById('reset-power').click();`);
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-power-defaults'))`),{clear:3,drop:1,smash:2},'power reset restores all shot defaults');
  assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-audio-settings'))`),{volume:37,muted:true},'power reset leaves audio settings intact');
  await shot('game-settings-saved-desktop.jpg');
  await evaluate(`document.getElementById('reset-audio').click();document.getElementById('volume').value=37;document.getElementById('volume').dispatchEvent(new Event('input'));`);
  await evaluate(`(()=>{const original=Storage.prototype.setItem;try{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};document.querySelector('[data-default-shot="clear"][data-default-power="2"]').click();}finally{Storage.prototype.setItem=original;}})()`);
  assert.equal(await evaluate(`document.getElementById('settings-save-status').textContent`),'Not saved','failed storage does not claim success');
  await evaluate(`document.querySelector('[data-default-shot="clear"][data-default-power="3"]').click();`);
  await sleep(1900);
  assert.equal(await evaluate(`document.getElementById('settings-save-status').textContent`),'Auto-save','saved feedback clears after a short delay');
  assert.equal(await evaluate(`document.getElementById('volume-value').value`), '37%');
  assert.equal((await evaluate(`JSON.parse(localStorage.getItem('shuttle-club-audio-settings'))`)).volume,37);
  await evaluate(`document.getElementById('volume').focus();`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight'});
  assert.equal(await evaluate(`Number(document.getElementById('volume').value)`),38,'volume slider supports keyboard arrows');
  await evaluate(`document.getElementById('volume-preview').click();`);
  await sleep(200);
  let audioSettings=await evaluate(`__courtCheck.audioSettings()`);
  assert.ok(audioSettings.created&&Math.abs(audioSettings.gain-.38)<.001,'all sound paths use the master volume');
  await evaluate(`document.getElementById('settings-sound').click();`);await sleep(150);
  audioSettings=await evaluate(`__courtCheck.audioSettings()`);
  assert.ok(audioSettings.muted&&audioSettings.gain<.001,`mute sets the actual master gain to zero: ${JSON.stringify(audioSettings)}`);
  assert.equal(await evaluate(`document.getElementById('volume-preview').disabled`),true);
  await evaluate(`document.getElementById('settings-sound').focus();`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'m',code:'KeyM'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'m',code:'KeyM'});
  assert.equal(await evaluate(`document.getElementById('settings-sound').getAttribute('aria-pressed')`),'true','M updates settings mute control');
  await evaluate(`document.getElementById('volume').value=0;document.getElementById('volume').dispatchEvent(new Event('input'));document.getElementById('volume').blur();`);await sleep(150);
  assert.ok((await evaluate(`__courtCheck.audioSettings()`)).gain<.001,'zero volume is silent');
  await evaluate(`document.getElementById('volume').value=100;document.getElementById('volume').dispatchEvent(new Event('input'));document.getElementById('settings-close').click();document.getElementById('choose-practice').click();document.getElementById('start').click();__courtCheck.freeze();`);
  assert.ok(await evaluate(`(()=>{const b=document.getElementById('drill-end'),r=b.getBoundingClientRect();return parseFloat(getComputedStyle(b).fontSize)>=16&&r.height>=44&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()`),'practice exit is a large visible court button');
  await evaluate(`document.getElementById('settings-open').click();document.querySelector('#settings [data-open-personalization]').click();`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'p',code:'KeyP'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'p',code:'KeyP'});
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).state,'paused','personalization keeps gameplay paused');
  await evaluate(`document.getElementById('personalization-close').click();`);
  assert.ok(await evaluate(`!document.getElementById('settings').classList.contains('hidden')`),'in-game personalization restores settings');
  await evaluate(`document.getElementById('settings-close').click();document.getElementById('resume').click();__courtCheck.freeze();`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.cover-art')).display`), 'none', 'playing hides cover artwork');
  let rect = await bounds(); assert.ok(rect.bottom <= rect.h && rect.right <= rect.w, 'Desktop focused court fits viewport');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.heading')).display`), 'none');
  for (const style of ['classic','sakura','sky','dusk']) {
    await evaluate(`document.querySelector('[data-court-style="${style}"]').click();`);
    const preview=await evaluate(`__courtCheck.guidePreview()`);
    await writeFile(join(artifacts,`landing-guides-${style}.png`),Buffer.from(preview.image,'base64'));
    if(style==='sakura') {
      const luminance=rgb=>rgb.slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
      const a=luminance(preview.marker),b=luminance(preview.floor);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=3,'pink landing ring has at least 3:1 contrast against the actual rendered floor');
    }
  }
  await evaluate(`document.querySelector('[data-court-style="sakura"]').click();`);
  for(const [label,width,height,dpr,mobile] of [['desktop',1400,900,2,false],['mobile',390,844,3,true],['landscape',844,390,2,true]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile});await sleep(100);
    const resolution=await evaluate(`__courtCheck.rendering()`),css=await evaluate(`(()=>{const r=document.getElementById('court').getBoundingClientRect();return {width:r.width,height:r.height};})()`);
    assert.equal(resolution.width,Math.round(css.width*dpr),'court uses native horizontal screen pixels');
    assert.equal(resolution.height,Math.round(css.height*dpr),'court uses native vertical screen pixels');
    assert.equal(resolution.cacheWidth,resolution.width,'venue cache is rebuilt at the new resolution');
    assert.equal(resolution.cacheHeight,resolution.height);
    assert.ok(Math.abs((await evaluate(`__courtCheck.aimPointer(.72)`))-(.03+.72*.94))<.0001,'mouse aiming remains in logical camera coordinates at every DPR');
    for(const color of ['#263348','#f5f3e8','#53b5ee']) {
      await evaluate(`(()=>{const input=document.getElementById('landingColor-choices');input.querySelector('[data-color="' + '${color}' + '"]').click();})()`);
      const result=await evaluate(`__courtCheck.guidePreview()`),expected=color.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16));
      assert.ok(result.marker.slice(0,3).every((c,i)=>Math.abs(c-expected[i])<20),`custom color reaches the actual landing ring: ${label}, ${color}, ${JSON.stringify(result.marker)}`);
    }
    await evaluate(`(()=>{const input=document.getElementById('aimColor-choices');input.querySelector('[data-color="' + '#ffcc33' + '"]').click();})()`);
    const preview=await evaluate(`__courtCheck.guidePreview()`);
    assert.ok(preview.aim.slice(0,3).every((c,i)=>Math.abs(c-[255,204,51][i])<20),'custom aim color reaches the actual outgoing marker');
    await writeFile(join(artifacts,`court-clarity-${label}.png`),Buffer.from(preview.image,'base64'));
    await evaluate(`__courtCheck.showGuides()`);
    await shot(`game-text-transparent-${label}.png`);
    await evaluate(`__courtCheck.freeze()`);
    await evaluate(`document.getElementById('settings-open').click();document.querySelector('#settings [data-open-personalization]').click();`);
    assert.ok(await evaluate(`(()=>{const c=document.getElementById('appearance-preview'),r=c.getBoundingClientRect();return c.width===Math.round(r.width*devicePixelRatio)&&c.height===Math.round(r.height*devicePixelRatio);})()`),'preview also renders at native screen resolution');
    if(label==='desktop') {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:3,mobile});await sleep(100);
      assert.ok(await evaluate(`(()=>{const c=document.getElementById('appearance-preview'),r=c.getBoundingClientRect();return c.width===Math.round(r.width*3)&&c.height===Math.round(r.height*3);})()`),'an open preview refreshes when only pixel density changes');
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile});await sleep(100);
    }
    await evaluate(`document.querySelector('#personalization .panel-content').scrollTop=document.querySelector('.marker-colors').offsetTop-100;`);
    await shot(`personalization-colors-hidpi-${label}.png`);
    await shot(`personalization-text-${label}.png`);
    await evaluate(`document.getElementById('personalization-close').click();document.getElementById('settings-close').click();document.getElementById('resume').click();__courtCheck.freeze();`);
  }
  await evaluate(`document.getElementById('marker-colors-reset').click();document.querySelector('[data-court-style="classic"]').click();`);
  await send('Emulation.setDeviceMetricsOverride',{width:1400,height:900,deviceScaleFactor:1,mobile:false});await sleep(100);
  await writeFile(join(artifacts,'appearance-preview.png'),Buffer.from(await evaluate(`__courtCheck.appearancePreview()`),'base64'));
  for (const [name, pose] of [['venue-lighting-preview.png','idle'],['venue-lighting-jump.png','apex']]) {
    await writeFile(join(artifacts,name),Buffer.from(await evaluate(`__courtCheck.venuePreview('${pose}')`),'base64'));
  }
  await evaluate(`__courtCheck.poseScene('idle')`);
  const waiting=await evaluate(`ShuttleAthletes.last.player`);
  assert.ok(waiting.ready>.9&&waiting.spinePitch>.12&&waiting.hips[1]<.92,'waiting athlete bends slightly forward and keeps knees flexed');
  assert.ok(waiting.triangles>=15777,'new mesh is rendered in the actual court');
  assert.equal(waiting.jerseyColor,'2264c8');
  assert.equal(await evaluate(`ShuttleAthletes.last.opponent.jerseyColor`),'f0ddbd','opponent has a distinct jersey');
  assert.ok(waiting.soleHeights.every(y=>y>=-.004)&&Math.min(...waiting.soleHeights)<.006,'ready posture preserves ground support');
  await shot('motion-waiting-ready.png');
  const prepared=await evaluate(`__courtCheck.prepareScene()`);
  assert.ok(prepared.motion.prepare>.5&&prepared.rig.prepare>.5,'nearby high shuttle anticipates the overhead before a click');
  await shot('motion-overhead-preparation.png');
  for (const mode of ['full','compact']) {
    await evaluate(`document.querySelector('[data-guidance="${mode}"]').click();`);
    const routine=await evaluate(`__courtCheck.guidanceProbe('hit')`);
    assert.equal(routine.visible,mode==='full','routine success feedback follows the selected guidance');
    assert.equal(routine.labels>0,mode==='full','ordinary court captions follow the selected guidance');
    for (const kind of ['opponent','feed']) assert.equal((await evaluate(`__courtCheck.guidanceProbe('${kind}')`)).visible,mode==='full');
    assert.equal((await evaluate(`__courtCheck.guidanceProbe('notice')`)).visible,true,'essential notices survive compact mode');
    await evaluate(`__courtCheck.guidanceProbe('hit');__courtCheck.freeze();`);
    await shot(`guidance-${mode}-desktop.png`);
  }
  const splitPose=await evaluate(`__courtCheck.poseScene('split')`);
  assert.ok(splitPose.motion.split>.4 && splitPose.player.height===0,'receiving split step is visual and leaves ground contact unchanged');
  await shot('motion-split-step.png');
  const shufflePose=await evaluate(`__courtCheck.poseScene('shuffle')`);
  assert.ok(shufflePose.player.vx>0 && shufflePose.motion.run>.35,'lateral shuffle follows real movement');await shot('motion-lateral-shuffle.png');
  assert.equal(await evaluate(`ShuttleAthletes.last.player.legPose`),'Sidestep','lateral gameplay uses the GLB sidestep rig');
  const wideStance=await evaluate(`ShuttleAthletes.last.player`);
  assert.ok(wideStance.stanceWidth>.44&&wideStance.hips[1]<.76,'lateral movement uses a deeper low wide stance');
  assert.ok(wideStance.soleHeights.every(y=>y>=-.004)&&Math.min(...wideStance.soleHeights)<.006,'one sidestep sole supports the body on the court');
  const retreatPose=await evaluate(`__courtCheck.poseScene('retreat')`);
  assert.ok(retreatPose.player.vy>0 && Math.abs(retreatPose.player.vx)<.01);await shot('motion-retreat.png');
  const brakePose=await evaluate(`__courtCheck.poseScene('brake')`);
  assert.ok(brakePose.player.pivot>.5 && brakePose.motion.brake>.3,'reversal drives a planted braking pose');await shot('motion-braking.png');
  const inertia=await evaluate(`ShuttleAthletes.last.player`);
  assert.ok(inertia.planted>.8&&inertia.spineRoll>.20,'reversal retains old-direction body lean while bracing');
  assert.ok(inertia.stanceWidth>.5&&inertia.soleHeights.every(y=>y>=-.004),'braking plants a wide stance without feet sinking');
  for(const name of ['takeoff','apex','landing']) {
    const pose=await evaluate(`__courtCheck.poseScene('${name}')`);
    if(name==='takeoff')assert.ok(pose.player.verticalVelocity>200 && pose.player.height>0);
    if(name==='apex')assert.ok(pose.player.height>55 && Math.abs(pose.player.verticalVelocity)<20);
    if(name==='landing')assert.ok(pose.player.height===0 && pose.player.jumpRecovery>0);
    const rig=await evaluate(`ShuttleAthletes.last.player`);
    assert.equal(rig.bones,29);assert.equal(rig.height,pose.player.height,'only gameplay contributes jump height');
    assert.ok(rig.hips[1]<1.01,'GLB airborne root motion is removed');
    assert.ok(rig.footHeights.every(y=>y>.085&&y<.22),'jump rig keeps only local foot tuck, without a second jump');
    await shot('motion-jump-'+name+'.png');
  }
  assert.equal(await evaluate(`__courtCheck.scenario('early').reason`), 'early');
  for(const x of [.2,.8]) for(const side of [-1,1]) {
    const cue=await evaluate(`__courtCheck.landingSide(${x},${side})`);
    assert.ok(cue.grade,`landing ${x}, side ${side} predicts a legal forehand/backhand return`);
    await evaluate(`__courtCheck.strike('clear')`);
    const result=await evaluate(`__courtCheck.snapshot()`),align=await evaluate(`__courtCheck.contactCheck()`);
    assert.equal(result.delivery.phase,'return');assert.equal(result.swing.backhand,side>0);
    assert.ok(Math.hypot(align.head.x-align.point.x,align.head.y-align.point.y)<.01,'both landing sides align the real 3D racket with the actual shuttle');
    await shot(`landing-side-${x===.2?'left':'right'}-${side<0?'forehand':'backhand'}.png`);
  }
  assert.equal(await evaluate(`__courtCheck.scenario('late').reason`), 'late');
  assert.equal(await evaluate(`__courtCheck.scenario('high').reason`), 'high');
  assert.equal(await evaluate(`__courtCheck.scenario('far').reason`), 'far');
  assert.equal(await evaluate(`__courtCheck.scenario('drop').grade`), 'perfect');
  await evaluate(`__courtCheck.step(.01); __courtCheck.freeze();`);
  await shot('contact-cue-drop.png');
  await evaluate(`__courtCheck.scenario('lunge');__courtCheck.step(.02);__courtCheck.step(.02);__courtCheck.freeze();`);
  assert.ok(await evaluate(`__courtCheck.snapshot().lunge`) > .25, 'Low net shot produces a split lunge');
  assert.equal(await evaluate(`ShuttleAthletes.last.player.legPose`),'Lunge','low incoming shot blends the new lunge animation');
  assert.ok(await evaluate(`ShuttleAthletes.last.player.soleHeights.every(y=>y>=-.004)`),'lunge shoes stay above the court');
  await shot('character-net-lunge.png');
  assert.equal(await evaluate(`__courtCheck.scenario('clear').grade`), 'perfect');
  await evaluate(`__courtCheck.freeze();`); await shot('focus-practice.png');
  await evaluate(`__courtCheck.scenario('early'); __courtCheck.hit('clear'); __courtCheck.step(.05); __courtCheck.freeze();`);
  assert.equal(await evaluate(`document.querySelector('#feedback').firstChild.textContent`), 'Too early');
  await evaluate(`__courtCheck.scenario('far'); __courtCheck.hit('clear'); __courtCheck.step(.05); __courtCheck.freeze();`);
  assert.equal(await evaluate(`document.querySelector('#feedback').firstChild.textContent`), 'Too far away');
  await evaluate(`__courtCheck.scenario('high'); __courtCheck.hit('clear'); __courtCheck.step(.05); __courtCheck.freeze();`);
  assert.equal(await evaluate(`document.querySelector('#feedback').firstChild.textContent`), 'Too high');
  await evaluate(`__courtCheck.scenario('jump'); __courtCheck.step(.01); __courtCheck.hit('smash'); __courtCheck.step(.05);`);
  const contact = await evaluate(`__courtCheck.contactCheck()`);
  assert.ok(contact?.head && Math.hypot(contact.head.x-contact.point.x,contact.head.y-contact.point.y)<.01, 'Turned racket head meets the shuttle');
  await evaluate(`__courtCheck.hit('clear'); __courtCheck.freeze();`);
  assert.equal(await evaluate(`document.querySelector('#feedback').firstChild.textContent`), 'Recovering');
  await shot('character-turn-jump.png');
  // High shots use the live shuttle, including the windup prediction and locked racket contact.
  assert.equal(await evaluate(`__courtCheck.scenario('phantom-high').reason`),'far');
  const phantom=await evaluate(`__courtCheck.snapshot()`);
  assert.ok(phantom.cue.point.y<phantom.delivery.target.y-.2,'moving high cue is separate from landing');
  await evaluate(`__courtCheck.hit('smash');__courtCheck.step(.05);__courtCheck.freeze();`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).delivery.phase,'incoming','future landing does not manufacture contact');
  assert.equal(await evaluate(`document.querySelector('#feedback').firstChild.textContent`),'Too far away');
  await shot('high-contact-too-far.png');
  assert.ok(await evaluate(`__courtCheck.scenario('live-high').grade`));
  await evaluate(`__courtCheck.hit('smash');__courtCheck.step(.05);__courtCheck.freeze();`);
  const realHigh=await evaluate(`__courtCheck.snapshot()`),realAlignment=await evaluate(`__courtCheck.contactCheck()`);
  assert.equal(realHigh.delivery.shotType,'smash');assert.equal(realHigh.delivery.fault,null);
  assert.ok(Math.hypot(realAlignment.head.x-realAlignment.point.x,realAlignment.head.y-realAlignment.point.y)<.01,JSON.stringify(realAlignment));
  await shot('high-contact-live-smash.png');
  await evaluate(`__courtCheck.scenario('live-high');__courtCheck.hit('smash');__courtCheck.step(.05);__courtCheck.step(.09);__courtCheck.freeze();`);
  assert.ok((await evaluate(`__courtCheck.snapshot()`)).motion.stroke>.35,'overhead follow-through drives torso and balancing arm');
  await shot('motion-smash-follow-through.png');
  // Backhands share the controls; actual contact decides the side after windup.
  const landingStroke=await evaluate(`__courtCheck.landingStroke()`);
  assert.equal(landingStroke.air.upperPose,'Smash');assert.equal(landingStroke.land.upperPose,'Smash','landing cannot switch a smash follow-through to forehand');
  assert.ok(landingStroke.land.landingWeight>0&&landingStroke.land.landingWeight<1,'landing blends towards locomotion');
  assert.ok(landingStroke.land.soleHeights.every(y=>y>=-.004),'blended landing preserves shoe support');
  await shot('motion-smash-landing-transition.png');
  for(const rig of [landingStroke.air,landingStroke.land]) assert.ok(rig.extension<=rig.unassistedExtension+.01,'torso assistance never increases arm extension');
  const liveBackhandChecks = [];
  for (const scenario of ['backhand-jump','backhand-defense']) for (const requested of ['clear','drop','smash']) {
    for (const age of [.025,.05,.09,.16,.25,.36]) {
      const result = await evaluate(`__courtCheck.probeBackhand('${scenario}','${requested}',${age})`);
      assert.equal(result.clear,true,`${scenario}/${requested} at ${age}: live racket crosses jersey or head`);
      if(age===.05||age===.09) assert.ok(Math.hypot(result.contact.head.x-result.contact.point.x,result.contact.head.y-result.contact.point.y)<.01);
      liveBackhandChecks.push({scenario,requested,age,clear:result.clear,upperPose:result.pose.upperPose});
    }
  }
  await writeFile(join(artifacts,'pixel-athlete-live-backhand-checks.json'),JSON.stringify(liveBackhandChecks,null,2));
  const backReady=await evaluate(`(()=>{const cue=__courtCheck.scenario('backhand-jump');__courtCheck.freeze();return cue;})()`);
  assert.equal(backReady.backhand,true);assert.equal(backReady.smash,true);
  await evaluate(`__courtCheck.strike('smash');`);
  const backHit=await evaluate(`__courtCheck.snapshot()`),backAlign=await evaluate(`__courtCheck.contactCheck()`);
  assert.equal(backHit.delivery.backhand,true);assert.equal(backHit.delivery.shotType,'smash',JSON.stringify({player:backHit.player,delivery:backHit.delivery}));assert.equal(backHit.delivery.fault,null);
  assert.equal(await evaluate(`document.querySelector('#feedback').firstChild.textContent`),'Backhand Jump smash');
  assert.ok(Math.hypot(backAlign.head.x-backAlign.point.x,backAlign.head.y-backAlign.point.y)<.01,'backhand racket stays aligned with the shuttle');
  await shot('backhand-jump-desktop.png');
  const backFail=await evaluate(`(()=>{const cue=__courtCheck.scenario('backhand-fail');__courtCheck.freeze();return cue;})()`);
  assert.ok(backFail.grade);assert.equal(backFail.smash,false);
  assert.equal(await evaluate(`document.getElementById('option-smash').textContent`),'Backhand Clear');
  await evaluate(`__courtCheck.strike('smash');`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).delivery.shotType,'clear');
  assert.match(await evaluate(`document.querySelector('#feedback small').textContent`),/Backhand Smash条件不足/);
  await shot('backhand-fallback-desktop.png');
  const groundAttackChecks=[];
  for(const name of ['tap-forehand','tap-center','tap-backhand','tap-low']) {
    const result=await evaluate(`(()=>{
      const cue=__courtCheck.scenario('${name}'),label=document.getElementById('option-smash').textContent;
      const court=document.getElementById('court'),r=court.getBoundingClientRect();
      court.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.x+r.width*.5,clientY:r.y+r.height*.64,button:2,buttons:2,pointerId:1,pointerType:'mouse',bubbles:true}));
      __courtCheck.step(.05);__courtCheck.freeze();return {cue,label,snapshot:__courtCheck.snapshot(),alignment:__courtCheck.contactCheck()};
    })()`);
    const expected='tap';
    assert.equal(result.snapshot.delivery.shotType,expected,`${name} resolves through the actual right-click handler`);
    assert.equal(result.snapshot.player.height,0,'direct right-click requires no jump');
    assert.equal(result.snapshot.delivery.fault,null);
    assert.match(result.label,/Standing smash/,'preview agrees with actual attack');
    if(expected==='tap') {
      assert.ok(result.snapshot.delivery.returnHeight>25 && result.snapshot.delivery.returnHeight<=120,'original ground attack still uses a live reachable shuttle');
      assert.ok(Math.hypot(result.alignment.head.x-result.alignment.point.x,result.alignment.head.y-result.alignment.point.y)<.01,'relaxed ground attack still aligns the 3D racket with the live shuttle');
      await shot(`${name}-relaxed-desktop.png`);
    }
    groundAttackChecks.push({name,expected,label:result.label,height:result.snapshot.delivery.returnHeight,airborneHeight:result.snapshot.player.height,fault:result.snapshot.delivery.fault,backhand:result.snapshot.delivery.backhand});
  }
  await writeFile(join(artifacts,'ground-attack-height-checks.json'),JSON.stringify(groundAttackChecks,null,2));
  const practiceJumpChecks=[];
  for(let i=0;i<20;i++) {
    const result=await evaluate(`__courtCheck.practiceJumpBall(${i%2?.6:.4})`);
    assert.equal(result.shot,'smash',`ordinary practice jump ${i}: ${JSON.stringify(result)}`);
    assert.equal(result.fault,null);assert.ok(result.ballHeight>=75);
    practiceJumpChecks.push({attempt:i+1,...result});
  }
  await writeFile(join(artifacts,'practice-jump-restored-checks.json'),JSON.stringify({jumpDelaySeconds:.1,strikeDelaySeconds:.06,checks:practiceJumpChecks},null,2));
  await shot('practice-jump-restored-desktop.png');
  for(const [request,expected] of [['clear','lift'],['drop','block'],['smash','drive']]) {
    await evaluate(`__courtCheck.scenario('backhand-defense');__courtCheck.hit('${request}');__courtCheck.step(.05);__courtCheck.freeze();`);
    const snapshot=await evaluate(`__courtCheck.snapshot()`),alignment=await evaluate(`__courtCheck.contactCheck()`);
    assert.equal(snapshot.delivery.shotType,expected);assert.equal(snapshot.delivery.backhand,true);assert.equal(snapshot.delivery.fault,null);
    assert.ok(Math.hypot(alignment.head.x-alignment.point.x,alignment.head.y-alignment.point.y)<.01);
  }
  await evaluate(`__courtCheck.scenario('backhand-defense');__courtCheck.hit('clear');__courtCheck.switchToForehand();__courtCheck.step(.08);__courtCheck.freeze();`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).delivery.backhand,false,'moving past the ball during windup updates the actual stroke side');
  // Exercise actual desktop pointer/Shift events, not just direct calls to hit().
  await evaluate(`__courtCheck.scenario('defense');__courtCheck.step(.001);__courtCheck.freeze();`);await shot('defense-options-desktop.png');
  for (const [button,modifiers,expected] of [['left',0,'lift'],['left',8,'block'],['right',0,'drive']]) {
    await evaluate(`__courtCheck.holdInputClock();__courtCheck.scenario('defense');`);
    assert.equal(await evaluate(`document.getElementById('option-clear').textContent`),'Lift');
    assert.equal(await evaluate(`document.getElementById('option-drop').textContent`),'Block');
    assert.equal(await evaluate(`document.getElementById('option-smash').textContent`),'Drive');
    const pointer=await evaluate(`(()=>{const r=document.getElementById('court').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.64};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...pointer,button,buttons:button==='right'?2:1,clickCount:1,modifiers});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...pointer,button,buttons:0,clickCount:1,modifiers});
    await evaluate(`__courtCheck.finishInput();`);
    const result=await evaluate(`__courtCheck.snapshot()`);
    assert.equal(result.delivery.shotType,expected,`Pointer input selects ${expected}: ${JSON.stringify(result)}`);
    assert.equal(result.delivery.fault,null);
    assert.ok(result.counts[{lift:'lifts',block:'blocks',drive:'drives'}[expected]]>0);
    const aligned=await evaluate(`__courtCheck.contactCheck()`);
    // Contact lock lasts through 110ms; later samples are the deliberate follow-through.
    if(result.delivery.age<.065) assert.ok(Math.hypot(aligned.head.x-aligned.point.x,aligned.head.y-aligned.point.y)<.01);
    await shot(`defense-${expected}-desktop.png`);
    await evaluate(`__courtCheck.advance(.08);`);await shot(`defense-${expected}-follow.png`);
  }
  await evaluate(`document.getElementById('help-open').click()`);
  assert.equal(await evaluate(`document.getElementById('help').classList.contains('hidden')`), false);
  await shot('help-cues.png');
  await evaluate(`document.getElementById('help-close').click();document.getElementById('pause-menu').click();`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).state,'over','leaving paused practice shows a summary');
  await evaluate(`document.getElementById('result-menu').click();`);
  assert.equal(await evaluate(`document.body.classList.contains('focus-game')`), false);
  await evaluate(`document.getElementById('choose-match').click();`);
  assert.ok(await evaluate(`document.getElementById('start').getBoundingClientRect().bottom<=innerHeight`),'desktop match settings and start fit viewport');
  await shot('match-styles-menu-desktop.png');
  for(const [level,label] of [['easy','Easy'],['hard','Expert'],['normal','Standard']]) {
    await evaluate(`document.getElementById('choose-match').click();document.querySelector('[data-ai-level="${level}"]').click();`);
    assert.match(await evaluate(`document.getElementById('ai-level-note').textContent`),new RegExp(label+'：'));
    await shot('difficulty-menu-'+level+'-desktop.png');
    await evaluate(`document.getElementById('start').click();__courtCheck.freeze();`);
    const started=await evaluate(`__courtCheck.snapshot()`);
    assert.equal(started.opponent.level,level,'chosen tier drives the match opponent');
    assert.ok(Object.values(started.motion).every(value=>value===0),'new game clears every motion state');
    await evaluate(`__courtCheck.resetMatchRound();`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).opponent.level,level,'tier persists between points');
    await evaluate(`__courtCheck.winMatch();document.getElementById('restart').click();__courtCheck.freeze();`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).opponent.level,level,'tier persists on rematch');
    await evaluate(`document.getElementById('pause-menu').click();`);
  }
  for(const style of ['balanced','attack','defense','rally']) {
    await evaluate(`document.getElementById('choose-match').click();document.querySelector('[data-ai-style="${style}"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).opponent.style,style);
    assert.equal(await evaluate(`document.querySelector('[data-ai-style="${style}"]').getAttribute('aria-pressed')`),'true');
    await evaluate(`__courtCheck.resetMatchRound();`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).opponent.style,style,'style persists between points');
    await evaluate(`__courtCheck.winMatch();`);
    const name={balanced:'Balanced',attack:'Attack',defense:'Defense',rally:'Rally'}[style];
    assert.match(await evaluate(`document.getElementById('result-details').textContent`),new RegExp(name+'CPU'));
    await evaluate(`document.getElementById('restart').click();__courtCheck.freeze();`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).opponent.style,style,'rematch preserves chosen style');
    await evaluate(`document.getElementById('pause-menu').click();`);
  }
  await evaluate(`document.getElementById('choose-match').click();document.querySelector('[data-ai-style="balanced"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.hud')).display`), 'none');
  assert.equal(await evaluate(`document.getElementById('match-computer').classList.contains('serving')`), true);
  // Exercise real left/right and Shift+left mouse events while waiting to serve.
  for (const [button, modifiers, expected] of [['left',0,'long'],['right',0,'short'],['left',8,'long']]) {
    await evaluate(`__courtCheck.playerService(1)`);
    assert.equal(await evaluate(`document.getElementById('touch-smash').textContent`), 'Short');
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('touch-drop')).display`), 'none');
    const pointer=await evaluate(`(()=>{const r=document.getElementById('court').getBoundingClientRect();return {x:r.x+r.width*.99,y:r.y+r.height*.64};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...pointer,button,buttons:button==='right'?2:1,clickCount:1,modifiers});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...pointer,button,buttons:0,clickCount:1,modifiers});
    await evaluate(`__courtCheck.step(.05);__courtCheck.freeze()`);
    const snapshot=await evaluate(`__courtCheck.snapshot()`);
    assert.equal(snapshot.delivery.phase,'return');assert.equal(snapshot.delivery.serviceKind,expected);
    assert.equal(snapshot.delivery.shotType,expected==='short'?'drop':'clear');assert.equal(snapshot.delivery.fault,null);
    assert.equal(await evaluate(`ShuttleAthletes.last.player.upperPose`),'Serve','both serve choices use the low-hand service motion');
    assert.ok(snapshot.delivery.returnTarget.x>=.56 && snapshot.delivery.returnTarget.x<=.865,'odd-side serve remains diagonal');
    assert.equal(snapshot.delivery.returnTarget.y,expected==='short'?-.38:-.88);
    await shot(`serve-${expected}-desktop.png`);
  }
  await evaluate(`__courtCheck.playerService(0,true)`);
  const blockedPointer=await evaluate(`(()=>{const r=document.getElementById('court').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.64};})()`);
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...blockedPointer,button:'right',buttons:2,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...blockedPointer,button:'right',buttons:0,clickCount:1});
  await evaluate(`__courtCheck.freeze()`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).delivery.phase,'serve','small serve also requires stationary feet');
  await evaluate(`__courtCheck.score(6,4,'player');`);
  assert.equal(await evaluate(`document.getElementById('match-situation').textContent`), 'Your match point');
  await evaluate(`__courtCheck.score(6,6,'computer');`);
  assert.match(await evaluate(`document.getElementById('match-situation').textContent`), /Deuce/);
  await evaluate(`__courtCheck.score(10,10,'player');`);
  assert.equal(await evaluate(`document.getElementById('match-situation').textContent`), 'Match point');
  await evaluate(`__courtCheck.score(6,4,'player');document.getElementById('feedback').classList.remove('visible');`); await sleep(180); await shot('focus-match.png');
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  await send('Emulation.setTouchEmulationEnabled', { enabled:true });
  await sleep(100);
  for (const [id,expected] of [['hit','long'],['smash','short']]) {
    await evaluate(`__courtCheck.playerService(0)`);
    await tapTouch(id==='hit'?'touch-clear':'touch-smash');
    await tapTouch('touch-hit');
    await evaluate(`__courtCheck.step(.05);__courtCheck.freeze()`);
    const snapshot=await evaluate(`__courtCheck.snapshot()`);
    assert.equal(snapshot.delivery.serviceKind,expected);assert.equal(snapshot.delivery.fault,null);
    assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('touch-drop')).display`),'none','rally choice returns after serve');
    await shot(`serve-${expected}-mobile.png`);
  }
  rect = await bounds(); assert.ok(rect.scroll <= rect.w, 'Portrait has no horizontal overflow');
  assert.ok(rect.bottom <= rect.h, 'Portrait focused court fits viewport');
  await shot('focus-match-mobile.png');
  await evaluate(`document.getElementById('help-open').click();`); await shot('help-mobile.png');
  await evaluate(`document.getElementById('help-close').click();`);
  await send('Emulation.setDeviceMetricsOverride', { width:844, height:390, deviceScaleFactor:1, mobile:true });
  await sleep(100); rect = await bounds(); assert.ok(rect.bottom <= rect.h && rect.scroll <= rect.w, 'Landscape court fits viewport');
  await evaluate(`document.getElementById('resume').click();__courtCheck.freeze();`);
  await shot('focus-match-landscape.png');
  await evaluate(`document.getElementById('help-open').click();`);await shot('help-landscape.png');
  await evaluate(`document.getElementById('help-close').click();document.getElementById('resume').click();__courtCheck.scenario('jump');__courtCheck.step(.01);__courtCheck.hit('smash');__courtCheck.step(.05);__courtCheck.freeze();`);
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true }); await sleep(100);
  const mobileContact=await evaluate(`__courtCheck.contactCheck()`);
  assert.ok(mobileContact?.head && Math.hypot(mobileContact.head.x-mobileContact.point.x,mobileContact.head.y-mobileContact.point.y)<.01, 'Racket remains aligned after rotating the phone during a swing');
  // Mobile labels and real touch input follow the same defense choices.
  for (const [id,expected] of [['hit','lift'],['drop','block'],['smash','drive']]) {
    await evaluate(`__courtCheck.holdInputClock();__courtCheck.scenario('defense');`);
    await tapTouch(id==='hit'?'touch-clear':'touch-'+id);
    await tapTouch('touch-hit');
    await evaluate(`__courtCheck.finishInput();`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).delivery.shotType,expected);
  }
  await evaluate(`__courtCheck.scenario('defense');`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Digit1',key:'1'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Digit1',key:'1'});
  assert.match(await evaluate(`document.getElementById('power-status').getAttribute('aria-label')`),/This shot/);
  await evaluate(`__courtCheck.hit('clear');__courtCheck.step(.05);__courtCheck.freeze();`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).delivery.power,1);
  await evaluate(`__courtCheck.scenario('defense');__courtCheck.freeze();`);
  assert.match(await evaluate(`document.getElementById('power-status').getAttribute('aria-label')`),/Default.*Strong/);
  await shot('defense-options-mobile.png');
  await evaluate(`__courtCheck.scenario('backhand-defense');__courtCheck.freeze();`);
  for(const [type,label] of [['clear','Lift'],['drop','Block'],['smash','Drive']]) {
    await evaluate(`__courtCheck.selectTouch('${type}')`);
    assert.equal(await evaluate(`document.getElementById('touch-hit').textContent`),label);
    assert.match(await evaluate(`document.getElementById('touch-hit').getAttribute('aria-label')`),/Backhand/);
    assert.ok(await evaluate(`(()=>{const b=document.getElementById('touch-hit');return b.scrollWidth<=b.clientWidth;})()`),'mobile backhand button text fits');
  }
  await shot('backhand-options-mobile.png');
  await evaluate(`__courtCheck.scenario('backhand-jump');__courtCheck.strike('smash');`);
  const mobileBack=await evaluate(`__courtCheck.contactCheck()`);
  assert.ok(Math.hypot(mobileBack.head.x-mobileBack.point.x,mobileBack.head.y-mobileBack.point.y)<.01,'mobile backhand racket alignment');
  await shot('backhand-jump-mobile.png');
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await sleep(100);
  await evaluate(`__courtCheck.scenario('backhand-defense');__courtCheck.freeze();`);
  for(const id of ['hit','drop','smash'])assert.ok(await evaluate(`(()=>{const b=document.getElementById('touch-${id}');return b.scrollWidth<=b.clientWidth;})()`),'landscape backhand label fits');
  await shot('backhand-options-landscape.png');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
  for(const type of ['drive','block','lift']) {
    await evaluate(`__courtCheck.aiReturn('${type}');__courtCheck.freeze();`);
    assert.ok(['drive','block','lift','clear','drop'].includes((await evaluate(`__courtCheck.snapshot()`)).delivery.incomingType));
  }
  await evaluate(`document.getElementById('pause-menu').click();document.getElementById('choose-match').click();`);
  assert.ok(await evaluate(`document.getElementById('start').getBoundingClientRect().bottom<=innerHeight`),'mobile match menu start fits viewport');
  await shot('match-styles-menu-mobile.png');
  // Targeted practice: real game updates, stroke resolution and finite/unlimited summaries.
  await send('Emulation.setDeviceMetricsOverride', { width:1400,height:900,deviceScaleFactor:1,mobile:false });
  await send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await evaluate(`document.getElementById('pause-menu').click();document.getElementById('choose-drill').click();`);
  let menuStart=await evaluate(`document.getElementById('start').getBoundingClientRect().bottom`);assert.ok(menuStart<=900,'desktop training start is visible without scrolling');
  await shot('training-menu-desktop.png');
  const originalBest=await evaluate(`__courtCheck.snapshot().best`);
  for(const kind of ['jump','net','defense']) {
    await evaluate(`document.querySelector('[data-training="${kind}"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
    const outcome=await evaluate(`__courtCheck.drillBall()`);
    assert.equal(outcome.completed,1,`${kind} attempt counts once`);assert.equal(outcome.succeeded,1,`${kind} goal works through actual windup and motion: ${JSON.stringify(await evaluate('__courtCheck.snapshot()'))}`);
    await evaluate(`__courtCheck.frames(2);`);
    assert.equal((await evaluate(`__courtCheck.snapshot()`)).training.completed,1,'return animation does not duplicate outcome');
    await evaluate(`document.getElementById('drill-end').click();`);
    assert.equal(await evaluate(`document.getElementById('final-score').textContent`),'100%');
    await evaluate(`document.getElementById('result-menu').click();`);
  }
  // Each speed and each of the three advancing feed positions also works through the game loop.
  for(const kind of ['jump','net','defense']) for(const speed of ['slow','normal','fast']) {
    await evaluate(`document.querySelector('[data-training="${kind}"]').click();document.querySelector('[data-training-speed="${speed}"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
    for(let i=0;i<3;i++) {
      const outcome=await evaluate(`__courtCheck.drillBall()`);
      assert.equal(outcome.succeeded,i+1,`${kind}/${speed}/feed ${i} goal works in actual game: ${JSON.stringify(await evaluate('__courtCheck.snapshot()'))}`);
      await evaluate(`__courtCheck.frames(1.85);`);
    }
    await evaluate(`document.getElementById('drill-end').click();document.getElementById('result-menu').click();`);
  }
  // Stand at the landing with natural flight; vary jump response and allow a short deliberate strike delay.
  const humanJumpChecks=[];
  for(const speed of ['slow','normal','fast']) {
    await evaluate(`document.querySelector('[data-training="jump"]').click();document.querySelector('[data-training-speed="${speed}"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
    for(let feed=0;feed<3;feed++) {
      const outcome=await evaluate(`__courtCheck.humanJumpBall(.15,.10)`);
      assert.equal(outcome.succeeded,feed+1,`human reaction jump/${speed}/${feed}: ${JSON.stringify(outcome)}`);
      assert.equal(outcome.shot,'smash');humanJumpChecks.push({speed,feed,...outcome});
      if(speed==='normal' && feed===1)await shot('training-jump-human-contact.png');
      await evaluate(`__courtCheck.frames(1.85);`);
    }
    await evaluate(`document.getElementById('drill-end').click();document.getElementById('result-menu').click();`);
  }
  await writeFile(join(artifacts,'jump-human-reaction-checks.json'),JSON.stringify({flight:'continuous arc with absolute contact-height calibration',jumpReactionSeconds:.15,hitReactionSeconds:.10,checks:humanJumpChecks},null,2));
  await evaluate(`document.querySelector('[data-training="jump"]').click();document.getElementById('start').click();__courtCheck.drillJumpCue();`);
  assert.match(await evaluate(`document.getElementById('action-status').textContent`),/现在Jump/);
  await evaluate(`__courtCheck.drillJumpCue(.5);`);
  assert.match(await evaluate(`document.getElementById('action-status').textContent`),/现在Jump/,'jump lead follows the future apex contact instead of requiring the landing point');
  await shot('training-jump-cue-desktop.png');
  await evaluate(`document.getElementById('drill-end').click();document.getElementById('result-menu').click();`);
  await evaluate(`document.querySelector('[data-training="defense"]').click();document.querySelector('[data-training-speed="slow"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
  for(let i=0;i<20;i++) {
    const before=await evaluate(`__courtCheck.snapshot()`);
    await evaluate(`__courtCheck.drillBall(false);__courtCheck.frames(.8);`);
    const after=await evaluate(`__courtCheck.snapshot()`);
    assert.equal(after.training.completed,i+1);
    if(before.delivery?.phase==='incoming' && after.delivery?.phase==='incoming')assert.deepEqual(after.delivery.target,before.delivery.target);
  }
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).state,'over');
  assert.equal(await evaluate(`document.querySelectorAll('#training-errors>div').length`),6);
  await shot('training-results-desktop.png');
  await evaluate(`document.getElementById('result-menu').click();document.getElementById('choose-drill').click();document.querySelector('[data-training-limit="0"]').click();document.getElementById('start').click();__courtCheck.freeze();`);
  await evaluate(`__courtCheck.drillBall(false);__courtCheck.frames(.8);document.getElementById('settings-open').click();document.getElementById('drill-end').click();`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).state,'over','unlimited drill can end from settings while paused');
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).best,originalBest,'drills do not overwrite classic practice best');
  await evaluate(`document.getElementById('restart').click();__courtCheck.freeze();document.getElementById('drill-end').click();`);
  assert.equal(await evaluate(`document.getElementById('final-score').textContent`),'0%','empty sessions have a stable summary');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true});await sleep(100);
  await evaluate(`document.getElementById('result-menu').click();document.getElementById('choose-drill').click();`);await shot('training-menu-mobile.png');
  menuStart=await evaluate(`document.getElementById('start').getBoundingClientRect().bottom`);assert.ok(menuStart<=844,'mobile training start is visible without scrolling');
  await evaluate(`document.getElementById('start').click();__courtCheck.freeze();`);
  rect=await bounds();assert.ok(rect.scroll<=rect.w && rect.bottom<=rect.h,'drill portrait fits viewport');
  await evaluate(`__courtCheck.frames(1.2);`);await shot('training-defense-mobile.png');
  await evaluate(`__courtCheck.drillBall();document.getElementById('drill-end').click();`);await shot('training-results-mobile.png');
  await send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await sleep(100);
  await shot('training-results-landscape.png');
  await evaluate(`document.getElementById('result-menu').click();document.getElementById('choose-practice').click();document.getElementById('start').click();__courtCheck.freeze();`);
  assert.equal(await evaluate(`document.getElementById('drill-end').classList.contains('hidden')`),false);
  assert.equal(await evaluate(`document.getElementById('score-label').textContent`),'SCORE');
  for(let i=0;i<5;i++) {
    await evaluate(`__courtCheck.practiceAttempt('miss');__courtCheck.frames(2);`);
    const session=await evaluate(`__courtCheck.snapshot()`);
    assert.equal(session.practiceMisses,i+1);assert.equal(session.state,'paused','five misses do not end practice');
    assert.equal(session.delivery.phase,'incoming','normal feeds continue after misses');
  }
  for(const kind of ['good','out','net']) {
    await evaluate(`__courtCheck.practiceAttempt('${kind}');__courtCheck.frames(1.8);`);
  }
  const practice=await evaluate(`__courtCheck.snapshot()`);
  assert.equal(practice.returns,1);assert.equal(practice.practiceOuts,1);assert.equal(practice.practiceNets,1);
  await evaluate(`document.getElementById('drill-end').click();`);
  assert.equal(await evaluate(`document.getElementById('result-title').textContent`),'Practice complete');
  const summary=await evaluate(`document.getElementById('result-details').textContent`);
  assert.match(summary,/Feeds 8 shuttles/);assert.match(summary,/Return rate 13%/);assert.match(summary,/Miss 5 times · Out 1 times · Net 1 times/);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).best,Math.max(practice.best,practice.score),'normal practice preserves the higher best on exit');
  assert.equal(await evaluate(`Number(localStorage.getItem('shuttle-club-best'))`),Math.max(practice.best,practice.score),'best stays stored');
  await shot('practice-summary-landscape.png');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
  await shot('practice-summary-mobile.png');
  await evaluate(`document.getElementById('restart').click();__courtCheck.freeze();`);
  assert.equal((await evaluate(`__courtCheck.snapshot()`)).practiceMisses,0,'restart clears session statistics');
  await evaluate(`document.getElementById('help-open').click();document.getElementById('drill-end').click();`);
  assert.match(await evaluate(`document.getElementById('result-details').textContent`),/Feeds 0 shuttles · Return rate 0%/,'empty practice can end from help without NaN');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(100);
  await evaluate(`document.getElementById('restart').click();document.querySelector('[data-court-style="sakura"]').click();__courtCheck.scenario('phantom-high');__courtCheck.freeze();`);
  await shot('landing-guides-sakura-mobile.png');
  for(const mode of ['full','compact']) {
    await evaluate(`document.querySelector('[data-guidance="${mode}"]').click();__courtCheck.guidanceProbe('hit');__courtCheck.freeze();`);
    assert.equal(await evaluate(`getComputedStyle(document.getElementById('touch-hit')).display==='none'`),false,'guidance never hides actual touch controls');
    await shot(`guidance-${mode}-mobile.png`);
  }
  // Settings survive a file:// reload and invalid saved audio data has safe defaults.
  await evaluate(`document.querySelector('[data-guidance="full"]').click();`);
  await evaluate(`document.getElementById('settings-open').click();document.getElementById('volume').value=37;document.getElementById('volume').dispatchEvent(new Event('input'));if(document.getElementById('settings-sound').getAttribute('aria-pressed')==='true')document.getElementById('settings-sound').click();document.querySelector('[data-default-shot="clear"][data-default-power="2"]').click();`);
  await evaluate(`document.querySelector('#settings [data-open-personalization]').click();document.querySelector('[data-court-style="sakura"]').click();`);
  await evaluate(`(()=>{for(const [id,color] of [['landingColor-choices','#53b5ee'],['aimColor-choices','#ffcc33']]){const input=document.getElementById(id);input.querySelector('[data-color="' + color + '"]').click();}})()`);
  await evaluate(`(()=>{for(const [role,main,stripe] of [['player','#d44a36','#53b5ee'],['opponent','#f5f3e8',null]]){document.querySelector('[data-jersey-role="'+role+'"]').click();const input=document.getElementById('jerseyColor-choices');input.querySelector('[data-color="' + main + '"]').click();if(stripe){const accent=document.getElementById('jerseyStripe-choices');accent.querySelector('[data-color="' + stripe + '"]').click();}}})()`);
  await send('Page.navigate',{url:pathToFileURL(join(root,'index.html')).href});await sleep(500);
  await evaluate(`document.getElementById('settings-menu').click();`);
  assert.equal(await evaluate(`document.body.dataset.guidance`),'full','guidance survives reload');
  assert.equal(await evaluate(`document.getElementById('volume-value').value`),'37%','volume survives reload');
  assert.equal(await evaluate(`document.getElementById('settings-sound').getAttribute('aria-pressed')`),'false','mute survives reload');
  assert.equal(await evaluate(`document.querySelector('[data-default-shot="clear"][data-default-power="2"]').getAttribute('aria-pressed')`),'true','default power survives reload');
  await evaluate(`document.querySelector('#settings [data-open-personalization]').click();`);
  assert.equal(await evaluate(`document.getElementById('current-court-name').textContent`),'Sakura Pink','court appearance survives file reload');
  assert.equal(await evaluate(`document.querySelector('[data-court-style="sakura"]').getAttribute('aria-pressed')`),'true');
  assert.equal(await evaluate(`document.getElementById('landingColor-choices').dataset.selectedColor`),'#53b5ee','landing color survives file reload');
  assert.equal(await evaluate(`document.getElementById('aimColor-choices').dataset.selectedColor`),'#ffcc33','aim color survives file reload');
  assert.equal(await evaluate(`document.getElementById('jerseyColor-choices').dataset.selectedColor`),'#d44a36');assert.equal(await evaluate(`document.getElementById('jerseyStripe-choices').dataset.selectedColor`),'#53b5ee');
  await evaluate(`document.querySelector('[data-jersey-role="opponent"]').click();`);
  assert.equal(await evaluate(`document.getElementById('jerseyColor-choices').dataset.selectedColor`),'#f5f3e8');assert.equal(await evaluate(`document.getElementById('jerseyStripe-value').textContent`),'Auto color','automatic stripes remain automatic after reload');
  await evaluate(`localStorage.setItem('shuttle-club-guidance','{"mode":"invalid"}');localStorage.setItem('shuttle-club-audio-settings','{invalid');localStorage.setItem('shuttle-club-appearance',JSON.stringify({court:'unknown',landingColor:'bad',aimColor:42,playerJerseyColor:'#fff',playerJerseyStripe:42,opponentJerseyColor:{},opponentJerseyStripe:'red'}));`);
  await send('Page.navigate',{url:pathToFileURL(join(root,'index.html')).href});await sleep(500);
  await evaluate(`document.getElementById('settings-menu').click();`);
  assert.equal(await evaluate(`document.getElementById('volume-value').value`),'100%','invalid audio settings restore default volume');
  assert.equal(await evaluate(`document.body.dataset.guidance`),'compact','invalid guidance restores the quieter default');
  assert.equal(await evaluate(`document.getElementById('settings-sound').getAttribute('aria-pressed')`),'true','invalid audio settings restore sound');
  await evaluate(`document.querySelector('#settings [data-open-personalization]').click();`);
  assert.equal(await evaluate(`document.getElementById('current-court-name').textContent`),'Classic Green','invalid appearance restores the classic court');
  assert.equal(await evaluate(`document.getElementById('landingColor-value').textContent`),'Auto color','invalid colors restore automatic appearance');
  assert.equal(await evaluate(`document.getElementById('aimColor-value').textContent`),'Auto color');
  assert.equal(await evaluate(`document.getElementById('jerseyColor-choices').dataset.selectedColor`),'#2264c8');assert.equal(await evaluate(`document.getElementById('jerseyStripe-value').textContent`),'Auto color');
  await evaluate(`document.querySelector('[data-jersey-role="opponent"]').click();`);
  assert.equal(await evaluate(`document.getElementById('jerseyColor-choices').dataset.selectedColor`),'#f0ddbd','invalid saved kit colors restore the original outfit');
  // Also load through the optional local server, without any browser test hooks.
  const server = spawn(process.execPath, [join(root, 'server.js')], { cwd:root, env:{...process.env,PORT:'3017'}, windowsHide:true, stdio:'ignore' });
  try {
    await sleep(400); await send('Page.navigate', { url:'http://127.0.0.1:3017' }); await sleep(600);
    assert.equal(await evaluate(`typeof ShuttleCore.assessHit`), 'function');
    assert.equal(await evaluate(`Object.keys(ShuttleAppearance.courts).length`),4,'HTTP serves the appearance registry');
    for(let i=0;i<100&&!await evaluate(`!!globalThis.ShuttleAthletes?.ready`);i++)await sleep(100);
    assert.equal(await evaluate(`ShuttleAthletes.ready`),true,'HTTP also serves the offline 3D renderer');
    assert.equal(await evaluate(`ShuttleAthletes.asset`),'pixel-athlete-v2','HTTP uses the same new production character');
    await evaluate(`document.getElementById('personalize-menu').click();document.querySelector('[data-court-style="sky"]').click();document.getElementById('personalization-close').click();`);
    await evaluate(`document.getElementById('cover-image').decode()`);
    await evaluate(`document.getElementById('choose-practice').click();document.getElementById('start').click();`);
    assert.equal(await evaluate(`document.body.classList.contains('focus-game')`), true);
    await evaluate(`ShuttleAthletes.renderer.domElement.dispatchEvent(new Event('webglcontextlost',{cancelable:true}))`);
    assert.equal(await evaluate(`ShuttleAthletes.ready`),false,'lost WebGL context enables the Canvas fallback');
    await sleep(100);
  } finally { server.kill(); }
  }
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  if (!process.argv.includes('--scene') && !process.argv.includes('--menu-design') && !process.argv.includes('--mobile-controls') && !process.argv.includes('--tutorial') && !process.argv.includes('--language')) console.log('Browser checks passed: native-resolution court/cache/preview at DPR 1–3, custom landing and aim pixels, color reset/reload/invalid values, logical mouse aim and contact alignment, four courts, responsive UI and settings, all existing gameplay and offline/HTTP regressions.');
  if (!electronCheck) await send('Browser.close');
} catch (error) {
  console.error('Browser verification failed:', error, browserLog.slice(-2500));
  if (!electronCheck) await send?.('Browser.close').catch(() => {});
  throw error;
} finally {
  socket?.close(); browser.kill(); await sleep(400);
  // Delete only this run's temporary profile, verified to be below artifacts.
  const target = resolve(profile);
  if (target.startsWith(artifacts + sep) && target.split(sep).at(-1).startsWith('.browser-check-')) {
    await rm(target, { recursive:true, force:true, maxRetries:10, retryDelay:500 });
  }
}
