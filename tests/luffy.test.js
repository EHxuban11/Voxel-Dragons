// Regression tests for Luffy's gear/gauge state machine, form transitions and
// per-form movesets. LuffyController only uses THREE math + injected deps, so it
// runs headless with simple stubs (no WebGL/canvas).
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
    nearestTo: () => new THREE.Vector3(0, 0, -5),
  };
  return new LuffyController({
    scene: { add: noop, remove: noop },
    effects: { impact: noop, shockwave: noop, explosion: noop, beam: noop },
    enemies,
    camera: new THREE.PerspectiveCamera(75, 1, 0.1, 100),
    player: { object: { position: new THREE.Vector3() }, velocity: new THREE.Vector3(), isGrounded: true },
    hud: { showMessage: noop },
    audio: { shoot: noop, explosion: noop },
    world: { getGroundHeight: () => 0 },
  });
}

// Form indices for readability.
const GEAR1 = 0; const GEAR2 = 1; const BOUND = 2; const SNAKE = 3; const GEAR5 = 4;

test('the gauge gets harder to fill each gear (strictly increasing)', () => {
  const max = BALANCE.luffy.gaugeMax;
  for (let i = 1; i < max.length; i += 1) assert.ok(max[i] > max[i - 1], `gear ${i} needs more`);
  assert.equal(max.length, BALANCE.luffy.gears.length, 'one threshold per form');
});

test('landing hits fills the gauge and Gear 1 fills into Gear 2', () => {
  const L = makeLuffy(4); // each punch lands 4 hits
  assert.equal(L.gearIndex, GEAR1);
  L.useSkill('pistol'); // pistol fill 2 * 4 = 8 == gaugeMax[0]
  assert.equal(L.gearIndex, GEAR2);
  assert.equal(L.gauge, 0, 'gauge resets on gear-up');
});

test('getting hit empties the gauge but keeps the form', () => {
  const L = makeLuffy(0);
  L.gearIndex = BOUND;
  L.gauge = 7;
  L.onPlayerHit();
  assert.equal(L.gauge, 0);
  assert.equal(L.gearIndex, BOUND, 'form is kept when hit');
});

test('Gear 2 fills into Boundman; Boundman and Snakeman both fill straight to Gear 5', () => {
  assert.equal(BALANCE.luffy.gears[GEAR2].fillTo, BOUND);
  assert.equal(BALANCE.luffy.gears[BOUND].fillTo, GEAR5, 'Boundman skips Snakeman on fill');
  assert.equal(BALANCE.luffy.gears[SNAKE].fillTo, GEAR5);
  const L = makeLuffy(20);
  L.gearIndex = BOUND;
  L.useSkill('pistol'); // plenty of fill
  assert.equal(L.gearIndex, GEAR5, 'filling Boundman -> Gear 5');
});

test('the Gear-2 Cañón spends the whole form back to Gear 1', () => {
  const L = makeLuffy(0);
  L.gearIndex = GEAR2;
  L.gauge = 6;
  assert.equal(L.secondary(), true);
  assert.equal(L.gearIndex, GEAR1, 'back to Gear 1');
  assert.equal(L.gauge, 0, 'progress lost');
});

test('Boundman right-click morphs into Snakeman (keeps the form, not a reset)', () => {
  const L = makeLuffy(0);
  L.gearIndex = BOUND;
  L.gauge = 9;
  assert.equal(L.secondary(), true);
  assert.equal(L.gearIndex, SNAKE, 'now Snakeman');
  assert.equal(L.gear().name, 'Gear 4: Snakeman');
});

test('Boundman King Kong Gun leaps and slams (bazooka slot)', () => {
  const L = makeLuffy(2);
  L.gearIndex = BOUND;
  assert.equal(L.gear().slots.bazooka.behavior, 'kingkong');
  assert.equal(L.useSkill('bazooka'), true);
  assert.ok(L.player.velocity.y > 0, 'leaps');
  assert.ok(L.pendingSlam, 'a ground slam is queued');
  for (let i = 0; i < 20 && L.pendingSlam; i += 1) L.update(0.05);
  assert.equal(L.pendingSlam, null, 'the slam resolves');
});

test('Boundman renames the slots (Kong Gun / King Kong Gun / Kong Gatling)', () => {
  const L = makeLuffy(0);
  L.gearIndex = BOUND;
  assert.deepEqual(L.currentLabels(), { pistol: 'Kong Gun', bazooka: 'King Kong Gun', gatling: 'Kong Gatling' });
  const g1 = makeLuffy(0).slotStats('pistol');
  const kong = L.slotStats('pistol');
  assert.ok(kong.damage > g1.damage && kong.halfWidth > g1.halfWidth, 'Kong Gun hits harder + wider');
});

test('Snakeman uses autoaim punches with long reach', () => {
  const L = makeLuffy(0);
  L.gearIndex = SNAKE;
  assert.equal(L.gear().slots.pistol.behavior, 'autoaim');
  assert.equal(L.gear().slots.bazooka.behavior, 'autoaim'); // King Cobra Gun
  assert.deepEqual(L.currentLabels(), { pistol: 'Pistol (auto)', bazooka: 'King Cobra Gun', gatling: 'Black Mamba' });
});

test('Gear 5 jumps high / moves fast and has penetrate + skybeam + bajrang', () => {
  const L = makeLuffy(0);
  L.gearIndex = GEAR5;
  assert.ok(L.speedMult > 1.2 && L.jumpMult > 1.2, 'fast + high jumps');
  const s = L.gear().slots;
  assert.equal(s.pistol.behavior, 'penetrate');
  assert.equal(s.bazooka.behavior, 'skybeam');
  assert.equal(s.gatling.behavior, 'bajrang');
  // Bajrang Gun: a high leap + a big slam.
  assert.equal(L.useSkill('gatling'), true);
  assert.ok(L.player.velocity.y >= BALANCE.luffy.bajrang.jump - 0.001, 'leaps very high');
});

test('Gear 1, Snakeman and Gear 5 have no Cañón; only Gear 2 resets', () => {
  assert.equal(BALANCE.luffy.gears[GEAR1].secondary, 'none');
  assert.equal(BALANCE.luffy.gears[GEAR2].secondary, 'cannon');
  assert.equal(BALANCE.luffy.gears[BOUND].secondary, 'toSnakeman');
  assert.equal(BALANCE.luffy.gears[SNAKE].secondary, 'none');
  assert.equal(BALANCE.luffy.gears[GEAR5].secondary, 'none');
});
