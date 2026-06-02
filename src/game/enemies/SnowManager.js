import * as THREE from 'three';
import { moveHorizontal, easeToGround, steerToward } from '../../engine/Collision.js';
import { BALANCE } from '../../core/config/GameBalance.js';

const DEFAULT_BOUNDS = { minX: -22, maxX: 22, minZ: -22, maxZ: 22 };
const RADIUS = 0.4;
const HEIGHT = 2;
const ANY_DIR = new THREE.Vector3(1, 0, 0);

function getWorldPosition(target, fallback = new THREE.Vector3()) {
  if (!target) return fallback.set(0, 0, 0);
  if (target.isVector3) return fallback.copy(target);
  if (target.object?.position?.isVector3) return fallback.copy(target.object.position);
  if (target.position?.isVector3) return fallback.copy(target.position);
  return fallback.set(0, 0, 0);
}

function groundHeight(world, x, z, fallback = 0) {
  return typeof world?.getGroundHeight === 'function' ? world.getGroundHeight(x, z) : fallback;
}

// Snow-map-only roster + the two snow bosses. Conforms to the enemy-aggregator
// contract so guns/abilities/status effects hit them like any other enemy. The
// special enemies key off the environment: yetis chill (slow) on contact, the
// snowroller rolls and shatters, the frost wisp floats and pelts ice, and the
// snowman keeps range like the biome's skeleton analogue.
export class SnowManager {
  constructor(scene = null, options = {}) {
    this.scene = scene?.isScene ? scene : null;
    this.camera = options.camera ?? null;
    this.world = options.world ?? null;
    this.bounds = { ...DEFAULT_BOUNDS, ...(options.bounds ?? {}) };
    this.cfg = BALANCE.snow;

    this.group = new THREE.Group();
    this.group.name = 'SnowManager';
    this.enemies = [];        // every snow mob, bosses included (so it's one list)
    this.projectiles = [];    // shards, boulders
    this.zones = [];          // boss telegraphs + erupting icicle columns
    this.events = [];         // -> Game (attack/projectile/summon)
    this.elapsed = 0;
    this.kills = 0;
    this._coins = 0;
    this.impacts = [];

    this.tmpPlayer = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();
    this.tmpRaycaster = new THREE.Raycaster();
    this.tmpQuat = new THREE.Quaternion();

    this.material = {
      fur: new THREE.MeshStandardMaterial({ color: 0xeef4fb, roughness: 0.95, flatShading: true }),
      furDark: new THREE.MeshStandardMaterial({ color: 0xc3d2e0, roughness: 0.95, flatShading: true }),
      face: new THREE.MeshStandardMaterial({ color: 0x3a4654, roughness: 0.8, flatShading: true }),
      eye: new THREE.MeshStandardMaterial({ color: 0x6fd2ff, emissive: 0x2aa0ff, emissiveIntensity: 1.2, flatShading: true }),
      snow: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
      coal: new THREE.MeshStandardMaterial({ color: 0x181a1d, roughness: 0.9, flatShading: true }),
      carrot: new THREE.MeshStandardMaterial({ color: 0xff8a1c, roughness: 0.85, flatShading: true }),
      stick: new THREE.MeshStandardMaterial({ color: 0x6a4324, roughness: 0.9, flatShading: true }),
      torch: new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.85, flatShading: true }),
      flame: new THREE.MeshBasicMaterial({ color: 0xffb23b, transparent: true, opacity: 0.88, depthWrite: false, blending: THREE.AdditiveBlending }),
      safe: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
      ice: new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x2a8bdf, emissiveIntensity: 0.5, roughness: 0.4, flatShading: true, transparent: true, opacity: 0.92 }),
      shard: new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x3aa0ff, emissiveIntensity: 1.4, flatShading: true }),
      telegraph: new THREE.MeshBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    this.geometry = { box: new THREE.BoxGeometry(1, 1, 1), shard: new THREE.IcosahedronGeometry(0.32, 0) };

    if (this.scene) this.scene.add(this.group);
  }

  // ---------------------------------------------------------------- meshes ---
  _box(w, h, d, mat) {
    const m = new THREE.Mesh(this.geometry.box, mat);
    m.scale.set(w, h, d);
    m.castShadow = true;
    return m;
  }

  _yetiMesh(scale = 1, options = {}) {
    const g = new THREE.Group();
    const torso = this._box(1.5, 1.7, 1.0, this.material.fur); torso.position.y = 1.5; g.add(torso);
    const belly = this._box(1.1, 1.1, 0.9, this.material.furDark); belly.position.set(0, 1.35, 0.15); g.add(belly);
    const head = this._box(1.0, 0.9, 0.9, this.material.fur); head.position.y = 2.6; g.add(head);
    const face = this._box(0.7, 0.5, 0.2, this.material.face); face.position.set(0, 2.55, 0.45); g.add(face);
    for (const sx of [-0.22, 0.22]) { const eye = this._box(0.16, 0.16, 0.12, this.material.eye); eye.position.set(sx, 2.7, 0.55); g.add(eye); }
    if (options.iceHorns) {
      for (const sx of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.85, 5), this.material.shard);
        horn.position.set(sx * 0.36, 3.05, 0.02);
        horn.rotation.z = -sx * 0.42;
        horn.rotation.x = 0.25;
        horn.castShadow = true;
        g.add(horn);
      }
      const crest = this._box(0.32, 0.18, 0.5, this.material.ice);
      crest.position.set(0, 2.98, -0.2);
      crest.rotation.x = -0.35;
      g.add(crest);
    }
    for (const sx of [-1, 1]) {
      const arm = this._box(0.5, 1.5, 0.5, this.material.fur); arm.position.set(sx * 1.05, 1.45, 0.1); g.add(arm);
      const leg = this._box(0.55, 1.0, 0.6, this.material.furDark); leg.position.set(sx * 0.45, 0.5, 0); g.add(leg);
    }
    g.scale.setScalar(scale);
    g.traverse((c) => { if (c.isMesh) c.userData.snowRoot = g; });
    return g;
  }

  _rollerMesh() {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), this.material.snow);
    ball.castShadow = true; g.add(ball);
    // a couple of darker patches so the spin reads
    for (const [x, y] of [[0.4, 0.4], [-0.4, -0.3]]) { const p = this._box(0.4, 0.4, 0.4, this.material.furDark); p.position.set(x, y, 0.7); g.add(p); }
    g.traverse((c) => { if (c.isMesh) c.userData.snowRoot = g; });
    return g;
  }

  _wispMesh() {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), this.material.ice); g.add(core);
    for (const sx of [-0.55, 0.55]) { const wing = this._box(0.5, 0.05, 0.7, this.material.shard); wing.position.set(sx, 0.1, 0); wing.rotation.z = sx * 0.4; g.add(wing); }
    const eye = this._box(0.18, 0.18, 0.12, this.material.eye); eye.position.set(0, 0.05, 0.45); g.add(eye);
    g.traverse((c) => { if (c.isMesh) c.userData.snowRoot = g; });
    return g;
  }

  _snowmanMesh() {
    const g = new THREE.Group();
    const base = this._box(0.95, 0.95, 0.95, this.material.snow); base.position.y = 0.48; g.add(base);
    const body = this._box(0.78, 0.78, 0.78, this.material.snow); body.position.y = 1.18; g.add(body);
    const head = this._box(0.58, 0.58, 0.58, this.material.snow); head.position.y = 1.85; g.add(head);
    for (const sx of [-0.14, 0.14]) {
      const eye = this._box(0.07, 0.07, 0.05, this.material.coal);
      eye.position.set(sx, 1.94, 0.31);
      g.add(eye);
    }
    const nose = this._box(0.09, 0.09, 0.3, this.material.carrot); nose.position.set(0, 1.86, 0.46); g.add(nose);
    for (const sx of [-1, 1]) {
      const arm = this._box(0.12, 0.12, 0.75, this.material.stick);
      arm.position.set(sx * 0.52, 1.25, 0.05);
      arm.rotation.z = sx * 0.55;
      arm.rotation.y = sx * 0.25;
      g.add(arm);
    }
    g.traverse((c) => { if (c.isMesh) c.userData.snowRoot = g; });
    return g;
  }

  _colossusMesh(scale = 1) {
    const g = new THREE.Group();
    const torso = this._box(2.4, 2.6, 1.6, this.material.ice); torso.position.y = 2.4; g.add(torso);
    const head = this._box(1.3, 1.2, 1.2, this.material.ice); head.position.y = 4.2; g.add(head);
    for (const sx of [-0.32, 0.32]) { const eye = this._box(0.22, 0.22, 0.14, this.material.eye); eye.position.set(sx, 4.3, 0.65); g.add(eye); }
    for (const sx of [-1, 1]) {
      const arm = this._box(0.8, 2.4, 0.8, this.material.ice); arm.position.set(sx * 1.7, 2.4, 0); g.add(arm);
      const leg = this._box(0.9, 1.8, 0.9, this.material.ice); leg.position.set(sx * 0.6, 0.9, 0); g.add(leg);
      const spike = this._box(0.3, 1.2, 0.3, this.material.shard); spike.position.set(sx * 0.9, 4.0, -0.6); spike.rotation.x = -0.5; g.add(spike);
    }
    g.scale.setScalar(scale);
    g.traverse((c) => { if (c.isMesh) c.userData.snowRoot = g; });
    return g;
  }

  _blizzardMesh(radius = 16) {
    const g = new THREE.Group();
    const baseMat = new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 5; i += 1) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * (0.18 + i * 0.11), radius * (0.23 + i * 0.12), 48), baseMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.18 + i * 0.45;
      ring.userData.spin = (i % 2 ? -1 : 1) * (0.7 + i * 0.18);
      g.add(ring);
    }
    for (let i = 0; i < 18; i += 1) {
      const shard = this._box(0.12, 0.12, 0.9, this.material.shard);
      const angle = (i / 18) * Math.PI * 2;
      const r = radius * (0.28 + (i % 5) * 0.11);
      shard.position.set(Math.cos(angle) * r, 0.7 + (i % 4) * 0.7, Math.sin(angle) * r);
      shard.rotation.set(Math.random() * Math.PI, angle, Math.random() * Math.PI);
      shard.userData.spin = 1.8 + (i % 4) * 0.4;
      g.add(shard);
    }
    g.frustumCulled = false;
    return g;
  }

  _torchMesh(radius = 6) {
    const g = new THREE.Group();
    const post = this._box(0.42, 1.7, 0.42, this.material.torch);
    post.position.y = 0.85;
    g.add(post);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 6), this.material.flame.clone());
    flame.position.y = 2.1;
    flame.castShadow = false;
    flame.userData.flame = true;
    g.add(flame);
    const aura = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 48), this.material.safe.clone());
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.1;
    aura.userData.aura = true;
    g.add(aura);
    g.traverse((c) => { if (c.isMesh) c.frustumCulled = false; });
    return g;
  }

  _healthBar() {
    const group = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.5), new THREE.MeshBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }));
    bg.renderOrder = 998; bg.frustumCulled = false;
    const fillGeo = new THREE.PlaneGeometry(1, 0.38); fillGeo.translate(0.5, 0, 0);
    const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0x6fd2ff, depthTest: false, side: THREE.DoubleSide }));
    fill.position.set(-1.5, 0, 0.01); fill.scale.x = 3; fill.renderOrder = 999; fill.frustumCulled = false;
    group.add(bg, fill); group.userData.fill = fill; group.userData.width = 3; group.frustumCulled = false;
    return group;
  }

  // --------------------------------------------------------------- spawning ---
  _make(kind, x, z, world, extra = {}) {
    const c = this.cfg;
    const base = {
      yeti: () => ({ health: c.yeti.health, speed: c.yeti.speed, damage: c.yeti.damage, mesh: this._yetiMesh(c.yeti.scale), coins: c.coins.yeti }),
      roller: () => ({ health: c.roller.health, speed: c.roller.speed, damage: c.roller.damage, mesh: this._rollerMesh(), coins: c.coins.roller }),
      wisp: () => ({ health: c.wisp.health, speed: c.wisp.speed, mesh: this._wispMesh(), coins: c.coins.wisp }),
      snowman: () => ({ health: c.snowman.health, speed: c.snowman.speed, mesh: this._snowmanMesh(), coins: c.coins.snowman }),
      alpha: () => ({ health: c.miniboss.health, speed: c.miniboss.speed, mesh: this._yetiMesh(c.miniboss.scale, { iceHorns: true }), coins: c.coins.alpha, boss: true }),
      colossus: () => ({ health: c.boss.health, speed: c.boss.speed, mesh: this._colossusMesh(c.boss.scale * (extra.scaleMult ?? 1)), coins: c.coins.colossus, boss: true }),
    }[kind]();

    const e = {
      id: this.enemies.length,
      kind,
      maxHealth: base.health,
      attackTimer: 0.6 + Math.random() * 0.8,
      dead: false,
      ...base,
      ...extra,
    };
    if (e.boss) { e.phase = null; e.lastAttack = null; e.healthBar = this._healthBar(); this.group.add(e.healthBar); }
    if (kind === 'roller') {
      // Locks a straight heading at the player and barrels along it.
      const px = extra.targetX ?? 0; const pz = extra.targetZ ?? 0;
      const dir = new THREE.Vector3(px - x, 0, pz - z); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
      e.roll = dir;
    }
    const y = kind === 'wisp' ? groundHeight(world, x, z) + c.wisp.hover : groundHeight(world, x, z);
    e.mesh.position.set(x, y, z);
    e.mesh.userData.snow = e;
    this.group.add(e.mesh);
    this.enemies.push(e);
    return e;
  }

  _ring(center, count, world, kindPicker) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + i * 1.7;
      const r = THREE.MathUtils.lerp(this.cfg.spawnRadiusMin, this.cfg.spawnRadiusMax, (i % 3) / 2);
      const x = THREE.MathUtils.clamp(center.x + Math.cos(angle) * r, this.bounds.minX, this.bounds.maxX);
      const z = THREE.MathUtils.clamp(center.z + Math.sin(angle) * r, this.bounds.minZ, this.bounds.maxZ);
      this._make(kindPicker(i), x, z, world, { targetX: center.x, targetZ: center.z });
    }
  }

  // Regular snow wave: mostly yetis, some rollers, ranged snowmen and wisps.
  spawnWave(w, player, world) {
    this.clear();
    const center = getWorldPosition(player, this.tmpPlayer);
    const yetis = 2 + Math.ceil(w * 0.7);
    const rollers = Math.floor(w * 0.4);
    const snowmen = Math.max(1, Math.ceil(w * 0.5));
    const wisps = Math.floor(w * 0.3);
    this._ring(center, yetis, world, () => 'yeti');
    this._ring(center, rollers, world, () => 'roller');
    this._ring(center, snowmen, world, () => 'snowman');
    this._ring(center, wisps, world, () => 'wisp');
  }

  spawnMiniboss(player, world) {
    this.clear();
    const center = getWorldPosition(player, this.tmpPlayer);
    this._ring(center, 3, world, () => 'yeti');
    const x = THREE.MathUtils.clamp(center.x + 14, this.bounds.minX, this.bounds.maxX);
    this._make('alpha', x, center.z, world, { targetX: center.x, targetZ: center.z });
  }

  spawnBoss(player, world) {
    this.clear();
    const [cx, cz] = this.cfg.boss.center;
    const y = groundHeight(world, cx, cz);
    const mesh = this._blizzardMesh(this.cfg.boss.intro.radius);
    mesh.position.set(cx, y, cz);
    this.group.add(mesh);
    this.enemies.push({
      id: this.enemies.length,
      kind: 'summoning',
      maxHealth: 1,
      health: 1,
      speed: 0,
      coins: 0,
      boss: true,
      dead: false,
      mesh,
      t: this.cfg.boss.intro.duration,
      total: this.cfg.boss.intro.duration,
      spawnX: cx,
      spawnZ: cz,
    });
    this.events.push({ type: 'bossIntro', position: mesh.position.clone() });
  }

  // Summon reinforcements without clearing (boss roars).
  reinforce(spec, player, world) {
    const center = getWorldPosition(player, this.tmpPlayer);
    for (const [kind, count] of Object.entries(spec)) {
      for (let i = 0; i < (count || 0); i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const r = THREE.MathUtils.lerp(this.cfg.spawnRadiusMin, this.cfg.spawnRadiusMax, Math.random());
        const x = THREE.MathUtils.clamp(center.x + Math.cos(angle) * r, this.bounds.minX, this.bounds.maxX);
        const z = THREE.MathUtils.clamp(center.z + Math.sin(angle) * r, this.bounds.minZ, this.bounds.maxZ);
        this._make(kind, x, z, world, { targetX: center.x, targetZ: center.z });
      }
    }
  }

  // ----------------------------------------------------------------- update ---
  update(delta, player, world) {
    const dt = Math.min(delta || 0, 0.08);
    this.elapsed += dt;
    if (world && !this.world) this.world = world;
    const w = world ?? this.world;
    const playerPos = getWorldPosition(player, this.tmpPlayer);
    const guardActive = Boolean(player?.guardActive);

    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.kind === 'summoning') {
        this._updateSummoning(e, dt, w);
        continue;
      }
      let speedFactor = 1;
      if (e.slowTimer > 0) { e.slowTimer -= dt; speedFactor = e.slowFactor ?? 1; if (e.slowTimer <= 0) this._clearSlow(e); }
      if (e.liftTimer > 0) { e.liftTimer -= dt; continue; }

      if (e.kind === 'roller') this._updateRoller(e, dt, w, playerPos);
      else if (e.kind === 'wisp') this._updateWisp(e, dt, w, playerPos, speedFactor);
      else if (e.kind === 'snowman') this._updateSnowman(e, dt, w, playerPos, speedFactor);
      else this._updateWalker(e, dt, w, playerPos, speedFactor, guardActive); // yeti / alpha / colossus

      if (e.boss) this._updateBoss(e, dt, w, player, playerPos);
      if (e.healthBar) this._updateHealthBar(e);
    }

    this._updateProjectiles(dt, w, player, playerPos);
    this._updateZones(dt, w, player, playerPos);
  }

  _faceAndApproach(e, dt, w, playerPos, speedFactor, { approach = true, stopRange = 2.6 } = {}) {
    this.tmpDir.set(playerPos.x - e.mesh.position.x, 0, playerPos.z - e.mesh.position.z);
    const distance = this.tmpDir.length();
    if (distance > 1e-4) { this.tmpDir.normalize(); e.mesh.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z); }
    if (approach && distance > stopRange) {
      const speed = e.speed * speedFactor * dt;
      const avoidWater = (cx, cz) => w?.isWaterColumn?.(cx, cz);
      const dir = steerToward(w, e.mesh.position, this.tmpDir, RADIUS, HEIGHT, 1.1, avoidWater);
      moveHorizontal(w, e.mesh.position, dir.x * speed, dir.z * speed, RADIUS, HEIGHT, 1.1, avoidWater);
      e.mesh.position.x = THREE.MathUtils.clamp(e.mesh.position.x, this.bounds.minX, this.bounds.maxX);
      e.mesh.position.z = THREE.MathUtils.clamp(e.mesh.position.z, this.bounds.minZ, this.bounds.maxZ);
    }
    easeToGround(e.mesh.position, groundHeight(w, e.mesh.position.x, e.mesh.position.z), dt);
    return distance;
  }

  _updateWalker(e, dt, w, playerPos, speedFactor, guardActive) {
    const stopRange = e.kind === 'colossus' ? 7 : (e.kind === 'alpha' ? 3.2 : this.cfg.yeti.attackRange);
    const distance = this._faceAndApproach(e, dt, w, playerPos, speedFactor, { stopRange });

    // Lesser yetis melee (bosses attack via their FSM instead).
    if (e.kind === 'yeti') {
      e.attackTimer -= dt;
      if (distance <= this.cfg.yeti.attackRange && e.attackTimer <= 0) {
        if (guardActive) { this._kill(e); this.events.push({ type: 'parry', position: e.mesh.position.clone() }); }
        else this.events.push({ type: 'attack', position: e.mesh.position.clone(), damage: e.damage, chill: this.cfg.yeti.chill });
        e.attackTimer = this.cfg.yeti.attackCooldown;
      }
      e.mesh.children[0].rotation.z = Math.sin(this.elapsed * 5 + e.id) * 0.06; // lumber
    }
  }

  _updateRoller(e, dt, w, playerPos) {
    const step = e.speed * dt;
    const before = e.mesh.position.clone();
    moveHorizontal(w, e.mesh.position, e.roll.x * step, e.roll.z * step, 0.5, 1, 0.6);
    e.mesh.position.y = groundHeight(w, e.mesh.position.x, e.mesh.position.z) + 0.9;
    e.mesh.rotation.x += step * 1.4; // roll
    const moved = e.mesh.position.distanceTo(before);
    e.mesh.position.x = THREE.MathUtils.clamp(e.mesh.position.x, this.bounds.minX, this.bounds.maxX);
    e.mesh.position.z = THREE.MathUtils.clamp(e.mesh.position.z, this.bounds.minZ, this.bounds.maxZ);

    // Hit the player -> burst. Hit a wall (barely moved) or run its life -> shatter.
    const dx = playerPos.x - e.mesh.position.x; const dz = playerPos.z - e.mesh.position.z;
    if (Math.hypot(dx, dz) <= this.cfg.roller.hitRadius) {
      this.events.push({ type: 'attack', position: e.mesh.position.clone(), damage: e.damage });
      this.impacts.push({ position: e.mesh.position.clone(), kind: 'snow' });
      this._kill(e);
      return;
    }
    e.rollLife = (e.rollLife ?? 6) - dt;
    if (moved < step * 0.3 || e.rollLife <= 0) { this.impacts.push({ position: e.mesh.position.clone(), kind: 'snow' }); this._kill(e); }
  }

  _updateWisp(e, dt, w, playerPos, speedFactor) {
    const cfg = this.cfg.wisp;
    this.tmpDir.set(playerPos.x - e.mesh.position.x, 0, playerPos.z - e.mesh.position.z);
    const distance = this.tmpDir.length();
    if (distance > 1e-4) { this.tmpDir.normalize(); e.mesh.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z); }
    let move = 0;
    if (distance > cfg.keepMax) move = 1; else if (distance < cfg.keepMin) move = -1;
    if (move !== 0) {
      const speed = e.speed * speedFactor * dt * move;
      moveHorizontal(w, e.mesh.position, this.tmpDir.x * speed, this.tmpDir.z * speed, RADIUS, HEIGHT, 1.1, (cx, cz) => w?.isWaterColumn?.(cx, cz));
      e.mesh.position.x = THREE.MathUtils.clamp(e.mesh.position.x, this.bounds.minX, this.bounds.maxX);
      e.mesh.position.z = THREE.MathUtils.clamp(e.mesh.position.z, this.bounds.minZ, this.bounds.maxZ);
    }
    e.mesh.position.y = groundHeight(w, e.mesh.position.x, e.mesh.position.z) + cfg.hover + Math.sin(this.elapsed * 3 + e.id) * 0.3;

    e.attackTimer -= dt;
    if (e.attackTimer <= 0 && distance < cfg.keepMax + 4) {
      e.attackTimer = cfg.shootCooldown;
      this._spawnShard(e.mesh.position, playerPos, cfg.shardDamage, cfg.shardSpeed, cfg.chill);
    }
  }

  _updateSnowman(e, dt, w, playerPos, speedFactor) {
    const cfg = this.cfg.snowman;
    this.tmpDir.set(playerPos.x - e.mesh.position.x, 0, playerPos.z - e.mesh.position.z);
    const distance = this.tmpDir.length();
    if (distance > 1e-4) { this.tmpDir.normalize(); e.mesh.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z); }
    let move = 0;
    if (distance > cfg.keepMax) move = 1;
    else if (distance < cfg.keepMin) move = -1;
    if (move !== 0) {
      const speed = e.speed * speedFactor * dt * move;
      moveHorizontal(w, e.mesh.position, this.tmpDir.x * speed, this.tmpDir.z * speed, RADIUS, HEIGHT, 1.1, (cx, cz) => w?.isWaterColumn?.(cx, cz));
      e.mesh.position.x = THREE.MathUtils.clamp(e.mesh.position.x, this.bounds.minX, this.bounds.maxX);
      e.mesh.position.z = THREE.MathUtils.clamp(e.mesh.position.z, this.bounds.minZ, this.bounds.maxZ);
    }
    easeToGround(e.mesh.position, groundHeight(w, e.mesh.position.x, e.mesh.position.z), dt);

    e.attackTimer -= dt;
    if (e.attackTimer <= 0 && distance < cfg.keepMax + 5) {
      e.attackTimer = cfg.shootCooldown;
      this._spawnSnowball(e.mesh.position, playerPos, cfg.snowballDamage, cfg.snowballSpeed, cfg.chill);
    }
  }

  _updateSummoning(e, dt, w) {
    e.t -= dt;
    const progress = THREE.MathUtils.clamp(1 - e.t / e.total, 0, 1);
    e.mesh.rotation.y += dt * (1.8 + progress * 2.8);
    e.mesh.scale.setScalar(0.55 + progress * 0.45);
    e.mesh.children.forEach((child) => {
      child.rotation.z += dt * (child.userData.spin ?? 1.2);
      if (child.material?.opacity != null) child.material.opacity = 0.18 + Math.sin(this.elapsed * 12 + child.id) * 0.06 + progress * 0.24;
    });
    if (e.t <= 0) {
      const x = e.spawnX;
      const z = e.spawnZ;
      this.group.remove(e.mesh);
      e.dead = true;
      this._make('colossus', x, z, w, {});
      this.impacts.push({ position: new THREE.Vector3(x, groundHeight(w, x, z), z), kind: 'frost' });
      this.events.push({ type: 'bossIntroDone', position: new THREE.Vector3(x, groundHeight(w, x, z), z) });
    }
  }

  // ----------------------------------------------------------- boss attacks ---
  _updateBoss(e, dt, w, player, playerPos) {
    if (!player) return;
    if (e.phase) { this._advancePhase(e, dt, w, playerPos); return; }
    e.attackTimer -= dt;
    if (e.attackTimer > 0) return;
    const cfg = e.kind === 'alpha' ? this.cfg.miniboss : this.cfg.boss;
    const moves = e.kind === 'alpha' ? ['slam', 'spikes', 'boulder', 'summon'] : ['icicles', 'frost', 'stomp', 'blizzard'];
    const choices = moves.filter((m) => m !== e.lastAttack);
    const attack = choices[Math.floor(Math.random() * choices.length)];
    e.lastAttack = attack;
    const [lo, hi] = cfg.attackEvery;
    e.attackTimer = lo + Math.random() * (hi - lo);
    this[`_boss_${attack}`](e, w, playerPos);
  }

  _boss_slam(e, w, playerPos) {
    const cfg = this.cfg.miniboss.slam;
    const c = e.mesh.position.clone(); c.y = groundHeight(w, c.x, c.z);
    this.zones.push({ type: 'slam', center: c, t: 0.35, radius: cfg.radius, damage: cfg.damage, chill: cfg.chill, mesh: this._telegraph(cfg.radius, c) });
  }

  _boss_boulder(e, w, playerPos) {
    const cfg = this.cfg.miniboss.boulder;
    const from = e.mesh.position.clone(); from.y += 2.5;
    this._spawnBoulder(from, playerPos, cfg.damage, cfg.speed, cfg.hitRadius);
  }

  _boss_spikes(e, w, playerPos) {
    const cfg = this.cfg.miniboss.spikes;
    const from = e.mesh.position.clone();
    const dir = new THREE.Vector3(playerPos.x - from.x, 0, playerPos.z - from.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const spots = [];
    for (let i = 1; i <= cfg.count; i += 1) {
      const x = THREE.MathUtils.clamp(from.x + dir.x * cfg.spacing * i, this.bounds.minX, this.bounds.maxX);
      const z = THREE.MathUtils.clamp(from.z + dir.z * cfg.spacing * i, this.bounds.minZ, this.bounds.maxZ);
      const y = groundHeight(w, x, z);
      spots.push({ x, y, z, mesh: this._telegraph(cfg.radius, new THREE.Vector3(x, y, z)) });
    }
    this.zones.push({ type: 'spikeLine', t: cfg.telegraph, total: cfg.telegraph, spots, radius: cfg.radius, damage: cfg.damage, chill: cfg.chill, ttl: cfg.columnTtl });
  }

  _boss_summon(e) {
    this.events.push({ type: 'summon', yetis: this.cfg.miniboss.summon.yetis, snowmen: this.cfg.miniboss.summon.snowmen });
    this.zones.push({ type: 'roar', center: e.mesh.position.clone(), t: 0.6, mesh: this._roarRing(e.mesh.position) });
  }

  _boss_icicles(e, w, playerPos) {
    const cfg = this.cfg.boss.icicles;
    const zones = [];
    for (let i = 0; i < cfg.count; i += 1) {
      let x; let z;
      if (i === 0) { x = playerPos.x; z = playerPos.z; }
      else { const a = (i / cfg.count) * Math.PI * 2 + Math.random() * 0.9; const r = 4 + Math.random() * cfg.spread; x = playerPos.x + Math.cos(a) * r; z = playerPos.z + Math.sin(a) * r; }
      x = THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX); z = THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ);
      const y = groundHeight(w, x, z);
      zones.push({ x, y, z, mesh: this._telegraph(cfg.radius, new THREE.Vector3(x, y, z)) });
    }
    this.zones.push({ type: 'icicles', t: cfg.telegraph, total: cfg.telegraph, spots: zones, radius: cfg.radius, damage: this._bossDamage(e, cfg.damage), ttl: cfg.columnTtl });
  }

  _boss_frost(e, w, playerPos) {
    const cfg = this.cfg.boss.frost;
    const p = e.mesh.position;
    const dir = new THREE.Vector3(playerPos.x - p.x, 0, playerPos.z - p.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const origin = new THREE.Vector3(p.x, groundHeight(w, p.x, p.z) + 0.1, p.z);
    this.zones.push({ type: 'frost', t: cfg.telegraph, dir, cfg, damage: this._bossDamage(e, cfg.damage), origin, mesh: this._sector(cfg.range, cfg.halfAngle, dir, origin) });
  }

  _boss_stomp(e, w) {
    const cfg = this.cfg.boss.stomp;
    const c = e.mesh.position.clone();
    c.y = groundHeight(w, c.x, c.z);
    this.zones.push({ type: 'stomp', center: c, t: cfg.telegraph, total: cfg.telegraph, radius: cfg.radius, damage: this._bossDamage(e, cfg.damage), chill: cfg.chill, mesh: this._telegraph(cfg.radius, c) });
  }

  _boss_blizzard(e, w, playerPos = e.mesh.position) {
    const cfg = this.cfg.boss.blizzard;
    this.events.push({ type: 'summon', yetis: cfg.yetis, snowmen: cfg.snowmen, wisps: cfg.wisps });
    const angle = Math.random() * Math.PI * 2;
    const torchRadius = 7 + Math.random() * 5;
    const tx = THREE.MathUtils.clamp(playerPos.x + Math.cos(angle) * torchRadius, this.bounds.minX, this.bounds.maxX);
    const tz = THREE.MathUtils.clamp(playerPos.z + Math.sin(angle) * torchRadius, this.bounds.minZ, this.bounds.maxZ);
    const torchPos = new THREE.Vector3(tx, groundHeight(w, tx, tz), tz);
    const torchMesh = this._torchMesh(cfg.torchRadius);
    torchMesh.position.copy(torchPos);
    this.group.add(torchMesh);
    const stormMesh = this._blizzardMesh(this.cfg.boss.intro.radius * 1.25);
    stormMesh.position.set(e.mesh.position.x, groundHeight(w, e.mesh.position.x, e.mesh.position.z), e.mesh.position.z);
    this.group.add(stormMesh);
    this.zones.push({ type: 'torch', t: cfg.duration, total: cfg.duration, center: torchPos, radius: cfg.torchRadius, mesh: torchMesh });
    this.zones.push({ type: 'bossBlizzard', t: cfg.duration, total: cfg.duration, mesh: stormMesh });
    this.events.push({
      type: 'blizzard',
      chill: cfg.chill,
      duration: cfg.duration,
      freezePerSecond: cfg.freezePerSecond,
      torch: { position: torchPos.clone(), radius: cfg.torchRadius },
    });
  }

  _bossDamage(e, damage) { return damage * (e.damageMult ?? 1); }

  _advancePhase() { /* bosses use the zones list, not a single phase */ }

  // ------------------------------------------------------- projectiles/zones ---
  _spawnShard(from, target, damage, speed, chill) {
    const dir = target.clone().sub(from); dir.y += 0.6; if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const mesh = new THREE.Mesh(this.geometry.shard, this.material.shard); mesh.position.copy(from); mesh.frustumCulled = false;
    this.group.add(mesh);
    this.projectiles.push({ mesh, position: from.clone(), velocity: dir.multiplyScalar(speed), damage, chill, radius: 0.7, life: 3.5, gravity: 0 });
  }

  _spawnSnowball(from, target, damage, speed, chill) {
    const start = from.clone(); start.y += 1.45;
    const dir = target.clone().sub(start); dir.y += 0.35; if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), this.material.snow);
    mesh.position.copy(start);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.projectiles.push({ mesh, position: start, velocity: dir.multiplyScalar(speed), damage, chill, radius: 0.55, life: 3.2, gravity: 0, spin: true });
  }

  _spawnBoulder(from, target, damage, speed, hitRadius) {
    const dir = target.clone().sub(from); const dist = dir.length(); dir.normalize();
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), this.material.snow); mesh.position.copy(from); mesh.frustumCulled = false;
    this.group.add(mesh);
    const vel = dir.multiplyScalar(speed); vel.y += Math.min(8, dist * 0.18); // lob arc
    this.projectiles.push({ mesh, position: from.clone(), velocity: vel, damage, radius: hitRadius, life: 4, gravity: 20, spin: true });
  }

  _telegraph(radius, center) {
    const geo = new THREE.CircleGeometry(radius, 28); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.material.telegraph.clone()); mesh.position.copy(center); mesh.position.y += 0.07; mesh.frustumCulled = false;
    this.group.add(mesh); return mesh;
  }

  _sector(range, halfAngle, dir, origin) {
    const geo = new THREE.CircleGeometry(range, 40, -halfAngle, halfAngle * 2); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.material.telegraph.clone()); mesh.position.copy(origin); mesh.rotation.y = Math.atan2(-dir.z, dir.x); mesh.frustumCulled = false;
    this.group.add(mesh); return mesh;
  }

  _roarRing(center) {
    const geo = new THREE.RingGeometry(0.5, 1.0, 28); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.copy(center); mesh.frustumCulled = false; this.group.add(mesh); return mesh;
  }

  _eruptIcicle(spot, ttl) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(spot === null ? 1 : 1.0, 5, 6), this.material.ice.clone());
    mesh.position.set(spot.x, spot.y + 2.5, spot.z); mesh.frustumCulled = false; this.group.add(mesh);
    this.zones.push({ type: 'column', mesh, t: ttl, total: ttl, baseY: spot.y });
  }

  _updateProjectiles(dt, w, player, playerPos) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const p = this.projectiles[i];
      if (p.gravity) p.velocity.y -= p.gravity * dt;
      p.position.addScaledVector(p.velocity, dt);
      p.mesh.position.copy(p.position);
      if (p.spin) { p.mesh.rotation.x += dt * 6; p.mesh.rotation.z += dt * 5; }
      p.life -= dt;
      const blocked = this._solid(p.position, w);
      const hit = Boolean(player) && p.position.distanceTo(playerPos) <= p.radius + 0.5;
      if (hit) this.events.push({ type: 'projectile', position: p.position.clone(), damage: p.damage, chill: p.chill });
      if (hit || blocked || p.life <= 0 || p.position.y < -4) {
        this.impacts.push({ position: p.position.clone(), kind: hit ? 'spark' : 'snow' });
        this.group.remove(p.mesh); p.mesh.geometry.dispose?.(); p.mesh.material.dispose?.();
        this.projectiles.splice(i, 1);
      }
    }
  }

  _updateZones(dt, w, player, playerPos) {
    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      const z = this.zones[i];
      z.t -= dt;
      if (z.type === 'slam' || z.type === 'stomp') {
        z.mesh.material.opacity = 0.3 + 0.4 * Math.abs(Math.sin(this.elapsed * 16));
        if (z.t <= 0) {
          const hit = Boolean(player) && Math.hypot(playerPos.x - z.center.x, playerPos.z - z.center.z) <= z.radius;
          this.events.push({ type: 'aoe', position: z.center.clone(), damage: z.damage, chill: z.chill, hit });
          this.impacts.push({ position: z.center.clone(), kind: 'shock', radius: z.radius });
          this._disposeZoneMesh(z); this.zones.splice(i, 1);
        }
      } else if (z.type === 'icicles') {
        const pulse = THREE.MathUtils.clamp(1 - z.t / z.total, 0, 1);
        for (const s of z.spots) s.mesh.material.opacity = 0.25 + 0.5 * pulse * Math.abs(Math.sin(this.elapsed * 20));
        if (z.t <= 0) {
          for (const s of z.spots) {
            const hit = Boolean(player) && Math.hypot(playerPos.x - s.x, playerPos.z - s.z) <= z.radius;
            this.events.push({ type: 'aoe', position: new THREE.Vector3(s.x, s.y + 1, s.z), damage: z.damage, hit });
            this._eruptIcicle(s, z.ttl);
            this.group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
          }
          this.zones.splice(i, 1);
        }
      } else if (z.type === 'spikeLine') {
        const pulse = THREE.MathUtils.clamp(1 - z.t / z.total, 0, 1);
        for (const s of z.spots) s.mesh.material.opacity = 0.22 + 0.58 * pulse * Math.abs(Math.sin(this.elapsed * 18));
        if (z.t <= 0) {
          let hit = false;
          for (const s of z.spots) {
            if (Boolean(player) && Math.hypot(playerPos.x - s.x, playerPos.z - s.z) <= z.radius) hit = true;
            this._eruptIcicle(s, z.ttl);
            this.group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
          }
          this.events.push({ type: 'aoe', position: playerPos.clone(), damage: z.damage, chill: z.chill, hit });
          this.impacts.push({ position: new THREE.Vector3(z.spots[0]?.x ?? 0, z.spots[0]?.y ?? 0, z.spots[0]?.z ?? 0), kind: 'frost' });
          this.zones.splice(i, 1);
        }
      } else if (z.type === 'frost') {
        z.mesh.material.opacity = 0.22 + 0.4 * THREE.MathUtils.clamp(1 - z.t / z.cfg.telegraph, 0, 1);
        if (z.t <= 0) {
          const to = this.tmpDir.set(playerPos.x - z.origin.x, 0, playerPos.z - z.origin.z);
          const dist = to.length();
          const within = dist > 1e-3 && dist <= z.cfg.range && to.normalize().dot(z.dir) >= Math.cos(z.cfg.halfAngle);
          this.events.push({ type: 'aoe', position: playerPos.clone(), damage: z.damage, chill: z.cfg.chill, hit: within });
          this.impacts.push({ position: z.origin.clone().addScaledVector(z.dir, z.cfg.range * 0.5), kind: 'frost' });
          this._disposeZoneMesh(z); this.zones.splice(i, 1);
        }
      } else if (z.type === 'roar') {
        const s = 1 + (z.total ? (1 - z.t / z.total) : this.elapsed) * 22;
        z.mesh.scale.set(s, 1, s); z.mesh.material.opacity = 0.7 * THREE.MathUtils.clamp(z.t / (z.total ?? 0.6), 0, 1);
        if (z.t <= 0) { this._disposeZoneMesh(z); this.zones.splice(i, 1); }
      } else if (z.type === 'column') {
        const grow = THREE.MathUtils.clamp((z.total - z.t) / 0.12, 0, 1);
        z.mesh.scale.y = grow; z.mesh.position.y = z.baseY + (5 * grow) / 2;
        z.mesh.material.opacity = 0.92 * THREE.MathUtils.clamp(z.t / z.total, 0, 1);
        if (z.t <= 0) { this._disposeZoneMesh(z); this.zones.splice(i, 1); }
      } else if (z.type === 'torch') {
        const fade = THREE.MathUtils.clamp(z.t / z.total, 0, 1);
        z.mesh.traverse((child) => {
          if (!child.isMesh) return;
          if (child.userData.flame) {
            child.scale.setScalar(0.85 + Math.sin(this.elapsed * 14) * 0.12);
            child.material.opacity = 0.65 + Math.sin(this.elapsed * 18) * 0.15;
          } else if (child.userData.aura) {
            child.material.opacity = 0.1 + 0.2 * fade * Math.abs(Math.sin(this.elapsed * 4));
            child.rotation.z += dt * 0.3;
          }
        });
        if (z.t <= 0) { this._disposeZoneMesh(z); this.zones.splice(i, 1); }
      } else if (z.type === 'bossBlizzard') {
        const fade = THREE.MathUtils.clamp(z.t / z.total, 0, 1);
        z.mesh.rotation.y += dt * 2.2;
        z.mesh.children.forEach((child) => {
          child.rotation.z += dt * (child.userData.spin ?? 1.2);
          if (child.material?.opacity != null) child.material.opacity = 0.12 + 0.28 * fade * Math.abs(Math.sin(this.elapsed * 9 + child.id));
        });
        if (z.t <= 0) { this._disposeZoneMesh(z); this.zones.splice(i, 1); }
      }
    }
  }

  _disposeZoneMesh(z) { if (z.mesh) { this.group.remove(z.mesh); z.mesh.geometry?.dispose?.(); z.mesh.material?.dispose?.(); } }

  _updateHealthBar(e) {
    const bar = e.healthBar;
    bar.position.copy(e.mesh.position); bar.position.y += (e.kind === 'colossus' ? 6.5 : 5.0);
    if (this.camera) { this.camera.getWorldQuaternion(this.tmpQuat); bar.quaternion.copy(this.tmpQuat); }
    const ratio = THREE.MathUtils.clamp(e.health / e.maxHealth, 0, 1);
    bar.userData.fill.scale.x = bar.userData.width * ratio;
    bar.userData.fill.material.color.setHex(ratio > 0.5 ? 0x6fd2ff : ratio > 0.25 ? 0xe0c020 : 0xd83b3b);
  }

  _solid(pos, w) {
    if (!w?.getBlock) return false;
    const t = w.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    return Boolean(t) && t !== 'water';
  }

  // ------------------------------------------------------- aggregator contract ---
  _meshes() { const out = []; for (const e of this.enemies) if (!e.dead) e.mesh.traverse((c) => { if (c.isMesh) out.push(c); }); return out; }

  _raycaster(ray) {
    const isRc = typeof ray?.intersectObjects === 'function' && ray.ray;
    const rc = isRc ? ray : this.tmpRaycaster;
    if (!isRc) { if (ray?.origin && ray?.direction) { rc.ray.copy(ray); rc.near = 0; rc.far = Infinity; } else return null; }
    return rc;
  }

  peekRay(ray) {
    const rc = this._raycaster(ray); if (!rc) return null;
    const hits = rc.intersectObjects(this._meshes(), false);
    if (!hits.length) return null;
    const root = hits[0].object.userData.snowRoot;
    const e = this.enemies.find((c) => c.mesh === root);
    if (!e || e.dead) return null;
    return { enemy: e, point: hits[0].point.clone(), distance: hits[0].distance };
  }

  applyRayHit(peek, damage) {
    const killed = this._damage(peek.enemy, damage);
    return { dragon: null, enemy: peek.enemy, point: peek.point, distance: peek.distance, killed, health: peek.enemy.health };
  }

  hitByRay(ray, damage = 25) { const peek = this.peekRay(ray); return peek ? this.applyRayHit(peek, damage) : null; }

  hitAllByRay(ray, damage = 25) {
    const rc = this._raycaster(ray); if (!rc) return [];
    const hits = rc.intersectObjects(this._meshes(), false);
    const results = []; const seen = new Set();
    for (const it of hits) {
      const root = it.object.userData.snowRoot;
      const e = this.enemies.find((c) => c.mesh === root);
      if (!e || e.dead || seen.has(e.id)) continue;
      seen.add(e.id);
      const killed = this._damage(e, damage);
      results.push({ dragon: null, enemy: e, point: it.point.clone(), distance: it.distance, killed, health: e.health });
    }
    return results;
  }

  hitMelee(origin, direction, range, damage, arcCos = 0.3) {
    const results = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      this.tmpDir.subVectors(e.mesh.position, origin);
      const distance = this.tmpDir.length();
      if (distance > range || distance < 1e-4) continue;
      this.tmpDir.normalize();
      if (this.tmpDir.dot(direction) < arcCos) continue;
      const killed = this._damage(e, damage);
      results.push({ position: e.mesh.position.clone(), killed });
    }
    return results;
  }

  hitBox(origin, forward, right, length, halfWidth, damage) {
    const results = []; const v = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      v.subVectors(e.mesh.position, origin);
      const f = v.dot(forward); const lateral = Math.abs(v.dot(right));
      if (f < -1 || f > length || lateral > halfWidth || Math.abs(v.y) > 6) continue;
      const killed = this._damage(e, damage);
      results.push({ position: e.mesh.position.clone(), killed });
    }
    return results;
  }

  knockback(center, radius, force, world) {
    for (const e of this.enemies) {
      if (e.dead || e.boss) continue; // bosses hold their ground
      const dx = e.mesh.position.x - center.x; const dz = e.mesh.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius || dist < 1e-4) continue;
      const inv = 1 / dist;
      const nx = THREE.MathUtils.clamp(e.mesh.position.x + dx * inv * force, this.bounds.minX, this.bounds.maxX);
      const nz = THREE.MathUtils.clamp(e.mesh.position.z + dz * inv * force, this.bounds.minZ, this.bounds.maxZ);
      e.mesh.position.x = nx; e.mesh.position.z = nz;
      e.mesh.position.y = groundHeight(world ?? this.world, nx, nz) + (e.kind === 'wisp' ? this.cfg.wisp.hover : 0);
    }
  }

  slow(center, radius, factor, duration) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.mesh.position.x - center.x, e.mesh.position.z - center.z) > radius) continue;
      e.slowTimer = duration; e.slowFactor = factor; this._applySlow(e);
    }
  }

  _applySlow(e) {
    e.mesh.traverse((c) => {
      if (!c.isMesh) return;
      if (!c.userData.baseMat) c.userData.baseMat = c.material;
      if (!c.userData.iceMat) { c.userData.iceMat = c.userData.baseMat.clone(); c.userData.iceMat.emissive = new THREE.Color(0x2a6bdf); c.userData.iceMat.emissiveIntensity = 0.7; }
      c.material = c.userData.iceMat;
    });
  }

  _clearSlow(e) { e.slowTimer = 0; e.mesh.traverse((c) => { if (c.isMesh && c.userData.baseMat) c.material = c.userData.baseMat; }); }

  tornadoPull(center, radius, elapsed) {
    const lifted = [];
    for (const e of this.enemies) {
      if (e.dead || e.boss) continue;
      const dx = center.x - e.mesh.position.x; const dz = center.z - e.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius) continue;
      e.liftTimer = 0.2;
      const angle = elapsed * 6 + e.id; const orbit = Math.min(dist, radius * 0.5);
      e.mesh.position.set(center.x + Math.cos(angle) * orbit, center.y + 1.5 + (Math.sin(elapsed * 3 + e.id) * 0.5 + 1) * 2.5, center.z + Math.sin(angle) * orbit);
      lifted.push(e);
    }
    return lifted;
  }

  heal(center, radius, amount) {
    for (const e of this.enemies) { if (e.dead) continue; if (e.mesh.position.distanceTo(center) > radius) continue; e.health = Math.min(e.maxHealth, e.health + amount); }
  }

  anyNear(pos, radius) { return this.enemies.some((e) => !e.dead && pos.distanceTo(e.mesh.position) < radius); }

  _damage(e, amount) {
    e.health = Math.max(0, e.health - amount);
    if (e.health <= 0) { this._kill(e); return true; }
    return false;
  }

  _kill(e) {
    if (e.dead) return;
    if (e.kind === 'colossus' && !e.splitLevel) {
      this._splitColossus(e);
      return;
    }
    e.dead = true; e.mesh.visible = false;
    this.group.remove(e.mesh);
    if (e.healthBar) this.group.remove(e.healthBar);
    this.kills += 1;
    this._coins += e.coins ?? 2;
  }

  _splitColossus(e) {
    const cfg = this.cfg.boss.split;
    const basePos = e.mesh.position.clone();
    e.dead = true;
    e.mesh.visible = false;
    this.group.remove(e.mesh);
    if (e.healthBar) this.group.remove(e.healthBar);
    this.kills += 1;
    this.impacts.push({ position: basePos.clone(), kind: 'frost' });
    this.events.push({ type: 'split', position: basePos.clone() });
    for (const side of [-1, 1]) {
      const x = THREE.MathUtils.clamp(basePos.x + side * cfg.offset, this.bounds.minX, this.bounds.maxX);
      const z = THREE.MathUtils.clamp(basePos.z, this.bounds.minZ, this.bounds.maxZ);
      const health = Math.max(1, Math.round(e.maxHealth * cfg.healthMult));
      this._make('colossus', x, z, this.world, {
        health,
        maxHealth: health,
        damageMult: (e.damageMult ?? 1) * cfg.damageMult,
        splitLevel: 1,
        scaleMult: cfg.scale,
        coins: Math.round((e.coins ?? this.cfg.coins.colossus) * 0.5),
      });
    }
  }

  setHighlighted(on, color = 0xff2020) {
    for (const mat of Object.values(this.material)) {
      if (!mat?.emissive) continue;
      if (mat.userData.baseEmissive === undefined) {
        mat.userData.baseEmissive = mat.emissive.getHex();
        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
        mat.userData.baseDepthTest = mat.depthTest;
        mat.userData.baseDepthWrite = mat.depthWrite;
        mat.userData.baseTransparent = mat.transparent;
      }
      if (on) {
        mat.emissive.setHex(color);
        mat.emissiveIntensity = 0.85;
        mat.depthTest = false;
        mat.depthWrite = false;
        mat.transparent = true;
      } else {
        mat.emissive.setHex(mat.userData.baseEmissive);
        mat.emissiveIntensity = mat.userData.baseEmissiveIntensity;
        mat.depthTest = mat.userData.baseDepthTest;
        mat.depthWrite = mat.userData.baseDepthWrite;
        mat.transparent = mat.userData.baseTransparent;
      }
    }
  }

  getAliveCount() { let n = 0; for (const e of this.enemies) if (!e.dead) n += 1; return n; }
  getAliveBreakdown() {
    const labels = {
      yeti: 'Yetis',
      roller: 'Rodadores',
      snowman: 'Muñecos de nieve',
      wisp: 'Espectros',
      alpha: 'Yeti Alfa',
      colossus: 'Coloso',
      summoning: 'Ventisca',
    };
    const order = ['yeti', 'roller', 'snowman', 'wisp', 'alpha', 'summoning', 'colossus'];
    const counts = Object.fromEntries(order.map((kind) => [kind, 0]));
    for (const e of this.enemies) {
      if (!e.dead && counts[e.kind] != null) counts[e.kind] += 1;
    }
    return order
      .filter((kind) => counts[kind] > 0)
      .map((kind) => ({ kind, label: labels[kind], count: counts[kind] }));
  }
  consumeKills() { const k = this.kills; this.kills = 0; return k; }
  consumeCoins() { const c = this._coins; this._coins = 0; return c; }
  consumeEvents() { const e = this.events; this.events = []; return e; }
  consumeImpacts() { const i = this.impacts; this.impacts = []; return i; }

  clear() {
    for (const e of this.enemies) { this.group.remove(e.mesh); if (e.healthBar) this.group.remove(e.healthBar); }
    this.enemies.length = 0;
    for (const p of this.projectiles) { this.group.remove(p.mesh); p.mesh.geometry?.dispose?.(); p.mesh.material?.dispose?.(); }
    this.projectiles.length = 0;
    for (const z of this.zones) { if (z.spots) for (const s of z.spots) { this.group.remove(s.mesh); s.mesh.geometry?.dispose?.(); s.mesh.material?.dispose?.(); } this._disposeZoneMesh(z); }
    this.zones.length = 0;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.clear();
    for (const g of Object.values(this.geometry)) g.dispose?.();
    for (const m of Object.values(this.material)) m.dispose?.();
  }
}

export default SnowManager;
