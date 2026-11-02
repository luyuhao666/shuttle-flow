import test from 'node:test';
import assert from 'node:assert/strict';
import './guidance.js';
const { normalizeMode, feedbackVisible } = globalThis.ShuttleGuidance;

test('new or invalid guidance settings select compact, while full remains opt-in', () => {
  for (const value of [undefined, null, {}, 'invalid', 'compact']) assert.equal(normalizeMode(value), 'compact');
  assert.equal(normalizeMode('full'), 'full');
});
test('compact suppresses routine rally narration but keeps errors, points and service notices', () => {
  for (const kind of ['hit', 'opponent', 'feed']) assert.equal(feedbackVisible('compact', kind), false);
  for (const kind of ['notice', 'miss', 'score', 'service', 'training']) assert.equal(feedbackVisible('compact', kind), true);
  for (const kind of ['hit', 'opponent', 'feed', 'miss', 'notice']) assert.equal(feedbackVisible('full', kind), true);
});
