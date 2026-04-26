export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function rand(min = 0, max = 1) {
  return lerp(min, max, Math.random());
}

export function hashNoise(x = 0, z = 0, seed = 1337) {
  let h = Math.imul(Math.floor(x), 374761393)
    ^ Math.imul(Math.floor(z), 668265263)
    ^ Math.imul(Math.floor(seed), 1442695041);

  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

export const BALANCE = deepFreeze({
  colors: {
    sky: 0x8fc7ff,
    fog: 0x8fc7ff,
    sun: 0xfff0c5,
    hemisphereSky: 0xcfe8ff,
    hemisphereGround: 0x31451e,
    grass: 0x58a548,
    dirt: 0x8b5a2b,
    stone: 0x7b7f86,
    water: 0x2f8ed8,
    dragonBody: 0x3e6f45,
    dragonBelly: 0x8aa36a,
    dragonWing: 0x2d5538,
    dragonHorn: 0xd8d0a8,
    dragonFire: 0xff6b1a,
    dragonFireEmissive: 0xff3400,
  },

  world: {
    blockSize: 1,
    width: 48,
    depth: 48,
    maxHeight: 20,
    waterLevel: 6,
    seed: 1337,
    terrain: {
      broadScale: 18,
      detailScale: 7,
      broadAmplitude: 10,
      detailAmplitude: 4,
      surfaceBias: 0.45,
    },
    interactionRange: 8,
    fogNear: 80,
    fogFar: 340,
  },

  player: {
    height: 1.75,
    radius: 0.35,
    moveSpeed: 7,
    sprintMultiplier: 1.5,
    jumpSpeed: 8,
    gravity: 24,
    groundY: 0,
    mouseSensitivity: 0.0022,
    maxHealth: 100,
    ammo: 30,
    maxAmmo: 30,
    spawnYOffset: 2.2,
  },

  weapons: [
    {
      id: 'rifle',
      name: 'Rifle',
      damage: 22,
      range: 90,
      fireRate: 8,
      clipSize: 30,
      reserveAmmo: 120,
      reloadTime: 1.4,
      pellets: 1,
      spread: 0.008,
      automatic: true,
      projectile: false,
      flashColor: 0xffd166,
    },
    {
      id: 'shotgun',
      name: 'Shotgun',
      damage: 11,
      range: 42,
      fireRate: 1.35,
      clipSize: 8,
      reserveAmmo: 40,
      reloadTime: 1.85,
      pellets: 8,
      spread: 0.075,
      automatic: false,
      projectile: false,
      flashColor: 0xff9f1c,
    },
    {
      id: 'blaster',
      name: 'Blaster',
      damage: 36,
      range: 120,
      fireRate: 3.2,
      clipSize: 18,
      reserveAmmo: 72,
      reloadTime: 1.7,
      pellets: 1,
      spread: 0.004,
      automatic: true,
      projectile: true,
      projectileSpeed: 72,
      projectileRadius: 0.12,
      flashColor: 0x54d2ff,
    },
  ],

  dragons: {
    count: 3,
    spawnRadius: 34,
    spawnRadiusStep: 5,
    minAltitude: 13,
    maxAltitude: 22,
    health: 100,
    fireballDamage: 14,
    fireballSpeed: 24,
    fireballLife: 3.25,
    fireballCollisionRadius: 1.15,
    attackRangeBase: 52,
    attackCooldownMin: 1.35,
    attackCooldownMax: 3.2,
    baseSpeed: 0.24,
    speedStep: 0.035,
    baseAggression: 0.58,
    aggressionStep: 0.13,
    orbitPressure: 0.35,
    bobAmplitude: 1.6,
    bobSpeed: 2.5,
    wingFlapSpeed: 12,
    wingFlapAmplitude: 0.55,
  },
});

export default BALANCE;
