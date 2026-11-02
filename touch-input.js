(() => {
'use strict';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// This translates pointer gestures into existing game actions; it does not
// change footwork speed, contact windows, jump timing or shot physics.
function createControls({ document, window, i18n, isActive, activate, getAim, aim, hit, jump, shot, power, canAdjustPower }) {
  const $ = id => document.getElementById(id);
  const stick = $('touch-stick'), knob = $('touch-stick-knob'), strike = $('touch-hit');
  const choices = { clear: $('touch-clear'), drop: $('touch-drop'), smash: $('touch-smash') };
  let move = null, stroke = null, vector = { dx: 0, dy: 0 };
  let rallyShot = 'clear', serveShot = 'clear', serving = null;
  const requested = () => serving ? serveShot : rallyShot;
  const capture = (element, id) => { try { element.setPointerCapture(id); } catch { /* Pointer may already have ended. */ } };
  const release = (element, id) => { try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* Removed or canceled pointer. */ } };
  const renderChoices = () => {
    for (const [type, button] of Object.entries(choices)) {
      const selected = requested() === type;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  };
  function select(type) {
    if (!Object.hasOwn(choices, type) || serving && type === 'drop') return;
    if (serving) serveShot = type; else rallyShot = type;
    renderChoices(); shot(requested());
  }
  function moveTo(event) {
    const x = event.clientX - move.x, y = event.clientY - move.y;
    const distance = Math.hypot(x, y), travel = Math.min(distance, move.radius);
    // A fixed center and a small dead zone prevent unintended movement when
    // the thumb rests on the stick. Direction retains the game's normal speed.
    vector = distance > move.radius * .18 ? { dx: x / distance, dy: y / distance } : { dx: 0, dy: 0 };
    knob.style.setProperty('--stick-x', `${distance ? x / distance * travel : 0}px`);
    knob.style.setProperty('--stick-y', `${distance ? y / distance * travel : 0}px`);
  }
  function stopMove() {
    if (!move) return;
    const id = move.id; move = null; vector = { dx: 0, dy: 0 };
    stick.classList.remove('active');
    knob.style.setProperty('--stick-x', '0px'); knob.style.setProperty('--stick-y', '0px');
    release(stick, id);
  }
  function stopStroke() {
    if (!stroke) return;
    const id = stroke.id; stroke = null; strike.classList.remove('held'); release(strike, id);
    i18n.text($('touch-instruction'), 'Tap to hit · Drag to aim');
    $('touch-aim-track').classList.remove('aiming');
  }
  function reset() { stopMove(); stopStroke(); }
  function dragAim(event) {
    aim(clamp(stroke.aim + (event.clientX - stroke.x) / 128, 0, 1));
  }
  stick.addEventListener('pointerdown', event => {
    if (!isActive() || move || event.button > 0) return;
    event.preventDefault(); activate();
    const rect = stick.getBoundingClientRect();
    move = { id: event.pointerId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width * .28 };
    capture(stick, move.id); stick.classList.add('active'); moveTo(event);
  });
  stick.addEventListener('pointermove', event => {
    if (move?.id !== event.pointerId) return;
    event.preventDefault(); if (!isActive()) stopMove(); else moveTo(event);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(name, event => {
    if (move?.id === event.pointerId) stopMove();
  });
  strike.addEventListener('pointerdown', event => {
    if (!isActive() || stroke || event.button > 0) return;
    event.preventDefault(); activate();
    stroke = { id: event.pointerId, x: event.clientX, aim: getAim(), type: requested() };
    capture(strike, stroke.id); strike.classList.add('held');
    i18n.text($('touch-instruction'), 'Release to hit · Drag to aim');
    $('touch-aim-track').classList.add('aiming');
  });
  strike.addEventListener('pointermove', event => {
    if (stroke?.id !== event.pointerId) return;
    event.preventDefault(); if (!isActive()) stopStroke(); else dragAim(event);
  });
  strike.addEventListener('pointerup', event => {
    if (stroke?.id !== event.pointerId) return;
    event.preventDefault(); const type = stroke.type;
    if (!isActive()) { stopStroke(); return; }
    dragAim(event); stopStroke(); hit(type);
  });
  for (const name of ['pointercancel', 'lostpointercapture']) strike.addEventListener(name, event => {
    if (stroke?.id === event.pointerId) stopStroke();
  });
  // Keyboard activation of the on-screen controls stays accessible. Pointer
  // clicks are handled above, so a native click cannot fire a second swing.
  strike.addEventListener('click', event => {
    if (event.detail === 0 && isActive()) { activate(); hit(requested()); }
  });
  for (const [type, button] of Object.entries(choices)) {
    const choose = event => { if (isActive()) { event.preventDefault(); activate(); select(type); } };
    button.addEventListener('pointerdown', choose);
    button.addEventListener('click', event => { if (event.detail === 0) choose(event); });
  }
  const doJump = event => { if (isActive() && !serving) { event.preventDefault(); activate(); jump(); } };
  $('touch-jump').addEventListener('pointerdown', doJump);
  $('touch-jump').addEventListener('click', event => { if (event.detail === 0) doJump(event); });
  $('touch-power-toggle').addEventListener('click', () => {
    if (!isActive()) return;
    const open = $('touch-power-options').hidden;
    $('touch-power-options').hidden = !open;
    $('touch-power-toggle').setAttribute('aria-expanded', String(open));
  });
  for (const button of document.querySelectorAll('[data-power]')) button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (isActive() && canAdjustPower()) { activate(); power(Number(button.dataset.power)); }
  });
  $('touch-power-auto').addEventListener('click', () => { if (isActive() && canAdjustPower()) power(null); });
  // Visibility changes, rotation and loss of focus must never leave movement
  // latched or complete an old, canceled strike after play resumes.
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  renderChoices();
  return Object.freeze({ movement: () => ({ ...vector }), requested, select, reset,
    setServing(value) {
      if (value === serving) return;
      serving = value; serveShot = 'clear'; stopStroke();
      choices.drop.hidden = serving; $('touch-jump').disabled = serving;
      i18n.text(choices.clear, serving ? 'Long' : 'Clear');
      i18n.text(choices.smash, serving ? 'Short' : 'Attack');
      i18n.attr(choices.clear, 'aria-label', serving ? 'Select long serve' : 'Select clear or lift');
      i18n.attr(choices.drop, 'aria-label', 'Select drop or block');
      i18n.attr(choices.smash, 'aria-label', serving ? 'Select short serve' : 'Select attack or drive');
      renderChoices();
    }
  });
}
globalThis.ShuttleTouch = Object.freeze({ createControls });
})();
