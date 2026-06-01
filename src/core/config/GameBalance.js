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
    width: 80,
    depth: 80,
    maxHeight: 22,
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
    maxShield: 100,
    shieldRegenPercent: 2,
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
      reserveAmmo: 0,
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
      damage: 9,
      range: 22,
      fireRate: 1.2,
      clipSize: 8,
      reserveAmmo: 8,
      reloadTime: 1.85,
      pellets: 8,
      spread: 0.09,
      cone: true,
      spreadAngle: 0.22,
      automatic: false,
      projectile: false,
      flashColor: 0xff9f1c,
    },
    {
      id: 'blaster',
      name: 'Blaster',
      damage: 150,
      range: 140,
      fireRate: 0.2,
      clipSize: 1,
      reserveAmmo: 2,
      reloadTime: 2.2,
      pellets: 1,
      spread: 0,
      automatic: true,
      projectile: false,
      penetrate: true,
      flashColor: 0x54d2ff,
    },
    {
      id: 'pistol',
      name: 'Pistola',
      damage: 12,
      range: 70,
      fireRate: 4, // half the rifle's cadence
      clipSize: 12,
      reserveAmmo: 0,
      reloadTime: 1.0,
      pellets: 1,
      spread: 0.02,
      automatic: true,
      projectile: false,
      infiniteAmmo: true,
      flashColor: 0xfff0a0,
    },
    {
      id: 'dagger',
      name: 'Daga',
      damage: 26,
      range: 70,
      fireRate: 2.4,
      clipSize: 99,
      reserveAmmo: 999,
      reloadTime: 1.0,
      pellets: 1,
      spread: 0.012,
      automatic: false,
      projectile: true,
      projectileSpeed: 36,
      projectileRadius: 0.12,
      gravity: 24, // gives the thrown dagger its arc/drop
      flashColor: 0xcfd6df,
    },
  ],

  zombies: {
    health: 30,
    speed: 3.4,
    damage: 8,
    attackRange: 2.3,
    attackCooldown: 1.1,
    spawnRadiusMin: 14,
    spawnRadiusMax: 24,
  },

  sword: {
    damage: 40, // one-shots a zombie (30 hp)
    range: 4.2,
    cooldown: 1.0, // seconds between slashes
    arcCos: 0.3, // frontal cone (~72 degrees half-angle)
    // Charged attacks (hold left click as the knight).
    sweepCharge: 1.5, // seconds to charge the blue giant sweep
    aoeCharge: 4.0, // seconds to charge the white-aura circular AoE
    sweepRange: 9, // reach of the giant sweep
    sweepArcCos: -0.25, // very wide frontal arc
    sweepDamageMult: 2, // double a normal slash
    aoeRadius: 18, // radius of the circular area attack (greatly increased)
    aoeDamageMult: 4, // big damage
  },

  katana: {
    damage: 28, // less than the sword (40)
    cooldown: 0.9,
    range: 4.2,
    arcCos: 0.3,
    buffDamageMult: 2, // basic attacks hit much harder while buffed
    buffCooldown: 0.35, // and much faster
    buffDuration: 10,
    parryWindow: 0.5, // you must be attacked within this window to trigger the buff
    parryRadius: 5.5,
    parryKnockback: 4,
    dashMaxCharge: 3.0,
    dashSpeed: 42,
    dashMinLength: 5,
    dashMaxLength: 12,
    dashMinWidth: 2,
    dashMaxWidth: 4,
    dashMinDamage: 60,
    dashMaxDamage: 180,
  },

  bomb: {
    startCount: 2,
    waveRefill: 2, // extra bombs granted at the shop wave
    fuse: 1.5, // seconds before it blows
    radius: 7.5, // small enough that only a dash escapes it
    damage: 70, // to enemies
    playerDamage: 50, // to the hunter if caught in the blast
  },

  aerial: {
    duration: 2.0, // seconds in the top-down view (invulnerable)
    slashDuration: 0.5, // burst of slashes afterwards
    radius: 4, // circle radius around the player
    damage: 80, // dealt to enemies inside the circle
    cooldown: 30,
  },

  guard: {
    duration: 0.8, // seconds the guard stays up
    cooldown: 1.25, // before it can be raised again
    reflectDamage: 100, // a reflected fireball one-shots the dragon
  },

  dash: {
    distance: 8, // blocks travelled
    speed: 38, // blocks per second
    cooldown: 5, // seconds between dashes
  },

  mage: {
    health: 25,
    mana: 225, // stored as the shield
    nukeRegenLock: 10, // seconds mana can't regen after a nuke
    skills: {
      fireball: { cost: 5, cd: 0, speed: 16, radius: 2.6, damage: 34, life: 4 },
      thunder: { cost: 40, cd: 10, delay: 1.5, radius: 5, range: 130, damage: 130 },
      tornado: { cost: 70, cd: 10, ahead: 5, radius: 4, duration: 4, tickRate: 0.5, tickDamage: 3 }, // total 24 < 30 zombie hp
      blizzard: { cost: 60, cd: 10, speed: 9, radius: 5, damage: 24, slowFactor: 0.5, slowDuration: 5, life: 5 },
      nuke: { cost: 225, cd: 10, radius: 38, damage: 9999 },
    },
  },

  // Luffy: his arm is the weapon. A gear gauge on the right fills by landing
  // hits and empties when he is hit; each form needs more to fill. Transitions:
  //   Gear 1 --fill--> Gear 2 --fill--> Gear 4 Boundman --fill--> Gear 5
  //   Boundman --right click--> Gear 4 Snakeman --fill--> Gear 5
  //   Gear 2  --right click--> Cañón (spends the form back to Gear 1)
  // Each gear defines its three hotbar slots (label + behaviour scaled off the
  // base archetypes), a right-click `secondary`, a `fillTo` target, and passive
  // move/jump multipliers.
  luffy: {
    gaugeMax: [8, 13, 20, 30, 42], // fill needed per gear (harder each time)
    // Archetype stats the slots scale from.
    base: {
      pistol: { damage: 30, range: 9, halfWidth: 1.2, cooldown: 0.5, fill: 2, knockback: 3 },
      bazooka: { damage: 75, range: 8, halfWidth: 2.4, cooldown: 3.0, fill: 3, knockback: 9 },
      gatling: { damage: 9, range: 8, halfWidth: 2.2, cooldown: 6.0, fill: 0.4, knockback: 0, duration: 2.0, interval: 0.08 },
    },
    // Leap specials (own damage/cooldown, not scaled off the archetypes).
    cannon: { damage: 420, range: 12, halfWidth: 4.5, knockback: 18 },             // Gear 2 right-click
    kingkong: { damage: 320, radius: 7, knockback: 16, cooldown: 4.0, jump: 13, slamDelay: 0.42 }, // Boundman skill
    bajrang: { damage: 520, radius: 9, knockback: 22, cooldown: 7.0, jump: 22, slamDelay: 0.6 },    // Gear 5 skill
    skybeam: { damage: 240, radius: 5, knockback: 8, cooldown: 5.0, jump: 12, slamDelay: 0.4 },     // Gear 5 skill
    gears: [
      {
        name: 'Gear 1', smoke: false, secondary: 'none', fillTo: 1, speed: 1.0, jump: 1.0,
        slots: {
          pistol: { label: 'Pistol', behavior: 'punch', dmg: 1.0, range: 1.0, width: 1.0, cd: 1.0 },
          bazooka: { label: 'Bazooka', behavior: 'bazooka', dmg: 1.0, range: 1.0, width: 1.0, cd: 1.0 },
          gatling: { label: 'Gatling', behavior: 'gatling', dmg: 1.0, range: 1.0, width: 1.0, cd: 1.0 },
        },
      },
      {
        name: 'Gear 2', smoke: true, secondary: 'cannon', fillTo: 2, speed: 1.0, jump: 1.0,
        slots: {
          pistol: { label: 'Pistol', behavior: 'punch', dmg: 1.7, range: 1.3, width: 1.15, cd: 0.6 },
          bazooka: { label: 'Bazooka', behavior: 'bazooka', dmg: 1.7, range: 1.3, width: 1.15, cd: 0.6 },
          gatling: { label: 'Gatling', behavior: 'gatling', dmg: 1.7, range: 1.3, width: 1.15, cd: 0.6 },
        },
      },
      {
        // Boundman: Kong Gun / King Kong Gun / Kong Gatling. Right-click -> Snakeman.
        name: 'Gear 4: Boundman', smoke: true, secondary: 'toSnakeman', fillTo: 4, speed: 1.0, jump: 1.0,
        slots: {
          pistol: { label: 'Kong Gun', behavior: 'punch', dmg: 2.1, range: 1.3, width: 1.7, cd: 0.55 },
          bazooka: { label: 'King Kong Gun', behavior: 'kingkong', dmg: 1.0, range: 1.0, width: 1.0, cd: 1.0 },
          gatling: { label: 'Kong Gatling', behavior: 'gatling', dmg: 2.1, range: 1.3, width: 1.7, cd: 0.55 },
        },
      },
      {
        // Snakeman: autoaim punches + long reach. Faster on foot.
        name: 'Gear 4: Snakeman', smoke: true, secondary: 'none', fillTo: 4, speed: 1.12, jump: 1.0,
        slots: {
          pistol: { label: 'Pistol (auto)', behavior: 'autoaim', dmg: 1.8, range: 1.8, width: 1.0, cd: 0.7 },
          bazooka: { label: 'King Cobra Gun', behavior: 'autoaim', dmg: 3.0, range: 2.8, width: 1.0, cd: 1.5 },
          gatling: { label: 'Black Mamba', behavior: 'gatling', dmg: 1.6, range: 2.6, width: 1.3, cd: 0.6 },
        },
      },
      {
        // Gear 5: jumps high, moves fast. Penetrating punch / sky lightning / Bajrang Gun.
        name: 'Gear 5', smoke: true, secondary: 'none', fillTo: 4, speed: 1.5, jump: 1.6,
        slots: {
          pistol: { label: 'Pistol penetrante', behavior: 'penetrate', dmg: 2.4, range: 2.2, width: 1.4, cd: 0.45 },
          bazooka: { label: 'Rayo Divino', behavior: 'skybeam', dmg: 1.0, range: 1.0, width: 1.0, cd: 1.0 },
          gatling: { label: 'Bajrang Gun', behavior: 'bajrang', dmg: 1.0, range: 1.0, width: 1.0, cd: 1.0 },
        },
      },
    ],
  },

  // Dio (secret): a knife thrower. Left click throws a single knife at a good
  // cadence; right click throws 6 independent knives in a line. Stop Sign slams
  // a road sign for AoE every 1.5s. The World freezes time for 5s — only Dio
  // moves; thrown knives drift then hang in the air and launch (dealing damage)
  // when time resumes. The right-side bar fills by dealing damage and empties on
  // The World.
  dio: {
    // hitRadius is generous (3D) so a level-flying knife still connects with a
    // ground enemy whose origin sits at its feet.
    knife: { damage: 14, speed: 44, cooldown: 0.22, hitRadius: 2.2, life: 2.4, fill: 1.5 },
    // Right click: 6 knives scattered at random within an invisible disc in
    // front of the view, all flying forward. Each is identical + independent.
    six: { damage: 14, count: 6, circleRadius: 1.7, cooldown: 3.5, fill: 1.0 },
    // Stop Sign swings down from the hand to slam the ground (damage on landing).
    stopSign: { damage: 55, radius: 4.5, cooldown: 1.5, ahead: 5, fill: 4, swing: 0.2, hold: 0.55 },
    timestop: { duration: 5, freezeDelay: 0.18, gaugeMax: 36 },
  },

  // Snow map only: a wintry roster + two bosses. Special enemies lean on the
  // environment — the cold chills (slows) the player, snow lets a boulder roll,
  // a blizzard spirit floats and pelts ice. Miniboss on wave 5, big boss wave 10.
  snow: {
    spawnRadiusMin: 16,
    spawnRadiusMax: 27,
    coins: { yeti: 4, roller: 3, wisp: 3, alpha: 30, colossus: 90 },
    // Yeti: a big, tanky, slow brute. Its frozen blows chill (slow) the player.
    yeti: { health: 70, speed: 2.5, damage: 16, attackRange: 2.7, attackCooldown: 1.4, scale: 2.2, chill: { factor: 0.55, duration: 2.5 } },
    // Snowroller: a packed snowball that rolls straight at you, fast — dodge it.
    // It can't turn, shatters on a wall, and bursts on impact for heavy damage.
    roller: { health: 26, speed: 11, damage: 30, hitRadius: 1.5 },
    // Frost Wisp: floats, keeps its distance and lobs chilling ice shards.
    wisp: { health: 20, speed: 3.4, hover: 3.2, keepMin: 10, keepMax: 17, shootCooldown: 2.0, shardSpeed: 24, shardDamage: 8, chill: { factor: 0.7, duration: 1.6 } },
    // Wave 5 miniboss — Alpha Yeti: charges, ground-slam ice ring, snow boulders,
    // and a roar that summons lesser yetis.
    miniboss: {
      wave: 5, health: 820, scale: 2.9, speed: 2.8,
      slam: { radius: 6.5, damage: 26, chill: { factor: 0.5, duration: 2.5 } },
      boulder: { damage: 22, speed: 19, hitRadius: 1.2 },
      summon: { yetis: 2 },
      attackEvery: [2.0, 3.0],
    },
    // Wave 10 boss — Ice Colossus: huge, slow, central. Erupting icicle fields,
    // a frost-breath cone (heavy chill), and a blizzard roar that summons + chills.
    boss: {
      wave: 10, health: 5200, scale: 3.6, speed: 1.5, center: [0, 0], altitude: 0,
      icicles: { count: 8, telegraph: 1.1, radius: 3.0, spread: 13, damage: 72, columnTtl: 0.6 },
      frost: { telegraph: 1.6, range: 24, halfAngle: 0.6, damage: 55, chill: { factor: 0.4, duration: 3 } },
      blizzard: { roar: 1.2, yetis: 3, wisps: 2, chill: { factor: 0.5, duration: 3 } },
      attackEvery: [2.2, 3.4],
    },
  },

  progression: {
    waveCount: 10, // total waves in a run
    shopWave: 5, // the shop opens before this wave
    // Reserve ammo granted when reaching the shop wave (only useful to the duck).
    waveAmmo: { Rifle: 60, Shotgun: 16, Blaster: 3 },
  },

  slash: {
    zombieSize: 1.6,
    dragonSize: 3.4,
  },

  skeletons: {
    health: 22, // less than a zombie (30); the fire tornado (24 total) kills them
    speed: 3.0,
    shootRange: 18,
    keepMin: 9, // retreat when the player is closer than this
    keepMax: 15, // follow when the player is farther than this
    shootCooldown: 2.0,
    arrowSpeed: 24,
    arrowDamage: 6,
    reflectDamage: 30, // a guard-reflected arrow one-shots its shooter
  },

  witches: {
    health: 26,
    speed: 3.0,
    keepMin: 12, // keeps a bit more distance than the skeleton (9)
    keepMax: 19,
    throwRange: 22,
    throwCooldown: 2.4,
    potionSpeed: 14,
    healRadius: 6, // 50% larger explosion
    healAmount: 28, // double the heal
  },

  coins: {
    zombie: 2,
    skeleton: 3,
    witch: 4,
    dragon: 5,
  },

  // After this long without damaging any enemy, every enemy glows red for a
  // while so you can find them. Resets the moment you land a hit.
  threat: {
    idleSeconds: 10,
    highlightSeconds: 5,
    color: 0xff2020,
  },

  // Campaign mode (vs the default "waves" mode). The duck starts with only the
  // pistol, plays 20 waves, shops every 5, and ground mobs have a head hitbox
  // that pays bonus coins on a killing headshot.
  campaign: {
    waveCount: 20,
    shopEvery: 5,
    headshotDamageMult: 2,
    headshotBonusCoins: 4,
    startWeapons: ['pistol'],
    // Guns sold in the campaign shop (the same arsenal as waves mode).
    shopWeapons: [
      { id: 'rifle', name: 'Rifle', cost: 28 },
      { id: 'shotgun', name: 'Shotgun', cost: 22 },
      { id: 'blaster', name: 'Blaster', cost: 46 },
    ],
    // Reserve ammo granted when a gun is bought.
    weaponAmmo: { Rifle: 90, Shotgun: 24, Blaster: 6 },
  },

  // Wave-5 miniboss (waves mode only): a big red dragon that cycles attacks.
  boss: {
    wave: 5,
    enemyScale: 0.5,   // fewer regular enemies on the boss wave
    health: 900,
    scale: 1.9,        // model size multiplier
    color: 0xb01818,
    fire: 0xff3a10,
    // Big ground ball -> a burning circle that hurts per second for a while.
    ground: { speed: 17, damage: 10, count: 2, zoneRadius: 4.2, zoneDps: 22, zoneTtl: 5, tickRate: 0.5 },
    // Fast little bolts with slight auto-aim.
    homing: { speed: 30, damage: 9, count: 5, turn: 2.2, life: 3, radius: 0.7 },
    // Machine-gun: many tiny fast bullets, only dodgeable behind cover.
    machinegun: { speed: 46, damage: 4, burst: 22, interval: 0.06, spread: 0.07, life: 2.2, radius: 0.45 },
    attackEvery: [1.6, 2.6], // random gap (min,max) between attack patterns
  },

  // Wave-10 boss (waves mode only): after the meteor, the Dragon King lands in
  // the centre of the crater and never leaves it. No other enemies spawn (it
  // summons its own). Reuses the wave-5 attacks scaled up, plus three signature
  // attacks: erupting pillars, a fire-breath cone, and a summoning roar.
  kingDragon: {
    wave: 10,
    health: 5200,
    scale: 3.0,        // bigger than the wave-5 boss (1.9)
    color: 0xcf1414,
    fire: 0xff5212,
    crown: 0xffd23b,
    center: [0, 0],    // crater centre (x,z) — it stays here
    altitude: 16,      // hover height above the crater
    // Scaled-up wave-5 attacks.
    ground: { speed: 19, damage: 16, count: 3, zoneRadius: 6.0, zoneDps: 32, zoneTtl: 5.5, tickRate: 0.5 },
    homing: { speed: 32, damage: 14, count: 8, turn: 2.4, life: 3.2, radius: 0.95 },
    machinegun: { speed: 50, damage: 6, burst: 34, interval: 0.05, spread: 0.06, life: 2.4, radius: 0.5 },
    // 8 big red telegraphs on the ground, then erupting damage columns.
    pillar: { count: 8, telegraph: 1.2, radius: 3.4, spread: 13, damage: 75, columnTtl: 0.6, columnHeight: 16 },
    // A giant circular-sector telegraph aimed at the player, then a fire breath.
    cone: { telegraph: 2.0, range: 26, halfAngle: 0.6, damage: 55, breathTtl: 0.7 },
    // A roar that summons reinforcements after a short wind-up.
    summon: { roar: 1.0, zombies: 6, skeletons: 3 },
    attackEvery: [2.0, 3.2],
  },

  // Wave-10 cutscene (waves mode only): a meteor smashes the castle into a
  // crater, then the player respawns somewhere random on the cratered map.
  meteor: {
    wave: 10,
    height: 95,       // meteor start altitude
    fallTime: 1.8,    // seconds to impact
    flashTime: 0.9,   // white-out duration that hides the map swap
    craterRadius: 18, // covers the castle + plateau
  },

  shop: {
    items: [
      { id: 'damage', name: '+25% Daño', emoji: '⚔️', cost: 18 },
      { id: 'speed', name: '+15% Velocidad', emoji: '👟', cost: 14 },
      { id: 'health', name: '+40 Vida máx', emoji: '❤️', cost: 14 },
      { id: 'shield', name: '+25 Escudo máx', emoji: '🛡️', cost: 12 },
    ],
  },

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
