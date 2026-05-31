// Regression tests for the player's physics and survival invariants — e.g.
// "your X/Z persist between frames", "gravity never drops you through the
// floor", "jump only works on the ground", and the health/shield rules. Player
// only depends on THREE + the pure Collision helpers, so it runs headless. A
// world that exposes getGroundHeight but no getBlock uses the simple vertical
// fallback (flat floor) and frees horizontal movement — ideal for unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/game/Player.js';

const FLOOR = { getGroundHeight: () => 0 };

test('X/Z persist across frames and gravity settles on the floor (never below)', () => {
  const p = new Player();
  p.setPosition(5, 10, 7);
  for (let i = 0; i < 300; i += 1) p.update(0.05, {}, FLOOR);
  const pos = p.cameraHolder.position;
  assert.equal(pos.x, 5, 'no horizontal drift with no input');
  assert.equal(pos.z, 7, 'no horizontal drift with no input');
  assert.ok(pos.y >= 0, `fell through the floor: y=${pos.y}`);
  assert.ok(pos.y < 1, `should rest on the floor, y=${pos.y}`);
  assert.ok(p.isGrounded, 'ends up grounded');
});

test('jump only works when grounded; no free mid-air re-jump', () => {
  const p = new Player();
  p.setPosition(0, 0, 0);
  p.update(0.05, {}, FLOOR); // land + become grounded
  assert.ok(p.isGrounded);

  p.update(0.05, { jump: true }, FLOOR);
  assert.ok(p.cameraHolder.position.y > 0.05, 'a grounded jump lifts off');
  assert.ok(!p.isGrounded, 'now airborne');

  const vyBefore = p.velocity.y;
  p.update(0.05, { jump: true }, FLOOR); // airborne, no wall to kick off
  assert.ok(p.velocity.y < vyBefore, 'gravity keeps pulling; jump gives no extra boost');
});

test('damage drains the shield before health and clamps at zero', () => {
  const p = new Player(undefined, { maxHealth: 100, maxShield: 50 });
  p.damage(30);
  assert.equal(p.shield, 20);
  assert.equal(p.health, 100);
  p.damage(40); // 20 to finish the shield, 20 to health
  assert.equal(p.shield, 0);
  assert.equal(p.health, 80);
  p.damage(9999);
  assert.equal(p.health, 0, 'health clamps at zero');
  assert.equal(p.isAlive, false, 'dead at zero health');
});

test('invulnerability ignores all damage', () => {
  const p = new Player();
  p.invulnerable = true;
  p.damage(9999);
  assert.equal(p.health, p.maxHealth);
  assert.equal(p.shield, p.maxShield);
  assert.ok(p.isAlive);
});

test('heal never exceeds max health', () => {
  const p = new Player(undefined, { maxHealth: 100 });
  p.health = 90;
  p.heal(9999);
  assert.equal(p.health, 100);
  p.heal(50);
  assert.equal(p.health, 100);
});

test('look() clamps pitch to within +/-90 degrees', () => {
  const p = new Player();
  p.look(0, -1e6); // crank the view up
  assert.ok(p.pitchHolder.rotation.x <= Math.PI / 2, 'cannot pitch past straight up');
  p.look(0, 1e6); // crank it down
  assert.ok(p.pitchHolder.rotation.x >= -Math.PI / 2, 'cannot pitch past straight down');
});
