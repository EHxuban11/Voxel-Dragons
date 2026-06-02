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
function advance(manager, seconds, target = player()) {
  for (let t = 0; t < seconds; t += 0.05) manager.update(0.05, target, STUB_WORLD);
}
function finishColossusIntro(manager) {
  advance(manager, BALANCE.snow.boss.intro.duration + 0.1);
  return manager.enemies.find((e) => e.kind === 'colossus');
}

test('config: snow bosses are well-formed and waves line up', () => {
  assert.equal(BALANCE.snow.miniboss.wave, 5);
  assert.equal(BALANCE.snow.boss.wave, 10);
  assert.ok(BALANCE.snow.boss.health > BALANCE.snow.miniboss.health, 'the colossus is tougher than the alpha');
  assert.equal(BALANCE.snow.boss.icicles.count, 8);
  assert.ok(BALANCE.snow.yeti.chill.factor < 1, 'the chill actually slows');
});

test('a regular snow wave fields yetis, rollers, snowmen and wisps', () => {
  const m = make();
  m.spawnWave(6, player(), STUB_WORLD);
  const kinds = new Set(m.enemies.map((e) => e.kind));
  assert.ok(kinds.has('yeti') && kinds.has('roller') && kinds.has('snowman') && kinds.has('wisp'));
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
  assert.ok(b.enemies.some((e) => e.kind === 'summoning'), 'the boss starts inside a blizzard intro');
  const col = finishColossusIntro(b);
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

test('the Alpha Yeti raises a damaging line of ice spikes', () => {
  const m = make();
  m.spawnMiniboss(player(), STUB_WORLD);
  const alpha = m.enemies.find((e) => e.kind === 'alpha');
  const target = new THREE.Vector3(alpha.mesh.position.x - 6, 0, alpha.mesh.position.z);
  m._boss_spikes(alpha, STUB_WORLD, target);
  const line = m.zones.find((z) => z.type === 'spikeLine');
  assert.equal(line.spots.length, BALANCE.snow.miniboss.spikes.count);
  advance(m, BALANCE.snow.miniboss.spikes.telegraph + 0.1, player(target.x, 0, target.z));
  const hit = m.consumeEvents().find((e) => e.type === 'aoe' && e.hit);
  assert.ok(hit);
  assert.equal(hit.damage, BALANCE.snow.miniboss.spikes.damage);
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
  const col = finishColossusIntro(m);
  const pos = new THREE.Vector3(0, 0, 8);

  m._boss_icicles(col, STUB_WORLD, pos);
  const icicleZone = m.zones.find((z) => z.type === 'icicles');
  assert.ok(icicleZone && icicleZone.spots.length === 8, '8 telegraphed icicle spots');

  m._boss_frost(col, STUB_WORLD, pos);
  assert.ok(m.zones.some((z) => z.type === 'frost'), 'a frost cone telegraph');

  m._boss_stomp(col, STUB_WORLD);
  assert.ok(m.zones.some((z) => z.type === 'stomp'), 'a stomp telegraph');

  m._boss_blizzard(col, STUB_WORLD, pos);
  const ev = m.consumeEvents();
  assert.ok(ev.some((e) => e.type === 'summon'), 'the blizzard summons reinforcements');
  assert.ok(ev.some((e) => e.type === 'blizzard' && e.chill && e.torch && e.freezePerSecond > 0), 'and starts the torch blizzard');
  assert.ok(m.zones.some((z) => z.type === 'torch'), 'the blizzard creates a protective torch');
});

test('icicle telegraphs erupt into damaging columns and hit a player standing on one', () => {
  const m = make();
  m.spawnBoss(player(), STUB_WORLD);
  const col = finishColossusIntro(m);
  const pos = new THREE.Vector3(0, 0, 0); // a spot lands on the player
  m._boss_icicles(col, STUB_WORLD, pos);
  for (let i = 0; i < 40 && m.zones.some((z) => z.type === 'icicles'); i += 1) m.update(0.05, player(0, 0, 0), STUB_WORLD);
  const aoe = m.consumeEvents().find((e) => e.type === 'aoe' && e.hit && e.damage === BALANCE.snow.boss.icicles.damage);
  assert.ok(aoe, 'a column erupts on the player for full damage');
});

test('the first Ice Colossus death splits it into two weaker colossi', () => {
  const m = make();
  m.spawnBoss(player(), STUB_WORLD);
  const col = finishColossusIntro(m);
  m._damage(col, col.health);
  const split = m.enemies.filter((e) => !e.dead && e.kind === 'colossus');
  assert.equal(split.length, 2);
  for (const child of split) {
    assert.equal(child.health, Math.round(BALANCE.snow.boss.health * BALANCE.snow.boss.split.healthMult));
    assert.equal(child.damageMult, BALANCE.snow.boss.split.damageMult);
    assert.equal(child.splitLevel, 1);
  }
  assert.ok(m.consumeEvents().some((e) => e.type === 'split'));
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
