(() => {
  'use strict';
  const normalizeMode = mode => mode === 'full' ? 'full' : 'compact';
  const feedbackVisible = (mode, kind) => normalizeMode(mode) === 'full' || !['hit', 'opponent', 'feed'].includes(kind);
  globalThis.ShuttleGuidance = Object.freeze({ normalizeMode, feedbackVisible });
})();
