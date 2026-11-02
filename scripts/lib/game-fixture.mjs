import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import '../../core.js';
import '../../target-challenge.js';
import '../../appearance.js';
import '../../guidance.js';
import '../../touch-input.js';
import '../../tutorial.js';
import '../../i18n.js';
const core = globalThis.ShuttleCore, targets = globalThis.ShuttleTargets;

// Run the whole production game with a small DOM stand-in. This checks the real
// menu handlers, swing resolution, update clock, pause and results transitions.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const game = readFileSync(new URL('../../game.js', import.meta.url), 'utf8');
export function gameFixture(extra = '', options = {}) {
  const nodes = [], byId = new Map(), storage = new Map(Object.entries(options.storage ?? {}));
  const context2d = new Proxy({ measureText: () => ({ width: 50 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (obj, key) => obj[key] ?? (() => {}), set: (obj, key, value) => { obj[key] = value; return true; } });
  function node(attributes = {}) {
    const classes = new Set((attributes.class ?? '').split(/\s+/)), listeners = new Map(), captures = new Set();
    const element = {
      attributes, dataset: {}, style: { setProperty() {} }, children: [], parentElement: {}, textContent: '', value: '', firstChild: { textContent: '' },
      classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)), contains: v => classes.has(v), toggle(v, force = !classes.has(v)) { if (force) classes.add(v); else classes.delete(v); return force; } },
      setAttribute(k, v) { this.attributes[k] = v; }, getAttribute(k) { return this.attributes[k]; },
      addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(handler); },
      dispatchEvent(event) { event.target ??= this; event.preventDefault ??= () => {}; for (const handler of listeners.get(event.type) ?? []) handler(event); },
      scrollTo() {}, focus() {}, setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id), releasePointerCapture(id) { captures.delete(id); }, closest: () => node(),
      append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
      getBoundingClientRect: () => ({ width: 1200, height: 720, x: 0, y: 0, left: 0, top: 0 }),
      getContext: () => context2d,
      querySelector: () => node(), querySelectorAll: selector => element.children.filter(child => matches(child, selector))
    };
    Object.defineProperty(element, 'className', { get: () => [...classes].join(' '), set: v => { classes.clear(); v.split(/\s+/).forEach(x => classes.add(x)); } });
    Object.defineProperty(element, 'childNodes', { get: () => element.children });
    for (const [key, value] of Object.entries(attributes)) if (key.startsWith('data-')) element.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    nodes.push(element); if (attributes.id) byId.set(attributes.id, element);
    return element;
  }
  function matches(element, selector) {
    if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return Boolean(attr && Object.hasOwn(element.attributes, attr[1]) && (attr[2] === undefined || element.attributes[attr[1]] === attr[2]));
  }
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const attributes = Object.fromEntries([...tag[0].matchAll(/\s([\w-]+)(?:="([^"]*)")?(?=\s|\/?>)/g)].map(m => [m[1], m[2] ?? '']));
    node(attributes);
  }
  const documentEvents = node();
  const document = { body: node(), documentElement: node(), getElementById: id => { assert.ok(byId.has(id), `real HTML contains ${id}`); return byId.get(id); },
    querySelectorAll: s => nodes.filter(n => matches(n, s)), querySelector: s => nodes.find(n => matches(n, s)), createElement: () => node(), createTextNode: text => ({ textContent: text }), addEventListener: documentEvents.addEventListener, dispatchEvent: documentEvents.dispatchEvent };
  document.body.children = [...byId.values()];
  const injected = game.replace(/\}\)\(\);\s*$/, `globalThis.fixture = {
    update, hit, finish, togglePause, drawChallengeZone, chooseMode,
    snapshot: () => ({state, mode, challenge, challengeZone, delivery, player, score, opponent, match, aiLevel}),
    prepareStroke(requested, power, aim = challengeZone.x) {
      delivery.age = delivery.duration;
      Object.assign(player, incomingPosition(delivery), {height:0, vx:0, vy:0, pivot:0});
      setAim(aim); setPower(power); hit(requested);
    },
    forceNet() { delivery.phase='return'; delivery.age=0; delivery.returnDuration=1; delivery.fault={type:'net',age:.1,point:{x:.5,y:0,z:20}}; },
    leave: leaveResults,
    ${extra}
  };})();`);
  const window = node(); window.devicePixelRatio = 1; window.scrollTo = () => {};
  const sandbox = { document, window,
    ResizeObserver: class { observe() {} }, requestAnimationFrame() {}, performance: { now: () => 0 }, setTimeout, clearTimeout,
    localStorage: { getItem: k => { if(options.storageBlocked)throw new Error('Storage unavailable');return storage.get(k) ?? null; }, setItem: (k, v) => { if(options.storageBlocked)throw new Error('Storage unavailable');storage.set(k, v); } },
    ShuttleCore: core, ShuttleTargets: targets, ShuttleAppearance: globalThis.ShuttleAppearance, ShuttleGuidance: globalThis.ShuttleGuidance, ShuttleTouch: globalThis.ShuttleTouch, ShuttleTutorial: globalThis.ShuttleTutorial, ShuttleI18n: globalThis.ShuttleI18n,
    HTMLInputElement: class {}, HTMLButtonElement: class {} };
  runInNewContext(injected, sandbox);
  return { api: sandbox.fixture, document, window, byId, storage, click: selector => { const button = document.querySelector(selector); assert.ok(button?.onclick, selector); button.onclick(); },
    step(seconds) { for (let elapsed = 0; elapsed < seconds; elapsed += .01) sandbox.fixture.update(.01); } };
}

