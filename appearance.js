// Appearance data is independent of gameplay rules. Add future equipment here.
(() => {
'use strict';
const courts = {
  classic: { name: 'Classic Green', wall: ['#f1f7ef', '#d6e6dc'], apron: ['#c9dcd0', '#dce9db', '#b9d2bf'], floor: ['#51987c', '#60a98c', '#74b99a'], edge: '#619680', line: '#f6fff3', trim: '#acc9ad', shadow: '#527f68', seam: '#3d8268', guides: { landing: '#dfefd2', landingOutline: '#102838', outline: '#102838', waiting: '#406454' } },
  sakura: { name: 'Sakura Pink', wall: ['#faf6f1', '#e8dfdf'], apron: ['#ddd3ce', '#ede4da', '#d5c7c5'], floor: ['#c38b9e', '#d19aaf', '#dda9ba'], edge: '#b78394', line: '#fffaf6', trim: '#e0c3ca', shadow: '#a87987', seam: '#a76f88', guides: { landing: '#153e60', landingOutline: '#fff7fa', outline: '#153044', waiting: '#486071' } },
  sky: { name: 'Sky Blue', wall: ['#f1f8f7', '#d5e6e7'], apron: ['#cadbdd', '#e1eddf', '#b9d0d0'], floor: ['#6099b0', '#71abc0', '#88bbcb'], edge: '#628e9a', line: '#f7fffb', trim: '#b5d2d3', shadow: '#5a8a9a', seam: '#477e94', guides: { landing: '#153e60', landingOutline: '#f4fcff', outline: '#12334e', waiting: '#486171' } },
  dusk: { name: 'Lilac Purple', wall: ['#f7f6fa', '#e1e1ec'], apron: ['#d5d6de', '#e8e9e2', '#c8cbd7'], floor: ['#9c94b8', '#aaa2c6', '#b9b1ce'], edge: '#9189a7', line: '#fcfaff', trim: '#d2cedd', shadow: '#817995', seam: '#817699', guides: { landing: '#edfbff', landingOutline: '#25203b', outline: '#25203b', waiting: '#5d5675' } }
};
for (const court of Object.values(courts)) {
  for (const value of Object.values(court)) if (value && typeof value === 'object') Object.freeze(value);
  Object.freeze(court);
}
const jerseys = Object.freeze({
  player: Object.freeze({ main: '#2264c8', stripe: '#53b5ee' }),
  opponent: Object.freeze({ main: '#f0ddbd', stripe: '#c78336' })
});
const normalizeColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
const colorPresets = Object.freeze([
  ['Ivory', '#f5f3e8'], ['Charcoal', '#263348'], ['Blue', '#2264c8'], ['Light Blue', '#53b5ee'], ['Green', '#17a371'],
  ['Orange', '#f77927'], ['Red', '#d44a36'], ['Pink', '#d75b8c'], ['Purple', '#aa77cc'], ['Yellow', '#ffcc33']
].map(([name, color]) => Object.freeze({ name, color })));
const channels = color => color.slice(1).match(/../g).map(c => parseInt(c, 16));
const mix = (color, target, amount) => '#' + channels(color).map((c, i) => Math.round(c + (channels(target)[i] - c) * amount).toString(16).padStart(2, '0')).join('');
const luminance = color => channels(color).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
function jerseyPalette(role, mainColor, stripeColor) {
  const original = jerseys[role] ?? jerseys.player;
  const main = normalizeColor(mainColor) ?? original.main;
  const stripe = normalizeColor(stripeColor) ?? (main === original.main ? original.stripe : luminance(main) < .3 ? mix(main, '#ffffff', .62) : mix(main, '#172638', .72));
  // Preserve original white numbers; custom pale shirts need dark numbers to stay readable.
  const number = main === original.main || luminance(main) < .45 ? '#f5f3e8' : '#243348';
  return { main, stripe, number, shade: mix(main, '#000000', .25), light: mix(main, '#ffffff', .25) };
}
const racketStyles = Object.freeze({
  classic: Object.freeze({ name: 'Classic Oval', width: 1, height: 1, exponent: 2, thickness: .0055 }),
  square: Object.freeze({ name: 'Isometric', width: 1.02, height: .97, exponent: 3.2, thickness: .006 }),
  slim: Object.freeze({ name: 'Slim Oval', width: .86, height: 1.07, exponent: 2, thickness: .0048 })
});
const racketSizes = Object.freeze({ original: Object.freeze({ name: 'Original', scale: 1 }), large: Object.freeze({ name: 'Large', scale: 1.16 }), extra: Object.freeze({ name: 'Extra Large', scale: 1.28 }) });
const normalizeRacketStyle = value => Object.hasOwn(racketStyles, value) ? value : 'classic';
const normalizeRacketSize = value => Object.hasOwn(racketSizes, value) ? value : 'large';
function racketAppearance(style, size, frameColor, gripColor) {
  style = normalizeRacketStyle(style); size = normalizeRacketSize(size);
  const frame = normalizeColor(frameColor) ?? '#204b51', grip = normalizeColor(gripColor) ?? '#f1f2e9';
  return { style, size, ...racketStyles[style], scale: racketSizes[size].scale, frame, grip,
    accent: luminance(frame) < .3 ? mix(frame, '#ffffff', .7) : mix(frame, '#172638', .7),
    strings: luminance(frame) < .45 ? '#dbe6e3' : '#536871' };
}
globalThis.ShuttleAppearance = Object.freeze({ courts: Object.freeze(courts), jerseys, normalizeColor, colorPresets, jerseyPalette,
  racketStyles, racketSizes, normalizeRacketStyle, normalizeRacketSize, racketAppearance,
  defaults: Object.freeze({ court: 'classic', landingColor: null, aimColor: null,
    playerJerseyColor: null, playerJerseyStripe: null, opponentJerseyColor: null, opponentJerseyStripe: null,
    playerRacketStyle: 'classic', playerRacketSize: 'large', playerRacketColor: null, playerRacketGrip: null,
    opponentRacketStyle: 'classic', opponentRacketSize: 'large', opponentRacketColor: null, opponentRacketGrip: null }) });
})();
