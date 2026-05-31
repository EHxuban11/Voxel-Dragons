// Exhaustive validation of every tuning variable in BALANCE. The first block
// walks EVERY leaf value generically (no NaN/undefined, finite numbers, valid
// hex colours, non-empty strings); the rest assert cross-variable consistency
// (ranges, min<=max pairs, ids that reference other ids, etc.).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, clamp, lerp, rand, hashNoise } from '../src/core/config/GameBalance.js';

// --- generic leaf walk ------------------------------------------------------
const COLOR_KEYS = new Set([
  'sky', 'fog', 'sun', 'hemisphereSky', 'hemisphereGround', 'grass', 'dirt', 'stone', 'water',
  'dragonBody', 'dragonBelly', 'dragonWing', 'dragonHorn', 'dragonFire', 'dragonFireEmissive',
  'flashColor', 'color', 'fire', 'crown',
]);

function flatten(value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push([prefix, value]);
  }
  return out;
}

const LEAVES = flatten(BALANCE);
const lastKey = (path) => path.replace(/\[\d+\]$/, '').split('.').pop();

test('every BALANCE variable is defined (no undefined/null/NaN)', () => {
  assert.ok(LEAVES.length > 250, `expected a large config, got ${LEAVES.length} leaves`);
  for (const [path, value] of LEAVES) {
    assert.notEqual(value, undefined, `${path} is undefined`);
    assert.notEqual(value, null, `${path} is null`);
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite (${value})`);
  }
});

test('every numeric variable is a finite number; strings non-empty; booleans real', () => {
  for (const [path, value] of LEAVES) {
    const t = typeof value;
    assert.ok(t === 'number' || t === 'string' || t === 'boolean', `${path} has odd type ${t}`);
    if (t === 'number') assert.ok(Number.isFinite(value), `${path} not finite`);
    if (t === 'string') assert.ok(value.length > 0, `${path} empty string`);
  }
});

test('every colour variable is a valid 24-bit hex value', () => {
  const colors = LEAVES.filter(([p]) => COLOR_KEYS.has(lastKey(p)));
  assert.ok(colors.length >= 20, `expected many colours, found ${colors.length}`);
  for (const [path, value] of colors) {
    assert.equal(typeof value, 'number', `${path} colour not a number`);
    assert.ok(Number.isInteger(value), `${path} colour not an integer`);
    assert.ok(value >= 0 && value <= 0xffffff, `${path} colour out of [0,0xffffff]: ${value.toString(16)}`);
  }
});

// --- world ------------------------------------------------------------------
test('world dimensions are sane', () => {
  const w = BALANCE.world;
  for (const k of ['blockSize', 'width', 'depth', 'maxHeight']) assert.ok(w[k] > 0, `world.${k}`);
  assert.ok(w.waterLevel >= 0 && w.waterLevel < w.maxHeight, 'waterLevel within height');
  assert.ok(w.fogNear < w.fogFar, 'fogNear < fogFar');
  assert.ok(w.interactionRange > 0, 'interactionRange');
});

// --- player -----------------------------------------------------------------
test('player stats are sane', () => {
  const p = BALANCE.player;
  for (const k of ['height', 'radius', 'moveSpeed', 'jumpSpeed', 'gravity', 'maxHealth', 'maxShield', 'mouseSensitivity']) {
    assert.ok(p[k] > 0, `player.${k} must be > 0`);
  }
  assert.ok(p.sprintMultiplier >= 1, 'sprint multiplier >= 1');
  assert.ok(p.ammo <= p.maxAmmo, 'ammo <= maxAmmo');
  assert.ok(p.radius < 0.5, 'player radius fits a 1-block grid');
});

// --- weapons ----------------------------------------------------------------
test('weapons: unique ids and positive core stats', () => {
  const ids = BALANCE.weapons.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'weapon ids must be unique');
  for (const w of BALANCE.weapons) {
    assert.ok(w.damage > 0, `${w.id}.damage`);
    assert.ok(w.range > 0, `${w.id}.range`);
    assert.ok(w.fireRate > 0, `${w.id}.fireRate`);
    assert.ok(w.clipSize > 0, `${w.id}.clipSize`);
    assert.ok(w.reloadTime > 0, `${w.id}.reloadTime`);
    assert.ok(w.pellets >= 1, `${w.id}.pellets`);
    assert.ok(w.spread >= 0, `${w.id}.spread`);
    assert.ok(w.reserveAmmo >= 0, `${w.id}.reserveAmmo`);
    assert.equal(typeof w.automatic, 'boolean', `${w.id}.automatic`);
    assert.equal(typeof w.name, 'string', `${w.id}.name`);
  }
});

// --- enemies ----------------------------------------------------------------
test('ground enemies have positive health/speed and ordered keep ranges', () => {
  for (const key of ['zombies', 'skeletons', 'witches']) {
    const e = BALANCE[key];
    assert.ok(e.health > 0, `${key}.health`);
    assert.ok(e.speed > 0, `${key}.speed`);
  }
  assert.ok(BALANCE.zombies.spawnRadiusMin <= BALANCE.zombies.spawnRadiusMax, 'zombie spawn radius order');
  assert.ok(BALANCE.skeletons.keepMin <= BALANCE.skeletons.keepMax, 'skeleton keep order');
  assert.ok(BALANCE.witches.keepMin <= BALANCE.witches.keepMax, 'witch keep order');
});

test('flying dragons: ordered altitude/cooldown ranges', () => {
  const d = BALANCE.dragons;
  assert.ok(d.count >= 1, 'dragon count');
  assert.ok(d.health > 0, 'dragon health');
  assert.ok(d.minAltitude <= d.maxAltitude, 'altitude order');
  assert.ok(d.attackCooldownMin <= d.attackCooldownMax, 'cooldown order');
  assert.ok(d.fireballSpeed > 0 && d.fireballDamage > 0, 'fireball stats');
});

// --- melee / abilities ------------------------------------------------------
test('sword & katana charge/dash ranges are ordered', () => {
  const s = BALANCE.sword;
  assert.ok(s.damage > 0 && s.range > 0 && s.cooldown > 0, 'sword base');
  assert.ok(s.sweepCharge < s.aoeCharge, 'sweep charges before aoe');
  const k = BALANCE.katana;
  assert.ok(k.dashMinLength <= k.dashMaxLength, 'dash length order');
  assert.ok(k.dashMinWidth <= k.dashMaxWidth, 'dash width order');
  assert.ok(k.dashMinDamage <= k.dashMaxDamage, 'dash damage order');
  assert.ok(k.buffDuration > 0 && k.parryWindow > 0, 'katana buff/parry');
});

test('mage skills cost no more than the mana pool', () => {
  const m = BALANCE.mage;
  assert.ok(m.mana > 0, 'mana');
  for (const [name, sk] of Object.entries(m.skills)) {
    assert.ok(sk.cost >= 0 && sk.cost <= m.mana, `${name} cost within mana`);
    assert.ok((sk.damage ?? 0) >= 0, `${name} damage`);
    assert.ok((sk.cd ?? 0) >= 0, `${name} cooldown`);
  }
  assert.equal(m.skills.nuke.cost, m.mana, 'the nuke drains the full pool');
});

// --- progression / modes ----------------------------------------------------
test('progression & campaign reference real weapons', () => {
  const ids = new Set(BALANCE.weapons.map((w) => w.id));
  const names = new Set(BALANCE.weapons.map((w) => w.name));
  assert.ok(BALANCE.progression.waveCount >= 1, 'waveCount');
  assert.ok(BALANCE.progression.shopWave <= BALANCE.progression.waveCount, 'shopWave within run');
  for (const k of Object.keys(BALANCE.progression.waveAmmo)) assert.ok(names.has(k), `waveAmmo "${k}"`);

  const c = BALANCE.campaign;
  assert.ok(c.waveCount >= 1 && c.shopEvery >= 1 && c.shopEvery <= c.waveCount, 'campaign waves');
  assert.ok(c.headshotDamageMult > 1, 'headshots hurt more');
  for (const id of c.startWeapons) assert.ok(ids.has(id), `startWeapon "${id}"`);
  for (const w of c.shopWeapons) { assert.ok(ids.has(w.id), `shopWeapon "${w.id}"`); assert.ok(w.cost > 0, `${w.id} cost`); }
  for (const k of Object.keys(c.weaponAmmo)) assert.ok(names.has(k), `weaponAmmo "${k}"`);
});

// --- bosses -----------------------------------------------------------------
test('wave-5 boss & Dragon King are well-formed and the King is the bigger threat', () => {
  for (const cfg of [BALANCE.boss, BALANCE.kingDragon]) {
    assert.ok(cfg.health > 0 && cfg.scale > 0, 'boss hp/scale');
    assert.ok(Array.isArray(cfg.attackEvery) && cfg.attackEvery[0] <= cfg.attackEvery[1] && cfg.attackEvery[0] > 0, 'attackEvery [lo<=hi]');
    for (const atk of ['ground', 'homing', 'machinegun']) {
      const a = cfg[atk];
      assert.ok(a.speed > 0 && a.damage > 0, `${atk} speed/damage`);
      assert.ok((a.count ?? a.burst) >= 1, `${atk} count`);
    }
  }
  // The King out-scales the wave-5 boss (the user's "todavía más grande").
  assert.ok(BALANCE.kingDragon.scale > BALANCE.boss.scale, 'King is bigger');
  assert.ok(BALANCE.kingDragon.health > BALANCE.boss.health, 'King has more HP');
});

test('Dragon King signature attacks match the spec', () => {
  const k = BALANCE.kingDragon;
  assert.equal(k.pillar.count, 8, 'exactly 8 pillar areas');
  assert.ok(k.pillar.telegraph > 0 && k.pillar.damage > 0 && k.pillar.radius > 0, 'pillar fields');
  assert.ok(k.cone.telegraph > 0 && k.cone.range > 0 && k.cone.damage > 0, 'cone fields');
  assert.ok(k.cone.halfAngle > 0 && k.cone.halfAngle < Math.PI / 2, 'cone half-angle is a real wedge');
  assert.ok(k.summon.zombies >= 1 || k.summon.skeletons >= 1, 'summon brings minions');
  assert.ok(Array.isArray(k.center) && k.center.length === 2, 'king stays at a fixed (x,z)');
});

test('boss/king/meteor waves line up with the run length', () => {
  assert.equal(BALANCE.boss.wave, 5, 'miniboss on wave 5');
  assert.equal(BALANCE.kingDragon.wave, 10, 'King on wave 10');
  assert.equal(BALANCE.meteor.wave, BALANCE.kingDragon.wave, 'meteor precedes the King on the same wave');
  assert.ok(BALANCE.boss.wave < BALANCE.kingDragon.wave, 'miniboss before the King');
  assert.ok(BALANCE.kingDragon.wave <= BALANCE.progression.waveCount, 'King within the waves run');
  assert.ok(BALANCE.meteor.fallTime > 0 && BALANCE.meteor.flashTime > 0 && BALANCE.meteor.craterRadius > 0, 'meteor timing');
});

// --- misc economy / feedback ------------------------------------------------
test('coins, shop and threat values are positive and unique', () => {
  for (const [k, v] of Object.entries(BALANCE.coins)) assert.ok(v > 0, `coins.${k}`);
  const shopIds = BALANCE.shop.items.map((i) => i.id);
  assert.equal(new Set(shopIds).size, shopIds.length, 'shop item ids unique');
  for (const i of BALANCE.shop.items) assert.ok(i.cost > 0 && i.name.length > 0, `shop ${i.id}`);
  assert.ok(BALANCE.threat.idleSeconds > 0 && BALANCE.threat.highlightSeconds > 0, 'threat timing');
});

// --- exported math primitives (used everywhere) -----------------------------
test('clamp/lerp/rand/hashNoise behave', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  for (let i = 0; i < 500; i += 1) {
    const r = rand(2, 5);
    assert.ok(r >= 2 && r <= 5, `rand out of range: ${r}`);
  }
  // hashNoise is deterministic and normalised to [0,1].
  assert.equal(hashNoise(3, 7, 1337), hashNoise(3, 7, 1337));
  for (const [x, z] of [[0, 0], [10, -4], [123, 456], [-7, 99]]) {
    const n = hashNoise(x, z, 1337);
    assert.ok(n >= 0 && n <= 1, `hashNoise out of [0,1]: ${n}`);
  }
});
