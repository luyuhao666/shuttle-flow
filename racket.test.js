import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import './appearance.js';
import './i18n.js';
import { createPixelAthlete } from './scripts/lib/pixel-athlete-model.mjs';
import { applyRacketAppearance, racketOutline } from './scripts/lib/racket-appearance.mjs';
const appearance = globalThis.ShuttleAppearance;

test('old or invalid equipment settings migrate to the larger default without invalid colors', () => {
  for (const value of [undefined, null, 42, {}, 'missing', '__proto__']) {
    const profile = appearance.racketAppearance(value, value, value, value);
    assert.equal(profile.style, 'classic'); assert.equal(profile.size, 'large');
    assert.equal(profile.scale, 1.16); assert.equal(profile.frame, '#204b51'); assert.equal(profile.grip, '#f1f2e9');
  }
  for (const frame of ['#000000', '#ffffff', '#ff0000']) {
    const profile = appearance.racketAppearance('square', 'extra', frame, '#abcdef');
    assert.notEqual(profile.frame, profile.accent);
    assert.equal(profile.grip, '#abcdef');
  }
});

test('all nine equipment geometries retain the grip socket and put strings around the real face locator', () => {
  const { root, racket, contact } = createPixelAthlete();
  root.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
  const socket = racket.position.clone(), grip = racket.getObjectByName('RacketGrip');
  const gripPosition = grip.position.clone(), gripGeometry = grip.geometry;
  const jersey = root.getObjectByName('Athlete_Jersey').material.color.getHexString();
  for (const style of Object.keys(appearance.racketStyles)) for (const size of Object.keys(appearance.racketSizes)) {
    const profile = appearance.racketAppearance(style, size, '#ff0000', '#0000ff');
    applyRacketAppearance(racket, profile);
    assert.ok(racket.position.equals(socket)); assert.ok(grip.position.equals(gripPosition)); assert.equal(grip.geometry, gripGeometry);
    const frame = racket.getObjectByName('RacketFrame'), strings = racket.getObjectByName('RacketStrings');
    assert.ok(frame.position.equals(contact.position)); assert.ok(strings.position.equals(contact.position));
    assert.equal(frame.material.color.getHexString(), 'ff0000'); assert.equal(grip.material.color.getHexString(), '0000ff');
    assert.equal(root.getObjectByName('Athlete_Jersey').material.color.getHexString(), jersey);
    for (const mesh of [frame, strings, racket.getObjectByName('RacketAccent')]) {
      const positions = mesh.geometry.attributes.position;
      assert.ok(positions.count > 0 && Array.from(positions.array).every(Number.isFinite));
    }
    const rx = .105 * profile.scale * profile.width, ry = .1386 * profile.scale * profile.height;
    for (const point of racketOutline(profile)) assert.ok(Math.abs((Math.abs(point.x) / rx) ** profile.exponent + (Math.abs(point.y) / ry) ** profile.exponent - 1) < 1e-10);
  }
});

test('recoloring reuses geometry and style changes release generated resources', () => {
  const { racket } = createPixelAthlete();
  racket.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
  applyRacketAppearance(racket, appearance.racketAppearance());
  const frame = racket.getObjectByName('RacketFrame'), strings = racket.getObjectByName('RacketStrings'), accent = racket.getObjectByName('RacketAccent');
  const old = [frame.geometry, strings.geometry, accent.geometry]; let disposed = 0;
  old.forEach(g => g.addEventListener('dispose', () => disposed++));
  applyRacketAppearance(racket, appearance.racketAppearance('classic', 'large', '#ffcc00'));
  assert.equal(frame.geometry, old[0]); assert.equal(disposed, 0);
  applyRacketAppearance(racket, appearance.racketAppearance('square', 'extra'));
  assert.equal(disposed, 3); assert.notEqual(frame.geometry, old[0]);
});

