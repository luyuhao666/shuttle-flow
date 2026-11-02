import test from 'node:test';
import assert from 'node:assert/strict';
import { gameFixture } from './scripts/lib/game-fixture.mjs';

const attackFixture = `
  defendPlayerAttack(jumping, aim, startX) {
    match=createMatch(selectedPoints); roundBreak=0; state='playing'; swing=opponentSwing=null;
    player={...createPlayer(),x:.5,y:.65,height:jumping?55:0}; opponent=createOpponent(aiLevel,aiStyle);
    Object.assign(opponent,{x:startX,y:-.65,reaction:opponent.skill.reaction,intent:'chase'});
    const contact={x:.5,y:.65,z:jumping?145:95},plan=planReturn(player,contact,'smash',2,aim);
    const ball={phase:'return',age:0,shotType:plan.type,returnFrom:contact,returnHeight:contact.z,returnTarget:plan.target,returnEndHeight:plan.endHeight,returnArc:plan.arc,returnDuration:plan.duration,fault:plan.fault};
    delivery=ball;
    for(let frame=0;frame<120&&delivery.phase==='return';frame++)update(1/120);
    const returned=delivery.phase==='incoming',point=returnPosition(ball);
    return {returned,reach:Math.hypot(opponent.x-point.x,opponent.y-point.y),radius:opponent.skill.radius,level:opponent.level,type:plan.type,playerPoints:match.player,cpuPoints:match.computer,reply:delivery.incomingType};
  }
`;

for (const [level, label] of [['easy', 'Casual'], ['normal', 'Standard'], ['hard', 'Expert']]) {
  test(`${label} selection reaches the actual AI, defends player attacks and survives pause/rematch`, () => {
    const ui = gameFixture(attackFixture);
    ui.byId.get('choose-match').onclick();
    ui.click(`[data-ai-level="${level}"]`);
    assert.equal(ui.byId.get('setup-summary').textContent, `7 pts · ${label} · Balanced`);
    ui.byId.get('start').onclick();
    assert.equal(ui.api.snapshot().opponent.level, level);
    assert.equal(ui.api.snapshot().aiLevel, level);
    assert.deepEqual(ui.api.snapshot().opponent.skill, ShuttleCore.AI_LEVELS[level]);
    ui.api.togglePause();
    const frozen = JSON.stringify(ui.api.snapshot().opponent);
    ui.step(1);
    assert.equal(JSON.stringify(ui.api.snapshot().opponent), frozen, 'pause stops even expert movement and timers');
    ui.api.togglePause();
    let returned = 0, missed = 0;
    for (const jumping of [false, true]) for (const aim of [.12, .5, .88]) for (const startX of [.22, .5, .78]) {
      const result = ui.api.defendPlayerAttack(jumping, aim, startX);
      assert.equal(result.level, level); assert.equal(result.type, jumping ? 'smash' : 'tap');
      if (result.returned) {
        returned++;
        assert.ok(result.reach <= result.radius + 1e-9, 'production contact is beside the live shuttle');
        assert.ok(['lift', 'block', 'drive'].includes(result.reply), 'CPU defends a smash rather than inventing an overhead attack');
        assert.equal(result.playerPoints, 0); assert.equal(result.cpuPoints, 0);
      } else {
        missed++;
        assert.equal(result.playerPoints, 1, 'a genuinely missed attack scores one player point');
      }
    }
    assert.ok(returned > 0 && missed > 0, 'the tier can defend and remains punishable');
    ui.api.finish(); ui.byId.get('restart').onclick();
    assert.equal(ui.api.snapshot().opponent.level, level, 'Play Again keeps the selected tier');
    assert.equal(ui.api.snapshot().match.player, 0);
  });
}
