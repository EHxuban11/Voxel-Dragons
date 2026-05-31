import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unpackIndices } from '../src/content/maps/custom/anvil.js';

// Independent BigInt reference for the padded (1.16+) layout.
function referencePadded(longs, bits, count) {
  const out = new Uint16Array(count);
  const mask = (1n << BigInt(bits)) - 1n;
  const u = longs.map((v) => BigInt.asUintN(64, v));
  const perLong = Math.floor(64 / bits);
  for (let i = 0; i < count; i += 1) {
    const li = Math.floor(i / perLong);
    const shift = BigInt((i % perLong) * bits);
    out[i] = Number((u[li] >> shift) & mask);
  }
  return out;
}

// Deterministic LCG so the test is reproducible.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
}

function randomLongs(n, rng) {
  return Array.from({ length: n }, () => BigInt.asIntN(64, (BigInt(rng()) << 32n) | BigInt(rng())));
}

test('optimized padded unpack matches the BigInt reference across bit widths', () => {
  const rng = lcg(20260531);
  const count = 4096;
  for (const bits of [4, 5, 6, 7, 8, 9, 12]) {
    const perLong = Math.floor(64 / bits);
    const longs = randomLongs(Math.ceil(count / perLong), rng);
    const got = unpackIndices(longs, bits, count, true);
    const want = referencePadded(longs, bits, count);
    assert.deepEqual([...got], [...want], `mismatch at bits=${bits}`);
  }
});

test('every unpacked index is within the palette range', () => {
  const rng = lcg(7);
  for (const bits of [4, 6, 8]) {
    const perLong = Math.floor(64 / bits);
    const longs = randomLongs(Math.ceil(4096 / perLong), rng);
    const got = unpackIndices(longs, bits, 4096, true);
    const max = (1 << bits) - 1;
    assert.ok(got.every((v) => v >= 0 && v <= max));
  }
});
