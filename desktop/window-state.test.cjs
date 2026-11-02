const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitWindowState } = require('./window-state.cjs');
const primary = { x: 0, y: 0, width: 1920, height: 1040 };

test('first launch centers the game within the work area', () => {
  assert.deepEqual(fitWindowState(null, [primary]).bounds, { x: 260, y: 70, width: 1400, height: 900 });
});
test('a connected secondary monitor retains the saved window and maximize preference', () => {
  const saved = { bounds: { x: -1700, y: 50, width: 1200, height: 800 }, maximized: true };
  const fitted = fitWindowState(saved, [primary, { x: -1920, y: 0, width: 1920, height: 1040 }]);
  assert.deepEqual(fitted.bounds, saved.bounds); assert.equal(fitted.maximized, true);
});
test('an unplugged monitor returns the window to a reachable screen', () => {
  const fitted = fitWindowState({ bounds: { x: 3000, y: -900, width: 1800, height: 1200 } }, [primary]);
  assert.ok(fitted.bounds.x >= 0 && fitted.bounds.y >= 0);
  assert.ok(fitted.bounds.x + fitted.bounds.width <= primary.width);
  assert.ok(fitted.bounds.y + fitted.bounds.height <= primary.height);
});
test('high DPI small work areas do not force an oversized minimum window', () => {
  const area = { x: 0, y: 0, width: 640, height: 480 };
  const fitted = fitWindowState({ bounds: { x: 0, y: 0, width: 1400, height: 900 } }, [area]);
  assert.equal(fitted.minWidth, 640); assert.equal(fitted.minHeight, 480);
  assert.deepEqual(fitted.bounds, { x: 0, y: 0, width: 640, height: 480 });
});
test('invalid saved geometry falls back to usable defaults', () => {
  for (const bounds of [{ x: '0', y: 0, width: 900, height: 600 }, { x: 0, y: Infinity, width: 900, height: 600 }, { x: 0, y: 0, width: -1, height: 600 }]) {
    assert.deepEqual(fitWindowState({ bounds }, [primary]).bounds, fitWindowState(null, [primary]).bounds);
  }
});
