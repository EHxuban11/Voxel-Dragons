// Regression tests for the core shooting contract — the headline invariant
// "if you have ammo and you fire, a shot comes out and the clip goes down".
// Weapons only uses THREE.Vector3 math and guards every mesh/scene op behind
// `scene?.add`, so it runs fully headless (no WebGL/canvas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Weapons } from '../src/game/combat/Weapons.js';

const SHOT = { origin: new THREE.Vector3(0, 1, 0), direction: new THREE.Vector3(0, 0, -1) };

function makeWeapons(extra = {}) {
  const events = [];
  const w = new Weapons({
    onFire: () => events.push('fire'),
    onMuzzleFlash: () => events.push('muzzle'),
    onEmpty: () => events.push('empty'),
    ...extra,
  });
  return { w, events };
}

test('firing with ammo fires the shot and spends one round', () => {
  const { w, events } = makeWeapons();
  const before = w.currentWeapon.ammo;
  assert.ok(before > 0);
  const res = w.fire(SHOT);
  assert.equal(res.fired, true, 'a loaded weapon must fire');
  assert.equal(w.currentWeapon.ammo, before - 1, 'one round is consumed');
  assert.ok(events.includes('fire') && events.includes('muzzle'), 'fire + muzzle flash emitted');
});

test('a projectile weapon actually spawns a projectile when it fires', () => {
  const { w } = makeWeapons();
  const idx = w.inventory.findIndex((weapon) => weapon.projectile);
  assert.ok(idx >= 0, 'there is a projectile weapon to test');
  w.switchWeapon(idx);
  assert.equal(w.projectiles.length, 0);
  const res = w.fire(SHOT);
  assert.equal(res.fired, true);
  assert.equal(w.projectiles.length, 1, 'the projectile is in flight');
});

test('an empty clip cannot fire and ammo never goes negative', () => {
  const { w, events } = makeWeapons();
  w.currentWeapon.ammo = 0;
  w.currentWeapon.reserveAmmo = 0; // so it does not auto-reload
  const res = w.fire(SHOT);
  assert.equal(res, false, 'no shot from an empty clip');
  assert.equal(w.currentWeapon.ammo, 0, 'ammo stays at zero (never negative)');
  assert.equal(w.lastFireResult.reason, 'empty');
  assert.ok(events.includes('empty'));
});

test('the fire-rate cooldown blocks a second shot until it elapses', () => {
  const { w } = makeWeapons();
  assert.equal(w.fire(SHOT).fired, true);
  assert.equal(w.fire(SHOT), false, 'second immediate shot is on cooldown');
  w.update(1); // advance well past 1/fireRate seconds
  assert.equal(w.fire(SHOT).fired, true, 'fires again once cooled down');
});

test('reloading refills the clip from reserve and blocks firing meanwhile', () => {
  const { w } = makeWeapons();
  const wp = w.currentWeapon;
  wp.ammo = 5;
  wp.reserveAmmo = 100;
  assert.equal(w.reload(), true);
  assert.equal(wp.isReloading, true);
  assert.equal(w.fire(SHOT), false, 'cannot fire mid-reload');
  w.update(wp.reloadTime + 0.01);
  assert.equal(wp.isReloading, false);
  assert.equal(wp.ammo, wp.clipSize, 'clip is full again');
  assert.equal(wp.reserveAmmo, 100 - (wp.clipSize - 5), 'reserve drops by what was loaded');
});

test('an infinite-ammo weapon never runs out', () => {
  const { w } = makeWeapons({
    weapons: [{
      name: 'Pistol', damage: 12, range: 70, fireRate: 100, clipSize: 12,
      reserveAmmo: 0, reloadTime: 1, pellets: 1, spread: 0, automatic: true,
      projectile: false, infiniteAmmo: true,
    }],
  });
  const start = w.currentWeapon.ammo;
  for (let i = 0; i < 8; i += 1) { w.fire(SHOT); w.update(1); }
  assert.equal(w.currentWeapon.ammo, start, 'infinite-ammo clip never depletes');
});
