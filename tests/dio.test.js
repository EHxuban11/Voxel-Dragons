// Regression tests for Dio: knife throws, the six-knife line, the gauge, and
// The World (timestop) freezing knives + deferring damage. DioController only
// uses THREE math + injected deps, so it runs headless with stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DioController } from '../src/game/combat/DioController.js';
import { BALANCE } from '../src/core/config/GameBalance.js';

function makeDio({ near = false } = {}) {
  const noop = () => {};
  const enemies = {
    near,
    anyNear() { return this.near; },
    hitMelee() { return this.near ? [{ position: new THREE.Vector3() }] : []; },
    knockback: noop,
  };
  const dio = new DioController({
    scene: { add: noop, remove: noop },
    effects: { impact: noop, shockwave: noop, explosion: noop },
    enemies,
    camera: new THREE.PerspectiveCamera(75, 1, 0.1, 100),
    player: { object: { position: new THREE.Vector3() }, velocity: new THREE.Vector3() },
    hud: { showMessage: noop },
    audio: { shoot: noop, explosion: noop },
    world: { getGroundHeight: () => 0, getBlock: () => null },
  });
  dio.enemies = enemies;
  return { dio, enemies };
}

test('left click throws one knife, on a cooldown', () => {
  const { dio } = makeDio();
  assert.equal(dio.throwKnife(), true);
  assert.equal(dio.knives.length, 1);
  assert.equal(dio.throwKnife(), false, 'still on cooldown');
  dio.update(dio.cfg.knife.cooldown + 0.01);
  assert.equal(dio.throwKnife(), true, 'fires again once cooled down');
});

test('right click throws six independent knives scattered in a disc', () => {
  const { dio } = makeDio();
  assert.equal(dio.sixKnives(), true);
  assert.equal(dio.knives.length, 6);
  // Each is its own entity with the same damage.
  for (const k of dio.knives) assert.equal(k.damage, BALANCE.dio.six.damage);
  assert.equal(new Set(dio.knives).size, 6, 'six distinct projectiles');
  // Not a straight line: the spawn points spread across more than one axis.
  const xs = new Set(dio.knives.map((k) => k.position.x.toFixed(3)));
  const ys = new Set(dio.knives.map((k) => k.position.y.toFixed(3)));
  assert.ok(xs.size > 1 && ys.size > 1, 'scattered in a disc, not a flat line');
});

test('hitting enemies fills the gauge; The World needs a full bar', () => {
  const { dio } = makeDio({ near: true });
  assert.equal(dio.timestop(), false, 'cannot stop time on an empty bar');
  dio.gauge = dio.gaugeMax;
  assert.equal(dio.timestop(), true);
  assert.equal(dio.gauge, 0, 'The World empties the gauge');
  assert.ok(dio.timestopActive);
});

test('a normal knife that reaches an enemy deals damage and fills the gauge', () => {
  const { dio } = makeDio({ near: true });
  dio.throwKnife();
  const before = dio.gauge;
  dio.update(0.05); // moves + collides (enemy is near) -> hit
  assert.ok(dio.gauge > before, 'gauge filled on the hit');
  assert.equal(dio.knives.length, 0, 'the knife is consumed on impact');
});

test('during The World, knives drift then hang in the air and deal no damage', () => {
  const { dio } = makeDio({ near: true });
  dio.gauge = dio.gaugeMax;
  dio.timestop();
  dio.throwKnife();
  const gaugeAfterThrow = dio.gauge;
  // Step past the freeze delay: it should hang, not hit.
  for (let i = 0; i < 10; i += 1) dio.update(0.05);
  assert.equal(dio.knives.length, 1, 'knife is not consumed while time is stopped');
  assert.ok(dio.knives[0].frozen, 'it hangs frozen in the air');
  assert.equal(dio.gauge, gaugeAfterThrow, 'no damage dealt while time is stopped');
});

test('when time resumes, hanging knives launch and become lethal again', () => {
  const { dio } = makeDio({ near: true });
  dio.gauge = dio.gaugeMax;
  dio.timestop();
  dio.throwKnife();
  for (let i = 0; i < 6; i += 1) dio.update(0.05); // hang it
  const knife = dio.knives[0];
  // End the stop (5s).
  for (let i = 0; i < 110 && dio.timestopActive; i += 1) dio.update(0.05);
  assert.equal(dio.timestopActive, false, 'time resumed');
  assert.ok(knife.velocity.length() > 1, 'the knife is moving again');
});

test('Stop Sign swings down from the hand and only deals damage on landing', () => {
  const { dio, enemies } = makeDio({ near: true });
  let melees = 0;
  const realHit = enemies.hitMelee.bind(enemies);
  enemies.hitMelee = (...a) => { melees += 1; return realHit(...a); };
  dio.stopSign();
  assert.equal(melees, 0, 'not instant — it swings first');
  for (let i = 0; i < 8; i += 1) dio.update(0.05); // past the swing -> lands
  assert.ok(melees >= 1, 'damage lands when the sign hits the ground');
});

test('Stop Sign used during The World freezes mid-swing, dealing damage only after resume', () => {
  const { dio, enemies } = makeDio({ near: true });
  dio.gauge = dio.gaugeMax;
  dio.timestop();
  let melees = 0;
  const realHit = enemies.hitMelee.bind(enemies);
  enemies.hitMelee = (...a) => { melees += 1; return realHit(...a); };
  dio.stopSign();
  for (let i = 0; i < 6; i += 1) dio.update(0.05); // frozen mid-swing
  assert.equal(melees, 0, 'no damage while time is stopped');
  for (let i = 0; i < 110 && dio.timestopActive; i += 1) dio.update(0.05); // end the stop
  for (let i = 0; i < 10; i += 1) dio.update(0.05); // swing finishes
  assert.ok(melees >= 1, 'the slam lands after time resumes');
});
