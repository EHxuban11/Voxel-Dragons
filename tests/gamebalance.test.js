import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../src/core/config/GameBalance.js';

test('BALANCE is deep-frozen', () => {
  assert.ok(Object.isFrozen(BALANCE));
  assert.ok(Object.isFrozen(BALANCE.weapons));
  assert.ok(Object.isFrozen(BALANCE.progression));
  assert.throws(() => { BALANCE.player.moveSpeed = 999; });
});

test('progression is internally consistent', () => {
  assert.ok(BALANCE.progression.waveCount >= 1);
  assert.ok(BALANCE.progression.shopWave <= BALANCE.progression.waveCount);
  // waveAmmo keys must match real weapon names.
  const names = new Set(BALANCE.weapons.map((w) => w.name));
  for (const key of Object.keys(BALANCE.progression.waveAmmo)) {
    assert.ok(names.has(key), `waveAmmo refers to unknown weapon "${key}"`);
  }
});

test('every weapon has sane positive stats', () => {
  for (const w of BALANCE.weapons) {
    assert.ok(w.damage > 0, `${w.id} damage`);
    assert.ok(w.clipSize > 0, `${w.id} clipSize`);
    assert.ok(w.fireRate > 0, `${w.id} fireRate`);
  }
});
