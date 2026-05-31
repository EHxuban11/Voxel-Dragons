import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, getMap } from '../src/content/maps/index.js';
import { meadow } from '../src/content/maps/meadow.js';
import { snowland } from '../src/content/maps/snowland.js';
import { makeStubWorld } from './helpers/stub-world.js';

test('map registry exposes meadow + snowland and getMap falls back', () => {
  const ids = MAPS.map((m) => m.id);
  assert.deepEqual(ids, ['meadow', 'snowland']);
  assert.equal(getMap('snowland').id, 'snowland');
  assert.equal(getMap('does-not-exist').id, 'meadow');
});

test('meadow generates green terrain with trees + castle', () => {
  const world = makeStubWorld();
  meadow.generate(world);
  const types = world.types();
  for (const t of ['grass', 'dirt', 'stone', 'water', 'wood', 'leaves']) {
    assert.ok(types.has(t), `meadow should contain ${t}`);
  }
  assert.ok(world.trees.length > 0, 'meadow should plant oak trees');
});

test('snowland is snowy/icy with exactly 3 spruces and no oaks', () => {
  const world = makeStubWorld();
  snowland.generate(world);
  const types = world.types();
  for (const t of ['snow', 'ice', 'spruce_log', 'spruce_leaves']) {
    assert.ok(types.has(t), `snowland should contain ${t}`);
  }
  assert.equal(world.spruces.length, 3, 'snowland should plant exactly 3 spruces');
  assert.equal(world.trees.length, 0, 'snowland should plant no oak trees');
  assert.ok(!types.has('grass'), 'snowland surface should not be grass');
});
