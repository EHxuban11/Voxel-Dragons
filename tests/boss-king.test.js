// Regression tests for the wave-10 Dragon King and shared dragon invariants.
// DragonManager builds its models from box/sphere geometry (no canvas), so it
// is headless-safe. A stub world supplies the ground height the attacks need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DragonManager } from '../src/game/enemies/DragonManager.js';
import { BALANCE } from '../src/core/config/GameBalance.js';

const STUB_WORLD = { getGroundHeight: () => 0, getBlock: () => null };
const makeManager = (count = 0) => new DragonManager({ count, world: STUB_WORLD });
const fakePlayer = (x = 0, y = 2, z = 0) => ({ position: new THREE.Vector3(x, y, z) });

test('spawnKing creates one huge, stationary boss and keeps the alive-count up', () => {
  const m = makeManager();
  const king = m.spawnKing(fakePlayer(), BALANCE.kingDragon);
  assert.equal(king.king, true);
  assert.equal(king.health, BALANCE.kingDragon.health);
  assert.ok(king.health > BALANCE.boss.health, 'the King has more HP than the wave-5 boss');
  assert.ok(king.stationaryCenter, 'the King is pinned to a fixed centre');
  // While the King lives the wave cannot end (aliveCount must stay > 0).
  assert.ok(m.getAliveCount() >= 1);
});

test('the King never leaves the crater centre', () => {
  const m = makeManager();
  const king = m.spawnKing(fakePlayer(20, 2, 18), BALANCE.kingDragon);
  king.attackTimer = 9999; // suppress attacks for a clean movement check
  for (let i = 0; i < 60; i += 1) m.update(0.05, fakePlayer(20, 2, 18));
  assert.ok(Math.abs(king.mesh.position.x) < 0.6, `x drifted to ${king.mesh.position.x}`);
  assert.ok(Math.abs(king.mesh.position.z) < 0.6, `z drifted to ${king.mesh.position.z}`);
});

test('pillar attack drops 8 telegraphs, then a full-damage hit on whoever stands on one', () => {
  const m = makeManager();
  const king = m.spawnKing(fakePlayer(0, 2, 0), BALANCE.kingDragon);
  king.attackTimer = 9999;

  m._kingStartPillar(king, new THREE.Vector3(0, 0, 0)); // one zone lands at (0,0)
  assert.equal(king.phase.type, 'pillar');
  assert.equal(king.phase.zones.length, 8, 'exactly 8 ground areas');

  const player = fakePlayer(0, 0.5, 0); // standing on that first zone
  for (let i = 0; i < 40 && king.phase; i += 1) m.update(0.05, player);
  assert.equal(king.phase, null, 'the telegraph resolves into columns');
  assert.ok(m.kingEffects.length >= 1, 'erupting columns are spawned');

  const impacts = m.consumeImpacts();
  const hit = impacts.find((im) => im.hitPlayer && im.damage === BALANCE.kingDragon.pillar.damage);
  assert.ok(hit, 'a column deals full pillar damage to the player standing on it');
});

test('the summoning roar queues a reinforcement event after the wind-up', () => {
  const m = makeManager();
  const king = m.spawnKing(fakePlayer(0, 2, 0), BALANCE.kingDragon);
  king.attackTimer = 9999;

  m._kingStartSummon(king);
  assert.equal(king.phase.type, 'summon');
  for (let i = 0; i < 40 && king.phase; i += 1) m.update(0.05, fakePlayer(0, 2, 0));

  const summon = m.consumeEvents().find((e) => e.type === 'summon');
  assert.ok(summon, 'a summon event is emitted');
  assert.equal(summon.zombies, BALANCE.kingDragon.summon.zombies);
  assert.equal(summon.skeletons, BALANCE.kingDragon.summon.skeletons);
});

test('healing a dragon never pushes it above its max health', () => {
  const m = makeManager(2);
  const d = m.dragons[0];
  d.health = 10;
  d.maxHealth = 100;
  m.heal(d.mesh.position.clone(), 50, 9999);
  assert.equal(d.health, 100, 'overheal is clamped to maxHealth');
});
