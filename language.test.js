import test from 'node:test';
import assert from 'node:assert/strict';
import './i18n.js';
import './tutorial.js';
import { gameFixture } from './scripts/lib/game-fixture.mjs';

const { translate, createLocalizer, storageKey } = globalThis.ShuttleI18n;
const noEnglish = value => assert.ok(!/[A-Za-z]{3,}/.test(value.replace(/Shuttle Flow|WASD|Shift|English/g, '')), value);
const extra = `language: i18n, details: () => ({state,mode,match,delivery,player,opponent,elapsed,score,best,selectedPower,aimX,tutorial}), refreshHud:updateHud,
  playerServe() {match.server='player';prepareService(0);roundBreak=0;updateShotOptions();}`;

test('fresh and invalid preferences start in English; saved Chinese restores without browser-language detection', () => {
  for (const stored of [undefined,'fr','zh','{"language":"zh-CN"}']) {
    const ui = gameFixture(extra, {storage:stored === undefined ? {} : {[storageKey]:stored}});
    assert.equal(ui.api.language.language,'en');
    assert.equal(ui.document.documentElement.lang,'en');
  }
  const ui = gameFixture(extra,{storage:{[storageKey]:'zh-CN'}});
  assert.equal(ui.document.documentElement.lang,'zh-CN');
  assert.equal(ui.byId.get('settings-sound').textContent,'开启');
  assert.equal(ui.byId.get('score-label').textContent,'得分');
});

test('settings language choices switch both ways and preserve progress, difficulty, appearance and saved power', () => {
  const ui=gameFixture(extra);
  ui.byId.get('choose-match').onclick();ui.click('[data-ai-level="hard"]');ui.click('[data-points="15"]');
  ui.byId.get('start').onclick();ui.step(.3);ui.byId.get('settings-open').onclick();
  const before=JSON.stringify(ui.api.details()),stored=new Map(ui.storage);
  ui.click('[data-language="zh-CN"]');
  assert.equal(JSON.stringify(ui.api.details()),before);
  assert.equal(ui.document.documentElement.lang,'zh-CN');assert.equal(ui.storage.get(storageKey),'zh-CN');
  assert.equal(ui.byId.get('settings-sound').textContent,'开启');
  assert.match(ui.byId.get('match-format').textContent,/15 分.*高手/);
  assert.equal(ui.document.querySelector('[data-language="zh-CN"]').getAttribute('aria-pressed'),'true');
  for(const [key,value] of stored)assert.equal(ui.storage.get(key),value);
  ui.click('[data-language="en"]');ui.api.refreshHud();
  assert.equal(JSON.stringify(ui.api.details()),before);
  assert.equal(ui.byId.get('settings-sound').textContent,'On');assert.equal(ui.byId.get('match-format').textContent,'15 pts · Expert');
  assert.equal(ui.storage.get(storageKey),'en');
});

test('storage failures keep language switching usable and report that the preference was not saved', () => {
  const ui=gameFixture(extra,{storageBlocked:true});
  assert.equal(ui.api.language.language,'en');
  ui.click('[data-language="zh-CN"]');assert.equal(ui.api.language.language,'zh-CN');
  assert.equal(ui.byId.get('settings-save-status').textContent,'本次未能保存');
  ui.click('[data-language="en"]');assert.equal(ui.byId.get('settings-save-status').textContent,'Not saved');
  assert.equal(ui.api.language.setLanguage('fr'),false);assert.equal(ui.api.language.language,'en');
});

test('all eight lesson names and keyboard/touch instructions translate using badminton terminology', () => {
  for(const lesson of ShuttleTutorial.lessons)for(const field of ['title','why','keyboard','touch'])noEnglish(translate(lesson[field],'zh-CN'));
  assert.equal(translate('Standing smash','zh-CN'),'点杀');
  assert.equal(translate('Jump smash','zh-CN'),'跳杀');
  assert.equal(translate('Net','zh-CN'),'下网');assert.equal(translate('Net','zh-CN','net-area'),'网前');
  assert.equal(translate('Back','zh-CN','preview'),'背面');assert.equal(translate('Back','en','preview'),'Back');
});

test('dynamic counts, result fragments and accessibility labels stay translated as values change', () => {
  for(const value of ['LESSON 3 / 8','Rally: 19 shots','Rally 7','Smash Defense · Feed 12','3 of 20 feeds completed','Session time: 2 min 7 s, unlimited practice',
    '7 points · Casual · Balanced CPU\nWin by 2 at deuce (cap 11) · Longest rally 7\nStanding smashes 2 · Jump smashes 3',
    'Backhand Lift. Tap and release to hit; drag left or right before release to aim.',
    'That was Drop. Try the instructed action.', 'Practice 2:37 · 12 feeds · Return rate 50%\nReturns 6 · Misses 3 · Out 2 · Net 1'])noEnglish(translate(value,'zh-CN'));
  assert.equal(translate('Rally: 19 shots','zh-CN'),'本回合：19 拍');
  assert.equal(translate('LESSON 3 / 8','zh-CN'),'第 3 课 / 共 8 课');
  assert.equal(translate('  Start Match ↗  ','en'),'  Start Match ↗  ');
});

test('Chinese touch controls still choose, aim, cancel and serve through the original handlers', () => {
  const ui=gameFixture(extra,{storage:{[storageKey]:'zh-CN'}});
  ui.byId.get('choose-match').onclick();ui.byId.get('start').onclick();ui.api.playerServe();
  assert.equal(ui.byId.get('touch-clear').textContent,'高远发球');
  ui.byId.get('touch-hit').dispatchEvent({type:'pointerdown',button:0,pointerId:2,clientX:700,clientY:200});
  assert.equal(ui.byId.get('touch-instruction').textContent,'松手击球 · 拖动瞄准');
  ui.byId.get('touch-hit').dispatchEvent({type:'pointercancel',pointerId:2});
  assert.equal(ui.byId.get('touch-instruction').textContent,'轻点击球 · 拖动瞄准');
  assert.equal(ui.api.details().state,'playing');
});

test('static nested text and live updates restore English sources without replacing icon elements', () => {
  const textNode=value=>({nodeType:3,nodeValue:value});
  const element=(tag,...children)=>{
    const attrs=new Map();const node={nodeType:1,tagName:tag,childNodes:children,dataset:{},classList:{toggle(){}},getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v)};
    Object.defineProperty(node,'textContent',{get:()=>node.childNodes.map(c=>c.nodeValue??c.textContent).join(''),set:value=>{node.childNodes=[textNode(String(value))];node.childNodes[0].parentElement=node;}});
    for(const child of children)child.parentElement=node;
    return node;
  };
  const icon=element('SPAN',textNode('↗')),button=element('BUTTON',textNode('Start Match '),icon),status=element('P',textNode('Practice 0:00'));
  const body=element('BODY',button,status),document={body,documentElement:{},querySelectorAll:()=>[],createTextNode:textNode};
  const i18n=createLocalizer({document,storage:{getItem(){},setItem(){}}});
  i18n.refresh();i18n.setLanguage('zh-CN');assert.equal(button.textContent,'开始比赛 ↗');assert.equal(button.childNodes[1],icon);
  i18n.text(status,'Practice 3:42');assert.equal(status.textContent,'练习模式 3:42');
  i18n.setLanguage('en');assert.equal(button.textContent,'Start Match ↗');assert.equal(status.textContent,'Practice 3:42');assert.equal(button.childNodes[1],icon);
});