const game = await readFile(new URL('./game.js', import.meta.url), 'utf8');
function equipmentUi(stored = {}) {
  const storage = new Map([['shuttle-club-appearance', JSON.stringify(stored)]]), nodes = new Map();
  const groups = {};
  for (const [part, values] of [['role', ['player', 'opponent']], ['style', Object.keys(appearance.racketStyles)], ['size', Object.keys(appearance.racketSizes)]]) groups[`[data-racket-${part}]`] = values.map(value => ({ dataset: { [`racket${part[0].toUpperCase() + part.slice(1)}`]: value }, attributes: {}, setAttribute(key, v) { this.attributes[key] = v; } }));
  const $ = id => {
    if (!nodes.has(id)) {
      const buttons = ['', ...appearance.colorPresets.map(preset => preset.color)].map(color => ({ dataset: { color }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
      nodes.set(id, { textContent: '', dataset: {}, style: { setProperty() {} }, querySelectorAll: () => buttons });
    }
    return nodes.get(id);
  };
  let renders = 0;
  const prefix = game.slice(game.indexOf('const { courts: COURT_STYLES'), game.indexOf('// Transparent captions'));
  const functions = game.slice(game.indexOf('function renderRacketControls()'), game.indexOf('function selectCourt('));
  const reset = game.slice(game.indexOf("$('racket-reset').onclick = () => {"), game.indexOf("$('marker-colors-reset').onclick"));
  const api = runInNewContext(`${prefix}\n${functions}\n${reset}\n({settings:appearanceSettings,select:selectRacket,render:renderRacketControls,role:value=>{racketPreviewRole=value;},reset:()=>$('racket-reset').onclick()})`, {
    i18n: globalThis.ShuttleI18n.createLocalizer({ document: { querySelectorAll: () => [] } }),
    globalThis: { ShuttleAppearance: appearance }, localStorage: { getItem: key => storage.get(key) }, $, document: { querySelectorAll: key => groups[key] },
    saveSettings(key, value) { storage.set(key, JSON.stringify(value)); }, renderAppearance() { renders++; }
  });
  return { api, storage, nodes, groups, renders: () => renders };
}

test('production equipment UI persists independently per athlete and restores only the selected racket', () => {
  const ui = equipmentUi({ court: 'sky', playerJerseyColor: '#ff0000', playerRacketStyle: 'invalid', opponentRacketSize: 'extra' });
  assert.equal(ui.api.settings.playerRacketStyle, 'classic'); assert.equal(ui.api.settings.playerRacketSize, 'large');
  ui.api.select('Style', 'square'); ui.api.select('Color', '#FFAA00'); ui.api.select('Grip', '#112233'); ui.api.select('Size', 'extra');
  ui.api.render(); assert.equal(ui.nodes.get('racketColor-choices').dataset.selectedColor, '#ffaa00');
  assert.equal(ui.nodes.get('racketColor-value').textContent, 'Custom color', 'legacy saved colors are kept without a custom picker');
  assert.equal(ui.groups['[data-racket-style]'][1].attributes['aria-pressed'], 'true');
  ui.api.role('opponent'); ui.api.select('Style', 'slim'); ui.api.select('Color', '#7788ff');
  const reopened = equipmentUi(JSON.parse(ui.storage.get('shuttle-club-appearance')));
  assert.equal(reopened.api.settings.playerRacketStyle, 'square'); assert.equal(reopened.api.settings.opponentRacketStyle, 'slim');
  reopened.api.role('player'); reopened.api.reset();
  assert.equal(reopened.api.settings.playerRacketSize, 'large'); assert.equal(reopened.api.settings.playerRacketColor, null);
  assert.equal(reopened.api.settings.opponentRacketStyle, 'slim'); assert.equal(reopened.api.settings.opponentRacketColor, '#7788ff');
  assert.equal(reopened.api.settings.court, 'sky'); assert.equal(reopened.api.settings.playerJerseyColor, '#ff0000');
  const before = JSON.stringify(reopened.api.settings);
  reopened.api.select('Style', '__proto__'); reopened.api.select('Size', 'unknown'); reopened.api.select('Color', '#bad');
  assert.equal(JSON.stringify(reopened.api.settings), before);
});
