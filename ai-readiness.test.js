import test from 'node:test';
import assert from 'node:assert/strict';
import './core.js';
const { createOpponent, returnPosition, opponentCanHit, moveOpponent, shouldOpponentJump, opponentIntercept, opponentContactAge, chooseMatchShot } = globalThis.ShuttleCore;

test('being beside a legal shuttle cannot bypass reaction or recovery, at any skill or style', () => {
  for (const level of ['easy', 'normal', 'hard']) for (const style of ['balanced', 'attack', 'defense', 'rally']) for (const type of ['clear', 'drop', 'drive']) {
    const ball = { phase:'return', shotType:type, age:.99, returnFrom:{x:.5,y:.6}, returnTarget:{x:.5,y:-.65}, returnHeight:85, returnEndHeight:0, returnArc:type==='clear'?215:35, returnDuration:1 };
    const point = returnPosition(ball), actor = Object.assign(createOpponent(level, style), {x:point.x,y:point.y});
    assert.equal(opponentCanHit(actor, ball), true);
    for (const timer of ['reaction', 'strokeRecovery']) {
      actor[timer] = .08;
      assert.equal(opponentCanHit(actor, ball), false, `${level}/${style}/${type}/${timer}`);
      moveOpponent(actor, point, .04);
      assert.equal(opponentCanHit(actor, ball), false);
      moveOpponent(actor, point, .04);
      assert.equal(opponentCanHit(actor, ball), true, 'expired wait allows a still-legal contact');
    }
  }
});
test('AI jump commitment respects the same reaction and stroke recovery as ground contact', () => {
  const ball = {phase:'return',shotType:'clear',age:0,returnFrom:{x:.5,y:.65},returnTarget:{x:.5,y:-.7},returnHeight:95,returnEndHeight:0,returnDuration:1.2,returnArc:215};
  ball.age = opponentContactAge(ball);
  const actor = Object.assign(createOpponent('hard','attack'), opponentIntercept(ball));
  assert.equal(shouldOpponentJump(actor,ball,()=>0),true);
  actor.reaction=.1; assert.equal(shouldOpponentJump(actor,ball,()=>0),false);
  actor.reaction=0;actor.strokeRecovery=.1;assert.equal(shouldOpponentJump(actor,ball,()=>0),false);
});
test('rally style continues front/back displacement after the player has returned near center', () => {
  const actor=createOpponent('normal','rally'),player={x:.5,y:.5},contact={x:.5,y:-.65,z:95};
  actor.lastShotType='drop';actor.lastPlayerY=.75;
  assert.equal(chooseMatchShot(player,actor,contact,'drop',()=>.8).type,'clear');
  actor.lastShotType='clear';actor.lastPlayerY=.25;
  assert.equal(chooseMatchShot(player,actor,contact,'drop',()=>.4).type,'drop');
  actor.style='balanced';
  assert.equal(chooseMatchShot(player,actor,contact,'drop',()=>.4).type,'clear','balanced retains its ordinary center choice');
  actor.style='rally';actor.pivot=1;actor.pressure=1;
  assert.equal(chooseMatchShot(player,actor,contact,'clear',()=>.4).type,'lift','pressure still takes precedence over tactics');
});
