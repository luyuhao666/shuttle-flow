(() => {
'use strict';
const lessons = Object.freeze([
  { id:'move', title:'Move & meet the shuttle', shot:'clear', expected:'clear', why:'A clear travels high and deep, giving you time to recover.',
    keyboard:'Use WASD or the arrow keys to move into the contact ring. Then left click to return a clear.',
    touch:'Move the left joystick toward the contact ring. Choose Clear, then tap and release the large hit button.' },
  { id:'aim', title:'Choose your direction', shot:'clear', expected:'clear', aim:'left', why:'Your aim chooses the side. Shot type and power control the depth.',
    keyboard:'Move the mouse left until Shot aim is on the left side. Left click to send a clear there.',
    touch:'Choose Clear. Hold the large hit button, drag left to aim at the left side, then release to hit.' },
  { id:'drop', title:'Bring the opponent forward', shot:'drop', expected:'drop', why:'A drop falls near the net and draws the opponent forward.',
    keyboard:'Hold Shift and left click to play a drop shot. Keep your feet inside the contact ring.',
    touch:'Choose Drop, then tap the large hit button. The label previews the shot you will play.' },
  { id:'attack', title:'Attack from the ground', shot:'smash', expected:'tap', why:'A standing smash sends the shuttle down without a jump.',
    keyboard:'Stay on the ground and right click to play a standing smash.',
    touch:'Stay on the ground. Choose Attack, then tap the large hit button to play a standing smash.' },
  { id:'lift', title:'Recover against a smash', shot:'clear', expected:'lift', defense:true, why:'A lift sends a low attack high toward the back court, buying time.',
    keyboard:'This shuttle is coming down fast. Left click to lift it back to the rear court.',
    touch:'Against a smash, choose Clear. The large button changes to Lift. Tap it to recover.' },
  { id:'block', title:'Answer with a soft block', shot:'drop', expected:'block', defense:true, why:'A block absorbs the attack and places the shuttle near the net.',
    keyboard:'Hold Shift and left click to block this low attack softly over the net.',
    touch:'Against a smash, choose Drop. The large button changes to Block. Tap it for a soft return.' },
  { id:'drive', title:'Counter with a flat drive', shot:'smash', expected:'drive', defense:true, why:'A drive counters a low shuttle with a quick, flat return.',
    keyboard:'Right click on this low shuttle to counter with a drive.',
    touch:'Against this low shuttle, choose Attack. The large button changes to Drive. Tap to counter.' },
  { id:'jump', title:'Jump & strike at the top', shot:'smash', expected:'smash', jump:true, why:'A jump smash needs both a reachable shuttle and a stable contact near the top of your jump.',
    keyboard:'Press Space to jump. We will pause you at the top; then right click to smash.',
    touch:'Choose Attack, then tap Jump. We will pause you at the top; tap and release the large hit button to smash.' }
].map(Object.freeze));
function createSession() { return { index:0, completed:0, attempts:0, phase:'intro', result:null }; }
const lessonFor = session => lessons[session.index] ?? null;
function makeFeed(session) {
  const lesson=lessonFor(session), x=lesson.id==='move'?.68:.5;
  if(lesson.defense) return {phase:'incoming',age:0,from:{x,y:-.65},target:{x,y:.65},fromHeight:130,flightArc:14,duration:1.4,incomingType:'smash'};
  return {phase:'incoming',age:0,from:{x,y:-.7},target:{x,y:lesson.jump?.72:.68},fromHeight:25,flightArc:lesson.jump?380:195,duration:lesson.jump?2:2.4,incomingType:'clear'};
}
function freezeAge(session, ball) {
  const lesson=lessonFor(session), {JUMP,SWING}=globalThis.ShuttleCore;
  if(lesson.jump) return ball.duration-JUMP.velocity**2/(2*JUMP.gravity)/JUMP.contactSpeed-SWING.impact;
  return lesson.defense?ball.duration*.78:ball.duration-.12;
}
function judgeOutcome(session, outcome) {
  const lesson=lessonFor(session);
  if(outcome.reason) return {success:false,error:outcome.reason};
  if(outcome.fault) return {success:false,error:outcome.fault.type};
  if(outcome.shotType!==lesson.expected) return {success:false,error:'shot',actual:outcome.shotType};
  if(lesson.aim==='left' && !(outcome.point?.x<.35)) return {success:false,error:'aim'};
  return {success:true,error:null};
}
function recordOutcome(session,outcome) {
  if(session.phase!=='flight') return null;
  const result=judgeOutcome(session,outcome);
  session.attempts++;session.result=result;
  if(result.success) {session.completed++;session.phase='success';} else session.phase='retry';
  return result;
}
function nextLesson(session) {
  if(session.phase!=='success' || session.completed>=lessons.length) return false;
  session.index++;session.phase='intro';session.result=null;return true;
}
globalThis.ShuttleTutorial=Object.freeze({lessons,createSession,lessonFor,makeFeed,freezeAge,judgeOutcome,recordOutcome,nextLesson});
})();
