import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveHorizontal, easeToGround } from '../src/engine/Collision.js';

// Stub voxel world: a Set of "x,y,z" solid cells.
function world(...cells) {
  const solid = new Set(cells);
  return { getBlock: (x, y, z) => (solid.has(`${x},${y},${z}`) ? 'stone' : null) };
}

const R = 0.4;
const H = 1.75;

test('a wall taller than a step blocks and clamps to a body-width away', () => {
  const w = world('2,1,0', '2,2,0'); // 2-tall wall in column x=2 (feet at y=1)
  const pos = { x: 1.4, y: 1, z: 0 };
  const hit = moveHorizontal(w, pos, 0.5, 0, R, H);
  assert.equal(hit.x, true);
  assert.ok(Math.abs(pos.x - (2 - R)) < 0.01, `clamped near 1.6, got ${pos.x}`);
});

test('a one-block step does NOT block (it is climbable)', () => {
  const w = world('2,1,0'); // single block at feet level => a step, not a wall
  const pos = { x: 1.4, y: 1, z: 0 };
  const hit = moveHorizontal(w, pos, 0.5, 0, R, H);
  assert.equal(hit.x, false);
  assert.ok(Math.abs(pos.x - 1.9) < 1e-6, `passed through to 1.9, got ${pos.x}`);
});

test('slides along a wall: blocked axis stops, free axis moves', () => {
  const w = world('2,1,0', '2,2,0'); // wall to the +X side only
  const pos = { x: 1.4, y: 1, z: 0 };
  const hit = moveHorizontal(w, pos, 0.5, 0.5, R, H);
  assert.equal(hit.x, true);
  assert.equal(hit.z, false);
  assert.ok(Math.abs(pos.z - 0.5) < 1e-6, 'Z still advanced');
});

test('no world => moves freely', () => {
  const pos = { x: 0, y: 0, z: 0 };
  moveHorizontal({}, pos, 1, 2, R, H);
  assert.deepEqual([pos.x, pos.z], [1, 2]);
});

test('easeToGround steps up gradually, not instantly', () => {
  const pos = { x: 0, y: 1, z: 0 };
  easeToGround(pos, 2, 0.05, 9, 16); // 9 b/s * 0.05 = 0.45
  assert.ok(pos.y > 1 && pos.y < 2, `eased to ${pos.y}`);
  assert.ok(Math.abs(pos.y - 1.45) < 1e-6);
  // many small steps converge to the target
  for (let i = 0; i < 20; i += 1) easeToGround(pos, 2, 0.05, 9, 16);
  assert.ok(Math.abs(pos.y - 2) < 1e-6);
});
