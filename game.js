(() => {
'use strict';
let lanClient = null, lanActive = false, lanHosting = false, lanBusy = false, lanFailed = false;
let lanView = null, lanRoom = null, lanRound = -1, lanFlight = -1, lanGeneration = 0;
const { clamp, RULES, SWING, POWER, createPlayer, startJump, updateJump, contactTime, contactTimingError, isHighShot, isInterceptable, aimHorizontal, defaultPowerFor, shotFor, planReturn, incomingPosition, returnPosition, returnFault, difficulty, movePlayer, makeDelivery, assessHit, judgeHit, pointsFor } = globalThis.ShuttleCore;
const { SERVICE, createMatch, awardPoint, createOpponent, advanceOpponentReturn, makeMatchDelivery, serviceSetup, inServiceCourt, constrainToServiceCourt, serviceTarget, makeServiceDelivery } = globalThis.ShuttleCore;
const { recoverOpponent, TRAINING, TRAINING_ERRORS, createTrainingSession, makeTrainingDelivery, recordTrainingOutcome, trainingAdvice } = globalThis.ShuttleCore;
const { AI_STYLES } = globalThis.ShuttleCore;
const { assessJumpPreparation } = globalThis.ShuttleCore;
const { isBackhand, canPlayerSmash } = globalThis.ShuttleCore;
const { planService } = globalThis.ShuttleCore;
const targets = globalThis.ShuttleTargets;
const tutorials = globalThis.ShuttleTutorial;
let tutorial = null, tutorialUiKey = '', tutorialCompleted = false;
try { tutorialCompleted = JSON.parse(localStorage.getItem('shuttle-flow-tutorial'))?.completed === true; } catch { /* The tutorial works without storage. */ }
let selectedPractice = 'feed', selectedTargetKind = 'mixed', selectedTargetLimit = 20, challenge = null;
let challengeZone = null;
let selectedAiStyle = 'balanced', aiStyle = 'balanced';
let selectedTraining = 'jump', selectedTrainingSpeed = 'normal', selectedTrainingLimit = 20, training = null;
const trainingSpeedNames = { slow: 'Slow', normal: 'Standard', fast: 'Fast' };
const trainingGoals = { jump: 'Jump on the cue, then right click near the apex.', net: 'Follow the ring and intercept at least 0.18 s before landing.', defense: 'Left: lift. Shift + left: block. Low right click: drive.' };
const touchTrainingGoals = { jump: 'Select Attack. Tap Jump on the cue, then release the hit button near the apex.', net: 'Select Drop. Follow the ring and release the hit button early to intercept.', defense: 'Clear: lift. Drop: block. Attack: low drive. Tap the large button to hit.' };
const trainingGoal = kind => (touchMode ? touchTrainingGoals : trainingGoals)[kind];
let selectedMode = 'practice', selectedPoints = 7, selectedAiLevel = 'normal', aiLevel = 'normal', mode = 'practice', match = null, opponent = createOpponent(), opponentSwing = null;
let roundBreak = 0, rallyHits = 0, longestRally = 0;
let serviceStill = 0;
const createMotion = () => ({ run: 0, lean: 0, pitch: 0, gait: 0, turn: 0, lunge: 0, high: 0, split: 0, brake: 0, ready: 1, prepare: 0, backhand: 0, reachX: 0, reachY: 0, stroke: 0, lastSpeed: 0 });
const opponentMotion = createMotion();

const $ = id => document.getElementById(id);
let languageStorage;
try { languageStorage = localStorage; } catch { /* Language switching still works for this session. */ }
const i18n = globalThis.ShuttleI18n.createLocalizer({ document, storage: languageStorage });
const tr = i18n.t;
const canvas = $('court'), ctx = canvas.getContext('2d');
// Physics and projection use this camera plane; bitmap dimensions follow the display.
const CAMERA_WIDTH = 1200, CAMERA_HEIGHT = 720;
const COURT_FONT = '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
let renderDpr = 0;
let figureYScale = 1, figureScale = 1, courtTextScale = 1;
function resizeCourtDetails() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // The portrait court uses a taller camera plane, while athletes and shuttles keep their proportions.
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height;
    ctx.setTransform(width / CAMERA_WIDTH, 0, 0, height / CAMERA_HEIGHT, 0, 0);
    courtBackdrop = null;
  }
  renderDpr = dpr;
  figureYScale = (rect.width / CAMERA_WIDTH) / (rect.height / CAMERA_HEIGHT);
  figureScale = figureYScale < .7 ? 1.6 : 1;
  courtTextScale = Math.max(1, Math.min(3, CAMERA_WIDTH / rect.width));
  for (const point of [swing?.contactScreen, swing?.predictedScreen, opponentSwing?.contactScreen, impact]) {
    if (point?.groundY !== undefined) point.y = point.groundY - point.flightHeight * figureYScale;
  }
  trail = [];
}
new ResizeObserver(resizeCourtDetails).observe(canvas);
window.addEventListener('resize', resizeCourtDetails);
const keys = new Set();
let touchMode = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
let aimX = .5, previewShot = 'clear';
let selectedPower = null;
const powerStorageKey = 'shuttle-club-power-defaults';
const powerDefaults = { ...POWER.defaults };
try {
  const stored = JSON.parse(localStorage.getItem(powerStorageKey));
  for (const type of ['clear', 'drop', 'smash']) powerDefaults[type] = defaultPowerFor(type, stored);
} catch { /* Default controls still work when storage is unavailable. */ }
let settingsReturn = 'welcome';
let helpReturn = 'welcome';
let personalizationReturn = 'welcome';
let currentPanel = 'welcome';
const saveFeedbackTimers = new Map();
const { normalizeMode: normalizeGuidance, feedbackVisible } = globalThis.ShuttleGuidance;
const guidanceStorageKey = 'shuttle-club-guidance';
let guidanceMode = 'compact';
try { guidanceMode = normalizeGuidance(JSON.parse(localStorage.getItem(guidanceStorageKey))?.mode); } catch { /* Compact is the default. */ }
function renderGuidanceSettings() {
  document.body.dataset.guidance = guidanceMode;
  for (const button of document.querySelectorAll('[data-guidance]')) {
    const selected = button.dataset.guidance === guidanceMode;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
}
renderGuidanceSettings();
const { courts: COURT_STYLES, defaults: appearanceDefaults, normalizeColor, colorPresets, jerseyPalette, racketAppearance, racketStyles, racketSizes, normalizeRacketStyle, normalizeRacketSize } = globalThis.ShuttleAppearance;
let jerseyPreviewRole = 'player';
let racketPreviewRole = 'player';
const appearanceStorageKey = 'shuttle-club-appearance';
const appearanceSettings = { ...appearanceDefaults };
try {
  const stored = JSON.parse(localStorage.getItem(appearanceStorageKey));
  if (Object.hasOwn(COURT_STYLES, stored?.court)) appearanceSettings.court = stored.court;
  for (const key of ['landingColor', 'aimColor', 'playerJerseyColor', 'playerJerseyStripe', 'opponentJerseyColor', 'opponentJerseyStripe', 'playerRacketColor', 'playerRacketGrip', 'opponentRacketColor', 'opponentRacketGrip']) {
    appearanceSettings[key] = normalizeColor(stored?.[key]);
  }
  for (const role of ['player', 'opponent']) {
    appearanceSettings[`${role}RacketStyle`] = normalizeRacketStyle(stored?.[`${role}RacketStyle`]);
    appearanceSettings[`${role}RacketSize`] = normalizeRacketSize(stored?.[`${role}RacketSize`]);
  }
} catch { /* Keep the classic court when saved appearance is unavailable. */ }
const courtStyle = () => COURT_STYLES[lanActive && lanView ? lanView.court : appearanceSettings.court] ?? COURT_STYLES.classic;
const networkLook = role => lanActive && lanView ? lanView.looks[role === 'player' ? lanView.side : 1 - lanView.side] : null;
const athleteJersey = role => { const look = networkLook(role); return look ? jerseyPalette('player', look.JerseyColor, look.JerseyStripe) : jerseyPalette(role, appearanceSettings[`${role}JerseyColor`], appearanceSettings[`${role}JerseyStripe`]); };
const athleteRacket = role => { const look = networkLook(role); return look ? racketAppearance(look.RacketStyle, look.RacketSize, look.RacketColor, look.RacketGrip) : racketAppearance(appearanceSettings[`${role}RacketStyle`], appearanceSettings[`${role}RacketSize`], appearanceSettings[`${role}RacketColor`], appearanceSettings[`${role}RacketGrip`]); };
// Transparent captions use an ink suited to the floor, independent of marker colors.
const courtTextInks = Object.freeze({ classic: '#10291b', sakura: '#223042', sky: '#122a3b', dusk: '#27223e' });
function markerOutline(color) {
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 145 ? '#102838' : '#ffffff';
}
function landingGuides() {
  const guides = courtStyle().guides, color = appearanceSettings.landingColor;
  return color ? { ...guides, landing: color, landingOutline: markerOutline(color) } : guides;
}
const hitReasons = {
  'no-ball': ['No incoming shuttle', 'Wait for the next shuttle before swinging.'],
  'before-net': ['Wait for the shuttle', 'Get in position; hit after the shuttle crosses the net.'],
  high: ['Too high', 'Wait for it to drop, or jump to reach higher.'],
  far: ['Too far away', 'Follow the contact ring and get within reach.'],
  early: ['Too early', 'Swing when the ring becomes solid.'],
  late: ['Too late', 'Next time, swing on the solid or double ring.']
};
const shotNames = { clear: 'Clear', drop: 'Drop', tap: 'Standing smash', smash: 'Jump smash', lift: 'Lift', block: 'Block', drive: 'Drive' };
const shotColors = { clear: '#dcf797', drop: '#a3e5f4', tap: '#ffd58b', smash: '#ffd58b', lift: '#b9e4aa', block: '#a3e5f4', drive: '#c5baff' };
const incomingNames = { clear: 'Clear', drop: 'Drop', attack: 'Attack', smash: 'Smash', jumpSmash: 'Jump smash', lift: 'Lift', block: 'Block', drive: 'Drive' };
const incomingColors = { clear: '#d7f583', drop: '#a3e5f4', attack: '#ffd58b', smash: '#ffb577', jumpSmash: '#ff8f72', lift: '#b9e4aa', block: '#a3e5f4', drive: '#c5baff' };
const aiLevelNames = { easy: 'Casual', normal: 'Standard', hard: 'Expert' };
const aiLevelDescriptions = { easy: 'Casual: steady rallies with room to recover.', normal: 'Standard: fast reactions and reliable smash defense.', hard: 'Expert: stronger defense and precise counterattacks.' };
const powerNames = ['', 'Light', 'Medium', 'Strong'];
const killEffects = Object.freeze({
  tap: [
    { volume: .90, rate: 1.12, bass: -4, trail: 3, width: 1.6, opacity: .30, flash: 23, particles: 15, scatter: 105 },
    { volume: .98, rate: 1.06, bass: 0, trail: 6, width: 2.8, opacity: .52, flash: 34, particles: 21, scatter: 145 },
    { volume: 1.05, rate: 1.01, bass: 2, trail: 9, width: 4.1, opacity: .72, flash: 46, particles: 28, scatter: 190 }
  ],
  smash: [
    { volume: .96, rate: 1.16, bass: -4, trail: 4, width: 2.1, opacity: .36, flash: 29, particles: 18, scatter: 125 },
    { volume: 1.02, rate: 1.10, bass: 0, trail: 9, width: 4.0, opacity: .58, flash: 42, particles: 25, scatter: 170 },
    { volume: 1.08, rate: 1.03, bass: 2, trail: 14, width: 6.0, opacity: .82, flash: 58, particles: 32, scatter: 220 }
  ]
});
const killEffect = (kind, power = 2) => killEffects[kind]?.[clamp(Math.round(power), 1, 3) - 1] ?? null;
const laneName = x => x < SERVICE.sideline ? 'Wide left' : x < .35 ? 'Left' : x < .46 ? 'Mid-left' : x <= .54 ? 'Center' : x <= .65 ? 'Mid-right' : x <= 1 - SERVICE.sideline ? 'Right' : 'Wide right';
function setAim(value) {
  aimX = aimHorizontal(value);
  i18n.text($('touch-aim-value'), laneName(aimX));
  $('touch-aim-track').style.setProperty('--aim-position', `${clamp(value, 0, 1) * 100}%`);
  $('touch-aim-track').classList.toggle('wide', aimX < SERVICE.sideline || aimX > 1 - SERVICE.sideline);
}
let state = 'ready', player = createPlayer(), delivery = null;
let score = 0, combo = 0, maxCombo = 0, returns = 0, perfects = 0, smashes = 0, taps = 0, lifts = 0, blocks = 0, drives = 0;
let practiceMisses = 0, practiceOuts = 0, practiceNets = 0;
let cooldown = 0, swing = null, nextFeed = .9, feedbackTime = 0, elapsed = 0;
let particles = [], audio = null, noiseBuffer = null, muted = false, best = 0, previousBest = 0;
let volume = 100, masterGain = null;
const audioStorageKey = 'shuttle-club-audio-settings';
try {
  const saved = JSON.parse(localStorage.getItem(audioStorageKey));
  if (typeof saved?.volume === 'number' && Number.isFinite(saved.volume)) volume = clamp(saved.volume, 0, 100);
  if (typeof saved?.muted === 'boolean') muted = saved.muted;
} catch { /* Use defaults when storage is unavailable or invalid. */ }
let landing = null, impact = null, trail = [];
const motion = createMotion();
const recordings = new Map(); let recordingLoad = null, impactIndex = 0, stepIndex = 0;
try { best = Number(localStorage.getItem('shuttle-club-best')) || 0; } catch { /* Storage may be unavailable in private browsing. */ }
i18n.text($('best'), best);

function sound(kind, power = 2) {
  if (muted || volume === 0 || !audio || audio.state !== 'running') return;
  if (playRecorded(kind, power)) return;
  const now = audio.currentTime;
  function tone(frequency, endFrequency, duration, volume, type = 'sine', delay = 0) {
    const oscillator = audio.createOscillator(), gain = audio.createGain(), start = now + delay;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start); oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .003); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain); gain.connect(masterGain); oscillator.start(start); oscillator.stop(start + duration + .01);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  function noise(duration, volume, frequency, endFrequency) {
    const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
    source.buffer = noiseBuffer; filter.type = 'bandpass'; filter.Q.value = .7;
    filter.frequency.setValueAtTime(frequency, now); filter.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(volume, now + .004); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(masterGain); source.start(now); source.stop(now + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  if (['hit', 'perfect', 'air', 'smash', 'tap', 'drop'].includes(kind)) {
    // A sharp string-bed impact plus a short racket swish.
    const feel = killEffect(kind, power);
    noise(.085, feel ? feel.volume * .42 : kind === 'drop' ? .15 : kind === 'air' ? .34 : .25, 5200, 1500);
    tone(feel ? 1480 - power * 120 : kind === 'air' ? 1150 : 920, 210, .075, feel ? feel.volume * .18 : .16, 'triangle');
    if (kind === 'perfect') tone(1650, 1200, .12, .045, 'sine', .035);
    if (kind === 'air') tone(1850, 600, .11, .065, 'triangle', .02);
    return;
  }
  if (kind === 'swing') { noise(.14, .10, 1900, 650); return; }
  if (kind === 'jump') { noise(.08, .055, 800, 1700); tone(150, 270, .08, .05); return; }
  if (kind === 'land') { noise(.075, .10, 700, 220); tone(95, 48, .10, .10); return; }
  const notes = { miss: [220, 140], start: [440, 660, 880] }[kind];
  if (!notes) return;
  notes.forEach((frequency, i) => {
    const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + i * .065;
    oscillator.type = kind === 'miss' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.055, start + .008); gain.gain.exponentialRampToValueAtTime(.001, start + .16);
    oscillator.connect(gain); gain.connect(masterGain); oscillator.start(start); oscillator.stop(start + .18);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}
function loadRecordings() {
  if (!recordingLoad) recordingLoad = Promise.all(Object.entries(globalThis.ShuttleSounds || {}).map(async ([name, base64]) => {
    try {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      recordings.set(name, await audio.decodeAudioData(bytes.buffer));
    } catch { /* The synthesized fallback remains available. */ }
  }));
}
function playRecorded(kind, power = 2) {
  let name, volume, rate;
  const feel = killEffect(kind, power);
  if (['hit', 'perfect', 'air', 'smash', 'tap', 'drop'].includes(kind)) {
    name = `hit${impactIndex % 4 + 1}`; volume = feel ? feel.volume : kind === 'drop' ? .43 : kind === 'air' ? .90 : kind === 'perfect' ? .82 : .67;
    rate = (feel ? feel.rate : kind === 'air' ? 1.06 : 1) + (Math.random() - .5) * .04;
  } else if (kind === 'swing') { name = 'swish'; volume = .23; rate = 1.5; }
  else if (kind === 'jump' || kind === 'land') { name = `step${stepIndex % 2 + 1}`; volume = kind === 'land' ? .48 : .25; rate = kind === 'land' ? .97 : 1.12; }
  else return false;
  const buffer = recordings.get(name); if (!buffer) return false;
  if (name.startsWith('hit')) impactIndex++; if (name.startsWith('step')) stepIndex++;
  const source = audio.createBufferSource(), gain = audio.createGain();
  const filter = feel ? audio.createBiquadFilter() : null;
  source.buffer = buffer; source.playbackRate.value = rate; gain.gain.value = volume;
  if (filter) { filter.type = 'lowshelf'; filter.frequency.value = 650; filter.gain.value = feel.bass; source.connect(filter); filter.connect(gain); }
  else source.connect(gain);
  gain.connect(masterGain); source.start();
  source.onended = () => { source.disconnect(); filter?.disconnect(); gain.disconnect(); };
  return true;
}
function enableAudio() {
  try {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audio.createGain(); masterGain.gain.value = muted ? 0 : volume / 100; masterGain.connect(audio.destination);
      noiseBuffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * .2), audio.sampleRate);
      const data = noiseBuffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      loadRecordings();
    }
    if (audio.state === 'suspended') return audio.resume().catch(() => {});
  } catch { /* Silent play is still supported. */ }
  return Promise.resolve();
}
function renderAudioSettings() {
  $('volume').value = volume;
  $('volume-value').value = `${volume}%`;
  i18n.attr($('volume'), 'aria-valuetext', `${volume}%${volume === 0 ? ', Muted' : ''}`);
  $('settings-sound').setAttribute('aria-pressed', String(!muted));
  i18n.text($('settings-sound'), muted ? 'Off' : 'On');
  $('volume-preview').disabled = muted || volume === 0;
  i18n.text($('sound'), muted || volume === 0 ? '♩̸' : '♪');
  i18n.attr($('sound'), 'aria-label', muted ? 'Enable sound' : volume === 0 ? 'Mute sound (volume is zero)' : 'Mute sound');
  if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : volume / 100, audio.currentTime, .01);
}
function saveAudioSettings() {
  saveSettings(audioStorageKey, { volume, muted });
  renderAudioSettings();
}
function saveSettings(key, value, statusId = 'settings-save-status') {
  let saved = true;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { saved = false; }
  clearTimeout(saveFeedbackTimers.get(statusId));
  const status = $(statusId);
  i18n.text(status, saved ? '✓ Saved' : 'Not saved');
  status.dataset.state = saved ? 'saved' : 'session';
  if (saved) saveFeedbackTimers.set(statusId, setTimeout(() => { i18n.text(status, 'Auto-save'); status.dataset.state = ''; }, 1800));
}
function savePowerDefaults() { saveSettings(powerStorageKey, powerDefaults); renderPowerDefaults(); }
function setVolume(value) {
  if (!Number.isFinite(value)) return;
  volume = Math.round(clamp(value, 0, 100)); saveAudioSettings();
}
function updateHud() {
  if (lanActive && lanView) { updateLanHud(); return; }
  const competing = mode === 'match';
  i18n.text($('score-label'), competing ? 'YOU' : 'SCORE');
  i18n.text($('combo-label'), competing ? 'CPU' : 'COMBO');
  i18n.text($('mode-label'), competing ? `Match · ${match.target} points · ${aiLevelNames[aiLevel]} · ${AI_STYLES[aiStyle].name} CPU` : 'Practice');
  document.querySelector('.best-label').classList.toggle('hidden', competing || mode === 'drill' || Boolean(challenge));
  $('drill-end').classList.toggle('hidden', mode === 'match' || !['playing', 'paused'].includes(state));
  i18n.text($('pause-menu'), mode === 'match' ? 'Back to menu' : 'End and review');
  $('ai-status').classList.toggle('hidden', !competing || state === 'ready');
  document.querySelector('.hud').classList.toggle('hidden', competing);
  $('match-board').classList.toggle('hidden', !competing);
  document.querySelector('.game-shell').classList.toggle('match-mode', competing);
  if (mode === 'tutorial') {
    $('drill-end').classList.add('hidden'); i18n.text($('pause-menu'), 'Exit tutorial');
    document.querySelector('.best-label').classList.add('hidden');
    return;
  }
  if (competing) {
    i18n.text($('match-computer').querySelector('span').firstChild, `CPU · ${AI_STYLES[aiStyle].name} `);
    i18n.text($('match-player-score'), match.player);
    i18n.text($('match-computer-score'), match.computer);
    $('match-player').classList.toggle('serving', match.server === 'player' && !match.winner);
    $('match-computer').classList.toggle('serving', match.server === 'computer' && !match.winner);
    i18n.attr($('match-player'), 'aria-label', `You: ${match.player} points${match.server === 'player' && !match.winner ? ', serving' : ''}`);
    i18n.attr($('match-computer'), 'aria-label', `${AI_STYLES[aiStyle].name} CPU: ${match.computer} points${match.server === 'computer' && !match.winner ? ', serving' : ''}`);
    i18n.text($('match-format'), `${match.target} pts · ${aiLevelNames[aiLevel]}`);
    i18n.text($('match-server'), match.winner ? 'Match complete' : match.server === 'player' ? 'Your serve' : 'CPU serve');
    const playerPoint = match.player >= match.cap - 1 || (match.player >= match.target - 1 && match.player > match.computer);
    const computerPoint = match.computer >= match.cap - 1 || (match.computer >= match.target - 1 && match.computer > match.player);
    const tied = match.player === match.computer && match.player >= match.target - 1;
    const situation = match.winner ? match.winner === 'player' ? 'You win' : 'CPU wins' : playerPoint && computerPoint ? 'Match point' : playerPoint ? 'Your match point' : computerPoint ? 'CPU match point' : tied ? `Deuce · Win by 2 · Cap ${match.cap}` : `Rally: ${rallyHits} shots`;
    i18n.text($('match-situation'), situation);
    $('match-situation').classList.toggle('game-point', !match.winner && (playerPoint || computerPoint));
    i18n.text($('score'), match.player); i18n.text($('combo'), match.computer);
    i18n.text($('level'), match.player >= match.target - 1 && match.computer >= match.target - 1 ? `Deuce · Win by 2 · cap ${match.cap}` : `${match.target} points · At deuce: Win by 2`);
    i18n.text($('hearts'), `Rally ${rallyHits}`); i18n.attr($('hearts'), 'aria-label', `Rally shots ${rallyHits} times`); return;
  }
  if (mode === 'drill') {
    i18n.text($('score-label'), 'GOALS'); i18n.text($('combo-label'), 'FEEDS');
    i18n.text($('score'), training.succeeded); i18n.text($('combo'), training.completed);
    i18n.text($('level'), `${TRAINING[training.kind]} · ${trainingSpeedNames[training.speed]}`);
    i18n.text($('hearts'), training.limit ? `${training.completed} / ${training.limit}` : 'Unlimited');
    i18n.attr($('hearts'), 'aria-label', training.limit ? `${training.completed} of ${training.limit} feeds completed` : 'Unlimited practice');
    i18n.text($('mode-label'), `Training · ${TRAINING[training.kind]}`); return;
  }
  if (challenge) {
    i18n.text($('score-label'), 'SCORE'); i18n.text($('combo-label'), 'HITS');
    i18n.text($('score'), challenge.score); i18n.text($('combo'), `${challenge.hits} / ${challenge.completed}`);
    i18n.text($('level'), challengeZone?.name ?? targets.kinds[challenge.kind]);
    i18n.text($('hearts'), challenge.limit ? `${challenge.completed} / ${challenge.limit} feeds` : 'Unlimited');
    i18n.attr($('hearts'), 'aria-label', `${challenge.completed}${challenge.limit ? ` of ${challenge.limit}` : ''} feeds completed`);
    i18n.text($('mode-label'), `Practice · Target Challenge · ${targets.kinds[challenge.kind]}`); return;
  }
  i18n.text($('score'), String(score).padStart(4, '0'));
  i18n.html($('combo'), `${combo} <small>×</small>`);
  updatePracticeStatus();
  const level = difficulty(returns).level;
  i18n.text($('level'), `${level === 1 ? 'Warm-up' : level < 4 ? 'Finding your rhythm' : 'Full pace'} · LV. ${level}`);
}
function sessionTime() { const seconds = Math.floor(elapsed); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function updatePracticeStatus() {
  if (mode !== 'practice' || challenge) return;
  const label = `Practice ${sessionTime()}`;
  if ($('hearts').textContent !== label) { i18n.text($('hearts'), label); i18n.attr($('hearts'), 'aria-label', `Session time: ${Math.floor(elapsed / 60)} min ${Math.floor(elapsed) % 60} s, unlimited practice`); }
}
function showPanel(id) {
  $('overlay').classList.remove('hidden');
  for (const name of ['welcome', 'mode-setup', 'phone-ready', 'lan-panel', 'paused', 'results', 'settings', 'help', 'personalization']) $(name).classList.toggle('hidden', name !== id);
  if (currentPanel !== id) $(id).querySelector('.panel-content')?.scrollTo({ top: 0 });
  currentPanel = id;
}
function focusPanel(id) {
  const target = { welcome: 'choose-' + selectedMode, 'mode-setup': 'start', 'phone-ready': 'phone-ready-play', 'lan-panel': 'lan-leave', paused: 'resume', settings: 'settings-close', personalization: 'personalization-close', help: 'help-close', results: 'restart' }[id];
  $(target).focus({ preventScroll: true });
}
function backToCover() {
  showPanel('welcome'); focusPanel('welcome');
}
function feedback(title, subtitle = '', miss = false, kind = 'notice') {
  $('feedback').replaceChildren(i18n.node(title));
  if (subtitle) { const small = document.createElement('small'); i18n.text(small, subtitle); $('feedback').append(small); }
  const visible = feedbackVisible(guidanceMode, kind);
  $('feedback').dataset.kind = kind;
  $('feedback').className = `feedback${visible ? ' visible' : ''}${miss ? ' miss' : ''}`; feedbackTime = visible ? .85 : 0;
}
function updatePowerStatus() {
  const serving = delivery?.phase === 'serve';
  const type = swing?.requested ?? previewShot;
  const service = serving ? planService(match, { x: player.x + .02, y: player.y, z: 50 }, type, swing?.aimX ?? aimX) : null;
  const value = serving ? service.power : swing?.power ?? selectedPower ?? defaultPowerFor(type, powerDefaults);
  const prediction = contactPrediction();
  const actualShot = serving ? service : swing ?? shotFor(prediction?.player ?? player, prediction?.point ?? null, type, value, prediction?.ball ?? delivery);
  const actualType = actualShot.type, strokeName = serving ? service.serviceKind === 'short' ? 'Short serve' : 'Long serve' : `${actualShot.backhand ? 'Backhand ' : ''}${shotNames[actualType]}`;
  const source = serving ? 'Serve' : selectedPower === null ? 'Default' : 'This shot';
  const label = `${source} · ${strokeName} · ${powerNames[value]}`;
  $('power-status').classList.toggle('temporary', !serving && selectedPower !== null);
  if ($('power-status').getAttribute('aria-label') === tr(label)) return;
  i18n.attr($('power-status'), 'aria-label', label);
  const title = document.createElement('span'); i18n.text(title, `${source} · ${strokeName}`);
  const meter = document.createElement('span'); meter.className = 'power-meter'; meter.setAttribute('aria-hidden', 'true');
  for (let n = 1; n <= 3; n++) { const bar = document.createElement('i'); bar.classList.toggle('filled', n <= value); meter.append(bar); }
  const level = document.createElement('b'); i18n.text(level, ['','Light','Medium','Strong'][value]);
  $('power-status').replaceChildren(title, meter, level);
}
function updateTouchShot() {
  const serving = delivery?.phase === 'serve';
  touchControls.setServing(serving);
  const requested = touchControls.requested();
  if (touchMode && !swing) previewShot = requested;
  const prediction = contactPrediction();
  const planned = serving ? planService(match, { x: player.x + .02, y: player.y, z: 50 }, requested, aimX)
    : shotFor(prediction?.player ?? player, prediction?.point ?? null, requested, selectedPower ?? defaultPowerFor(requested, powerDefaults), prediction?.ball ?? delivery);
  const label = serving ? planned.serviceKind === 'short' ? 'Short serve' : 'Long serve'
    : shotNames[planned.type].replace('Standing smash', 'Smash');
  const button = $('touch-hit'), accessibleLabel = `${planned.backhand ? 'Backhand ' : ''}${label}. Tap and release to hit; drag left or right before release to aim.`;
  if (button.textContent !== label) i18n.text(button, label);
  if (button.getAttribute('aria-label') !== accessibleLabel) i18n.attr(button, 'aria-label', accessibleLabel);
  const backhand = String(Boolean(planned.backhand));
  if (button.dataset.backhand !== backhand) button.dataset.backhand = backhand;
  const powerLabel = `Power · ${selectedPower === null ? 'Auto' : powerNames[selectedPower]}`;
  if ($('touch-power-toggle').textContent !== powerLabel) i18n.text($('touch-power-toggle'), powerLabel);
  const disabled = !canAdjustPower();
  for (const choice of document.querySelectorAll('[data-power]')) if (choice.disabled !== disabled) choice.disabled = disabled;
  if ($('touch-power-auto').disabled !== disabled) $('touch-power-auto').disabled = disabled;
}
function updateShotOptions() {
  updateTouchShot();
  const serving = state === 'playing' && delivery?.phase === 'serve' && match?.server === 'player' && roundBreak === 0;
  if (serving) {
    $('shot-options').classList.remove('hidden');
    for (const [id, label] of [['clear', 'Long serve'], ['drop', 'Long serve'], ['smash', 'Short serve']]) {
      i18n.text($('option-' + id), label);
    }
    // The Shift/Drop choice is a rally action; show the two actual serve choices.
    $('option-drop').parentElement.hidden = true;
    return;
  }
  $('option-drop').parentElement.hidden = false;
  const active = state === 'playing' && delivery?.phase === 'incoming' && roundBreak === 0;
  $('shot-options').classList.toggle('hidden', !active);
  if (!active) return;
  const prediction = contactPrediction();
  const shots = ['clear', 'drop', 'smash'].map(requested => shotFor(prediction.player, prediction.point, requested, selectedPower ?? defaultPowerFor(requested, powerDefaults), prediction.ball));
  const names = shots.map(shot => shot.type);
  for (let i = 0; i < names.length; i++) {
    const label = `${shots[i].backhand ? 'Backhand ' : ''}${{ lift: 'Lift', block: 'Block', drive: 'Drive', clear: 'Clear', drop: 'Drop', tap: 'Standing smash', smash: 'Jump smash' }[names[i]]}`;
    const id = ['clear', 'drop', 'smash'][i];
    if ($('option-' + id).textContent !== label) i18n.text($('option-' + id), label);
  }
}
function setFocusView(active) {
  document.body.classList.toggle('focus-game', active);
  document.body.classList.toggle('menu-view', !active);
  if (active) window.scrollTo({ top: 0, behavior: 'instant' });
}
function openHelp() {
  if (!$('help').classList.contains('hidden')) return;
  if (!$('settings').classList.contains('hidden')) closeSettings();
  if (state === 'playing') togglePause();
  helpReturn = navigationOrigin();
  showPanel('help'); $('help').scrollTop = 0; $('help-close').focus({ preventScroll: true });
}
function closeHelp() {
  showPanel(helpReturn);
  focusPanel(helpReturn);
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else feedback('Fullscreen unavailable', 'Using the focused court view.');
  } catch { feedback('Fullscreen did not open', 'You can continue in the focused court view.'); }
}
function renderPowerDefaults() {
  for (const button of document.querySelectorAll('[data-default-shot]')) {
    const selected = powerDefaults[button.dataset.defaultShot] === Number(button.dataset.defaultPower);
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  updatePowerStatus();
}
function setPower(power) {
  selectedPower = power;
  for (const button of document.querySelectorAll('[data-power]')) {
    const selected = Number(button.dataset.power) === selectedPower;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  updatePowerStatus();
}
function choosePower(power) { setPower(selectedPower === power ? null : power); }
function resetPowerForIncoming() {
  setPower(null);
  previewShot = touchMode ? touchControls.requested() : keys.has('ShiftLeft') || keys.has('ShiftRight') ? 'drop' : 'clear';
}
function canAdjustPower() { return state === 'playing' && delivery?.phase === 'incoming' && (!swing || swing.contacted) && roundBreak === 0; }
function openSettings() {
  if (!$('settings').classList.contains('hidden')) return;
  if (!$('help').classList.contains('hidden')) closeHelp();
  if (state === 'playing') togglePause();
  settingsReturn = navigationOrigin();
  renderPowerDefaults(); renderAudioSettings(); renderGuidanceSettings(); showPanel('settings'); $('settings-close').focus({ preventScroll: true });
}
function closeSettings() {
  showPanel(settingsReturn);
  focusPanel(settingsReturn);
}
function navigationOrigin() {
  return $('overlay').classList.contains('hidden') ? state === 'over' ? 'results' : state === 'paused' ? 'paused' : currentPanel : currentPanel;
}
function renderAppearance() {
  for (const button of document.querySelectorAll('[data-court-style]')) {
    const selected = button.dataset.courtStyle === appearanceSettings.court;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  i18n.text($('current-court-name'), courtStyle().name);
  for (const [key, fallback] of [['landingColor', courtStyle().guides.landing], ['aimColor', shotColors.clear]]) {
    renderColorChoices(key, appearanceSettings[key] ?? fallback, appearanceSettings[key], 'Auto');
  }
  renderJerseyControls();
  renderRacketControls();
  const preview = $('appearance-preview');
  const rect = preview.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  preview.width = Math.max(1, Math.round(rect.width * dpr));
  preview.height = Math.max(1, Math.round(rect.height * dpr));
  // The preview uses the camera's native ratio, independent of phone stretching.
  const original = [figureScale, figureYScale, courtTextScale];
  try {
    figureScale = figureYScale = 1; courtTextScale = Math.min(3, CAMERA_WIDTH / Math.max(1, rect.width)); draw(true);
    const incoming = project(.42, .62), outgoing = project(.72, -.60), guides = landingGuides();
    const aimColor = appearanceSettings.aimColor ?? shotColors.clear;
    drawGuideRing(incoming.x, incoming.y, 20 * incoming.scale, 8 * incoming.scale, guides.landing + '20', guides.landing, guides.landingOutline);
    drawGuideRing(outgoing.x, outgoing.y, 27 * outgoing.scale, 11 * outgoing.scale, aimColor + '20', aimColor, markerOutline(aimColor));
    ctx.save(); ctx.font = `500 16px ${COURT_FONT}`; ctx.textAlign = 'center';
    courtLabel('Landing point', incoming.x, incoming.y + 32 * courtTextScale);
    courtLabel('Shot aim', outgoing.x, outgoing.y + 32 * courtTextScale); ctx.restore();
    preview.getContext('2d').drawImage(canvas, 0, 0, preview.width, preview.height);
    renderJerseyPreview();
    renderRacketPreview();
  } finally { [figureScale, figureYScale, courtTextScale] = original; draw(); }
}
function renderJerseyControls() {
  const palette = athleteJersey(jerseyPreviewRole);
  for (const button of document.querySelectorAll('[data-jersey-role]')) button.setAttribute('aria-pressed', String(button.dataset.jerseyRole === jerseyPreviewRole));
  renderColorChoices('jerseyColor', palette.main, appearanceSettings[`${jerseyPreviewRole}JerseyColor`]);
  renderColorChoices('jerseyStripe', palette.stripe, appearanceSettings[`${jerseyPreviewRole}JerseyStripe`], 'Auto');
}
function renderJerseyPreview() {
  const preview = $('jersey-preview'), rect = preview.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  preview.width = Math.max(1, Math.round(rect.width * dpr)); preview.height = Math.max(1, Math.round(rect.height * dpr));
  const context = preview.getContext('2d');context.setTransform(preview.width / 600, 0, 0, preview.height / 320, 0, 0);
  context.fillStyle='#0d2c30';context.fillRect(0,0,600,320);
  context.fillStyle='#eef6e6';context.font=`18px ${COURT_FONT}`;context.textAlign='center';
  i18n.attr(preview, 'aria-label', `${jerseyPreviewRole === 'player' ? 'Player' : 'CPU'} jersey front and back preview`);
  if (!globalThis.ShuttleAthletes?.ready) { context.fillText(tr('Loading athlete preview...'),300,160); return; }
  for (const [x, view, label] of [[175, 'front', 'Front'],[425, 'back', 'Back']]) {
    globalThis.ShuttleAthletes.drawOutfitPreview(context, {x,y:280,unit:116,yScale:1,height:0,pixelRatio:preview.width/600,
      opponent:jerseyPreviewRole === 'opponent',motion:{},time:0,jersey:athleteJersey(jerseyPreviewRole),racket:athleteRacket(jerseyPreviewRole)},view);
    context.fillText(tr(label, 'preview'),x,309);
  }
}
function selectJerseyColor(part, value) {
  const color=value === null ? null : normalizeColor(value);if(value !== null && !color || !['Color','Stripe'].includes(part))return;
  appearanceSettings[`${jerseyPreviewRole}Jersey${part}`]=color;
  saveSettings(appearanceStorageKey,appearanceSettings,'appearance-save-status');renderAppearance();
}
function renderRacketControls() {
  const profile = athleteRacket(racketPreviewRole);
  for (const button of document.querySelectorAll('[data-racket-role]')) button.setAttribute('aria-pressed', String(button.dataset.racketRole === racketPreviewRole));
  for (const [field, value] of [['style', profile.style], ['size', profile.size]]) {
    for (const button of document.querySelectorAll(`[data-racket-${field}]`)) button.setAttribute('aria-pressed', String(button.dataset[`racket${field === 'style' ? 'Style' : 'Size'}`] === value));
  }
  for (const [part, color] of [['Color', profile.frame], ['Grip', profile.grip]]) {
    renderColorChoices(`racket${part}`, color, appearanceSettings[`${racketPreviewRole}Racket${part}`]);
  }
}
function renderColorChoices(field, color, selected, defaultLabel = 'Default') {
  const output = $(`${field}-value`);
  i18n.text(output, selected === null ? defaultLabel === 'Auto' ? 'Auto color' : defaultLabel : colorPresets.find(preset => preset.color === selected)?.name ?? 'Custom color');
  output.style.setProperty('--selected-color', color);
  const group = $(`${field}-choices`); group.dataset.selectedColor = color;
  for (const button of group.querySelectorAll('[data-color]')) button.setAttribute('aria-pressed', String(button.dataset.color === (selected ?? '')));
}
function selectAppearanceColor(field, color) {
  if (['landingColor', 'aimColor'].includes(field)) selectMarkerColor(field, color);
  else if (field === 'jerseyColor') selectJerseyColor('Color', color);
  else if (field === 'jerseyStripe') selectJerseyColor('Stripe', color);
  else if (field === 'racketColor') selectRacket('Color', color);
  else if (field === 'racketGrip') selectRacket('Grip', color);
}
function renderRacketPreview() {
  const preview = $('racket-preview'), rect = preview.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  preview.width = Math.max(1, Math.round(rect.width * dpr)); preview.height = Math.max(1, Math.round(rect.height * dpr));
  const context = preview.getContext('2d'); context.setTransform(preview.width / 600, 0, 0, preview.height / 420, 0, 0);
  context.fillStyle = '#0d2c30'; context.fillRect(0, 0, 600, 420);
  i18n.attr(preview, 'aria-label', `${racketPreviewRole === 'player' ? 'Player' : 'CPU'} racket close-up preview`);
  if (globalThis.ShuttleAthletes?.ready) globalThis.ShuttleAthletes.drawRacketPreview(context, { opponent: racketPreviewRole === 'opponent', racket: athleteRacket(racketPreviewRole), pixelRatio: preview.width / 600 });
  else { context.fillStyle = '#eef6e6'; context.font = `18px ${COURT_FONT}`; context.textAlign = 'center'; context.fillText(tr('Loading racket preview...'), 300, 210); }
}
function selectRacket(part, value) {
  if (!['Style', 'Size', 'Color', 'Grip'].includes(part)) return;
  if (part === 'Style' && !Object.hasOwn(racketStyles, value) || part === 'Size' && !Object.hasOwn(racketSizes, value)) return;
  if (['Color', 'Grip'].includes(part) && value !== null) { value = normalizeColor(value); if (!value) return; }
  appearanceSettings[`${racketPreviewRole}Racket${part}`] = value;
  saveSettings(appearanceStorageKey, appearanceSettings, 'appearance-save-status'); renderAppearance();
}
function selectCourt(value) {
  if (!Object.hasOwn(COURT_STYLES, value)) return;
  appearanceSettings.court = value; courtBackdrop = null;
  saveSettings(appearanceStorageKey, appearanceSettings, 'appearance-save-status');
  renderAppearance();
}
function selectMarkerColor(key, value) {
  const color = value === null ? null : normalizeColor(value);
  if (!['landingColor', 'aimColor'].includes(key) || value !== null && !color) return;
  appearanceSettings[key] = color;
  saveSettings(appearanceStorageKey, appearanceSettings, 'appearance-save-status'); renderAppearance();
}
function openPersonalization() {
  if (currentPanel === 'personalization' && !$('overlay').classList.contains('hidden')) return;
  if (!$('help').classList.contains('hidden')) closeHelp();
  if (state === 'playing') togglePause();
  personalizationReturn = navigationOrigin();
  showPanel('personalization'); renderAppearance(); focusPanel('personalization');
}
function closePersonalization() { showPanel(personalizationReturn); focusPanel(personalizationReturn); }
function renderTutorial() {
  if (!tutorial) return;
  $('tutorial-coach').classList.toggle('hidden', state !== 'playing');
  const lesson = tutorials.lessonFor(tutorial), phase = tutorial.phase;
  const reachable = ['try', 'apex'].includes(phase) && Boolean(contactCue().grade);
  const key = `${tutorial.index}/${phase}/${touchMode}/${reachable}/${tutorial.result?.error}/${tutorial.result?.actual}`;
  if (key === tutorialUiKey) return;
  tutorialUiKey = key;
  document.body.dataset.tutorialPhase = phase;
  document.body.dataset.tutorialFocus = phase === 'try' && lesson.id === 'move' && !reachable ? 'move' : phase === 'try' && lesson.jump ? 'jump' : ['try','apex'].includes(phase) ? 'hit' : '';
  i18n.text($('tutorial-step'), `LESSON ${tutorial.index + 1} / ${tutorials.lessons.length}`);
  $('tutorial-progress-fill').style.width = `${tutorial.completed / tutorials.lessons.length * 100}%`;
  $('tutorial-progress').setAttribute('aria-valuenow', String(tutorial.completed));
  i18n.text($('tutorial-title'), lesson.title);
  const labels = {intro:'YOUR FIRST RALLY',feed:'WATCH THE SHUTTLE',explain:'TIME PAUSED',try:'SHUTTLE HELD',apex:'PAUSED AT THE TOP',flight:'WATCH YOUR RETURN',success:'LESSON COMPLETE',retry:'TRY AGAIN'};
  i18n.text($('tutorial-state'), labels[phase]);
  let description = lesson.why, controls = touchMode ? lesson.touch : lesson.keyboard;
  if (phase === 'intro') description = 'A shuttle will arrive and pause. Learn one action, then try it yourself.';
  if (phase === 'feed') { description = 'Watch its flight. We will pause before you need to hit.'; controls = 'There is no time limit while the shuttle is held.'; }
  if (phase === 'explain') description = lesson.jump ? 'This shuttle is above standing reach. Jump to meet it.' : 'The shuttle is frozen. The contact ring shows where to meet it.';
  if (phase === 'try') description = lesson.jump ? 'Jump now. We will hold you at the top so you can find the smash timing.' : reachable ? 'You are in reach. Choose your shot and strike.' : 'Move into the contact ring. The shuttle will wait for you.';
  if (phase === 'apex') { description = 'Your jump and the shuttle are paused at the top. Strike now.'; controls = touchMode ? 'Choose Attack, then tap and release the large hit button.' : 'Right click now to play your jump smash.'; }
  if (phase === 'flight') { description = 'Your shot is moving again. Watch its arc and where it lands.'; controls = 'We check the real return before advancing.'; }
  if (phase === 'success') controls = lesson.why;
  if (phase === 'retry') {
    const messages = {far:'The shuttle was outside your reach. Move closer to the contact ring.',high:'The shuttle was too high. Use Jump for the jump-smash lesson.',early:'That swing was too early.',late:'That swing was too late.',out:'The return went outside the singles lines. Aim farther inside.',net:'The return did not clear the net. Try the default power and settle your feet.',shot:`That was ${shotNames[tutorial.result.actual] ?? 'a different shot'}. Try the instructed action.`,aim:'That clear did not go left. Move your aim farther to the left.'};
    description = messages[tutorial.result?.error] ?? 'Try this shot again at your own pace.';
  }
  if ($('tutorial-description').textContent !== description) i18n.text($('tutorial-description'), description);
  if ($('tutorial-controls').textContent !== controls) i18n.text($('tutorial-controls'), controls);
  const action = {intro:'Send shuttle',explain:'Try it',success:tutorial.completed === tutorials.lessons.length?'Finish tutorial':'Next lesson',retry:'Retry shot'}[phase];
  $('tutorial-action').classList.toggle('hidden', !action);
  if (action) i18n.text($('tutorial-action'), action);
}
function prepareTutorialLesson(atContact = false) {
  const lesson = tutorials.lessonFor(tutorial);
  delivery = tutorials.makeFeed(tutorial); tutorial.freezeAt = tutorials.freezeAge(tutorial, delivery);
  const point = incomingPosition({...delivery, age:tutorial.freezeAt + SWING.impact});
  player = {...createPlayer(), x:lesson.id === 'move' ? .38 : point.x - .04, y:lesson.id === 'move' ? .82 : point.y + .025};
  tutorial.phase = atContact ? 'explain' : 'intro'; tutorial.result = null; tutorialUiKey = '';
  delivery.age = atContact ? tutorial.freezeAt : 0;
  swing = opponentSwing = impact = landing = null; cooldown = 0; trail = []; particles = [];
  keys.clear(); touchControls.reset(); touchControls.setServing(false); touchControls.select('clear');
  for (const pose of [motion,opponentMotion]) for (const key of Object.keys(pose)) pose[key] = 0;
  setAim(.5); setPower(null); previewShot = 'clear';
  $('feedback').classList.remove('visible'); $('touch-power-options').hidden = true; $('touch-power-toggle').setAttribute('aria-expanded','false');
  updateShotOptions(); renderTutorial(); $('tutorial-action').focus({preventScroll:true});
}
function completeTutorialAttempt(outcome) {
  if (!tutorial || !tutorials.recordOutcome(tutorial, outcome)) return;
  keys.clear(); touchControls.reset(); tutorialUiKey = '';
  player.vx = player.vy = 0; renderTutorial(); $('tutorial-action').focus({preventScroll:true});
}
function tutorialAction() {
  if (!tutorial || state !== 'playing') return;
  if (tutorial.phase === 'intro') { keys.clear(); touchControls.reset(); tutorial.phase = 'feed'; }
  else if (tutorial.phase === 'explain') { keys.clear(); touchControls.reset(); tutorial.phase = 'try'; canvas.focus(); }
  else if (tutorial.phase === 'retry') prepareTutorialLesson(true);
  else if (tutorial.phase === 'success') {
    if (tutorials.nextLesson(tutorial)) prepareTutorialLesson(); else finish();
  }
  renderTutorial();
}
function updateTutorial(dt) {
  const lesson = tutorials.lessonFor(tutorial);
  if (tutorial.phase === 'feed') {
    delivery.age = Math.min(tutorial.freezeAt, delivery.age + dt);
    if (delivery.age >= tutorial.freezeAt) { tutorial.phase = 'explain'; keys.clear(); touchControls.reset(); renderTutorial(); $('tutorial-action').focus({preventScroll:true}); }
  } else if (['try','flight'].includes(tutorial.phase)) {
    elapsed += dt; cooldown = Math.max(0,cooldown-dt);
    const {dx,dy} = movementInput();
    let actorDt = dt;
    const apex = lesson.jump && tutorial.phase === 'try' && player.verticalVelocity > 0 && player.verticalVelocity <= globalThis.ShuttleCore.JUMP.gravity * dt;
    if (apex) actorDt = player.verticalVelocity / globalThis.ShuttleCore.JUMP.gravity;
    if (updateJump(player,actorDt)) { landing = {x:player.x,y:player.y,age:0}; sound('land'); }
    movePlayer(player,dx,dy,actorDt);
    const run = clamp(Math.hypot(player.vx,player.vy)/RULES.speed,0,1);
    motion.run += (run-motion.run)*Math.min(1,actorDt*12); motion.gait += actorDt*(7+11*motion.run);
    motion.lean += (player.vx/RULES.speed*6-motion.lean)*Math.min(1,actorDt*6);
    motion.pitch += (player.vy/RULES.speed*3-motion.pitch)*Math.min(1,actorDt*9);
    updatePose(player,motion,swing,delivery?.phase === 'incoming'?incomingPosition(delivery):null,actorDt);
    if (apex) { player.verticalVelocity = 0; tutorial.phase = 'apex'; keys.clear(); touchControls.reset(); }
    if (tutorial.phase === 'flight') {
      delivery.age += dt;
      if (swing) { swing.age += dt; if (!swing.contacted && swing.age >= SWING.impact) resolveHit(); if (swing?.age >= SWING.duration) swing = null; }
      if (tutorial.phase === 'flight' && delivery.phase === 'return') {
        if (delivery.fault && delivery.age >= delivery.fault.age) completeTutorialAttempt({fault:delivery.fault});
        else if (delivery.age >= delivery.returnDuration + .12) completeTutorialAttempt({shotType:delivery.shotType,point:returnPosition(delivery)});
      }
    }
    if (impact) { impact.age += dt; if (impact.age>.2) impact=null; }
    if (landing) { landing.age += dt; if (landing.age>.24) landing=null; }
    for (const p of particles) {p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=180*dt;p.life-=dt;} particles=particles.filter(p=>p.life>0);
  }
  $('touch-jump').classList.toggle('recommended', tutorial.phase === 'try' && Boolean(lesson.jump));
  updateShotOptions(); updatePowerStatus(); renderTutorial();
}
function drawTutorialTarget() {
  if (!tutorial || !['explain','try','apex'].includes(tutorial.phase) || delivery?.phase !== 'incoming') return;
  const point=incomingPosition({...delivery,age:delivery.age+SWING.impact}), target=project(point.x-.04,point.y+.025), actor=project(player.x,player.y);
  ctx.save();
  drawGuideRing(target.x,target.y,24*target.scale,10*target.scale,'#d8f14e35','#D8F14E','#14301F',2);
  if (Math.hypot(player.x-(point.x-.04),player.y-(point.y+.025))>.13) {
    ctx.setLineDash([6,6]); line(actor,target,'#14301f99',2); ctx.setLineDash([]);
  }
  ctx.restore();
}
// Suggest landscape once per session, before the game clock starts. Desktop
// starts directly; players can explicitly keep portrait without losing setup.
let phoneHintSeen = false, pendingPhoneStart = null, phoneStartReturn = 'welcome';
const isPhoneInput = () => Boolean(window.matchMedia?.('(pointer: coarse)').matches) && Math.min(window.innerWidth, window.innerHeight) <= 600;
const phoneLandscape = () => window.innerWidth > window.innerHeight;
let lastPhoneLandscape = phoneLandscape();
function renderPhoneReady() {
  const sideways = phoneLandscape();
  i18n.text($('phone-ready-title'), sideways ? 'Ready for the court' : 'Turn for a wider court');
  i18n.text($('phone-ready-description'), sideways ? 'Your thumbs have their own space beside the court. Start when you are ready.' : 'Hold your phone sideways for more room to move and aim. Your thumbs stay beside the court.');
  i18n.text($('phone-ready-play').firstChild, sideways ? 'Play in landscape ' : 'Continue in portrait ');
  $('phone-ready').classList.toggle('landscape-ready', sideways);
}
function requestGameStart(tutorialStart = false) {
  if (!phoneHintSeen && isPhoneInput() && !phoneLandscape()) {
    pendingPhoneStart = tutorialStart; phoneStartReturn = currentPanel;
    showPanel('phone-ready'); renderPhoneReady(); focusPanel('phone-ready'); return;
  }
  phoneHintSeen = true; startGame(tutorialStart);
}
function cancelPhoneStart() {
  pendingPhoneStart = null; showPanel(phoneStartReturn); focusPanel(phoneStartReturn);
}
$('phone-ready-play').onclick = () => {
  if (pendingPhoneStart === null) return;
  const lesson = pendingPhoneStart; pendingPhoneStart = null; phoneHintSeen = true; startGame(lesson);
};
$('phone-ready-back').onclick = cancelPhoneStart;
window.addEventListener('resize', () => {
  const sideways = phoneLandscape(), rotated = sideways !== lastPhoneLandscape;
  lastPhoneLandscape = sideways;
  if (pendingPhoneStart !== null) renderPhoneReady();
  if (rotated && isPhoneInput() && state === 'playing') togglePause();
});
$('tutorial-entry').onclick = () => requestGameStart(true);
$('tutorial-action').onclick = tutorialAction;
$('tutorial-exit').onclick = () => leaveResults();
function startGame(tutorialStart = false) {
  lastPhoneLandscape = phoneLandscape();
  if (tutorialStart) touchMode = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  mode = tutorialStart ? 'tutorial' : selectedMode; tutorial = tutorialStart ? tutorials.createSession() : null;
  document.body.classList.toggle('tutorial-mode', tutorialStart);
  $('tutorial-coach').classList.add('hidden');
  match = mode === 'match' ? createMatch(selectedPoints) : null; aiLevel = selectedAiLevel; aiStyle = selectedAiStyle;
  training = mode === 'drill' ? createTrainingSession(selectedTraining, selectedTrainingSpeed, selectedTrainingLimit) : null;
  challenge = mode === 'practice' && selectedPractice === 'target' ? targets.createSession(selectedTargetKind, selectedTargetLimit) : null;
  challengeZone = challenge ? targets.targetFor(challenge) : null;
  opponent = createOpponent(aiLevel, aiStyle); opponentSwing = null; roundBreak = rallyHits = longestRally = 0;
  for (const key of Object.keys(opponentMotion)) opponentMotion[key] = 0;
  enableAudio().then(() => { if (state === 'playing') sound('start'); }); keys.clear(); touchControls.reset(); state = 'playing'; player = createPlayer(); delivery = null; landing = impact = swing = null; trail = [];
  score = combo = maxCombo = returns = perfects = smashes = taps = lifts = blocks = drives = 0;
  practiceMisses = practiceOuts = practiceNets = 0; cooldown = elapsed = feedbackTime = 0; particles = []; nextFeed = 1;
  for (const key of Object.keys(motion)) motion[key] = 0;
  setFocusView(true);
  setAim(.5); touchControls.setServing(false); touchControls.select('clear'); previewShot = 'clear'; setPower(null);
  $('touch-power-options').hidden = true; $('touch-power-toggle').setAttribute('aria-expanded', 'false');
  updateShotOptions();
  i18n.text($('action-status'), 'Get ready'); $('action-status').className = 'action-status';
  previousBest = best; $('feedback').classList.remove('visible'); $('overlay').classList.add('hidden');
  if (mode === 'match') prepareService(1);
  if (tutorial) prepareTutorialLesson();
  i18n.text($('pause'), 'Ⅱ'); i18n.attr($('pause'), 'aria-label', 'Pause game'); updateHud(); canvas.focus();
  if (tutorial) $('tutorial-action').focus({preventScroll:true});
}
function togglePause() {
  if (!$('settings').classList.contains('hidden') || !$('help').classList.contains('hidden') || !$('personalization').classList.contains('hidden')) return;
  if (lanActive) { toggleLanPause(); return; }
  if (state === 'playing') { state = 'paused'; keys.clear(); touchControls.reset(); previewShot = 'clear'; showPanel('paused'); i18n.text($('pause'), '▶'); i18n.attr($('pause'), 'aria-label', 'Resume game'); }
  else if (state === 'paused') { state = 'playing'; $('overlay').classList.add('hidden'); i18n.text($('pause'), 'Ⅱ'); i18n.attr($('pause'), 'aria-label', 'Pause game'); enableAudio(); }
  if (tutorial) renderTutorial();
}
function toggleSound() {
  muted = !muted; saveAudioSettings(); if (!muted) enableAudio().then(() => sound('hit'));
}
function finish() {
  if (lanActive) { finishLan(); return; }
  state = 'over'; keys.clear(); touchControls.reset();
  i18n.html($('restart'), `${mode === 'match' ? 'Play Again' : 'Practice Again'} <span>↗</span>`);
  $('result-training').classList.toggle('hidden', mode !== 'drill'); updateHud();
  if (tutorial) {
    $('tutorial-coach').classList.add('hidden');
    const complete = tutorial.completed === tutorials.lessons.length;
    i18n.text($('result-kicker'), complete ? 'READY TO RALLY' : 'ON-COURT TUTORIAL');
    i18n.text($('result-title'), complete ? 'Your first shots, learned.' : 'Continue at your own pace.');
    i18n.text($('final-score'), `${tutorial.completed} / ${tutorials.lessons.length}`);
    i18n.text($('result-details'), complete ? 'Move · Aim · Clear · Drop · Standing smash\nLift · Block · Drive · Jump smash\nTry Feed Practice next to build your timing.' : `${tutorial.completed} lessons completed. Replay whenever you like.`);
    i18n.html($('restart'), 'Replay Tutorial <span>↗</span>');
    if (complete) { tutorialCompleted = true; try { localStorage.setItem('shuttle-flow-tutorial', JSON.stringify({version:1,completed:true})); } catch {} }
    showPanel('results'); $('restart').focus(); return;
  }
  if (challenge) {
    i18n.text($('result-kicker'), 'LANDING CHALLENGE'); i18n.text($('result-title'), 'Target challenge complete');
    i18n.text($('final-score'), challenge.score);
    const accuracy = challenge.completed ? Math.round(challenge.hits / challenge.completed * 100) : 0;
    i18n.text($('result-details'), `${targets.kinds[challenge.kind]} · ${challenge.completed} feeds · Hit rate ${accuracy}%\nHits ${challenge.hits} · Centers ${challenge.centers} · Best streak ${challenge.bestStreak}\nOff target ${challenge.errors.target} · Misses ${challenge.errors.miss} · Out ${challenge.errors.out} · Net ${challenge.errors.net}\n${targets.advice(challenge)}`);
    showPanel('results'); $('restart').focus(); return;
  }
  if (mode === 'drill') {
    i18n.text($('result-kicker'), 'TRAINING COMPLETE'); i18n.text($('result-title'), `${TRAINING[training.kind]} complete`);
    i18n.text($('final-score'), `${training.completed ? Math.round(training.succeeded / training.completed * 100) : 0}%`);
    i18n.text($('result-details'), `${trainingSpeedNames[training.speed]} · Goals ${training.succeeded} / ${training.completed}\nLegal returns ${training.legalReturns} · Best streak ${training.bestStreak}`);
    $('training-errors').replaceChildren(...Object.entries(TRAINING_ERRORS).map(([key, label]) => {
      const cell = document.createElement('div'), name = document.createElement('span'), count = document.createElement('b');
      i18n.text(name, label); i18n.text(count, training.errors[key]); cell.append(name, count); return cell;
    }));
    i18n.text($('training-advice'), trainingAdvice(training));
    showPanel('results'); $('restart').focus(); return;
  }
  if (mode === 'match') {
    i18n.text($('result-kicker'), match.winner === 'player' ? 'YOU WIN' : 'MATCH COMPLETE');
    i18n.text($('result-title'), match.winner === 'player' ? 'You won. Well played!' : 'A new match, a fresh start.');
    i18n.text($('final-score'), `${match.player} : ${match.computer}`);
    i18n.text($('result-details'), `${match.target} points · ${aiLevelNames[aiLevel]} · ${AI_STYLES[aiStyle].name} CPU\nWin by 2 at deuce (cap ${match.cap}) · Longest rally ${longestRally}\nStanding smashes ${taps} · Jump smashes ${smashes}\nLifts ${lifts} · Blocks ${blocks} · Drives ${drives} · Returns ${returns}`);
    showPanel('results'); $('restart').focus(); return;
  }
  if (score > best) { best = score; try { localStorage.setItem('shuttle-club-best', String(best)); } catch {} }
  i18n.text($('best'), best); i18n.text($('final-score'), score);
  i18n.text($('result-kicker'), score > previousBest ? 'NEW PERSONAL BEST' : 'NICE SESSION');
  i18n.text($('result-title'), 'Practice complete');
  const completed = returns + practiceMisses + practiceOuts + practiceNets;
  const accuracy = completed ? Math.round(returns / completed * 100) : 0;
  i18n.text($('result-details'), `Practice ${sessionTime()} · ${completed} feeds · Return rate ${accuracy}%\nReturns ${returns} · Misses ${practiceMisses} · Out ${practiceOuts} · Net ${practiceNets}\nBest combo ${maxCombo} · Perfect ${perfects}\nStanding smashes ${taps} · Jump smashes ${smashes}\nLifts ${lifts} · Blocks ${blocks} · Drives ${drives}`);
  showPanel('results'); $('restart').focus();
}
function burst(point, color, count = 18, scatter = 100) {
  for (let i = 0; i < count; i++) { const angle = Math.random() * Math.PI * 2, speed = 45 + Math.random() * scatter; particles.push({ x: point.x, y: point.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: .6, color }); }
}
function hit(requested = 'clear') {
  if (lanActive) { hitLan(requested); return; }
  if (state !== 'playing' || roundBreak > 0) return;
  if (tutorial && !['try', 'apex'].includes(tutorial.phase)) return;
  if (cooldown > 0) { feedback('Recovering', 'Let the racket recover before swinging again.'); return; }
  if (mode === 'match' && delivery?.phase === 'serve') {
    if (match.server !== 'player') return;
    if (!inServiceCourt(player, serviceSetup(match).serverCourt, true) || player.height > 0 || player.verticalVelocity > 0 || Math.hypot(player.vx, player.vy) > .04 || movementKeys.some(code => keys.has(code)) || Math.hypot(touchControls.movement().dx, touchControls.movement().dy) > 0) {
      feedback('Stop moving to serve', touchMode ? 'Stand in the highlighted service court and release the joystick.' : 'Stand in the highlighted service court and release movement keys.'); return;
    }
  }
  if (mode === 'match' && delivery?.phase === 'serve') { player.vx = player.vy = player.pivot = 0; }
  if (tutorial) tutorial.phase = 'flight';
  enableAudio(); cooldown = RULES.cooldown;
  previewShot = requested;
  const serving = mode === 'match' && delivery?.phase === 'serve';
  if (serving) requested = requested === 'clear' ? 'clear' : 'smash';
  const service = serving ? planService(match, { x: player.x + .02, y: player.y, z: 50 }, requested, aimX) : null;
  const power = serving ? service.power : selectedPower ?? defaultPowerFor(requested, powerDefaults);
  const prediction = contactPrediction();
  const contact = prediction?.point ?? null;
  const shot = serving ? service : shotFor(prediction?.player ?? player, contact, requested, power, prediction?.ball ?? delivery);
  swing = { age: 0, type: shot.type, backhand: shot.backhand, overhead: shot.overhead || (shot.type === 'clear' && contact?.z >= 75), serving, requested, power, aimX, contacted: false, contactScreen: null };
  if (contact) {
    const ground = project(contact.x, contact.y);
    swing.predictedScreen = { x: ground.x, y: ground.y - contact.z * figureYScale,
      groundY: ground.y, flightHeight: contact.z };
  }
}
function resolveHit() {
  swing.contacted = true;
  const serving = mode === 'match' && delivery?.phase === 'serve';
  if (serving && (match.server !== 'player' || !inServiceCourt(player, serviceSetup(match).serverCourt, true) || player.height > 0)) {
    feedback('Outside the service court', 'Return to the highlighted service court.'); return;
  }
  const grade = serving ? 'good' : judgeHit(player, delivery);
  if (grade) {
    const timeError = serving ? 0 : contactTimingError(player, delivery);
    if (mode === 'match') { rallyHits++; longestRally = Math.max(longestRally, rallyHits); }
    const contact = serving ? { x: player.x + .02, y: player.y, z: 50 } : incomingPosition(delivery);
    const shot = serving ? planService(match, contact, swing.requested, swing.aimX) : planReturn(player, contact, swing.requested, swing.power, swing.aimX, timeError, delivery);
    if (mode === 'drill') recordDrill({ shotType: shot.type, fault: shot.fault, age: delivery.age, duration: delivery.duration });
    const smash = shot.type === 'smash';
    if (smash) smashes++;
    const tap = shot.type === 'tap'; if (tap) taps++;
    if (shot.type === 'lift') lifts++;
    if (shot.type === 'block') blocks++;
    if (shot.type === 'drive') drives++;
    if (!serving && !shot.fault) { combo++; returns++; maxCombo = Math.max(combo, maxCombo); if (grade === 'perfect') perfects++; }
    const points = shot.fault ? 0 : pointsFor(grade, combo) + shot.bonus; if (mode === 'practice' && !challenge) score += points; swing.type = shot.type; swing.backhand = shot.backhand; swing.overhead = shot.overhead || (shot.type === 'clear' && contact.z >= 75);
    delivery.phase = 'return'; delivery.age = 0; delivery.returnFrom = { x: contact.x, y: contact.y }; delivery.returnHeight = contact.z; delivery.returnDuration = shot.duration; delivery.returnArc = shot.arc;
    delivery.returnEndHeight = shot.endHeight;
    delivery.returnTarget = shot.target;
    if (serving) delivery.serviceKind = shot.serviceKind;
    delivery.fault = serving ? returnFault(delivery) : shot.fault;
    delivery.power = swing.power;
    swing.aimX = delivery.returnTarget.x;
    delivery.shotType = shot.type;
    delivery.backhand = shot.backhand;
    if (mode === 'match') { opponent.reaction = opponent.skill.reaction; opponent.intent = 'chase'; opponent.chaseDistance = 0; }
    const ground = project(contact.x, contact.y), point = { x: ground.x, y: ground.y - contact.z * figureYScale, groundY: ground.y, flightHeight: contact.z };
    const feel = killEffect(shot.type, shot.power);
    swing.contactScreen = point; impact = { ...point, age: 0, smash: smash || tap, shotType: shot.type, power: shot.power }; trail = [];
    burst(point, shotColors[shot.type] ?? '#ddfc91', feel?.particles ?? 18, feel?.scatter ?? 100);
    const description = `${serving ? shot.serviceKind === 'short' ? 'Short serve' : 'Long serve' : `${shot.backhand ? 'Backhand ' : ''}${shotNames[shot.type]}`} · ${laneName(swing.aimX)} · ${powerNames[swing.power]}${shot.fallback ? shot.fallbackReason === 'backhand' ? ' (backhand smash unavailable)' : ' (outside jump-smash timing)' : ''}`;
    if (!challenge) feedback(serving ? ' serve' : shot.backhand ? `Backhand ${shotNames[shot.type]}` : ['lift', 'block', 'drive'].includes(shot.type) ? shotNames[shot.type] : smash ? 'JUMP SMASH' : tap ? 'Standing smash' : shot.type === 'drop' ? 'DROP SHOT' : grade === 'perfect' ? 'PERFECT' : 'GOOD', `${description} / ${shot.fault ? shot.fault.type === 'out' ? 'Too long!' : 'Too low!' : mode === 'match' ? `${rallyHits} shots` : `+${points}${smash ? ' · jump smash +50' : ''}${combo > 1 ? ` / ${combo} Combo` : ''}`}`, false, serving ? 'notice' : 'hit');
    $('feedback').classList.toggle('smash', smash || tap); sound(smash ? 'smash' : tap ? 'tap' : ['drop', 'block'].includes(shot.type) ? 'drop' : shot.overhead ? 'air' : grade === 'perfect' ? 'perfect' : 'hit', shot.power); updateHud();
  } else {
    sound('swing');
    const result = assessHit(player, delivery);
    if (mode === 'drill' && delivery?.phase === 'incoming') delivery.lastHitFailure = result.reason;
    const [title, detail] = hitReasons[result.reason] ?? hitReasons['no-ball'];
    feedback(title, detail, true);
    if (tutorial) completeTutorialAttempt({reason:result.reason});
  }
}
function jump() {
  if (lanActive) {
    if (state !== 'playing' || roundBreak > 0 || delivery?.phase === 'serve' || lanFailed) return;
    if (startJump(player)) { lanClient.action('jump'); enableAudio(); sound('jump'); }
    return;
  }
  if (state !== 'playing' || roundBreak > 0) return;
  if (tutorial && (tutorial.phase !== 'try' || !tutorials.lessonFor(tutorial).jump)) return;
  if (mode === 'match' && delivery?.phase === 'serve') { feedback('Stay grounded to serve', 'Move and jump freely after the serve.'); return; }
  if (!startJump(player)) return;
  enableAudio(); sound('jump');
}
$('start').onclick = () => requestGameStart(); $('restart').onclick = () => { if (lanActive) { showPanel('lan-panel'); lanClient.ready(true, ownLanLook()); renderLanRoom(); } else requestGameStart(mode === 'tutorial'); }; $('resume').onclick = togglePause; $('pause').onclick = togglePause; $('sound').onclick = toggleSound;
$('help-open').onclick = openHelp; $('help-close').onclick = closeHelp; $('fullscreen').onclick = toggleFullscreen;
$('settings-sound').onclick = () => { muted = !muted; saveAudioSettings(); };
$('reset-audio').onclick = () => { volume = 100; muted = false; saveAudioSettings(); };
$('reset-power').onclick = () => { Object.assign(powerDefaults, POWER.defaults); savePowerDefaults(); };
$('volume').oninput = () => setVolume(Number($('volume').value));
$('volume-preview').onclick = () => enableAudio().then(async () => { await recordingLoad; sound('hit'); });
$('setup-back').onclick = backToCover;
document.addEventListener('fullscreenchange', () => { i18n.attr($('fullscreen'), 'aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); });
for (const button of document.querySelectorAll('[data-open-settings]')) button.onclick = openSettings;
for (const button of document.querySelectorAll('[data-open-personalization]')) button.onclick = openPersonalization;
$('personalization-close').onclick = closePersonalization;
$('settings-close').onclick = closeSettings;
for (const button of document.querySelectorAll('[data-guidance]')) button.onclick = () => {
  guidanceMode = normalizeGuidance(button.dataset.guidance);
  renderGuidanceSettings(); saveSettings(guidanceStorageKey, { mode: guidanceMode });
  if (!feedbackVisible(guidanceMode, $('feedback').dataset.kind)) { $('feedback').classList.remove('visible'); feedbackTime = 0; }
};
for (const button of document.querySelectorAll('[data-default-shot]')) button.onclick = () => {
  powerDefaults[button.dataset.defaultShot] = Number(button.dataset.defaultPower);
  savePowerDefaults();
};
function updateSetupSummary() {
  i18n.text($('setup-summary'), selectedMode === 'match'
    ? `${selectedPoints} pts · ${aiLevelNames[selectedAiLevel]} · ${AI_STYLES[selectedAiStyle].name}`
    : selectedMode === 'drill' ? `${TRAINING[selectedTraining]} · ${trainingSpeedNames[selectedTrainingSpeed]} · ${selectedTrainingLimit ? selectedTrainingLimit + ' feeds' : 'Unlimited'}`
    : selectedPractice === 'target' ? `Target Challenge · ${targets.kinds[selectedTargetKind]} · ${selectedTargetLimit ? selectedTargetLimit + ' feeds' : 'Unlimited'}`
    : 'Feed Practice · Unlimited');
}
function chooseMode(value) {
  selectedMode = value;
  $('mode-setup').dataset.mode = value;
  i18n.text($('setup-title'), { practice: 'Practice', match: 'Match Mode', drill: 'Training' }[value]);
  i18n.text($('setup-kicker'), { practice: 'FIND YOUR RHYTHM', match: 'CHOOSE YOUR OPPONENT', drill: 'ONE SHOT AT A TIME' }[value]);
  $('practice-options').classList.toggle('hidden', value !== 'practice');
  $('feed-overview').classList.toggle('hidden', selectedPractice !== 'feed');
  $('target-options').classList.toggle('hidden', selectedPractice !== 'target');
  for (const button of document.querySelectorAll('[data-practice]')) {
    const selected = button.dataset.practice === selectedPractice;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  $('match-options').classList.toggle('hidden', value !== 'match');
  $('lan-open').classList.toggle('hidden', value !== 'match');
  $('drill-options').classList.toggle('hidden', value !== 'drill');
  i18n.text($('ai-style-note'), AI_STYLES[selectedAiStyle].description);
  i18n.text($('ai-level-note'), aiLevelDescriptions[selectedAiLevel]);
  i18n.html($('mode-description'), value === 'match' ? 'Choose an opponent and play a full match.' : 'Practice footwork, strokes, and jump smashes with CPU feeds.<br>Unlimited feeds, a rising pace, and a session summary.');
  i18n.html($('start'), `${value === 'match' ? 'Start Match' : 'Start Practice'} <span aria-hidden="true">↗</span>`);
  if (value === 'drill') { i18n.text($('mode-description'), trainingGoal(selectedTraining)); i18n.html($('start'), 'Start Training <span aria-hidden="true">↗</span>'); }
  if (value === 'practice' && selectedPractice === 'target') {
    i18n.text($('mode-description'), 'Aim for the target. Use shot type and power to control depth.');
    i18n.html($('start'), 'Start Challenge <span aria-hidden="true">↗</span>');
  }
  updateSetupSummary();
}
function openModeSetup(value) { chooseMode(value); showPanel('mode-setup'); $('setup-back').focus({ preventScroll: true }); }
$('choose-practice').onclick = () => openModeSetup('practice'); $('choose-match').onclick = () => openModeSetup('match');
$('choose-drill').onclick = () => openModeSetup('drill');
for (const button of document.querySelectorAll('[data-practice]')) button.onclick = () => { selectedPractice = button.dataset.practice; chooseMode('practice'); };
for (const attribute of ['target-kind', 'target-limit']) for (const button of document.querySelectorAll(`[data-${attribute}]`)) button.onclick = () => {
  if (attribute === 'target-kind') selectedTargetKind = button.dataset.targetKind;
  else selectedTargetLimit = Number(button.dataset.targetLimit);
  for (const option of document.querySelectorAll(`[data-${attribute}]`)) { option.classList.toggle('selected', option === button); option.setAttribute('aria-pressed', String(option === button)); }
  chooseMode('practice');
};
for (const attribute of ['training', 'training-speed', 'training-limit']) for (const button of document.querySelectorAll(`[data-${attribute}]`)) button.onclick = () => {
  if (attribute === 'training') selectedTraining = button.dataset.training;
  else if (attribute === 'training-speed') selectedTrainingSpeed = button.dataset.trainingSpeed;
  else selectedTrainingLimit = Number(button.dataset.trainingLimit);
  for (const option of document.querySelectorAll(`[data-${attribute}]`)) { option.classList.toggle('selected', option === button); option.setAttribute('aria-pressed', String(option === button)); }
  chooseMode('drill');
};
$('drill-end').onclick = () => { if (mode !== 'match' && ['playing', 'paused'].includes(state)) finish(); };
for (const button of document.querySelectorAll('[data-points]')) button.onclick = () => { selectedPoints = Number(button.dataset.points); for (const option of document.querySelectorAll('[data-points]')) { option.classList.toggle('selected', option === button); option.setAttribute('aria-pressed', String(option === button)); } updateSetupSummary(); };
for (const button of document.querySelectorAll('[data-ai-level]')) button.onclick = () => { selectedAiLevel = button.dataset.aiLevel; for (const option of document.querySelectorAll('[data-ai-level]')) { option.classList.toggle('selected', option === button); option.setAttribute('aria-pressed', String(option === button)); } if (selectedMode === 'match') chooseMode('match'); };
for (const button of document.querySelectorAll('[data-ai-style]')) button.onclick = () => {
  selectedAiStyle = button.dataset.aiStyle;
  for (const option of document.querySelectorAll('[data-ai-style]')) { option.classList.toggle('selected', option === button); option.setAttribute('aria-pressed', String(option === button)); }
  i18n.text($('ai-style-note'), AI_STYLES[selectedAiStyle].description);
  updateSetupSummary();
};
function returnToMenu() { state = 'ready'; tutorial = null; tutorialUiKey = ''; document.body.classList.remove('tutorial-mode'); $('tutorial-coach').classList.add('hidden'); setFocusView(false); keys.clear(); touchControls.reset(); delivery = null; swing = opponentSwing = impact = landing = null; roundBreak = 0; player = createPlayer(); opponent = createOpponent(selectedAiLevel, selectedAiStyle); trail = []; particles = []; for (const m of [motion, opponentMotion]) for (const key of Object.keys(m)) m[key] = 0; setPower(null); $('feedback').classList.remove('visible'); i18n.text($('pause'), 'Ⅱ'); showPanel('welcome'); chooseMode(selectedMode); i18n.attr($('tutorial-entry'), 'aria-label', tutorialCompleted ? 'Replay the on-court beginner tutorial' : 'Start the on-court beginner tutorial'); }
function leaveResults() { if (lanActive || lanClient?.connected || lanHosting) closeLan(); challenge = challengeZone = null; returnToMenu(); $('drill-end').classList.add('hidden'); $('ai-status').classList.add('hidden'); $('touch-jump').classList.remove('recommended'); }
$('result-menu').onclick = leaveResults;
$('pause-menu').onclick = () => { if (mode !== 'match' && mode !== 'tutorial' && state === 'paused') finish(); else leaveResults(); };
function recordDrill(outcome) {
  if (delivery.trainingRecorded) return;
  delivery.trainingRecorded = true;
  const result = recordTrainingOutcome(training, outcome);
  if (result) delivery.trainingResult = result;
  updateHud();
}
function recordChallenge(outcome) {
  if (!challenge || delivery.challengeRecorded) return;
  delivery.challengeRecorded = true;
  const result = targets.recordOutcome(challenge, delivery.challengeTarget, outcome);
  if (!result) return;
  delivery.challengeResult = result;
  const title = result.success ? result.center ? 'Center hit +150' : 'Target hit +100'
    : { miss: 'Miss', target: 'Off target', out: 'Out', net: 'Net' }[result.error];
  feedback(title, result.success && challenge.streak > 1 ? `${challenge.streak} consecutive hits` : '', !result.success);
  if (result.success) sound(result.center ? 'perfect' : 'hit');
  updateHud();
}
function completeChallengeFlight() {
  delivery = null; trail = []; nextFeed = .85;
  if (challenge.limit && challenge.completed >= challenge.limit) finish();
}
function feedTraining() {
  delivery = makeTrainingDelivery(training); player = { ...createPlayer(), ...delivery.start };
  keys.clear(); touchControls.reset(); swing = landing = impact = null; cooldown = 0; trail = [];
  for (const key of Object.keys(motion)) motion[key] = 0;
  resetPowerForIncoming();
  feedback(`${TRAINING[training.kind]} · Feed ${training.completed + 1}`, trainingGoal(training.kind), false, 'feed');
}
function completeDrillFlight() {
  const result = delivery?.trainingResult;
  delivery = null; trail = []; nextFeed = .8;
  if (training.limit && training.completed >= training.limit) { finish(); return; }
  feedback(result?.success ? 'Goal met' : 'Try that drill again', result?.success ? `Streak: ${training.streak}` : trainingAdvice(training), !result?.success);
}
function endRally(winner, reason = '', faultPoint = null) {
  if (roundBreak > 0 || !awardPoint(match, winner)) return;
  const point = faultPoint || (delivery?.phase === 'return' ? returnPosition(delivery) : delivery?.phase === 'incoming' ? incomingPosition(delivery) : { x: .5, y: .65, z: 0 });
  delivery = { phase: 'point', age: 0, pointPosition: point }; roundBreak = 1.7; swing = null; cooldown = 0; combo = 0; trail = []; keys.clear(); touchControls.reset();
  feedback(reason ? `${reason} · CPU scores +1` : winner === 'player' ? 'You score +1' : 'CPU scores +1', match.winner ? 'Match complete' : `${match.player} : ${match.computer} · ${winner === 'player' ? 'Your' : 'CPU'} serve`, winner !== 'player');
  i18n.text($('action-status'), match.winner ? 'Match complete' : 'Next rally'); $('action-status').className = 'action-status';
  feedbackTime = 1.7; sound(winner === 'player' ? 'perfect' : 'miss'); updateHud();
}
function practiceFault(fault) {
  if (challenge) { recordChallenge({ fault }); delivery.phase = 'miss'; delivery.age = 0; trail = []; combo = 0; sound('miss'); return; }
  delivery = { phase: 'miss', age: 0, target: fault.point, from: delivery?.from, trainingResult: delivery?.trainingResult }; trail = []; combo = 0;
  if (mode === 'drill') { feedback(fault.type === 'out' ? 'Out' : 'Net', 'Repeat the same target on the next feed.', true); sound('miss'); updateHud(); return; }
  if (fault.type === 'out') practiceOuts++; else practiceNets++;
  feedback(fault.type === 'out' ? 'Out' : 'Net', 'Reset and get ready for the next shuttle.', true);
  sound('miss'); updateHud();
}
function resetRally() {
  player = createPlayer(); opponent = createOpponent(aiLevel, aiStyle); opponentSwing = swing = landing = impact = null;
  delivery = null; rallyHits = 0; nextFeed = .6;
  for (const m of [motion, opponentMotion]) for (const key of Object.keys(m)) m[key] = 0;
  prepareService(.9); updateHud();
}
function prepareService(delay) {
  const setup = serviceSetup(match), own = setup.playerCourt, far = setup.computerCourt;
  player.x = (own.minX + own.maxX) / 2; player.y = .58; player.height = player.verticalVelocity = player.jumpRecovery = player.vx = player.vy = player.pivot = 0;
  opponent.x = (far.minX + far.maxX) / 2; opponent.y = -.58; opponent.vx = opponent.vy = opponent.pivot = opponent.height = opponent.verticalVelocity = opponent.jumpRecovery = 0;
  opponent.reaction = opponent.strokeRecovery = opponent.pressure = opponent.chaseDistance = 0;
  opponent.lastShotType = opponent.lastPlayerY = undefined;
  delivery = { phase: 'serve', age: 0, delay }; serviceStill = 0; setPower(null);
  keys.clear(); touchControls.reset(); cooldown = 0; swing = opponentSwing = null; previewShot = 'clear';
  i18n.text($('action-status'), match.server === 'player' ? 'Your serve · Left: long / Right: short' : 'Ready to receive · Stop moving');
  feedback(match.server === 'player' ? 'Your serve' : 'Ready to receive', `${match.server === 'player' ? 'You' : 'CPU'}: ${match[match.server]} pts · ${setup.right ? 'Right' : 'Left'} service court · ${match.server === 'player' ? 'Stop moving. Left: long / Right: short' : 'Stop moving for the CPU serve'}`);
}
function computerServe() {
  const p = project(opponent.x, opponent.y), point = { x: p.x, y: p.y - 50 * figureYScale, groundY: p.y, flightHeight: 50 };
  opponentSwing = { age: SWING.impact, type: 'clear', overhead: false, serving: true, contacted: true, contactScreen: point };
  impact = { ...point, age: 0, smash: false }; sound('hit');
  delivery = makeServiceDelivery(match, player, opponent); resetPowerForIncoming(); rallyHits = 1; longestRally = Math.max(longestRally, rallyHits); updateHud();
}
function opponentReturn() {
  const contact = returnPosition(delivery), ground = project(contact.x, contact.y), point = { x: ground.x, y: ground.y - contact.z * figureYScale, groundY: ground.y, flightHeight: contact.z };
  const receivedType = delivery.shotType;
  rallyHits++; longestRally = Math.max(longestRally, rallyHits);
  delivery = makeMatchDelivery(player, opponent, rallyHits, contact, Math.random, receivedType);
  opponent.strokeRecovery = .13 + (opponent.skill.strokeDelay ?? 0) + (1 - delivery.quality) * .22 + (['smash', 'jumpSmash'].includes(delivery.incomingType) ? .08 : 0);
  opponent.reaction = 0;
  const type = delivery.incomingType, attacking = ['attack', 'smash', 'jumpSmash'].includes(type), kill = type === 'smash' || type === 'jumpSmash';
  const color = incomingColors[type];
  opponentSwing = { age: SWING.impact, type: kill ? 'smash' : attacking ? 'tap' : type, overhead: ['clear', 'attack', 'smash', 'jumpSmash'].includes(type), contacted: true, contactScreen: point };
  impact = { ...point, age: 0, smash: attacking }; burst(point, color, kill ? 28 : 18, kill ? 170 : 100); sound('hit');
  feedback(`CPU: ${incomingNames[type]}`, kill ? 'Defend: left to lift · Shift + left to block' : type === 'drive' ? 'Drive incoming: right click low to counter' : attacking ? 'Attack incoming: left to lift · Shift + left to block' : ['drop', 'block'].includes(type) ? 'Net shot incoming; intercept early' : 'Deep shot incoming; move back', false, 'opponent');
  $('feedback').classList.toggle('smash', kill);
  resetPowerForIncoming(); trail = []; updateHud();
}
canvas.tabIndex = 0;
const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement && event.code !== 'Escape') return;
  if (event.target instanceof HTMLButtonElement && event.code === 'Space') return;
  if (movementKeys.includes(event.code) || event.code === 'Space' || ['Digit1', 'Digit2', 'Digit3', 'Digit0'].includes(event.code)) event.preventDefault();
  if (movementKeys.includes(event.code) && state === 'playing' && roundBreak === 0) keys.add(event.code);
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') { keys.add(event.code); previewShot = delivery?.phase === 'serve' ? 'clear' : 'drop'; }
  if (movementKeys.includes(event.code) || event.code.startsWith('Shift')) touchMode = false;
  if (event.repeat) return;
  if (['Digit1', 'Digit2', 'Digit3'].includes(event.code) && canAdjustPower()) choosePower(Number(event.code.slice(-1)));
  if (event.code === 'Digit0' && canAdjustPower()) setPower(null);
  if (event.code === 'Space') jump();
  if (event.code === 'Escape' && pendingPhoneStart !== null) cancelPhoneStart();
  else if (event.code === 'Escape' && !$('help').classList.contains('hidden')) closeHelp();
  else if (event.code === 'Escape' && !$('settings').classList.contains('hidden')) closeSettings();
  else if (event.code === 'Escape' && !$('personalization').classList.contains('hidden')) closePersonalization();
  else if (event.code === 'Escape' && currentPanel === 'lan-panel') leaveLan();
  else if (event.code === 'Escape' && state === 'ready' && currentPanel === 'mode-setup') backToCover();
  else if (event.code === 'KeyP' || event.code === 'Escape') togglePause();
  if (event.code === 'KeyM') toggleSound();
});
window.addEventListener('keyup', event => { keys.delete(event.code); if (event.code.startsWith('Shift')) previewShot = delivery?.phase !== 'serve' && (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 'drop' : 'clear'; });
function aimFromPointer(event) {
  const rect = canvas.getBoundingClientRect(), screenX = (event.clientX - rect.left) * CAMERA_WIDTH / rect.width;
  const left = project(0, -.5).x, right = project(1, -.5).x;
  setAim((screenX - left) / (right - left));
}
canvas.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse' || state !== 'playing') return;
  touchMode = false; aimFromPointer(event); previewShot = event.buttons & 2 ? 'smash' : event.shiftKey && delivery?.phase !== 'serve' ? 'drop' : 'clear';
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('pointerdown', event => {
  if (![0, 2].includes(event.button) || event.pointerType !== 'mouse' || state !== 'playing') return;
  touchMode = false; event.preventDefault(); aimFromPointer(event); canvas.focus(); hit(event.button === 2 ? 'smash' : event.shiftKey && delivery?.phase !== 'serve' ? 'drop' : 'clear');
});
let wheelDistance = 0, wheelDirection = 0;
canvas.closest('.game-shell').addEventListener('wheel', event => {
  if (!canAdjustPower() || !event.deltaY) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
  const direction = Math.sign(delta);
  if (direction !== wheelDirection) { wheelDistance = 0; wheelDirection = direction; }
  wheelDistance += Math.abs(delta);
  if (wheelDistance < 45) return;
  wheelDistance = 0;
  const current = selectedPower ?? defaultPowerFor(previewShot, powerDefaults);
  setPower(clamp(current - direction, 1, 3));
}, { passive: false });
window.addEventListener('blur', () => { keys.clear(); touchControls.reset(); if (lanActive) { lanClient.input(0, 0); if (state === 'playing') toggleLanPause(true); } else if (state === 'playing') togglePause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') { if (lanActive) toggleLanPause(true); else togglePause(); } });
const touchControls = globalThis.ShuttleTouch.createControls({
  document, window, i18n,
  isActive: () => state === 'playing' && roundBreak === 0 && $('overlay').classList.contains('hidden'),
  activate: () => { touchMode = true; previewShot = touchControls.requested(); enableAudio(); },
  getAim: () => (aimX - .03) / .94, aim: setAim,
  hit, jump, shot: type => { previewShot = type; updateShotOptions(); updatePowerStatus(); },
  power: value => { if (value === null) setPower(null); else choosePower(value); updateTouchShot(); },
  canAdjustPower
});
function movementInput() {
  const dx = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const dy = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  return dx || dy ? { dx, dy } : touchControls.movement();
}

// Use the same click-to-contact forecast for the cue, shot labels and aim preview.
function contactPrediction() {
  if (delivery?.phase !== 'incoming') return null;
  const future = { ...player };
  const { dx, dy } = movementInput();
  updateJump(future, SWING.impact); movePlayer(future, dx, dy, SWING.impact);
  const ball = { ...delivery, age: delivery.age + SWING.impact };
  return { player: future, ball, point: incomingPosition(ball) };
}
function contactCue() {
  const prediction = contactPrediction();
  if (!prediction) return { grade: null, reason: 'no-ball' };
  const result = assessHit(prediction.player, prediction.ball);
  const recovering = cooldown > 0 || Boolean(swing);
  return { ...result, backhand: isBackhand(prediction.player, prediction.point), grade: recovering ? null : result.grade, reason: recovering ? 'recovering' : result.reason,
    smash: !recovering && Boolean(result.grade) && canPlayerSmash(prediction.player, prediction.point, prediction.ball) };
}
function updatePose(actor, pose, activeSwing, ball, dt, isOpponent = false, anticipation = 0) {
  const contact = activeSwing?.contactScreen;
  const ground = project(actor.x, actor.y);
  const sideways = contact ? (contact.x - ground.x) / 95 : ball ? (ball.x - actor.x) * 3 : actor.vx / RULES.speed * .7;
  const high = activeSwing ? Number(activeSwing.overhead) : ball && ball.z > 75 && ball.z < 220 + actor.height ? 1 : 0;
  const low = ball && ball.z < 75 && Math.hypot(ball.x - actor.x, ball.y - actor.y) < .3;
  const lunge = actor.height > 8 ? 0 : activeSwing && !activeSwing.overhead ? .9 * (1 - clamp((activeSwing.age - SWING.contactEnd) / .27, 0, 1)) : low ? .7 : 0;
  // An overhead preparation turns the racket shoulder back, then unwinds after impact.
  const backhand = !isOpponent && (activeSwing ? activeSwing.backhand : isBackhand(actor, ball));
  const strokeTurn = (backhand ? -1 : 1) * (activeSwing?.overhead ? .72 * (1 - clamp(activeSwing.age / SWING.duration, 0, 1) * 1.65) : high * .48);
  const turn = clamp(sideways + (isOpponent ? -strokeTurn : strokeTurn), -.95, .95);
  const smooth = 1 - Math.exp(-dt * 14);
  const speed = Math.hypot(actor.vx || 0, actor.vy || 0);
  const braking = clamp((pose.lastSpeed - speed) / Math.max(.001, dt) / 3, 0, 1);
  const reach = ball ? { x: ball.x - actor.x, y: (ball.y - actor.y) * (isOpponent ? -1 : 1) } : { x: 0, y: 0 };
  const length = Math.max(.035, Math.hypot(reach.x, reach.y));
  const stroke = activeSwing ? Math.sin(Math.PI * clamp(activeSwing.age / .30, 0, 1)) * (['smash', 'tap'].includes(activeSwing.type) ? 1 : activeSwing.type === 'block' ? .3 : .65) : 0;
  pose.turn += (turn - pose.turn) * smooth;
  pose.lunge += (lunge - pose.lunge) * smooth;
  pose.high += (high - pose.high) * smooth;
  const prepare = !activeSwing && high && ball && Math.hypot(ball.x - actor.x, ball.y - actor.y) < .42 ? .8 : 0;
  pose.prepare += (prepare - pose.prepare) * smooth;
  pose.backhand += (Number(backhand) - pose.backhand) * smooth;
  pose.brake += (Math.max(braking, actor.pivot || 0) - pose.brake) * smooth;
  pose.split += ((actor.height > 0 || activeSwing ? 0 : anticipation) - pose.split) * smooth;
  pose.reachX += (reach.x / length - pose.reachX) * smooth;
  pose.reachY += (reach.y / length - pose.reachY) * smooth;
  pose.stroke += (stroke - pose.stroke) * smooth;
  pose.ready += ((actor.height > 0 || activeSwing ? 0 : 1) - pose.ready) * smooth;
  pose.lastSpeed = speed;
}
function update(dt) {
  if (lanActive) { updateLan(dt); return; }
  if (state !== 'playing') return;
  if (tutorial) { updateTutorial(dt); return; }
  elapsed += dt; cooldown = Math.max(0, cooldown - dt);
  if (opponentSwing) { opponentSwing.age += dt; if (opponentSwing.age >= SWING.duration) opponentSwing = null; }
  if (updateJump(player, dt)) { landing = { x: player.x, y: player.y, age: 0 }; sound('land'); }
  if (mode === 'match') updateJump(opponent, dt);
  if (landing) { landing.age += dt; if (landing.age > .24) landing = null; }
  if (feedbackTime > 0) { feedbackTime -= dt; if (feedbackTime <= 0) $('feedback').classList.remove('visible'); }
  const { dx, dy } = movementInput();
  const servicePending = mode === 'match' && delivery?.phase === 'serve';
  const feetLocked = servicePending && swing && !swing.contacted;
  if (!feetLocked && roundBreak === 0) movePlayer(player, dx, dy, dt);
  if (servicePending) constrainToServiceCourt(player, serviceSetup(match).playerCourt);
  const speed = Math.hypot(player.vx, player.vy), run = !feetLocked && roundBreak === 0 ? clamp(speed / RULES.speed, 0, 1) : 0;
  serviceStill = Math.hypot(dx, dy) > 0 || speed > .04 ? 0 : serviceStill + dt;
  motion.run += (run - motion.run) * Math.min(1, dt * 12);
  motion.lean += ((player.vx / RULES.speed * 6) - motion.lean) * Math.min(1, dt * 6);
  motion.pitch += ((player.vy / RULES.speed * 3) - motion.pitch) * Math.min(1, dt * 9);
  motion.gait += dt * (7 + 11 * motion.run);
  const playerSplit = delivery?.phase === 'incoming' ? Math.sin(Math.PI * clamp(delivery.age / .22, 0, 1)) : 0;
  updatePose(player, motion, swing, delivery?.phase === 'incoming' ? incomingPosition(delivery) : null, dt, false, playerSplit);
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  if (mode === 'match' && roundBreak > 0) {
    roundBreak = Math.max(0, roundBreak - dt); if (delivery) delivery.age += dt;
    if (impact) { impact.age += dt; if (impact.age > .20) impact = null; }
    if (roundBreak === 0) { if (match.winner) finish(); else resetRally(); } return;
  }
  if (!delivery) { nextFeed -= dt; if (nextFeed <= 0) { if (mode === 'match') prepareService(.9); else if (mode === 'drill') feedTraining(); else { delivery = challenge ? targets.makeFeed(player, challenge) : makeDelivery(player, returns); if (challenge) { challengeZone = delivery.challengeTarget; updateHud(); } resetPowerForIncoming(); } } }
  else {
    delivery.age += dt;
    if (delivery.phase === 'serve' && match.server === 'computer' && delivery.age >= delivery.delay && serviceStill >= .15) computerServe();
    else if (delivery.phase === 'incoming' && delivery.age > delivery.duration + RULES.late) {
      if (mode === 'match') { endRally('computer'); return; }
      if (mode === 'drill') {
        const point = isInterceptable(delivery) ? incomingPosition(delivery) : delivery.target;
        const far = Math.hypot(player.x - point.x, player.y - point.y) > RULES.radius;
        recordDrill({ missReason: far ? 'far' : delivery.lastHitFailure ?? 'late' });
      } else practiceMisses++;
      if (challenge) recordChallenge({});
      delivery.phase = 'miss'; delivery.age = 0; combo = 0; if (!challenge) feedback('MISSED', mode === 'drill' ? 'Repeat the same target on the next feed.' : 'Adjust your position for the next shuttle.', true); sound('miss'); updateHud();
    } else if (delivery.phase === 'miss' && delivery.age > .7) { if (mode === 'drill') completeDrillFlight(); else if (challenge) completeChallengeFlight(); else { delivery = null; nextFeed = difficulty(returns).gap; } }
    else if (delivery.phase === 'return') {
      if (delivery.fault && delivery.age >= delivery.fault.age) {
        if (mode === 'match') endRally('computer', delivery.fault.type === 'out' ? 'Out' : 'Net', delivery.fault.point);
        else practiceFault(delivery.fault);
        return;
      }
      if (challenge && delivery.age >= delivery.returnDuration) recordChallenge({ point: returnPosition(delivery) });
      if (mode === 'match') {
        if (!delivery.fault) {
          const opponentAction = advanceOpponentReturn(opponent, delivery, dt);
          if (opponentAction.jumped) feedback('CPU jumps!', 'Prepare to defend; watch the landing point.', false, 'opponent');
          if (opponentAction.hit) opponentReturn();
          else if (delivery.age > delivery.returnDuration + .09) { endRally('player'); return; }
        }
      } else if (delivery.age > delivery.returnDuration + (challenge ? .65 : delivery.shotType === 'smash' ? .25 : 0)) { if (mode === 'drill') completeDrillFlight(); else if (challenge) completeChallengeFlight(); else { delivery = null; trail = []; nextFeed = difficulty(returns).gap; } }
    }
  }
  if (mode === 'match') {
    if (delivery?.phase === 'incoming') recoverOpponent(opponent, delivery, dt);
    i18n.text($('ai-status'), delivery?.phase === 'incoming' && delivery.quality < .65 ? 'Under pressure · Recovering' : delivery?.phase === 'return' ? 'CPU chasing' : 'CPU recovering');
    const opponentRun = clamp(Math.hypot(opponent.vx, opponent.vy) / opponent.skill.speed, 0, 1);
    opponentMotion.run += (opponentRun - opponentMotion.run) * Math.min(1, dt * 12);
    opponentMotion.lean += ((opponent.vx / opponent.skill.speed * 6) - opponentMotion.lean) * Math.min(1, dt * 6);
    opponentMotion.pitch += ((opponent.vy / opponent.skill.speed * 3) - opponentMotion.pitch) * Math.min(1, dt * 9);
    opponentMotion.gait += dt * (7 + 11 * opponentMotion.run);
    const opponentSplit = delivery?.phase === 'return' ? Math.sin(Math.PI * clamp(delivery.age / .22, 0, 1)) : 0;
    updatePose(opponent, opponentMotion, opponentSwing, delivery?.phase === 'return' ? returnPosition(delivery) : null, dt, true, opponentSplit);
  }
  if (swing) { swing.age += dt; if (!swing.contacted && swing.age >= SWING.impact) resolveHit(); if (swing.age >= SWING.duration) swing = null; }
  if (impact) { impact.age += dt; if (impact.age > .20) impact = null; }
  if (delivery?.phase === 'return' && killEffect(delivery.shotType, delivery.power) && delivery.age <= delivery.returnDuration) { const ball = ballPosition(); trail.push({ x: ball.x, y: ball.y - ball.z * figureYScale }); if (trail.length > killEffect(delivery.shotType, delivery.power).trail) trail.shift(); }
  const cue = contactCue(), smashReady = cue.smash;
  const jumpLead = mode === 'drill' && training.kind === 'jump' && delivery?.phase === 'incoming' && !swing && player.height === 0 && player.verticalVelocity === 0 && !player.jumpRecovery && delivery.duration - delivery.age >= .40 && delivery.duration - delivery.age <= .85 && assessJumpPreparation(player, delivery).smash;
  $('touch-jump').classList.toggle('recommended', Boolean(jumpLead));
  const pivoting = player.pivot > .45 && player.height <= 8;
  const actionLabel = delivery?.phase === 'serve' ? `${serviceSetup(match).right ? 'Even score: right court' : 'Odd score: left court'} · ${match.server === 'player' ? 'Left: long serve / Right: short serve' : Math.hypot(dx, dy) > 0 || speed > .04 ? 'Release movement keys to receive' : 'CPU will serve diagonally'}` : swing ? 'Recovering' : smashReady ? cue.backhand ? 'Backhand smash · Right click' : 'Jump smash · Right click' : cue.grade === 'perfect' ? 'Perfect timing · Swing now' : cue.grade ? 'Hit now' : cue.reason === 'high' ? 'Too high · Wait or jump' : cue.reason === 'far' ? 'Move to the contact ring' : cue.reason === 'early' ? 'Ready · Wait for the solid ring' : cue.reason === 'before-net' ? 'Move into position before the shuttle crosses' : cue.reason === 'late' ? 'Contact window missed' : pivoting ? 'Shifting weight · Braking' : player.jumpRecovery > 0 ? 'Landing recovery' : 'Ready for the next shuttle';
  const readableAction = touchMode ? actionLabel.replace('Left: long serve / Right: short serve', 'Choose Long or Short · Tap to serve').replace('Release movement keys', 'Release the joystick').replaceAll('Right click', 'Attack') : actionLabel;
  if ($('action-status').textContent !== readableAction) i18n.text($('action-status'), readableAction);
  if (jumpLead) i18n.text($('action-status'), touchMode ? 'Jump now · Attack at the apex' : 'Jump now · Right click at the apex');
  else if (mode === 'drill' && training.kind === 'jump' && cue.grade && player.height > 8 && !smashReady && !swing) i18n.text($('action-status'), touchMode ? 'Watch for gold · Release Attack at the apex' : 'Watch for gold · Right click at the apex');
  $('action-status').classList.toggle('airborne', player.height > 8);
  $('action-status').classList.toggle('smash-ready', Boolean(smashReady || swing?.type === 'smash'));
  $('action-status').classList.toggle('pivoting', pivoting && !smashReady);
  $('action-status').classList.toggle('contact-ready', Boolean(cue.grade));
  $('action-status').classList.toggle('essential-cue', delivery?.phase === 'serve' || (mode === 'drill' && training.kind === 'jump' && Boolean(jumpLead || (cue.grade && player.height > 8))));
  updatePowerStatus();
  updateShotOptions();
  updatePracticeStatus();
}

// Coordinates are on the court plane: own half y=0..1; far half y=-1..0.
function project(x, y) {
  const depth = (y + 1) / 2;
  const eased = .62 * depth + .38 * depth * depth;
  return { x: 600 + (x - .5) * (460 + eased * 560), y: 179 + eased * 463, scale: .66 + eased * .50 };
}
function path(points, fill, stroke, width = 1) {
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function line(a, b, color, width = 1) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
function ellipse(x, y, rx, ry, fill, stroke, width = 1) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } }
function courtLine(x1, y1, x2, y2, color = '#d4e5c8a0', width = 2) { line(project(x1, y1), project(x2, y2), color, width); }
const VENUE_LIGHT = Object.freeze({ highlight: '#fff8e8', shadow: '#315b50', castX: .07, castY: .055 });
let courtBackdrop = null;
function drawCourt() {
  // Cache the venue at the display resolution; resizing invalidates this bitmap.
  if (!courtBackdrop) {
    ctx.save(); drawCourtBackdrop(); ctx.restore();
    courtBackdrop = document.createElement('canvas'); courtBackdrop.width = canvas.width; courtBackdrop.height = canvas.height;
    courtBackdrop.getContext('2d').drawImage(canvas, 0, 0);
  }
  ctx.drawImage(courtBackdrop, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
}
function venuePanel(x, y, w, h, fill, stroke = '#779b8c55', radius = 5) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function venueSoftShadow(x, y, rx, ry, opacity = .18) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
  const shade = ctx.createRadialGradient(0, 0, .06, 0, 0, 1);
  shade.addColorStop(0, 'rgba(35,61,52,' + opacity + ')');
  shade.addColorStop(.42, 'rgba(35,61,52,' + opacity * .65 + ')');
  shade.addColorStop(1, 'rgba(35,61,52,0)');
  ellipse(0, 0, 1, 1, shade); ctx.restore();
}
function drawVenueBench(x, y) {
  ctx.save(); ctx.translate(x, y);
  venueSoftShadow(105, 27, 116, 13, .20);
  for (const leg of [16, 171]) {
    path([{x:leg,y:-6},{x:leg+6,y:-6},{x:leg+10,y:26},{x:leg+4,y:26}], '#53685f', '#84938a', .8);
    line({x:leg+1,y:1},{x:leg+5,y:23}, '#acb8a9', .8);
    venuePanel(leg-3, 24, 20, 3, '#4c6057', null, 1);
    venueSoftShadow(leg+6, 27, 14, 3, .24);
  }
  line({x:24,y:18},{x:178,y:18}, '#718073', 2.4);
  for (const [row, h] of [[-29,10],[-15,9]]) {
    const wood = ctx.createLinearGradient(0, row, 0, row+h);
    wood.addColorStop(0, '#e7d6b6'); wood.addColorStop(.45, '#d4be98'); wood.addColorStop(1, '#b69f79');
    venuePanel(0, row, 200, h, wood, '#a2917055', 1.5);
    line({x:3,y:row+1},{x:197,y:row+1}, '#f9ecd099', .9);
    for (let i=0;i<3;i++) {
      ctx.beginPath(); ctx.moveTo(5,row+3+i*2);
      ctx.bezierCurveTo(52,row+2+i*2,127,row+5+i*2,194,row+3+i*2);
      ctx.strokeStyle = i%2 ? '#8c785819' : '#fff4d524'; ctx.lineWidth=.6; ctx.stroke();
    }
    for (const bolt of [12,188]) { ellipse(bolt,row+5,1.2,1.2,'#8c8168'); ellipse(bolt-.2,row+4.7,.5,.4,'#e9e5cc'); }
  }
  path([{x:-4,y:-1},{x:197,y:-1},{x:206,y:7},{x:3,y:7}], '#dfc8a1', '#e9dabd', .7);
  path([{x:3,y:7},{x:206,y:7},{x:206,y:11},{x:3,y:11}], '#ac9570');
  line({x:1,y:3},{x:201,y:3}, '#b39a7455', .8);
  line({x:4,y:7},{x:204,y:7}, '#f9ebcd99', .8);
  ctx.restore();
}
function drawVenueBag(x, y, color, accent) {
  ctx.save(); ctx.translate(x, y);
  venueSoftShadow(3, 6, 39, 10, .24);
  ctx.beginPath(); ctx.moveTo(-24, -19); ctx.quadraticCurveTo(-27, -41, 9, -38); ctx.quadraticCurveTo(27, -38, 28, -20);
  ctx.strokeStyle = '#17393c'; ctx.lineWidth = 4; ctx.stroke();
  const fabric = ctx.createLinearGradient(-30, -25, 32, 7); fabric.addColorStop(0, accent); fabric.addColorStop(.22, color); fabric.addColorStop(1, '#183b40');
  ctx.beginPath(); ctx.moveTo(-32, 0); ctx.lineTo(-27, -23); ctx.quadraticCurveTo(-2, -35, 27, -24);
  ctx.lineTo(34, 0); ctx.quadraticCurveTo(3, 13, -32, 0); ctx.closePath(); ctx.fillStyle = fabric; ctx.fill(); ctx.strokeStyle = '#0f3137'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-23, -24); ctx.quadraticCurveTo(0, -30, 22, -23); ctx.strokeStyle = '#c5d2b777'; ctx.lineWidth = 1; ctx.stroke();
  path([{ x: -20, y: -19 }, { x: -5, y: -22 }, { x: 4, y: 6 }, { x: -11, y: 5 }], accent);
  venuePanel(11, -15, 14, 14, '#24464b', '#77958966', 3);
  line({ x: 13, y: -13 }, { x: 23, y: -13 }, '#a3bba888', .8);
  line({ x: 22, y: -24 }, { x: 24, y: -19 }, '#d6dfc5', 1.3);
  ctx.restore();
}
function drawVenueBottle(x, y, color) {
  ctx.save(); ctx.translate(x, y); venueSoftShadow(1, 3, 9, 3, .24);
  const plastic = ctx.createLinearGradient(-5, 0, 5, 0); plastic.addColorStop(0, '#bdd7c6'); plastic.addColorStop(.3, '#d8e6d2'); plastic.addColorStop(1, color);
  venuePanel(-5, -20, 10, 22, plastic, '#183f4188', 3); venuePanel(-3, -25, 6, 6, color, null, 1.5);
  venuePanel(-4.5, -12, 9, 8, color, null, 1); line({ x: -2, y: -18 }, { x: -2, y: -14 }, '#f0f5ddaa', 1);
  ctx.restore();
}
function drawVenueFixtures() {
  ctx.save();
  // Recessed joinery and equipment stay outside the playing area and its cues.
  venuePanel(62, 73, 76, 81, '#778f7e2b', null, 1);
  venuePanel(64, 74, 72, 78, '#a3b7a5', '#f3f5e7', 1);
  const door=ctx.createLinearGradient(70,81,130,151);
  door.addColorStop(0,'#d3dfcd');door.addColorStop(1,'#b5c9b5');
  venuePanel(70, 81, 60, 70, door, '#edf2e1', 1);
  venuePanel(75, 88, 50, 33, '#97b4b199', '#8da795', 1);
  const glass=ctx.createLinearGradient(75,88,125,121);
  glass.addColorStop(0,'#dbe9dd');glass.addColorStop(1,'#b9d3c755');
  ctx.fillStyle=glass;ctx.fillRect(77,90,46,29);
  line({x:80,y:91},{x:102,y:91},'#f6f9e780',.8);
  venuePanel(74,143,52,5,'#9fb49f','#dce6ce',.5);
  line({x:76,y:151},{x:129,y:151},'#6d897466',1);
  venuePanel(117,127,10,3,'#718c79','#d3dfc8',.7);
  venuePanel(83,62,34,9,'#a5be94','#e7eed688',1.5);
  line({x:95,y:66},{x:107,y:66},'#f5fae3bb',1.2);
  path([{x:104,y:64},{x:107,y:66},{x:104,y:68}],null,'#f5fae3bb',.9);
  venuePanel(1005,73,124,73,'#708e7720',null,3);
  venuePanel(1004,71,124,73,'#dfe7d8','#a8bda577',3);
  line({x:1010,y:76},{x:1121,y:76},'#fafbec99',1);
  line({x:1017,y:91},{x:1089,y:91},'#b2c4ad',2);
  for (const x of [1026, 1053, 1080]) {
    ellipse(x+1,106,7,10,'#52735e0d');
    ellipse(x,105,6.5,9.5,null,'#6f8d77aa',1.1);
    for(const dx of [-2,2]) line({x:x+dx,y:98},{x:x+dx,y:112},'#879c7c55',.45);
    for(const dy of [-3,0,3]) line({x:x-4,y:105+dy},{x:x+4,y:105+dy},'#879c7c55',.45);
    line({x,y:115},{x,y:134},'#6f8d77aa',1.1);
    line({x,y:127},{x,y:135},'#597a64',2.5);
    ellipse(x,92,1.3,1.3,'#8aa082');
  }
  venuePanel(1095,98,17,34,'#829b83','#b7c7ad',1.5);
  for(const y of [103,108,113]) line({x:1098,y},{x:1109,y},'#dce6ce88',.7);
  ellipse(979,94,17,17,'#597d6222');
  ellipse(978,93,16,16,'#b6c6b1','#8ba284',1);
  ellipse(978,93,13.5,13.5,'#fafaf0','#e3e7d6',.6);
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6, inner=i%3===0?9.5:11;
    line({x:978+Math.sin(a)*inner,y:93-Math.cos(a)*inner},{x:978+Math.sin(a)*12,y:93-Math.cos(a)*12},'#5f7b64',i%3===0?1:.55);
  }
  line({x:978,y:93},{x:974,y:87},'#3f6050',1.3);
  line({x:978,y:93},{x:985,y:91},'#3f6050',.9);
  ellipse(978,93,1.1,1.1,'#5a7860');
  drawVenueBench(44, 199); drawVenueBench(953, 199);
  drawVenueBag(106, 235, '#416966', '#8da98c'); drawVenueBag(1105, 236, '#495c70', '#a4b2b4');
  drawVenueBottle(166, 217, '#64857a'); drawVenueBottle(992, 217, '#819373');
  // A folded towel adds a small lived-in detail, with no motion near the shuttle.
  path([{x:1000,y:197},{x:1027,y:197},{x:1032,y:202},{x:1005,y:202}],'#f4f0dc','#d3d5bc',.6);
  path([{x:1005,y:202},{x:1032,y:202},{x:1032,y:207},{x:1005,y:207}],'#dedfc7');
  for(const x of [1009,1012]) line({x,y:199},{x:x+2,y:207},'#9aaf9655',.8);
  ctx.save(); ctx.translate(218, 245); ctx.rotate(-.22);
  ellipse(0, 1, 8, 3, '#08292d66'); venuePanel(-5, -37, 10, 37, '#c7c9ad', '#596f64', 2);
  venuePanel(-5, -31, 10, 16, '#607a6a', null, 0); line({ x: -2, y: -12 }, { x: -2, y: -4 }, '#f0edcc99', 1); ctx.restore();
  ctx.restore();
}
function drawVenueWindows() {
  // Recessed glazing and thin frames keep the scoreboard's pale backdrop quiet.
  for (const x of [164,364,564,764]) {
    venuePanel(x-6, 30, 196, 88, '#94afa333', null, 1);
    venuePanel(x-3, 32, 190, 82, '#a9bdb1', '#f8faf1', 1);
    ctx.save(); ctx.beginPath(); ctx.rect(x+3,38,178,69); ctx.clip();
    const sky = ctx.createLinearGradient(0,38,0,107);
    sky.addColorStop(0,'#d8eaf0'); sky.addColorStop(.62,'#eef5ed'); sky.addColorStop(1,'#dce8cf');
    ctx.fillStyle=sky; ctx.fillRect(x+3,38,178,69);
    ellipse(x+48,57,53,6,'#ffffff55'); ellipse(x+132,46,38,5,'#ffffff40');
    for (let i=0;i<12;i++) {
      const cx=x+i*18, cy=108-5*Math.sin(i*1.8+x);
      line({x:cx,y:cy},{x:cx+1,y:116},'#89a78b35',1.4);
      ellipse(cx,cy,15,8+2*Math.sin(i),'#a8c49b60');
      ellipse(cx-4,cy-3,10,5,'#c0d5ab66');
    }
    const reveal=ctx.createLinearGradient(0,38,0,55);
    reveal.addColorStop(0,'#54736724'); reveal.addColorStop(1,'#54736700');
    ctx.fillStyle=reveal; ctx.fillRect(x+3,38,178,17);
    path([{x:x+18,y:38},{x:x+36,y:38},{x:x+94,y:107},{x:x+76,y:107}], '#ffffff20');
    ctx.restore();
    for (const mullion of [x+91]) {
      line({x:mullion-2,y:36},{x:mullion-2,y:110},'#819d8d55',1);
      line({x:mullion,y:36},{x:mullion,y:110},'#f8faf1',4);
      line({x:mullion+2,y:38},{x:mullion+2,y:108},'#c5d5c6',.8);
    }
    line({x:x+1,y:74},{x:x+183,y:74},'#78978644',5);
    line({x:x+1,y:73},{x:x+183,y:73},'#f6faf1',3);
    path([{x:x-6,y:113},{x:x+187,y:113},{x:x+191,y:117},{x:x-4,y:117}], '#e1e7d8');
    line({x:x-4,y:117},{x:x+190,y:117},'#7e9b8666',1);
    line({x:x,y:114},{x:x+185,y:114},'#fffdf3',1);
    // Small opening hinges supply scale without introducing background text.
    for (const hinge of [x+9,x+174]) venuePanel(hinge,70,2,7,'#9db09f',null,.5);
  }
}
function drawCourtBackdrop() {
  const style=courtStyle();
  const wall=ctx.createLinearGradient(0,0,0,170);
  wall.addColorStop(0,style.wall[0]); wall.addColorStop(1,style.wall[1]);
  ctx.fillStyle=wall; ctx.fillRect(0,0,1200,720);
  // Plaster bays, ceiling reveals and slim luminaires share one daylight palette.
  for (let i=0;i<=8;i++) {
    const x=35+i*150;
    const reveal=ctx.createLinearGradient(x-3,0,x+6,0);
    reveal.addColorStop(0,'#50735d00'); reveal.addColorStop(.5,'#50735d12'); reveal.addColorStop(1,'#ffffff00');
    ctx.fillStyle=reveal; ctx.fillRect(x-3,10,9,140);
    line({x,y:10},{x,y:149},'#ffffff70',1.4);
  }
  const cornice=ctx.createLinearGradient(0,0,0,21);
  cornice.addColorStop(0,'#b7c8b9'); cornice.addColorStop(.42,'#e3ebdf'); cornice.addColorStop(.6,'#f8faf0'); cornice.addColorStop(1,'#8da69100');
  ctx.fillStyle=cornice; ctx.fillRect(0,0,1200,21);
  for (const x of [230,600,970]) {
    for (const dx of [-28,28]) line({x:x+dx,y:7},{x:x+dx,y:17},'#8fa292',.9);
    venuePanel(x-40,15,80,9,'#b5c5b8','#91a794',1.5);
    venuePanel(x-36,16,72,6,'#dbe4d6',null,1);
    ctx.fillStyle='#fffef5'; ctx.fillRect(x-32,18,64,2.4);
    line({x:x-32,y:23},{x:x+32,y:23},'#849c8744',.7);
  }
  drawVenueWindows();
  const timber=ctx.createLinearGradient(0,120,0,150);
  timber.addColorStop(0,'#e3d8bd'); timber.addColorStop(.6,'#d6ccb1'); timber.addColorStop(1,'#bfc3a8');
  ctx.fillStyle=timber; ctx.fillRect(0,121,1200,29);
  for (let x=0;x<1200;x+=8) {
    line({x,y:122},{x,y:148},'#7f8e6f30',1);
    line({x:x+2,y:123},{x:x+2,y:148},'#fff8de44',.8);
  }
  line({x:0,y:120},{x:1200,y:120},'#fffdf099',1.5);
  // The lower wall's recessed ventilation slots remain behind the benches.
  for (const x of [272,862]) {
    venuePanel(x,128,65,13,'#c1c8b1','#eef0db66',1);
    for(let y=131;y<140;y+=3) line({x:x+5,y},{x:x+60,y},'#7c927960',.7);
  }
  const apron=ctx.createLinearGradient(0,150,0,720);
  apron.addColorStop(0,style.apron[0]); apron.addColorStop(.5,style.apron[1]); apron.addColorStop(1,style.apron[2]);
  ctx.fillStyle=apron; ctx.fillRect(0,150,1200,570);
  ctx.fillStyle='#e6ddc83d'; ctx.fillRect(0,150,1200,570);
  const skirting=ctx.createLinearGradient(0,148,0,164);
  skirting.addColorStop(0,'#758d7444'); skirting.addColorStop(.18,'#a9b69d66'); skirting.addColorStop(.24,'#f9f6e7aa'); skirting.addColorStop(1,'#6f8a6c00');
  ctx.fillStyle=skirting; ctx.fillRect(0,148,1200,16);
  // Pale sprung-floor boards converge on the unchanged projection.
  for(let i=-18;i<25;i++) {
    const x=i*.12;
    if(i%3===0) path([project(x,-1.16),project(x+.12,-1.16),project(x+.12,1.2),project(x,1.2)],'#fff9e411');
    courtLine(x,-1.16,x,1.2,'#748f6c1d',.75);
    for(let j=0;j<3;j++) {
      const y=-.95+j*.85+((i+18)%3)*.23;
      courtLine(x,y,x+.12,y,'#7f947321',.75);
    }
  }
  for (const [x,y,rx,ry] of [[220,261,320,170],[920,417,420,230]]) {
    ctx.save(); ctx.translate(x,y); ctx.scale(1,ry/rx);
    const wash=ctx.createRadialGradient(0,0,10,0,0,rx);
    wash.addColorStop(0,'#fff9dc40'); wash.addColorStop(.5,'#fff9dc1f'); wash.addColorStop(1,'#fff9dc00');
    ellipse(0,0,rx,rx,wash); ctx.restore();
  }
  drawVenueFixtures();
  // A thin rolled edge and feathered contact shadow replace the broad dark frame.
  for(const [pad,alpha] of [[.067,'08'],[.058,'10'],[.050,'1b']])
    path([project(-pad,-1.05),project(1+pad,-1.05),project(1+pad,1.05),project(-pad,1.05)],'#294e40'+alpha);
  path([project(-.045,-1.04),project(1.045,-1.04),project(1.045,1.04),project(-.045,1.04)],style.edge);
  courtLine(-.043,-1.038,1.043,-1.038,style.trim+'80',1);
  courtLine(-.043,-1.038,-.043,1.038,style.line+'3d',1.1);
  courtLine(1.043,-1.038,1.043,1.038,style.seam+'66',1.3);
  courtLine(-.044,1.045,1.044,1.045,'#274d4055',2.4);
  courtLine(-.039,1.031,1.039,1.031,style.trim+'75',1);
  const floor=ctx.createLinearGradient(0,179,0,645);
  floor.addColorStop(0,style.floor[0]); floor.addColorStop(.48,style.floor[1]); floor.addColorStop(1,style.floor[2]);
  const court=[project(0,-1),project(1,-1),project(1,1),project(0,1)];
  path(court,floor);
  ctx.save(); path(court); ctx.clip();
  // Six matte vinyl rolls: fine welds, restrained color variation and fixed grain.
  for(let i=0;i<6;i++) {
    path([project(i/6,-1),project((i+1)/6,-1),project((i+1)/6,1),project(i/6,1)],i%2?'#ffffff03':'#163d2e03');
    if(i) {
      courtLine(i/6,-1,i/6,1,style.seam+'24',.75);
      courtLine(i/6+.0012,-1,i/6+.0012,1,style.line+'12',.65);
    }
  }
  let grain=713;
  const random=()=>{grain=(Math.imul(grain,1664525)+1013904223)>>>0;return grain/4294967296;};
  for(let i=0;i<18000;i++) {
    const p=project(random(),random()*2-1), size=(.35+random()*.8)*p.scale;
    ctx.fillStyle=i%3?'#eff8df0c':'#173d3014'; ctx.fillRect(p.x,p.y,size,size*.55);
  }
  for(let i=0;i<42;i++) {
    const p=project(.12+random()*.76,-.85+random()*1.7);
    ctx.save(); ctx.translate(p.x,p.y); ctx.scale(p.scale,p.scale*.35); ctx.rotate(random()-.5);
    ctx.beginPath(); ctx.arc(0,0,4+random()*8,.2,1.8);
    ctx.strokeStyle=i%3?style.seam+'18':style.line+'17'; ctx.lineWidth=.7; ctx.stroke(); ctx.restore();
  }
  // Broad, feathered window light preserves the rubber's matte finish.
  for(const [x,y,rx,ry,alpha] of [[.25,-.45,290,140,'24'],[.65,.45,370,190,'1e']]) {
    const p=project(x,y);
    ctx.save(); ctx.translate(p.x,p.y); ctx.scale(1,ry/rx); ctx.rotate(-.17);
    const wash=ctx.createRadialGradient(0,0,4,0,0,rx);
    wash.addColorStop(0,'#fff9df'+alpha); wash.addColorStop(.55,'#fff9df0e'); wash.addColorStop(1,'#fff9df00');
    ellipse(0,0,rx,rx,wash); ctx.restore();
  }
  const falloff=ctx.createLinearGradient(0,179,0,642);
  falloff.addColorStop(0,style.shadow+'16'); falloff.addColorStop(.3,style.shadow+'00'); falloff.addColorStop(1,'#fffae407');
  path(court,falloff); ctx.restore();
  const lineScale=Math.min(1.6,Math.max(1,CAMERA_WIDTH/canvas.getBoundingClientRect().width));
  // Existing markings keep their positions and contrast across all four colors.
  path(court,null,style.seam+'66',5*lineScale);
  for(const x of [.075,.925]) courtLine(x,-1,x,1,style.seam+'55',4*lineScale);
  for(const y of [-.84,-.29,.29,.84]) courtLine(0,y,1,y,style.seam+'55',4*lineScale);
  courtLine(.5,-1,.5,-.29,style.seam+'55',4*lineScale); courtLine(.5,.29,.5,1,style.seam+'55',4*lineScale);
  path(court,null,style.line,3.5*lineScale);
  for(const x of [.075,.925]) courtLine(x,-1,x,1,style.line,2.5*lineScale);
  for(const y of [-.84,-.29,.29,.84]) courtLine(0,y,1,y,style.line,2.5*lineScale);
  courtLine(.5,-1,.5,-.29,style.line,2.5*lineScale); courtLine(.5,.29,.5,1,style.line,2.5*lineScale);
  for(const x of [0,1]) {const p=project(x,1);line({x:p.x,y:p.y},{x:p.x,y:p.y+7},style.line+'77',1.3);}
  // The suspended mesh casts a light open shadow rather than a solid stripe.
  ctx.save(); path(court); ctx.clip();
  for(let i=0;i<88;i++) courtLine(-.045+1.09*i/88+.015,.055,-.045+1.09*i/88+.038,.123,'#234d3c14',.65);
  for(const y of [.058,.074,.09,.106,.122]) courtLine(-.03,y,1.075,y,'#234d3c13',.6);
  ctx.restore();
}
function drawNet() {
  const left=project(-.045,0), right=project(1.045,0), height=53, width=right.x-left.x;
  const top=t=>left.y-height+3.6*4*t*(1-t);
  const bottom=t=>left.y-25+1.8*4*t*(1-t);
  const netCurve=(at,offset=0)=>{
    ctx.beginPath(); for(let i=0;i<=32;i++) {
      const t=i/32,x=left.x+width*t,y=at(t)+offset;
      if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);
    }
  };
  ctx.save();
  // The lower edge hangs above the floor; the top remains at its original height.
  ctx.beginPath();
  for(let i=0;i<=32;i++){const t=i/32; if(i)ctx.lineTo(left.x+width*t,top(t));else ctx.moveTo(left.x,top(0));}
  for(let i=32;i>=0;i--){const t=i/32;ctx.lineTo(left.x+width*t,bottom(t));}
  ctx.closePath(); ctx.fillStyle='#1a3b3210'; ctx.fill();
  ctx.beginPath();
  for(let i=0;i<=88;i++) {
    const t=i/88,x=left.x+width*t;
    ctx.moveTo(x,top(t)+1);ctx.lineTo(x,bottom(t));
  }
  ctx.strokeStyle='#173c358c';ctx.lineWidth=.72;ctx.stroke();
  for(let row=1;row<=5;row++) {
    netCurve(t=>top(t)+(bottom(t)-top(t))*row/5);
    ctx.strokeStyle=row===5?'#315347aa':'#24473d80';ctx.lineWidth=row===5?1.25:.7;ctx.stroke();
  }
  // Layered cotton tape, a fine seam and edge bindings make the net readable.
  netCurve(top,1.7);ctx.strokeStyle='#21483f45';ctx.lineWidth=5.8;ctx.stroke();
  netCurve(top);ctx.strokeStyle='#f0f1df';ctx.lineWidth=4.8;ctx.stroke();
  netCurve(top,-1.4);ctx.strokeStyle='#fffff4d9';ctx.lineWidth=1.1;ctx.stroke();
  netCurve(top,1.2);ctx.strokeStyle='#93a58b88';ctx.lineWidth=.55;ctx.setLineDash([1,3]);ctx.stroke();ctx.setLineDash([]);
  for(const [p,t] of [[left,0],[right,1]]) {
    line({x:p.x,y:top(t)+2},{x:p.x,y:bottom(t)},'#d5ddca',2.1);
    const outside=t===0?-1:1;
    path([{x:p.x-4,y:p.y+1},{x:p.x+4,y:p.y+1},{x:p.x+19,y:p.y+10},{x:p.x+10,y:p.y+10}],'#315c4924');
    venueSoftShadow(p.x+8,p.y+6,25,8,.20);
    venuePanel(p.x-12,p.y-1,24,6,'#3f5e56','#85998a',1.8);
    path([{x:p.x-12,y:p.y-1},{x:p.x+10,y:p.y-1},{x:p.x+13,y:p.y+2},{x:p.x-9,y:p.y+2}],'#71887a');
    for(const dx of [-8,8]) ellipse(p.x+dx,p.y+3,1.1,.65,'#b9c6af');
    const post=ctx.createLinearGradient(p.x-4,0,p.x+4,0);
    post.addColorStop(0,'#526e63');post.addColorStop(.35,'#e3e8d9');post.addColorStop(.58,'#b5c7b6');post.addColorStop(1,'#5a786c');
    line({x:p.x,y:p.y},{x:p.x,y:p.y-height-10},'#496457',8.5);
    line({x:p.x,y:p.y},{x:p.x,y:p.y-height-10},post,6.8);
    ellipse(p.x,p.y-height-10,3.7,2,'#f4f3e2','#98ad99',.7);
    venuePanel(p.x-4.5,p.y-25,9,21,'#42675d','#86a28d77',1.5);
    line({x:p.x-2.4,y:p.y-22},{x:p.x-2.4,y:p.y-7},'#b6cbb755',.8);
    for(const y of [top(t),bottom(t)]) {
      line({x:p.x-4,y},{x:p.x+4,y},'#3b5c50',2);
      ellipse(p.x,y,1.2,1.2,'#dce3d0');
    }
    line({x:p.x+outside*4,y:top(t)+2},{x:p.x+outside*10,y:top(t)+5},'#b9cbb4',1.2);
    line({x:p.x+outside*10,y:top(t)+5},{x:p.x+outside*10,y:top(t)+12},'#627f6b',1.8);
    ellipse(p.x+outside*10,top(t)+12,1.7,1.1,'#d9e1c8');
  }
  ctx.restore();
}
// Shared visual proportions and palettes keep wardrobe changes separate from contact rules.
const ATHLETE_BODY = Object.freeze({ shoulderHalf: 14, waistHalf: 10.5, hipHalf: 7, shoulderY: -51, hipY: -28, kneeY: -15, ankleY: -5, upperArm: 6.5, foreArm: 5.3, thigh: 7.4, calf: 5.8, armSegment: 18.5, headScale: .90 });
const ATHLETE_LOOKS = Object.freeze({
  player: Object.freeze({ ink: '#183b3e', skin: '#ecc7a2', skinShade: '#c99672', skinLight: '#f7dcc0', shirt: '#d7ee8c', shirtLight: '#e9f9b1', shirtShade: '#96bb6b', trim: '#426951', shorts: '#254a50', shortsShade: '#17383f', shoe: '#f6f7e9', shoeShade: '#c9d9cc', accent: '#abd773', sock: '#f0f3e1', number: '01' }),
  opponent: Object.freeze({ ink: '#183b3e', skin: '#dcae87', skinShade: '#bb8468', skinLight: '#ecc4a5', shirt: '#f0e5d0', shirtLight: '#fff6e4', shirtShade: '#bcc7ba', trim: '#466a72', shorts: '#3e606c', shortsShade: '#284751', shoe: '#eff2e9', shoeShade: '#becfc9', accent: '#89a9b2', sock: '#e9eee4', number: '02' })
});
function athleteElbow(shoulder, hand, side, body = ATHLETE_BODY) {
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y, distance = Math.max(1, Math.hypot(dx, dy));
  // A slight bend keeps both arm segments extended towards the hand, even at short projected reaches.
  const bend = Math.min(distance * .12, Math.sqrt(Math.max(0, body.armSegment ** 2 - distance ** 2 / 4))) * side;
  return { x: shoulder.x + dx * .5 - dy / distance * bend, y: shoulder.y + dy * .5 + dx / distance * bend };
}
function drawAthleteLimb(a, b, width, color, look, endWidth = width * .76) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy));
  const tx = dx / length, ty = dy / length, nx = -ty, ny = tx, r = width / 2, tip = endWidth / 2;
  ctx.beginPath(); ctx.moveTo(a.x + nx * r, a.y + ny * r); ctx.lineTo(b.x + nx * tip, b.y + ny * tip);
  ctx.quadraticCurveTo(b.x + tx * tip * 1.5, b.y + ty * tip * 1.5, b.x - nx * tip, b.y - ny * tip);
  ctx.lineTo(a.x - nx * r, a.y - ny * r);
  ctx.quadraticCurveTo(a.x - tx * r * 1.5, a.y - ty * r * 1.5, a.x + nx * r, a.y + ny * r);
  ctx.closePath();
  const skinPart = color === look.skin || color === look.skinShade;
  const surface = ctx.createLinearGradient(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + tip, Math.max(a.y, b.y) + tip);
  surface.addColorStop(0, skinPart ? look.skinLight : color); surface.addColorStop(.4, color);
  surface.addColorStop(1, skinPart ? look.skinShade : color === look.shirt ? look.shirtShade : color === look.sock ? look.shoeShade : color);
  ctx.fillStyle = surface; ctx.fill(); ctx.strokeStyle = look.ink; ctx.lineWidth = 1.3; ctx.stroke();
  const lightSide = nx * -.35 + ny * -1 >= 0 ? 1 : -1;
  line({ x: a.x + nx * r * .4 * lightSide + tx * 2, y: a.y + ny * r * .4 * lightSide + ty * 2 }, { x: b.x + nx * tip * .4 * lightSide - tx, y: b.y + ny * tip * .4 * lightSide - ty }, `${VENUE_LIGHT.highlight}66`, .8);
}
function drawAthleteShoe(ankle, facing, look) {
  ctx.save(); ctx.translate(ankle.x, ankle.y); ctx.scale(facing, 1);
  const upper = ctx.createLinearGradient(0, -4, 0, 4); upper.addColorStop(0, look.shoe); upper.addColorStop(1, look.shoeShade);
  ctx.beginPath(); ctx.moveTo(-5, -3); ctx.quadraticCurveTo(-1, -5, 3, -3); ctx.lineTo(6, -1);
  ctx.quadraticCurveTo(11, -1, 10, 3); ctx.quadraticCurveTo(4, 5, -5, 4); ctx.closePath();
  ctx.fillStyle = upper; ctx.fill(); ctx.strokeStyle = look.ink; ctx.lineWidth = 1.3; ctx.stroke();
  line({ x: -5, y: 3 }, { x: 9, y: 3 }, look.shoe, 1.8);
  line({ x: -4, y: 4.5 }, { x: 8, y: 4.5 }, look.ink, .8);
  path([{ x: -3, y: -1.5 }, { x: 3, y: -.5 }, { x: 5, y: 1 }, { x: -2, y: .5 }], look.accent);
  for (let n = 0; n < 2; n++) line({ x: n * 2 - 1, y: -2 }, { x: n * 2 + 1, y: -.7 }, look.shoe, .9);
  line({ x: -4, y: -2 }, { x: -4, y: 1 }, look.shoeShade, 1.1);
  ctx.beginPath(); ctx.moveTo(-4, -3); ctx.quadraticCurveTo(0, -4, 4, -2); ctx.strokeStyle = `${VENUE_LIGHT.highlight}aa`; ctx.lineWidth = .9; ctx.stroke();
  ctx.restore();
}
function drawAthleteShorts(crouch, stride, look, body) {
  const waist = body.waistHalf, leftHem = -21 + crouch + stride * .10, rightHem = -21 + crouch - stride * .10;
  const cloth = ctx.createLinearGradient(-waist, -31 + crouch, waist, rightHem);
  cloth.addColorStop(0, look.shorts); cloth.addColorStop(1, look.shortsShade);
  path([{ x: -waist, y: -32 + crouch }, { x: waist, y: -32 + crouch }, { x: 13, y: rightHem }, { x: 3, y: rightHem + 1 }, { x: 0, y: -24 + crouch }, { x: -3, y: leftHem + 1 }, { x: -13, y: leftHem }], cloth, look.ink, 1.3);
  line({ x: -waist, y: -30 + crouch }, { x: waist, y: -30 + crouch }, look.trim, 1.5);
  line({ x: -9, y: -28 + crouch }, { x: -11.5, y: leftHem - 1 }, look.accent, 1.3);
  line({ x: 9, y: -28 + crouch }, { x: 11.5, y: rightHem - 1 }, look.accent, 1.3);
  line({ x: -11, y: leftHem - .8 }, { x: -4, y: leftHem + .2 }, '#aec7bd55', .8);
  line({ x: 4, y: rightHem + .2 }, { x: 11, y: rightHem - .8 }, '#aec7bd55', .8);
  line({ x: 0, y: -28 + crouch }, { x: 0, y: -24 + crouch }, look.shortsShade, .9);
}
function drawAthleteJersey(lean, upper, crouch, turn, stroke, look, body) {
  const shoulder = body.shoulderHalf, waist = body.waistHalf, fold = turn * 2 + stroke * 2;
  const top = -55 + upper, hem = -30 + crouch;
  const cloth = ctx.createLinearGradient(-shoulder + lean, top, shoulder, hem);
  cloth.addColorStop(0, look.shirtLight); cloth.addColorStop(.45, look.shirt); cloth.addColorStop(1, look.shirtShade);
  ctx.beginPath(); ctx.moveTo(-5 + lean, top); ctx.quadraticCurveTo(-10 + lean, top - .5, -shoulder + lean, top + 3);
  ctx.quadraticCurveTo(-shoulder - 1 + lean, top + 9, -waist - 1, hem - 5); ctx.quadraticCurveTo(-waist - 1, hem, -waist, hem);
  ctx.quadraticCurveTo(0, hem + 1 + stroke, waist, hem); ctx.quadraticCurveTo(waist + 1, hem - 4, waist + 1, hem - 5);
  ctx.quadraticCurveTo(shoulder + 1 + lean, top + 9, shoulder + lean, top + 3);
  ctx.quadraticCurveTo(10 + lean, top - .5, 5 + lean, top); ctx.closePath();
  ctx.fillStyle = cloth; ctx.fill(); ctx.strokeStyle = look.ink; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.save(); ctx.clip();
  // Sparse weave and clipped seam shadows remain legible on the small court figures.
  ctx.globalAlpha = .12;
  for (let y = top + 5; y < hem; y += 3) line({ x: -shoulder + lean, y }, { x: shoulder + lean, y: y + turn * .4 }, look.shirtShade, .5);
  ctx.globalAlpha = 1;
  path([{ x: 9 + lean, y: top + 4 }, { x: shoulder + 2 + lean, y: top + 4 }, { x: waist + 2, y: hem + 1 }, { x: 7.5, y: hem - 1 }], `${look.shirtShade}aa`);
  line({ x: -11 + lean, y: top + 5 }, { x: -waist + 1, y: hem - 2 }, `${look.trim}66`, .8);
  line({ x: 11 + lean, y: top + 5 }, { x: waist - 1, y: hem - 2 }, `${look.trim}66`, .8);
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(side * 11 + lean, top + 9);
    ctx.quadraticCurveTo(side * 5 + lean + fold, top + 14, side * 7 + fold, hem - 3);
    ctx.strokeStyle = `${look.shirtShade}88`; ctx.lineWidth = .9; ctx.stroke();
  }
  line({ x: -9, y: hem - 2 }, { x: 9, y: hem - 2 + stroke * .5 }, `${look.shirtLight}bb`, 1);
  const sheen = ctx.createLinearGradient(-shoulder + lean, top, shoulder + lean, top + 15);
  sheen.addColorStop(0, `${VENUE_LIGHT.highlight}44`); sheen.addColorStop(1, `${VENUE_LIGHT.highlight}00`);
  path([{ x: -shoulder - 2 + lean, y: top }, { x: shoulder + 2 + lean, y: top }, { x: shoulder + lean, y: top + 6 }, { x: -shoulder + lean, y: top + 10 }], sheen);
  ctx.restore();
  path([{ x: -5 + lean, y: top }, { x: 5 + lean, y: top }, { x: 3.2 + lean, y: top + 4 }, { x: -3.2 + lean, y: top + 4 }], look.trim);
  line({ x: -3.5 + lean, y: top + 1 }, { x: 3.5 + lean, y: top + 1 }, `${look.shirtLight}aa`, .8);
  line({ x: -12 + lean, y: top + 3 }, { x: -6 + lean, y: top + 1 }, look.trim, .8);
  line({ x: 6 + lean, y: top + 1 }, { x: 12 + lean, y: top + 3 }, look.trim, .8);
  ctx.fillStyle = look.trim; ctx.font = 'bold 8px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText(tr(look.number), lean * .35 - turn * 3, -37 + crouch);
}
function drawAthleteGroundLight(height, width, look) {
  const lift=clamp(height/80,0,1), spread=1+lift*.38;
  // Soft body shadow stays on the court and disperses naturally during a jump.
  venueSoftShadow(3+height*VENUE_LIGHT.castX,3+height*VENUE_LIGHT.castY,(25+(1-width)*6)*spread,7*spread,.25-lift*.14);
  const contact=Math.max(0,1-height/12);
  if(contact>0) {
    // Two tight contact pools complement the broad body shadow on matte rubber.
    for(const side of [-1,1]) venueSoftShadow(side*6*width,1.5,6.5,2.8,.23*contact);
    ctx.save();ctx.globalAlpha=contact*.025;
    const reflected=ctx.createLinearGradient(0,5,0,16);
    reflected.addColorStop(0,look.shirt);reflected.addColorStop(1,look.shirt+'00');
    path([{x:-9*width,y:5},{x:9*width,y:5},{x:12*width,y:16},{x:-12*width,y:16}],reflected);
    ctx.restore();
  }
}
function drawPerson(x, y, isOpponent = false, previewOnly = false, visualActor = null) {
  const role=isOpponent ? 'opponent' : 'player', jersey=athleteJersey(role), racket=athleteRacket(role);
  const body = ATHLETE_BODY, look = {...ATHLETE_LOOKS[role],shirt:jersey.main,shirtLight:jersey.light,shirtShade:jersey.shade};
  const p = project(x, y), s = p.scale * 1.16 * figureScale, sy = s * figureYScale;
  if (globalThis.ShuttleAthletes?.ready) {
    const actor = visualActor ?? (isOpponent ? opponent : player), pose = isOpponent ? opponentMotion : motion;
    const height = previewOnly ? 0 : actor.height;
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, sy);
    drawAthleteGroundLight(height, 1, look); ctx.restore();
    globalThis.ShuttleAthletes.draw(ctx, {
      x: p.x, y: p.y, unit: 48 * s, yScale: figureYScale, height,
      pixelRatio: canvas.width / CAMERA_WIDTH, opponent: isOpponent,
      jersey, racket,
      motion: previewOnly ? {} : pose, swing: previewOnly ? null : isOpponent ? opponentSwing : swing,
      vx: previewOnly ? 0 : actor.vx, vy: previewOnly ? 0 : actor.vy,
      verticalVelocity: previewOnly ? 0 : actor.verticalVelocity, recovery: previewOnly ? 0 : actor.jumpRecovery,
      pivot: previewOnly ? 0 : actor.pivot, plantX: previewOnly ? 0 : actor.plantX,
      time: previewOnly ? 0 : elapsed
    });
    return;
  }
  const height = (visualActor ?? (isOpponent ? opponent : player)).height, airborne = height > 8, activeSwing = isOpponent ? opponentSwing : swing;
  const actorMotion = isOpponent ? opponentMotion : motion;
  const run = actorMotion.run, lean = actorMotion.lean;
  const actor = visualActor ?? (isOpponent ? opponent : player);
  const backhand = !isOpponent && (activeSwing ? activeSwing.backhand : delivery?.phase === 'incoming' && isBackhand(player, incomingPosition(delivery)));
  const turn = actorMotion.turn, lunge = actorMotion.lunge, high = actorMotion.high;
  const split = actorMotion.split, brake = actorMotion.brake, stroke = actorMotion.stroke;
  const bodyWidth = 1 - Math.abs(turn) * .24, bodyShear = turn * .055 + (backhand ? -1 : 1) * stroke * .018;
  const balance = airborne ? 0 : actor.pivot || 0, plantX = actor.plantX || 0, plantY = actor.plantY || 0;
  const directionX = clamp((actor.vx || 0) / (isOpponent ? opponent.skill.speed : RULES.speed), -1, 1);
  const directionY = clamp((actor.vy || 0) / (isOpponent ? opponent.skill.speed : RULES.speed), -1, 1);
  const lateral = Math.abs(directionX) > Math.abs(directionY);
  const stride = airborne ? 0 : Math.sin(actorMotion.gait) * (lateral ? 5 : 10) * run * (1 - Math.max(balance, brake) * .75);
  const falling = clamp(-(actor.verticalVelocity || 0) / 360, 0, 1);
  const tuck = airborne ? Math.min(10, height * .17) * (1 - falling * .65) : 0;
  const recovery = (isOpponent ? opponent.jumpRecovery : player.jumpRecovery) / .18;
  const crouch = recovery * 11 + lunge * 9 + split * 5 + (airborne ? -2 : 3 + Math.abs(stride) * .18 + brake * 5);
  const bounce = airborne || recovery ? 0 : Math.abs(Math.sin(actorMotion.gait)) * 2 * run + split * 2;
  const bodyLean = lean + turn * 5 - plantX * balance * 7 + lunge * actorMotion.reachX * 5 + (backhand ? -1 : 1) * stroke * 3 + (activeSwing?.contactScreen ? clamp((activeSwing.contactScreen.x - p.x) * .11, -10, 10) : 0);
  const upper = crouch + actorMotion.pitch - plantY * balance * 3 + lunge * actorMotion.reachY * 3 + stroke * 2;
  const mix = (a, b, t) => a + (b - a) * t, ease = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const readyHand = { x: (backhand ? -26 - high * 2 : 36 - high * 6) + bodyLean, y: (airborne ? -65 : -43 - high * 18) + upper }, readyAngle = backhand ? -.9 - high * .3 : airborne ? -.4 : -.25 - high * .8;
  let hand = { ...readyHand }, angle = readyAngle;
  if (activeSwing) {
    const overhead = activeSwing.overhead;
    const lift = activeSwing.type === 'lift', block = activeSwing.type === 'block', drive = activeSwing.type === 'drive';
    const windupHand = { x: (backhand ? block ? -23 : -29 : block ? 32 : 37) + bodyLean, y: (lift ? -26 : block ? -38 : overhead ? -63 : -48) + upper }, windupAngle = backhand ? lift || block ? -4.2 : overhead ? -.4 : -1.2 : lift ? -3.2 : block ? -3.5 : drive ? -.8 : overhead ? -1.5 : -1.15;
    if (activeSwing.age < SWING.impact) {
      const t = ease(activeSwing.age / SWING.impact);
      hand = { x: mix(readyHand.x, windupHand.x, t), y: mix(readyHand.y, windupHand.y, t) }; angle = mix(readyAngle, windupAngle, t);
    } else {
      const preferredAngle = backhand ? drive ? -1.85 : overhead ? -.75 : -4.0 : drive ? -1.55 : overhead ? ['smash', 'tap'].includes(activeSwing.type) ? .25 : -.25 : -3.7;
      // The racket tip stays at the ball contact point despite the larger character scale.
      const tip = activeSwing.contactScreen ? { x: (activeSwing.contactScreen.x - p.x) / s, y: (activeSwing.contactScreen.y - p.y) / sy + height + bounce } : { x: overhead ? 9 : -8, y: overhead ? -96 : -31 };
      // Invert the body turn so the racket head still meets the world-space shuttle.
      tip.x = (tip.x - bodyShear * tip.y) / bodyWidth;
      // Orient the racket towards the shuttle so the arm need not bend below the waist on a high backhand.
      const shoulderToTip = { x: tip.x - (body.shoulderHalf - 1) - bodyLean, y: tip.y - body.shoulderY - upper };
      const contactAngle = Math.hypot(shoulderToTip.x, shoulderToTip.y) > 12 ? Math.atan2(shoulderToTip.y, shoulderToTip.x) - Math.atan2(-29, 13) + (drive ? -.12 : lift ? .15 : 0) : preferredAngle;
      const vector = { x: 13 * Math.cos(contactAngle) + 29 * Math.sin(contactAngle), y: 13 * Math.sin(contactAngle) - 29 * Math.cos(contactAngle) };
      const contactHand = { x: tip.x - vector.x, y: tip.y - vector.y };
      if (activeSwing.age <= SWING.contactEnd) { hand = contactHand; angle = contactAngle; }
      else {
        const t = clamp((activeSwing.age - SWING.contactEnd) / (SWING.duration - SWING.contactEnd), 0, 1);
        const followHand = { x: (backhand ? block ? -16 : -34 : lift ? 26 : block ? 14 : drive ? -12 : ['drop', 'tap'].includes(activeSwing.type) ? 5 : -18) + bodyLean, y: (lift ? -62 : block ? -41 : drive ? -46 : overhead ? -28 : -40) + upper };
        const followAngle = backhand ? lift ? -.7 : block ? -4.1 : drive ? -2.5 : overhead ? -1.6 : -4.7 : lift ? -.8 : block ? -3.9 : drive ? -2.3 : activeSwing.type === 'tap' ? 1.2 : activeSwing.type === 'drop' ? (overhead ? .6 : -4.1) : overhead ? 2.25 : -5.0;
        const first = ease(t / .6), settle = ease((t - .6) / .4);
        hand = { x: mix(mix(contactHand.x, followHand.x, first), readyHand.x, settle), y: mix(mix(contactHand.y, followHand.y, first), readyHand.y, settle) };
        angle = mix(mix(contactAngle, followAngle, first), readyAngle, settle);
      }
    }
  }
  const { ink, skin, skinShade, shirt } = look;
  const limb = (a, b, width, color, endWidth) => drawAthleteLimb(a, b, width, color, look, endWidth);
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s, sy);
  drawAthleteGroundLight(height, bodyWidth, look);
  if (run > .35 && !airborne) {
    ctx.save(); ctx.globalAlpha = run * .24;
    line({ x: -31 - stride * .20, y: 0 }, { x: -40 - stride * .20, y: 0 }, '#e0efca', 1.5);
    line({ x: -30 + stride * .15, y: 5 }, { x: -36 + stride * .15, y: 5 }, '#e0efca', 1);
    ctx.restore();
  }
  if (activeSwing?.type === 'smash' || (!isOpponent && contactCue().smash)) ellipse(0, 2, 27, 8, null, '#ffd58b88', 1.5);
  ctx.translate(0, -height - bounce);
  ctx.transform(bodyWidth, 0, bodyShear, 1, 0, 0);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Shoes, calf wraps and articulated knees give the split step a clear silhouette.
  for (const side of [-1, 1]) {
    const hip = { x: side * body.hipHalf, y: body.hipY + crouch };
    const brace = !airborne && side === Math.sign(plantX || directionX) ? (balance * plantX + brake * directionX * .45) * 11 : 0;
    const lead = Math.abs(actorMotion.reachX) > .2 ? Math.sign(actorMotion.reachX) : 1;
    const reachStep = side === lead ? lunge * (9 + Math.abs(actorMotion.reachX) * 7) : -lunge * 3;
    const footLift = airborne ? tuck * (side === 1 ? 1 : .60) : Math.max(0, Math.sin(actorMotion.gait + (side === 1 ? 0 : Math.PI))) * run * 5 * (1 - brake);
    const shuffle = lateral ? directionX * stride * side * .7 : stride * .4;
    const stance = split * 5 + recovery * 3;
    const knee = { x: side * (9 + tuck * .30 + stance * .6) + shuffle * .4 + brace * .55 + reachStep * .6, y: body.kneeY - footLift * .48 + crouch * .30 + (lateral ? 0 : stride * side * .24) };
    const ankle = { x: side * (12 + tuck * .35 + stance) + shuffle + brace + reachStep, y: body.ankleY - footLift + (lateral ? 0 : stride * side * .65) + lunge * actorMotion.reachY * (side === lead ? 6 : -2) - (plantY && side !== Math.sign(plantY) ? balance * 3 : 0) };
    if (!airborne && footLift < 3) {
      // Compensate for the body's jump/bounce so each planted sole shades the floor.
      ctx.save(); ctx.transform(1 / bodyWidth, 0, -bodyShear / bodyWidth, 1, 0, 0);
      const contactX = ankle.x * bodyWidth + bodyShear * ankle.y;
      ellipse(contactX + side * 1.5, ankle.y + 5 + bounce, 9, 2.2, `rgba(8,42,45,${.24 * (1 - footLift / 3)})`); ctx.restore();
    }
    limb(hip, knee, body.thigh, skinShade, body.calf); ellipse(knee.x, knee.y, 2.9, 3.1, skin);
    limb(knee, ankle, body.calf, skin, 4.6);
    const sockTop = { x: mix(knee.x, ankle.x, .61), y: mix(knee.y, ankle.y, .61) };
    limb(sockTop, ankle, 6, look.sock, 5.2);
    line({ x: sockTop.x - 2, y: sockTop.y + 1 }, { x: sockTop.x + 2, y: sockTop.y + 1 }, look.accent, 1);
    drawAthleteShoe(ankle, lateral && Math.abs(directionX) > .3 ? Math.sign(directionX) : side, look);
  }
  drawAthleteShorts(crouch, stride, look, body);
  path([{ x: -3.7 + bodyLean, y: -61 + upper }, { x: 3.7 + bodyLean, y: -61 + upper }, { x: 4 + bodyLean, y: -52 + upper }, { x: -4 + bodyLean, y: -52 + upper }], skinShade);
  drawAthleteJersey(bodyLean, upper, crouch, turn, stroke, look, body);
  // The free arm counterbalances the racket arm during a run and lifts on a jump.
  const freeShoulder = { x: -(body.shoulderHalf - 1) + bodyLean, y: body.shoulderY + upper };
  const freeHand = { x: (airborne ? -39 : -38 - stride * .35 - high * 2) + bodyLean - stroke * 4, y: (airborne ? -51 : -31 - high * 24) + upper + stroke * 8 };
  const freeElbow = athleteElbow(freeShoulder, freeHand, -1, body);
  limb(freeShoulder, freeElbow, body.upperArm, skinShade); limb(freeElbow, freeHand, body.foreArm, skin, 4.2); ellipse(freeHand.x, freeHand.y, 2.8, 3.2, skin);
  ellipse(freeHand.x - .6, freeHand.y - 1.3, 1.5, .8, `${look.skinLight}aa`);
  const freeCuff = { x: mix(freeShoulder.x, freeElbow.x, .38), y: mix(freeShoulder.y, freeElbow.y, .38) };
  limb(freeShoulder, freeCuff, 8.4, shirt, 7.8);
  line({ x: freeCuff.x - 2, y: freeCuff.y + 1 }, { x: freeCuff.x + 2, y: freeCuff.y - 1 }, look.trim, .8);
  const shoulder = { x: body.shoulderHalf - 1 + bodyLean, y: body.shoulderY + upper };
  const elbow = athleteElbow(shoulder, hand, backhand ? -1 : 1, body);
  limb(shoulder, elbow, body.upperArm, skinShade); limb(elbow, hand, body.foreArm, skin, 4.2); ellipse(hand.x, hand.y, 2.8, 3.2, skin);
  ellipse(hand.x - .6, hand.y - 1.3, 1.5, .8, `${look.skinLight}aa`);
  const cuff = { x: mix(shoulder.x, elbow.x, .38), y: mix(shoulder.y, elbow.y, .38) };
  limb(shoulder, cuff, 8.4, shirt, 7.8);
  line({ x: cuff.x - 2, y: cuff.y + 1 }, { x: cuff.x + 2, y: cuff.y - 1 }, look.trim, .8);
  limb({ x: mix(elbow.x, hand.x, .68), y: mix(elbow.y, hand.y, .68) }, { x: mix(elbow.x, hand.x, .85), y: mix(elbow.y, hand.y, .85) }, 5.7, look.sock, 5.2);
  // Neck, ears and asymmetric hair make the two players distinguishable.
  ctx.save(); ctx.translate(bodyLean, -68 + upper); ctx.scale(body.headScale, body.headScale); ctx.translate(-bodyLean, 66 - upper);
  ellipse(bodyLean - 10, -66 + upper, 2.5, 4, skinShade); ellipse(bodyLean + 10, -66 + upper, 2.5, 4, skinShade);
  ellipse(bodyLean, -66 + upper, 10.5, 12, skin, ink, 1.5);
  path([{ x: -10 + bodyLean, y: -67 + upper }, { x: -11 + bodyLean, y: -74 + upper }, { x: -5 + bodyLean, y: -79 + upper }, { x: 4 + bodyLean, y: -80 + upper }, { x: 12 + bodyLean, y: -72 + upper }, { x: 9 + bodyLean, y: -67 + upper }, { x: 3 + bodyLean, y: -72 + upper }, { x: -3 + bodyLean, y: -68 + upper }], isOpponent ? '#273b39' : '#213e3b');
  if (!isOpponent) {
    line({ x: -10 + bodyLean, y: -71 + upper }, { x: 10 + bodyLean, y: -71 + upper }, '#f1f4df', 3);
    path([{ x: -6 + bodyLean, y: -77 + upper }, { x: 0 + bodyLean, y: -80 + upper }, { x: 5 + bodyLean, y: -78 + upper }, { x: -1 + bodyLean, y: -74 + upper }], '#496255');
    // Back of the head faces the camera; a cheek becomes visible when turning.
    path([{ x: -10 + bodyLean, y: -68 + upper }, { x: 10 + bodyLean, y: -68 + upper }, { x: 8 + bodyLean, y: -61 + upper }, { x: -7 + bodyLean, y: -61 + upper }], '#213e3b');
    if (Math.abs(turn) > .3) ellipse(bodyLean + Math.sign(turn) * 8, -64 + upper, 3, 5, skin);
  } else {
    ellipse(-3 + bodyLean + turn * 3, -65 + upper, 1.2, 1.5, '#2a3735'); ellipse(3 + bodyLean + turn * 3, -65 + upper, 1.2, 1.5, '#2a3735');
    line({ x: -2 + bodyLean, y: -60 + upper }, { x: 2 + bodyLean, y: -60 + upper }, '#9e6b57', 1);
    ctx.beginPath(); ctx.moveTo(-8 + bodyLean, -67 + upper); ctx.quadraticCurveTo(-9 + bodyLean, -61 + upper, -5 + bodyLean, -59 + upper);
    ctx.strokeStyle = `${look.skinLight}aa`; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-8 + bodyLean, -75 + upper); ctx.quadraticCurveTo(-3 + bodyLean, -80 + upper, 4 + bodyLean, -78 + upper);
  ctx.strokeStyle = `${VENUE_LIGHT.highlight}44`; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.restore();
  if (activeSwing && activeSwing.age > SWING.contactEnd && activeSwing.age < .27) {
    ctx.save(); ctx.globalAlpha = activeSwing.type === 'smash' ? .42 : .22;
    const points = []; for (let i = 0; i < 8; i++) { const a = angle - .8 + i * .8 / 7; points.push({ x: hand.x + 13 * Math.cos(a) + 29 * Math.sin(a), y: hand.y + 13 * Math.sin(a) - 29 * Math.cos(a) }); }
    ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.strokeStyle = shotColors[activeSwing.type] ?? '#e3f5bf'; ctx.lineWidth = activeSwing.type === 'smash' ? 6 : activeSwing.type === 'block' ? 1.5 : 3; ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(angle);
  const metal = ctx.createLinearGradient(2, -44, 24, -14);
  metal.addColorStop(0, racket.accent); metal.addColorStop(.4, racket.frame); metal.addColorStop(1, racket.frame);
  line({ x: 0, y: 0 }, { x: 8, y: -19 }, metal, 4);
  line({ x: -.6, y: -1 }, { x: 6.4, y: -18 }, '#fff4d588', .8);
  line({ x: 0, y: 0 }, { x: 4, y: -10 }, racket.grip, 4.5);
  const rx = 10 * racket.scale * racket.width, ry = 14 * racket.scale * racket.height, power = 2 / racket.exponent;
  const outline = Array.from({ length: 64 }, (_, i) => { const a = i * Math.PI / 32, c = Math.cos(a), s = Math.sin(a); return { x: 13 + rx * Math.sign(c) * Math.abs(c) ** power, y: -29 + ry * Math.sign(s) * Math.abs(s) ** power }; });
  path(outline, '#d8e8d422', metal, 2.5);
  for (let i = -2; i <= 2; i++) {
    const fraction = i / 3, extent = (1 - Math.abs(fraction) ** racket.exponent) ** (1 / racket.exponent);
    line({ x: 13 + rx * fraction, y: -29 - ry * extent }, { x: 13 + rx * fraction, y: -29 + ry * extent }, racket.strings + '99', .8);
    line({ x: 13 - rx * extent, y: -29 + ry * fraction }, { x: 13 + rx * extent, y: -29 + ry * fraction }, racket.strings + '99', .8);
  }
  ctx.restore(); ctx.restore();
}
function courtText(text, x, y) {
  const pixelX = canvas.width / CAMERA_WIDTH, pixelY = canvas.height / CAMERA_HEIGHT;
  ctx.save(); ctx.translate(Math.round(x * pixelX) / pixelX, Math.round(y * pixelY) / pixelY); ctx.scale(courtTextScale, courtTextScale * figureYScale);
  ctx.fillText(tr(text), 0, 0); ctx.restore();
}
function courtLabel(text, x, y) {
  ctx.save(); ctx.fillStyle = courtTextInks[lanActive && lanView ? lanView.court : appearanceSettings.court] ?? courtTextInks.classic;
  courtText(text, x, y); ctx.restore();
}
let courtLabels = [];
function queueCourtLabel(text, x, y) { courtLabels.push({ text, x, y, font: ctx.font }); }
function drawGuideRing(x, y, rx, ry, fill, color, outline, width = 2.5) {
  // Two contrasting edges stay visible over pale floors and painted court lines.
  const detail = Math.min(1.7, courtTextScale);
  ctx.save(); ctx.translate(x, y); ctx.scale(detail, detail * figureYScale);
  ellipse(0, 0, rx, ry, fill, outline, width + 3);
  ellipse(0, 0, rx, ry, null, color, width); ctx.restore();
}
function drawGuideCross(p, color, outline, size = 5) {
  const detail = Math.min(1.7, courtTextScale);
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(detail, detail * figureYScale);
  for (const [stroke, width] of [[outline, 4], [color, 1.8]]) {
    line({ x: -size, y: 0 }, { x: size, y: 0 }, stroke, width);
    line({ x: 0, y: -size / 2 }, { x: 0, y: size / 2 }, stroke, width);
  }
  ctx.restore();
}
function drawChallengeZone() {
  if (!challenge || !challengeZone || state === 'ready') return;
  const zone = challengeZone, result = delivery?.challengeResult;
  const color = result ? result.success ? '#d7f583' : '#ff9277' : '#ffdb76';
  ctx.save();
  function outline(scale, fill) {
    const rx = (zone.maxX - zone.minX) * scale / 2, ry = (zone.maxY - zone.minY) * scale / 2;
    const corners = [[-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry]].map(([x, y]) => project(zone.x + x, zone.y + y));
    ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y);
    for (const point of corners.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = markerOutline(color); ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  }
  outline(1, `${color}22`);
  ctx.setLineDash([4, 4]); outline(.5, `${color}18`); ctx.setLineDash([]);
  const label = project(zone.x, zone.minY);
  ctx.font = `500 16px ${COURT_FONT}`; ctx.textAlign = 'center';
  courtLabel(zone.name, label.x, label.y - 12 * courtTextScale);
  ctx.restore();
}
function drawTarget() {
  if (delivery?.phase !== 'incoming') return;
  const cue = contactCue();
  const landingPoint = project(delivery.target.x, delivery.target.y);
  const remaining = contactTime(player, delivery) - delivery.age;
  const guides = landingGuides();
  // Landing predicts the route; the brighter cue follows the actual contact position for every feed.
  {
    drawGuideRing(landingPoint.x, landingPoint.y, 20 * landingPoint.scale, 8 * landingPoint.scale, guides.landing + '20', guides.landing, guides.landingOutline);
    const detail = Math.min(1.7, courtTextScale);
    ellipse(landingPoint.x, landingPoint.y, 2.5 * detail, 2.5 * detail * figureYScale, guides.landing);
  }
  if (!cue.point || cue.point.y < .075) return;
  const p = project(cue.point.x, cue.point.y), perfect = cue.grade === 'perfect';
  const color = cue.smash ? '#ffd58b' : perfect ? '#e3ffa3' : cue.grade ? '#a3e5f4' : guides.waiting;
  const radius = cue.grade ? perfect ? 21 : 25 : 26 + 20 * clamp(remaining / delivery.duration, 0, 1);
  ctx.save();
  ctx.setLineDash(cue.grade ? [] : [5, 4]);
  drawGuideRing(p.x, p.y, radius * p.scale, radius * .38 * p.scale, `${color}${cue.grade ? '30' : '12'}`, color, guides.outline, cue.grade ? 3 : 2);
  ctx.setLineDash([]);
  if (perfect) drawGuideRing(p.x, p.y, (radius + 7) * p.scale, (radius + 7) * .38 * p.scale, null, color, guides.outline, 1.5);
  drawGuideCross(p, color, guides.outline);
  if (guidanceMode === 'compact') { ctx.restore(); return; }
  const label = cue.smash ? cue.backhand ? 'Backhand smash · Right click!' : 'Perfect timing · Right click to smash' : perfect ? cue.backhand ? 'Backhand · Perfect timing!' : 'Perfect timing · Swing!' : cue.grade ? cue.backhand ? 'Backhand · Hit now' : 'Hit now' : cue.reason === 'high' ? 'Too high' : cue.reason === 'recovering' ? 'Racket recovering' : cue.reason === 'far' ? 'Move here' : cue.reason === 'late' ? 'Too late' : 'Ready · Wait for the solid ring';
  ctx.font = `${cue.grade ? '600' : '500'} 16px ${COURT_FONT}`; ctx.textAlign = 'center';
  const gap = Math.max(25, radius * .38 * p.scale * Math.min(1.7, courtTextScale) + 10) * figureYScale;
  let labelY = p.y + gap;
  const labelWidth = (ctx.measureText(tr(label)).width + 20) * courtTextScale;
  const labelHeight = 30 * courtTextScale * figureYScale;
  const landingRadius = (8 * landingPoint.scale * Math.min(1.7, courtTextScale) + 7) * figureYScale;
  if (Math.abs(p.x - landingPoint.x) < labelWidth / 2 + 30 && labelY < landingPoint.y + landingRadius && labelY + labelHeight > landingPoint.y - landingRadius) {
    labelY = p.y - gap - labelHeight;
  }
  const actor = project(player.x, player.y);
  const actorTop = actor.y - (110 * figureScale * actor.scale + player.height * .84) * figureYScale;
  if (Math.abs(p.x - actor.x) < labelWidth / 2 + 40 * figureScale * actor.scale && labelY < actor.y + 10 * figureYScale && labelY + labelHeight > actorTop) {
    labelY = actorTop - labelHeight - 20 * figureYScale;
  }
  queueCourtLabel(label, p.x, labelY + 21 * courtTextScale * figureYScale);
  ctx.restore();
}
function drawAim() {
  if (state !== 'playing' || roundBreak > 0) return;
  if (delivery?.phase === 'serve' && match.server === 'computer') return;
  const locked = delivery?.phase === 'return';
  const aimSwing = swing && (!swing.contacted || locked || delivery?.phase === 'serve') ? swing : null;
  const requested = aimSwing?.requested ?? previewShot;
  const service = delivery?.phase === 'serve' ? planService(match, { x: player.x + .02, y: player.y, z: 50 }, requested, aimSwing?.aimX ?? aimX) : null;
  const previewPower = service ? service.power : aimSwing?.power ?? selectedPower ?? defaultPowerFor(requested, powerDefaults);
  const prediction = contactPrediction();
  const preview = shotFor(prediction?.player ?? player, prediction?.point ?? null, requested, previewPower, prediction?.ball ?? delivery);
  const type = locked ? delivery.shotType : service ? service.type : preview.type;
  const previewError = prediction && (isInterceptable(prediction.ball) || prediction.ball.age >= contactTime(prediction.player, prediction.ball) - RULES.early) ? contactTimingError(prediction.player, prediction.ball) : 0;
  const chosenX = aimSwing?.aimX ?? aimX;
  const planned = prediction ? planReturn(prediction.player, prediction.point, requested, previewPower, chosenX, previewError, prediction.ball) : null;
  const depth = locked ? delivery.returnTarget.y : service ? service.target.y : planned?.target.y ?? preview.targetDepth;
  const x = locked ? delivery.returnTarget.x : service ? service.target.x : chosenX, p = project(x, depth);
  const fault = locked ? delivery.fault : planned?.fault;
  const out = fault?.type === 'out' || (delivery?.phase !== 'serve' && (x < SERVICE.sideline || x > 1 - SERVICE.sideline));
  const color = out || fault?.type === 'net' ? '#ffb49c' : appearanceSettings.aimColor ?? shotColors[type] ?? '#dcf797';
  const guides = courtStyle().guides;
  const outline = appearanceSettings.aimColor ? markerOutline(color) : guides.outline;
  ctx.save(); ctx.setLineDash([5, 4]); drawGuideRing(p.x, p.y, 27 * p.scale, 11 * p.scale, `${color}18`, color, outline); ctx.setLineDash([]);
  drawGuideCross(p, color, outline, 8);
  if (guidanceMode === 'compact' && !out && fault?.type !== 'net') { ctx.restore(); return; }
  ctx.font = `500 16px ${COURT_FONT}`; ctx.textAlign = 'center';
  const label = `${laneName(x)} · ${out ? 'Out' : fault?.type === 'net' ? 'Net' : locked ? 'Landing' : 'Aim'}`;
  let labelY = p.y + 32 * courtTextScale * figureYScale;
  const actor = project(mode === 'match' ? opponent.x : delivery?.from?.x ?? .5, mode === 'match' ? opponent.y : -.70);
  const actorTop = actor.y - (110 * figureScale * actor.scale + (mode === 'match' ? opponent.height * .84 : 0)) * figureYScale;
  const textHeight = 16 * courtTextScale * figureYScale;
  if (Math.abs(p.x - actor.x) < ctx.measureText(tr(label)).width * courtTextScale / 2 + 40 * figureScale * actor.scale && labelY > actorTop && labelY - textHeight < actor.y + 10 * figureYScale) {
    labelY = actor.y + textHeight + 12 * figureYScale;
  }
  queueCourtLabel(label, p.x, labelY); ctx.restore();
}
function ballPosition(ball = delivery) {
  if (!ball) return null;
  if (ball.phase === 'serve') { const actor = match.server === 'player' ? player : opponent, ground = project(actor.x + (match.server === 'player' ? .02 : 0), actor.y); return { ...ground, z: 50, rotate: .7 }; }
  if (ball.phase === 'point') { const ground = project(ball.pointPosition.x, ball.pointPosition.y); return { ...ground, z: ball.pointPosition.z * Math.max(0, 1 - ball.age / .15), rotate: 1.1 }; }
  if (ball.phase === 'miss') { const ground = project(ball.target.x, ball.target.y); return { ...ground, z: Math.max(0, 8 * (1 - ball.age / .1)), rotate: 1.1 }; }
  const back = ball.phase === 'return', point = back ? returnPosition(ball) : incomingPosition(ball);
  const ground = project(point.x, point.y);
  return { ...ground, z: point.z, rotate: back ? ball.shotType === 'drive' ? -1.5 : ['smash', 'tap'].includes(ball.shotType) ? -1.7 : -.9 : ['attack', 'smash', 'jumpSmash', 'drive'].includes(ball.incomingType) ? -1.4 : .7 };
}
function drawBall(ball = delivery) {
  const p = ballPosition(ball); if (!p) return;
  const feel = killEffect(ball?.shotType, ball?.power);
  if (ball?.phase === 'incoming' && ['attack', 'smash', 'jumpSmash', 'drive'].includes(ball.incomingType) && ball.age > 0) {
    const lead = ball.incomingType === 'jumpSmash' ? .13 : ball.incomingType === 'smash' ? .10 : .075;
    const previous = incomingPosition({ ...ball, age: Math.max(0, ball.age - lead) }), ground = project(previous.x, previous.y);
    line({ x: ground.x, y: ground.y - previous.z * figureYScale }, { x: p.x, y: p.y - p.z * figureYScale }, `${incomingColors[ball.incomingType]}bb`, ball.incomingType === 'jumpSmash' ? 5 : ball.incomingType === 'smash' ? 4 : 3);
  }
  if (ball?.phase === 'return' && ball.shotType === 'drive' && ball.age > 0) {
    const previous = returnPosition(ball, Math.max(0, ball.age - .075)), ground = project(previous.x, previous.y);
    line({ x: ground.x, y: ground.y - previous.z * figureYScale }, { x: p.x, y: p.y - p.z * figureYScale }, '#c5baffbb', 2 + ball.power * .4);
  }
  if (feel && trail.length > 1) {
    ctx.save(); ctx.lineCap = 'round'; ctx.shadowColor = '#ffd58b'; ctx.shadowBlur = ball.power === 3 ? 8 : ball.power === 2 ? 4 : 0;
    for (let i = 1; i < trail.length; i++) { const fade = i / (trail.length - 1); line(trail[i - 1], trail[i], `rgba(255,213,139,${fade * feel.opacity})`, .6 + fade * feel.width); }
    ctx.restore();
  }
  const shadowAlpha = Math.max(.10, .28 - p.z / 1500);
  ellipse(p.x + 1, p.y + 1, 10 + p.z / 27, 3.5 + p.z / 90, `rgba(8,35,43,${shadowAlpha * .35})`);
  ellipse(p.x, p.y, 6 + p.z / 40, 2 + p.z / 130, `rgba(8,35,43,${shadowAlpha})`);
  ctx.save(); ctx.translate(p.x, p.y - p.z * figureYScale); ctx.scale(p.scale * figureScale, p.scale * figureScale * figureYScale); ctx.rotate(p.rotate);
  ctx.shadowColor = '#35594d22'; ctx.shadowBlur = 2;
  path([{ x: -9, y: -16 }, { x: -5, y: -18 }, { x: 0, y: -18.5 }, { x: 5, y: -18 }, { x: 9, y: -16 }, { x: 4, y: 0 }, { x: -4, y: 0 }], '#fafbf0', '#738679', .9);
  ctx.shadowBlur = 0;
  for (const x of [-7, -3.5, 0, 3.5, 7]) line({ x, y: -16 }, { x: x * .4, y: -1 }, '#a4b9ac', .7);
  line({ x: -5.7, y: -6 }, { x: 5.7, y: -6 }, '#c0cbbb', .8);
  line({ x: -4.5, y: -2 }, { x: 4.5, y: -2 }, '#75928d', 1.5);
  ellipse(0, 1, 4, 4, '#e4d4ad', '#aebba1', .6);
  ellipse(-1, 0, 2.3, 2.3, '#fff5d9'); ctx.restore();
}
function drawServiceCourts() {
  if (mode !== 'match' || delivery?.phase !== 'serve' || roundBreak > 0) return;
  const setup = serviceSetup(match);
  for (const [court, label, color] of [[setup.serverCourt, 'Service court', '#dcf797'], [setup.receiverCourt, 'Receiving court', '#a3e5f4']]) {
    path([project(court.minX, court.minY), project(court.maxX, court.minY), project(court.maxX, court.maxY), project(court.minX, court.maxY)], `${color}20`, `${color}99`, 2);
    const centerY = (court.minY + court.maxY) / 2;
    const p = project((court.minX + court.maxX) / 2, centerY > 0 ? court.minY : court.maxY - .12);
    if (guidanceMode === 'full') { ctx.font = `500 16px ${COURT_FONT}`; ctx.textAlign = 'center'; courtLabel(`${setup.right ? 'Right ' : 'Left '}${label}`, p.x, p.y); }
  }
}
function draw(previewOnly = false) {
  courtLabels = [];
  ctx.clearRect(0, 0, CAMERA_WIDTH, CAMERA_HEIGHT); drawCourt();
  if (previewOnly) { drawPerson(.5, -.70, true, true); drawNet(); drawPerson(.5, .6, false, true); return; }
  const visual = lanActive && !lanFailed ? lanClient?.presentation() : null;
  const far = visual?.opponent ?? opponent;
  drawServiceCourts(); drawChallengeZone(); drawAim(); drawTutorialTarget(); drawPerson(mode === 'match' ? far.x : delivery?.from?.x ?? .5, mode === 'match' ? far.y : -.70, true, false, far); drawNet(); drawTarget();
  if (landing) { const p = project(landing.x, landing.y), t = landing.age / .24; ctx.globalAlpha = (1 - t) * .5; ellipse(p.x, p.y, (18 + 24 * t) * p.scale, (6 + 8 * t) * p.scale, null, '#dbefaf', 2); ctx.globalAlpha = 1; }
  drawPerson(player.x, player.y); drawBall(visual?.delivery ?? delivery);
  if (impact) { const t = impact.age / .20, feel = killEffect(impact.shotType, impact.power), radius = feel?.flash ?? 22; ctx.globalAlpha = 1 - t; ellipse(impact.x, impact.y, 5 + t * radius, 5 + t * radius, null, feel || impact.smash ? '#ffd58b' : '#ecffcd', feel ? 1.5 + impact.power * .55 : 2); if (feel && impact.power === 3) { ctx.globalAlpha = (1 - t) * .38; ellipse(impact.x, impact.y, 2 + t * radius * .58, 2 + t * radius * .58, null, '#fff3be', 2); } ctx.globalAlpha = 1; }
  for (const p of particles) { ctx.globalAlpha = p.life / .6; ellipse(p.x, p.y, 2.5, 2.5, p.color); } ctx.globalAlpha = 1;
  for (const label of courtLabels) {
    ctx.save(); ctx.font = label.font; ctx.textAlign = 'center'; courtLabel(label.text, label.x, label.y); ctx.restore();
  }
}
function ownLanLook() {
  const look = {};
  for (const part of ['JerseyColor', 'JerseyStripe', 'RacketStyle', 'RacketSize', 'RacketColor', 'RacketGrip']) look[part] = appearanceSettings['player' + part];
  return look;
}
const lanMessages = {
  idle: "Create a room or enter your friend's address.",
  connecting: 'Connecting…',
  connected: 'Connected. Get ready when both players have joined.',
  address: 'Enter a valid IPv4 address and port, for example 26.12.34.56:3210.',
  port: 'This port is in use. Choose another port.',
  host: 'Could not create the room. Check the port and try again.',
  connection: 'Could not connect. Check the IP, port, Radmin network and firewall.',
  timeout: 'Connection timed out. Check the IP, port, Radmin network and firewall.',
  version: 'Game versions differ. Both players need the same game release.',
  full: 'Room unavailable. Check that the host is waiting and the room is not full.',
  disconnected: 'Connection lost. Leave this room and create or join a new one.'
};
function lanStatus(code) {
  i18n.text($('lan-status'), lanMessages[code] ?? lanMessages.connection);
  $('lan-status').classList.toggle('error', !['idle', 'connecting', 'connected'].includes(code));
}
function renderLanRoom() {
  const joined = lanClient?.connected;
  $('lan-connect').classList.toggle('hidden', joined || lanFailed);
  $('lan-room').classList.toggle('hidden', !joined && !lanFailed);
  $('lan-ready').classList.toggle('hidden', !joined || lanFailed);
  $('lan-ready').disabled = !lanView?.connected?.[1] || lanBusy;
  $('lan-create').disabled = lanBusy || !window.shuttleDesktop;
  $('lan-join').disabled = lanBusy;
  $('lan-desktop-note').classList.toggle('hidden', Boolean(window.shuttleDesktop));
  $('lan-host-addresses').classList.toggle('hidden', !lanHosting || !joined);
  i18n.text($('lan-leave'), joined || lanFailed ? 'Leave room' : 'Back to match setup');
  if (!lanView) return;
  i18n.text($('lan-you'), lanView.ready[0] ? 'You · Ready' : 'You · Not ready');
  i18n.text($('lan-friend'), !lanView.connected[1] ? 'Friend · Waiting to join' : lanView.ready[1] ? 'Friend · Ready' : 'Friend · Not ready');
  i18n.text($('lan-ready'), lanView.ready[0] ? 'Cancel ready' : 'Ready');
  i18n.text($('lan-room-format'), lanView.match.target + ' points · Win by 2 · Cap ' + lanView.match.cap);
}
function closeLan() {
  lanGeneration++; lanClient?.disconnect();
  lanActive = lanHosting = lanBusy = lanFailed = false; lanView = lanRoom = null;
  lanRound = lanFlight = -1; courtBackdrop = null;
  $('resume').disabled = false; i18n.html($('resume'), 'Resume game <span>↗</span>');
  i18n.text($('match-player').querySelector('span').firstChild, 'You ');
  // Closing a room also releases its listening socket before the next create.
  window.shuttleDesktop?.stopLan().catch(() => {});
}
function leaveLan() {
  closeLan(); keys.clear(); touchControls.reset(); returnToMenu(); openModeSetup('match');
}
async function connectLan(hosting) {
  if (lanBusy) return;
  const generation = ++lanGeneration; lanBusy = true; lanFailed = false;
  lanHosting = hosting; lanStatus('connecting'); renderLanRoom();
  try {
    let address = $('lan-address').value.trim(), token;
    if (hosting) {
      const port = Number($('lan-port').value), target = Number($('lan-points').value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('address');
      const room = await window.shuttleDesktop.hostLan({ port, target, court: appearanceSettings.court });
      if (generation !== lanGeneration) return;
      if (room.error) throw new Error(room.error);
      lanRoom = room; token = room.token; address = '127.0.0.1:' + room.port;
      $('lan-addresses').textContent = room.addresses.map(ip => ip + ':' + room.port).join('\n') || address;
    } else globalThis.ShuttleLan.parseAddress(address);
    await lanClient.connect(address, { token, look: ownLanLook() });
    if (generation !== lanGeneration) return;
    if (!hosting) try { localStorage.setItem('shuttle-flow-lan-address', address); } catch {}
    enableAudio();
  } catch (error) {
    if (generation !== lanGeneration) return;
    lanClient.disconnect(); lanStatus(error.message);
    if (hosting) { lanHosting = false; window.shuttleDesktop?.stopLan().catch(() => {}); }
  } finally {
    if (generation === lanGeneration) { lanBusy = false; renderLanRoom(); }
  }
}
function receiveLan(view) {
  const previous = lanView; lanView = view;
  if (view.phase === 'disconnected') {
    lanFailed = true; state = 'paused'; keys.clear(); touchControls.reset();
    lanStatus('disconnected'); showPanel('lan-panel'); renderLanRoom(); return;
  }
  if (view.phase === 'lobby') { renderLanRoom(); return; }
  if (!lanActive) {
    lanActive = true; mode = 'match'; tutorial = challenge = training = null;
    document.body.classList.remove('tutorial-mode'); $('tutorial-coach').classList.add('hidden');
    setFocusView(true); courtBackdrop = null; player = { ...view.player }; opponent = { ...view.opponent };
    particles = []; trail = []; impact = landing = swing = opponentSwing = null;
  }
  match = view.match;
  if (lanRound !== view.round) {
    lanRound = view.round; player = { ...view.player }; opponent = { ...view.opponent };
    keys.clear(); touchControls.reset(); swing = opponentSwing = null; setPower(null); previewShot = 'clear';
    for (const m of [motion, opponentMotion]) for (const k of Object.keys(m)) m[k] = 0;
  }
  if (lanFlight !== view.flightId) { lanFlight = view.flightId; trail = []; setPower(null); }
  if (view.phase === 'over') {
    if (previous?.phase !== 'over') finishLan();
    else if (currentPanel === 'lan-panel') renderLanRoom();
    return;
  }
  if (view.phase === 'paused') {
    state = 'paused'; keys.clear(); touchControls.reset();
    if (!['settings', 'help', 'personalization'].includes(currentPanel) || $('overlay').classList.contains('hidden')) showPanel('paused');
    $('resume').disabled = !view.paused[0];
    i18n.text($('resume'), view.paused[0] ? 'Resume game' : 'Waiting for friend to resume');
    i18n.text($('pause'), '▶');
  } else {
    const wasPlaying = state === 'playing';
    state = 'playing'; $('overlay').classList.add('hidden'); i18n.text($('pause'), 'Ⅱ');
    if (!wasPlaying) canvas.focus({ preventScroll: true });
    $('resume').disabled = false;
    // A ready player may have minimized the window before the start arrived.
    if (document.hidden) toggleLanPause(true);
  }
  updateLanHud();
}
function handleLanEvent(event, side) {
  if (!lanActive || lanFailed) return;
  const mine = event.side === side;
  if (event.type === 'hit') {
    const contact = mine ? event.contact : globalThis.ShuttleLanCore.mirror(event.contact);
    const ground = project(contact.x, contact.y);
    const point = { x: ground.x, y: ground.y - contact.z * figureYScale, groundY: ground.y, flightHeight: contact.z };
    const stroke = { age: SWING.impact, type: event.shot, requested: event.shot, contacted: true,
      power: event.power, backhand: event.backhand, overhead: event.overhead, contactScreen: point };
    if (mine) swing = stroke; else opponentSwing = stroke;
    impact = { ...point, age: 0, shotType: event.shot, power: event.power, smash: ['smash', 'tap'].includes(event.shot) };
    const feel = killEffect(event.shot, event.power);
    burst(point, shotColors[event.shot] ?? '#ddfc91', feel?.particles ?? 18, feel?.scatter ?? 100);
    sound(event.shot === 'smash' ? 'smash' : event.shot === 'tap' ? 'tap' : ['drop', 'block'].includes(event.shot) ? 'drop' : 'hit', event.power);
    feedback(mine ? shotNames[event.shot] : 'Friend: ' + shotNames[event.shot], '', false, mine ? 'hit' : 'opponent');
  } else if (event.type === 'miss' && mine) {
    const reason = hitReasons[event.reason] ?? hitReasons['no-ball'];
    feedback(event.reason === 'serve' ? 'Stop moving before serving' : reason[0], event.reason === 'serve' ? 'Both players must stop in their service courts.' : reason[1], true);
    sound('swing');
  } else if (event.type === 'point') {
    keys.clear(); touchControls.reset(); trail = []; swing = opponentSwing = null;
    feedback(mine ? 'You score +1' : 'Friend scores +1', event.reason === 'out' ? 'Out' : event.reason === 'net' ? 'Net' : '', !mine);
    sound(mine ? 'perfect' : 'miss');
  }
}
function updateLanHud() {
  if (!lanView) return;
  const m = lanView.match;
  document.querySelector('.hud').classList.add('hidden');
  document.querySelector('.best-label').classList.add('hidden');
  document.querySelector('.game-shell').classList.add('match-mode');
  $('match-board').classList.remove('hidden'); $('drill-end').classList.add('hidden');
  $('ai-status').classList.remove('hidden');
  i18n.text($('mode-label'), 'LAN Match');
  i18n.text($('match-computer').querySelector('span').firstChild, 'Friend ');
  i18n.text($('match-player-score'), m.player); i18n.text($('match-computer-score'), m.computer);
  i18n.text($('match-format'), m.target + ' pts · LAN Match');
  i18n.text($('match-server'), m.winner ? 'Match complete' : m.server === 'player' ? 'Your serve' : 'Friend serve');
  $('match-player').classList.toggle('serving', m.server === 'player' && !m.winner);
  $('match-computer').classList.toggle('serving', m.server === 'computer' && !m.winner);
  i18n.attr($('match-player'), 'aria-label', 'You: ' + m.player + ' points');
  i18n.attr($('match-computer'), 'aria-label', 'Friend: ' + m.computer + ' points');
  const tied = m.player === m.computer && m.player >= m.target - 1;
  const yourPoint = m.player >= m.cap - 1 || (m.player >= m.target - 1 && m.player > m.computer);
  const theirPoint = m.computer >= m.cap - 1 || (m.computer >= m.target - 1 && m.computer > m.player);
  i18n.text($('match-situation'), m.winner ? m.winner === 'player' ? 'You win' : 'Friend wins' : yourPoint && theirPoint ? 'Match point' : yourPoint ? 'Your match point' : theirPoint ? 'Friend match point' : tied ? 'Deuce · Win by 2 · Cap ' + m.cap : 'Rally: ' + lanView.rally + ' shots');
  $('match-situation').classList.toggle('game-point', !m.winner && (yourPoint || theirPoint));
  i18n.text($('ai-status'), 'LAN Match · ' + lanClient.ping + ' ms');
  i18n.text($('pause-menu'), 'Leave room');
}
function toggleLanPause(forcePause = false) {
  if (lanFailed || !lanClient.connected || !['playing', 'paused'].includes(state)) return;
  const paused = forcePause || state === 'playing' || !lanView?.paused[0];
  lanClient.pause(paused); keys.clear(); touchControls.reset();
  if (paused) {
    state = 'paused'; showPanel('paused');
    i18n.text($('resume'), 'Resume game'); $('resume').disabled = false;
  }
}
function hitLan(requested) {
  if (state !== 'playing' || roundBreak > 0 || cooldown > 0 || swing || lanFailed) return;
  if (delivery?.phase === 'serve' && match.server !== 'player') return;
  const power = selectedPower ?? defaultPowerFor(requested, powerDefaults);
  const prediction = contactPrediction();
  const contact = prediction?.point ?? { x: player.x + .02, y: player.y, z: 50 };
  const shot = shotFor(prediction?.player ?? player, contact, requested, power, prediction?.ball ?? delivery);
  const { dx, dy } = movementInput(); lanClient.input(dx, dy);
  lanClient.action('hit', { requested, power, aim: aimX, flightId: lanView.flightId });
  swing = { age: 0, type: shot.type, requested, power, aimX, contacted: true,
    overhead: shot.overhead, backhand: shot.backhand, serving: delivery?.phase === 'serve' };
  cooldown = RULES.cooldown; enableAudio();
}
function finishLan() {
  state = 'over'; keys.clear(); touchControls.reset();
  match = lanView.match;
  i18n.text($('result-kicker'), 'LAN Match');
  i18n.text($('result-title'), match.winner === 'player' ? 'You won. Well played!' : 'Friend wins');
  i18n.text($('final-score'), match.player + ' : ' + match.computer);
  i18n.text($('result-details'), match.target + ' points · Win by 2 · Cap ' + match.cap + '\nLongest rally ' + lanView.longest);
  $('result-training').classList.add('hidden');
  i18n.text($('restart'), 'Ready for rematch'); showPanel('results'); $('restart').focus();
  updateLanHud();
}
function updateLan(dt) {
  if (lanFailed || !lanClient?.connected) return;
  const sample = lanClient.sample();
  if (!sample || !['playing', 'paused'].includes(sample.phase)) return;
  match = sample.match; delivery = sample.delivery; opponent = sample.opponent;
  roundBreak = sample.stage === 'point' ? 1 : 0;
  if (state !== 'playing') { lanClient.input(0, 0); player = sample.player; return; }
  const { dx, dy } = movementInput(); lanClient.input(dx, dy);
  // Respond to movement immediately; reconcile small differences against the
  // authoritative state rather than snapping the local player every packet.
  if (!roundBreak) movePlayer(player, dx, dy, dt);
  const blend = Math.min(1, dt * 12);
  player.x += (sample.player.x - player.x) * blend; player.y += (sample.player.y - player.y) * blend;
  updateJump(player, dt);
  if (sample.player.height > 0 || player.verticalVelocity <= 0) {
    player.height += (sample.player.height - player.height) * blend;
    player.verticalVelocity = sample.player.verticalVelocity; player.jumpRecovery = sample.player.jumpRecovery;
  }
  if (sample.stage === 'serve') constrainToServiceCourt(player, serviceSetup(match).playerCourt);
  cooldown = Math.max(0, cooldown - dt, sample.cooldown - dt);
  for (const which of ['player', 'opponent']) {
    const actor = which === 'player' ? player : opponent, pose = which === 'player' ? motion : opponentMotion;
    const stroke = which === 'player' ? swing : opponentSwing;
    const run = roundBreak ? 0 : clamp(Math.hypot(actor.vx, actor.vy) / RULES.speed, 0, 1);
    pose.run += (run - pose.run) * Math.min(1, dt * 12);
    pose.lean += ((actor.vx / RULES.speed * 6) - pose.lean) * Math.min(1, dt * 6);
    pose.pitch += ((actor.vy / RULES.speed * 3) - pose.pitch) * Math.min(1, dt * 9);
    pose.gait += dt * (7 + 11 * pose.run);
    const ball = delivery?.phase === 'incoming' ? incomingPosition(delivery) : delivery?.phase === 'return' ? returnPosition(delivery) : null;
    updatePose(actor, pose, stroke, ball, dt, which === 'opponent');
    if (stroke) {
      stroke.age += dt;
      if (stroke.age >= SWING.duration) { if (which === 'player') swing = null; else opponentSwing = null; }
    }
  }
  if (impact) { impact.age += dt; if (impact.age > .2) impact = null; }
  for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt; p.life -= dt; }
  particles = particles.filter(p => p.life > 0);
  if (feedbackTime > 0) { feedbackTime -= dt; if (feedbackTime <= 0) $('feedback').classList.remove('visible'); }
  const cue = contactCue();
  i18n.text($('action-status'), roundBreak ? 'Next rally' : delivery?.phase === 'serve' ? match.server === 'player' ? 'Your serve · Left: long / Right: short' : 'Friend serve · Stop moving to receive' : delivery?.phase === 'return' ? 'Get ready for the return' : cue.smash ? 'Jump smash · Right click' : cue.grade ? 'Hit now' : cue.reason === 'far' ? 'Move to the contact ring' : cue.reason === 'high' ? 'Too high · Wait or jump' : 'Ready for the next shuttle');
  $('action-status').classList.toggle('smash-ready', Boolean(cue.smash));
  updateShotOptions(); updatePowerStatus(); updateLanHud();
}
function setupLan() {
  if (!globalThis.ShuttleLan) return;
  lanClient = globalThis.ShuttleLan.createClient({
    onState: receiveLan, onEvent: handleLanEvent,
    onStatus(code) {
      lanStatus(code);
      if (!['idle', 'connecting', 'connected'].includes(code) && lanActive) {
        lanFailed = true; state = 'paused'; keys.clear(); touchControls.reset(); showPanel('lan-panel'); renderLanRoom();
      }
    }
  });
  $('lan-open').onclick = () => {
    lanStatus('idle'); $('lan-points').value = String(selectedPoints);
    try { $('lan-address').value = localStorage.getItem('shuttle-flow-lan-address') ?? ''; } catch {}
    renderLanRoom(); showPanel('lan-panel'); $('lan-address').focus();
  };
  $('lan-create').onclick = () => connectLan(true); $('lan-join').onclick = () => connectLan(false);
  $('lan-leave').onclick = $('lan-back').onclick = leaveLan;
  $('lan-ready').onclick = () => { if (lanView && !lanFailed) lanClient.ready(!lanView.ready[0], ownLanLook()); };
  $('lan-address').addEventListener('keydown', event => { if (event.code === 'Enter') connectLan(false); });
}
let last = performance.now();
function frame(now) {
  if (renderDpr !== (window.devicePixelRatio || 1)) {
    resizeCourtDetails();
    if (currentPanel === 'personalization') renderAppearance();
  }
  const dt = Math.min(.04, (now - last) / 1000); last = now; update(dt); draw(); requestAnimationFrame(frame);
}
for (const [key, style] of Object.entries(COURT_STYLES)) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.courtStyle = key;
  const swatch = document.createElement('span'); swatch.className = 'court-swatch'; swatch.setAttribute('aria-hidden', 'true');
  swatch.style.background = `linear-gradient(135deg, ${style.floor[0]}, ${style.floor[2]})`;
  const name = document.createElement('b'); i18n.text(name, style.name);
  button.append(swatch, name); button.onclick = () => selectCourt(key); $('court-choices').append(button);
}
for (const group of document.querySelectorAll('[data-color-field]')) {
  const field = group.dataset.colorField, automatic = ['landingColor', 'aimColor', 'jerseyStripe'].includes(field);
  for (const preset of [{ name: automatic ? 'Auto' : 'Default', color: null }, ...colorPresets]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.color = preset.color ?? '';
    button.setAttribute('aria-pressed', 'false'); i18n.attr(button, 'aria-label', `${i18n.sourceAttribute(group, 'aria-label')} · ${preset.name}`); i18n.attr(button, 'title', preset.name);
    if (preset.color) { button.style.setProperty('--swatch-color', preset.color); button.style.color = markerOutline(preset.color); }
    else { button.className = 'color-default'; i18n.text(button, preset.name); if (field === 'jerseyStripe') button.id = 'jersey-stripe-auto'; }
    button.onclick = () => selectAppearanceColor(field, preset.color); group.append(button);
  }
}
for (const button of document.querySelectorAll('[data-jersey-role]')) button.onclick=()=>{jerseyPreviewRole=button.dataset.jerseyRole;renderAppearance();};
$('jersey-colors-reset').onclick=()=>{
  appearanceSettings[`${jerseyPreviewRole}JerseyColor`]=appearanceSettings[`${jerseyPreviewRole}JerseyStripe`]=null;
  saveSettings(appearanceStorageKey,appearanceSettings,'appearance-save-status');renderAppearance();
};
for (const button of document.querySelectorAll('[data-racket-role]')) button.onclick = () => { racketPreviewRole = button.dataset.racketRole; renderAppearance(); };
for (const part of ['Style', 'Size']) for (const button of document.querySelectorAll(`[data-racket-${part.toLowerCase()}]`)) button.onclick = () => selectRacket(part, button.dataset[`racket${part}`]);
$('racket-reset').onclick = () => {
  for (const part of ['Style', 'Size', 'Color', 'Grip']) appearanceSettings[`${racketPreviewRole}Racket${part}`] = appearanceDefaults[`${racketPreviewRole}Racket${part}`];
  saveSettings(appearanceStorageKey, appearanceSettings, 'appearance-save-status'); renderAppearance();
};
$('marker-colors-reset').onclick = () => {
  appearanceSettings.landingColor = appearanceSettings.aimColor = null;
  saveSettings(appearanceStorageKey, appearanceSettings, 'appearance-save-status'); renderAppearance();
};
new ResizeObserver(() => { if (currentPanel === 'personalization') renderAppearance(); }).observe($('appearance-preview'));
window.addEventListener('shuttle-athletes-ready', () => { renderAppearance(); draw(); });
let coachHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil($('tutorial-coach').getBoundingClientRect().height);
  if (height !== coachHeight) { coachHeight = height; canvas.closest('.game-shell').style.setProperty('--tutorial-coach-height', `${height}px`); }
}).observe($('tutorial-coach'));
for (const button of document.querySelectorAll('[data-language]')) button.onclick = () => i18n.setLanguage(button.dataset.language);
i18n.onChange((language, saved) => {
  tutorialUiKey = '';
  i18n.text($('settings-save-status'), saved ? '✓ Saved' : 'Not saved');
  $('settings-save-status').dataset.state = saved ? 'saved' : 'session';
  if (tutorial) renderTutorial();
  renderAppearance(); draw();
});
setupLan(); renderPowerDefaults(); renderAudioSettings(); updateHud(); i18n.refresh(); resizeCourtDetails(); requestAnimationFrame(frame);
})();
