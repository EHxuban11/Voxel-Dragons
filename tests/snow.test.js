// Regression tests for the snow-map roster + bosses. SnowManager is built from
// box/icosahedron geometry (no canvas), so it runs headless with a stub world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SnowManager } from '../src/game/enemies/SnowManager.js';
import { BALANCE } from '../src/core/config/GameBalance.js';

const STUB_WORLD = { getGroundHeight: () => 0, getBlock: () => null, isWaterColumn: () => false };
const player = (x = 0, y = 0, z = 0) => ({ position: new THREE.Vector3(x, y, z) });
const make = () => new SnowManager(null, { world: STUB_WORLD });

test('config: snow bosses are well-formed and waves line up', () => {
  assert.equal(BALANCE.snow.miniboss.wave, 5);
  assert.equal(BALANCE.snow.boss.wave, 10);
  assert.ok(BALANCE.snow.boss.health > BALANCE.snow.miniboss.health, 'the colossus is tougher than the alpha');
  assert.equal(BALANCE.snow.boss.icicles.count, 8);
  assert.ok(BALANCE.snow.yeti.chill.factor < 1, 'the chill actually slows');
});

test('a regular snow wave fields yetis, rollers and wisps', () => {
  const m = make();
  m.spawnWave(6, player(), STUB_WORLD);
  const kinds = new Set(m.enemies.map((e) => e.kind));
  assert.ok(kinds.has('yeti') && kinds.has('roller') && kinds.has('wisp'));
  assert.equal(m.getAliveCount(), m.enemies.length);
});

test('the Alpha Yeti miniboss and Ice Colossus spawn with health bars', () => {
  const a = make();
  a.spawnMiniboss(player(), STUB_WORLD);
  const alpha = a.enemies.find((e) => e.kind === 'alpha');
  assert.ok(alpha && alpha.boss && alpha.healthBar);
  assert.equal(alpha.health, BALANCE.snow.miniboss.health);

  const b = make();
  b.spawnBoss(player(), STUB_WORLD);
  const col = b.enemies.find((e) => e.kind === 'colossus');
  assert.ok(col && col.boss);
  assert.equal(col.health, BALANCE.snow.boss.health);
  assert.equal(b.getAliveCount(), 1, 'the colossus arrives alone (it summons its own)');
});

test('a yeti melees the player and the hit carries a chill', () => {
  const m = make();
  m._make('yeti', 1.5, 0, STUB_WORLD, { targetX: 0, targetZ: 0 });
  m.enemies[0].attackTimer = 0;
  m.update(0.05, player(0, 0, 0), STUB_WORLD);
  const atk = m.consumeEvents().find((e) => e.type === 'attack');
  assert.ok(atk, 'it attacks in range');
  assert.ok(atk.chill && atk.chill.factor < 1, 'the blow chills');
});

test('the snowroller barrels into the player and bursts', () => {
  const m = make();
  m._make('roller', 0, 6, STUB_WORLD, { targetX: 0, targetZ: 0 }); // heading toward the origin
  let burst = false;
  for (let i = 0; i < 40 && !burst; i += 1) {
    m.update(0.05, player(0, 0, 0), STUB_WORLD);
    if (m.consumeEvents().some((e) => e.type === 'attack')) burst = true;
  }
  assert.ok(burst, 'it reaches and hits the player');
  assert.equal(m.getAliveCount(), 0, 'and shatters on impact');
});

test('Ice Colossus attacks: icicles telegraph, frost cone, blizzard summon', () => {
  const m = make();
  m.spawnBoss(player(), STUB_WORLD);
  const col = m.enemies[0];
  const pos = new THREE.Vector3(0, 0, 8);

  m._boss_icicles(col, STUB_WORLD, pos);
  const icicleZone = m.zones.find((z) => z.type === 'icicles');
  assert.ok(icicleZone && icicleZone.spots.length === 8, '8 telegraphed icicle spots');

  m._boss_frost(col, STUB_WORLD, pos);
  assert.ok(m.zones.some((z) => z.type === 'frost'), 'a frost cone telegraph');

  m._boss_blizzard(col);
  const ev = m.consumeEvents();
  assert.ok(ev.some((e) => e.type === 'summon'), 'the blizzard summons reinforcements');
  assert.ok(ev.some((e) => e.type === 'blizzard' && e.chill), 'and chills the player');
});

test('icicle telegraphs erupt into damaging columns and hit a player standing on one', () => {
  const m = make();
  m.spawnBoss(player(), STUB_WORLD);
  const col = m.enemies[0];
  const pos = new THREE.Vector3(0, 0, 0); // a spot lands on the player
  m._boss_icicles(col, STUB_WORLD, pos);
  for (let i = 0; i < 40 && m.zones.some((z) => z.type === 'icicles'); i += 1) m.update(0.05, player(0, 0, 0), STUB_WORLD);
  const aoe = m.consumeEvents().find((e) => e.type === 'aoe' && e.hit && e.damage === BALANCE.snow.boss.icicles.damage);
  assert.ok(aoe, 'a column erupts on the player for full damage');
});

test('hits damage snow mobs and pay their coin value', () => {
  const m = make();
  m._make('yeti', 0, 1, STUB_WORLD, {});
  const yeti = m.enemies[0];
  yeti.health = 5;
  const hits = m.hitMelee(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1), 4, 999, -1);
  assert.ok(hits.length === 1 && hits[0].killed);
  assert.equal(m.consumeCoins(), BALANCE.snow.coins.yeti);
});
