import test from 'node:test';
import assert from 'node:assert/strict';
import './appearance.js';

const { jerseyPalette, normalizeColor } = globalThis.ShuttleAppearance;
const luminance = color => color.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
  .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('missing or invalid saved jersey colors preserve both original outfits', () => {
  for (const [role, main, stripe] of [['player','#2264c8','#53b5ee'],['opponent','#f0ddbd','#c78336']]) {
    for (const invalid of [undefined, null, 42, {}, '#fff', 'red', '#xyz123']) {
      const palette = jerseyPalette(role, invalid, invalid);
      assert.equal(palette.main, main); assert.equal(palette.stripe, stripe); assert.equal(palette.number, '#f5f3e8');
    }
  }
  assert.equal(normalizeColor('#AABBCC'), '#aabbcc');
});

test('automatic stripes stay distinct on very dark, bright and neutral custom shirts', () => {
  for (const main of ['#000000','#ffffff','#808080','#ffff00','#ff0000','#00ff00','#0000ff','#aa44cc','#dddddd']) {
    for (const role of ['player', 'opponent']) {
      const palette = jerseyPalette(role, main, null);
      assert.equal(palette.main, main);
      assert.ok(contrast(main, palette.stripe) >= 2, `stripe remains visible on ${main}`);
      assert.ok(contrast(main, palette.number) >= 2, `number remains visible on ${main}`);
    }
  }
});

test('manual stripe colors persist independently when the main shirt color changes', () => {
  for (const main of ['#aa44cc','#17a371','#eeeeee']) assert.equal(jerseyPalette('player', main, '#FFCC33').stripe, '#ffcc33');
  assert.notEqual(jerseyPalette('player', '#aa44cc', null).stripe, jerseyPalette('player', '#17a371', null).stripe);
});

test('custom pale shirts retain a readable number without changing the original cream kit', () => {
  assert.equal(jerseyPalette('player', '#ffffff', null).number, '#243348');
  assert.equal(jerseyPalette('opponent', null, null).number, '#f5f3e8');
});
