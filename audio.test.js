import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import './sounds.js';

test('offline sound bundle contains seven valid, audible, unclipped recordings', async () => {
  const entries = Object.entries(globalThis.ShuttleSounds);
  assert.equal(entries.length, 7);
  for (const [name, encoded] of entries) {
    const bytes = Buffer.from(encoded, 'base64');
    assert.deepEqual(bytes, await readFile(new URL(`assets/audio/${name}.wav`, import.meta.url)));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    const samples = bytes.readUInt32LE(40) / 2, rate = bytes.readUInt32LE(24);
    assert.ok(samples / rate >= .1 && samples / rate <= .6);
    let energy = 0, peak = 0;
    for (let i = 0; i < samples; i++) { const value = bytes.readInt16LE(44 + i * 2) / 32768; energy += value * value; peak = Math.max(peak, Math.abs(value)); }
    assert.ok(energy / samples > .00001, `${name} must not be silent`); assert.ok(peak <= .851, `${name} must retain headroom`);
  }
  assert.equal(new Set(['hit1', 'hit2', 'hit3', 'hit4'].map(name => globalThis.ShuttleSounds[name])).size, 4);
});
