// Regression tests for Luffy's gear/gauge state machine and form-dependent
// right-click. LuffyController only uses THREE math + injected deps, so it runs
// headless with simple stubs (no WebGL/canvas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LuffyController } from '../src/game/combat/LuffyController.js';
import { BALANCE } from '../src/core/config/GameBalance.js';

function makeLuffy(hits = 0) {
  const noop = () => {};
  const enemies = {
    hitCount: hits,
    hitBox() { return Array.from({ length: this.hitCount }, () => ({ position: new THREE.Vector3() })); },
    hitMelee() { return Array.from({ length: this.hitCount }, () => ({ position: new THREE.Vector3() })); },
    knockback: noop,
  };
  return new LuffyController({
    scene: { add: noop, remove: noop },
    effects: { impact: noop, shockwave: noop, explosion: noop },
    enemies,
    camera: new THREE.PerspectiveCamera(75, 1, 0.1, 100),
    player: { object: { position: new THREE.Vector3() }, velocity: new THREE.Vector3(), isGrounded: true },
    hud: { showMessage: noop },
    audio: { shoot: noop, explosion: noop },
    world: { getGroundHeight: () => 0 },
  });
}

test('the gauge gets harder to fill each gear (strictly increasing)', () => {
  const max = BALANCE.luffy.gaugeMax;
  for (let i = 1; i < max.length; i += 1) assert.ok(max[i] > max[i - 1], `gear ${i} needs more`);
  assert.equal(max.length, BALANCE.luffy.gearNames.length, 'one threshold per form');
});

test('landing hits fills the gauge and filling it advances the form', () => {
  const L = makeLuffy(4); // each punch lands 4 hits
  assert.equal(L.gearIndex, 0);
  L.useSkill('pistol'); // pistol fill 2 * 4 hits = 8 == gaugeMax[0]
  assert.equal(L.gearIndex, 1, 'filled Gear 1 -> Gear 2');
  assert.equal(L.gauge, 0, 'gauge resets on gear-up');
  assert.equal(L.gearName, 'Gear 2');
});

test('getting hit empties the gauge but keeps the form', () => {
  const L = makeLuffy(0);
  L.gearIndex = 2;
  L.gauge = 7;
  L.onPlayerHit();
  assert.equal(L.gauge, 0);
  assert.equal(L.gearIndex, 2, 'form is kept when hit');
});

test('right-click is form-dependent: none / Cañón / King Kong Gun', () => {
  const L = makeLuffy(0);
  assert.equal(L.cfg.gears[0].secondary, 'none', 'Gear 1 has no right-click move');
  assert.equal(L.cfg.gears[1].secondary, 'cannon', 'Gear 2 -> Cañón');
  assert.equal(L.cfg.gears[2].secondary, 'kingkong', 'Boundman -> King Kong Gun');
});

test('the Gear-2 Cañón spends the whole form back to Gear 1', () => {
  const L = makeLuffy(0);
  L.gearIndex = 1;
  L.gauge = 6;
  assert.equal(L.secondary(), true);
  assert.equal(L.gearIndex, 0, 'back to Gear 1');
  assert.equal(L.gauge, 0, 'progress lost');
});

test('Boundman King Kong Gun leaps and slams without dropping the form', () => {
  const L = makeLuffy(2);
  L.gearIndex = 2;
  const ok = L.secondary();
  assert.equal(ok, true);
  assert.ok(L.player.velocity.y > 0, 'leaps into the air');
  assert.ok(L.pendingSlam, 'a ground slam is queued');
  assert.equal(L.gearIndex, 2, 'stays Boundman (only the Cañón resets)');
  // The slam lands after its delay and deals AoE damage.
  for (let i = 0; i < 20 && L.pendingSlam; i += 1) L.update(0.05);
  assert.equal(L.pendingSlam, null, 'the slam resolved');
});

test('Boundman buffs the moveset and renames the slots (Kong Gun / Kong Gatling)', () => {
  const L = makeLuffy(0);
  const g1 = L.skillStats('pistol');
  L.gearIndex = 2;
  const bound = L.skillStats('pistol');
  assert.ok(bound.damage > g1.damage, 'Kong Gun hits harder than Pistol');
  assert.ok(bound.halfWidth > g1.halfWidth, 'Kong Gun has a wider hitbox');
  assert.equal(L.currentLabels().pistol, 'Kong Gun');
  assert.equal(L.currentLabels().gatling, 'Kong Gatling');
});

test('Snakeman and Gear 5 reuse the Gear-1 moveset', () => {
  const L = makeLuffy(0);
  for (const idx of [3, 4]) {
    const g = L.cfg.gears[idx];
    assert.equal(g.dmg, 1.0);
    assert.equal(g.secondary, 'none');
    assert.equal(g.labels.pistol, 'Pistol');
  }
});
