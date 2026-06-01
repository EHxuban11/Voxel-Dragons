import * as THREE from 'three';
import { BALANCE } from '../../core/config/GameBalance.js';

const ANY_DIR = new THREE.Vector3(1, 0, 0); // hitMelee with arcCos -1 ignores direction

// Dio's kit (JoJo). Knives are independent projectiles: left click throws one,
// right click a line of six (each hits separately). Stop Sign slams a road sign
// for AoE. The World stops time for 5s — Game freezes the enemies while this is
// active; here, knives thrown during the stop drift briefly then hang in the
// air, and on resume every knife launches along its kept direction and deals
// damage. Stop Sign used during the stop is deferred to resume too. The gauge
// fills by dealing damage and empties when The World is used.
export class DioController {
  constructor(deps) {
    this.scene = deps.scene;
    this.effects = deps.effects;
    this.world = deps.world;
    this.enemies = deps.enemies;
    this.player = deps.player;
    this.camera = deps.camera;
    this.audio = deps.audio;
    this.hud = deps.hud;

    this.cfg = BALANCE.dio;
    this.knives = [];
    this.signs = [];
    this.pendingResume = []; // Stop Sign slams queued during The World
    this.gauge = 0;
    this.cooldowns = { knife: 0, six: 0, stopSign: 0 };
    this.timestopActive = false;
    this.timestopTimer = 0;
  }

  // --- gauge -----------------------------------------------------------------
  get gaugeMax() { return this.cfg.timestop.gaugeMax; }
  get gaugeRatio() { return THREE.MathUtils.clamp(this.gauge / this.gaugeMax, 0, 1); }
  _fill(amount) { this.gauge = Math.min(this.gaugeMax, this.gauge + amount); }

  // --- aim -------------------------------------------------------------------
  origin() { return this.camera.getWorldPosition(new THREE.Vector3()); }
  direction() { return this.camera.getWorldDirection(new THREE.Vector3()); }
  _right(dir) {
    const r = new THREE.Vector3(dir.z, 0, -dir.x);
    if (r.lengthSq() < 1e-4) r.set(1, 0, 0);
    return r.normalize();
  }

  // --- knives ----------------------------------------------------------------
  throwKnife() {
    if (this.cooldowns.knife > 0) return false;
    this.cooldowns.knife = this.cfg.knife.cooldown;
    this._spawnKnife(this.direction(), this.cfg.knife.damage, this.cfg.knife.fill);
    this.audio?.shoot?.('pistol');
    return true;
  }

  // Right click: six independent knives spread in a line.
  sixKnives() {
    if (this.cooldowns.six > 0) return false;
    this.cooldowns.six = this.cfg.six.cooldown;
    const dir = this.direction();
    const right = this._right(dir);
    const n = this.cfg.six.count;
    for (let i = 0; i < n; i += 1) {
      const off = (i - (n - 1) / 2) * this.cfg.six.spread;
      this._spawnKnife(dir, this.cfg.six.damage, this.cfg.six.fill, right.clone().multiplyScalar(off));
    }
    this.audio?.shoot?.('shotgun');
    return true;
  }

  _spawnKnife(dir, damage, fill, posOffset = null) {
    const d = dir.clone().normalize();
    const origin = this.origin();
    const start = origin.clone().addScaledVector(d, 0.9);
    if (posOffset) start.add(posOffset);
    const mesh = this._knifeMesh();
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    this.scene.add(mesh);
    this.knives.push({
      mesh,
      position: start.clone(),
      velocity: d.clone().multiplyScalar(this.cfg.knife.speed),
      dir: d,
      speed: this.cfg.knife.speed,
      damage,
      fill,
      life: this.cfg.knife.life,
      frozen: false,
      // Knives thrown during The World drift for a moment, then hang in the air.
      freezeTimer: this.timestopActive ? this.cfg.timestop.freezeDelay : 0,
    });
  }

  _knifeMesh() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xd7dee7, metalness: 0.7, roughness: 0.3, flatShading: true }),
    );
    blade.position.z = -0.14;
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a, flatShading: true }),
    );
    handle.position.z = 0.14;
    g.add(blade, handle);
    g.frustumCulled = false;
    return g;
  }

  _updateKnives(delta) {
    for (let i = this.knives.length - 1; i >= 0; i -= 1) {
      const k = this.knives[i];

      // Time stopped: knives don't collide or expire. Newly thrown ones drift
      // for freezeTimer, then hang frozen in the air.
      if (this.timestopActive) {
        if (k.freezeTimer > 0) {
          k.freezeTimer -= delta;
          k.position.addScaledVector(k.velocity, delta);
          k.mesh.position.copy(k.position);
          if (k.freezeTimer <= 0) k.frozen = true;
        }
        continue;
      }

      k.position.addScaledVector(k.velocity, delta);
      k.mesh.position.copy(k.position);
      k.mesh.rotation.z += delta * 22;
      k.life -= delta;

      if (this._solid(k.position)) { this.effects.impact(k.position, 0xd7dee7); this._removeKnife(i); continue; }
      if (this.enemies.anyNear(k.position, k.radius ?? this.cfg.knife.radius)) {
        const hits = this.enemies.hitMelee(k.position, ANY_DIR, this.cfg.knife.radius + 0.4, k.damage, -1);
        if (hits.length) this._fill(k.fill);
        this.effects.impact(k.position, 0xfff0a0);
        this._removeKnife(i);
        continue;
      }
      if (k.life <= 0 || k.position.y < -4) this._removeKnife(i);
    }
  }

  _removeKnife(i) {
    const k = this.knives[i];
    this.scene.remove(k.mesh);
    k.mesh.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
    this.knives.splice(i, 1);
  }

  // --- Stop Sign -------------------------------------------------------------
  stopSign() {
    if (this.cooldowns.stopSign > 0) return false;
    this.cooldowns.stopSign = this.cfg.stopSign.cooldown;
    const dir = this.direction();
    const origin = this.origin();
    const aim = origin.clone().addScaledVector(dir, this.cfg.stopSign.ahead);
    const gy = this.world?.getGroundHeight?.(aim.x, aim.z) ?? aim.y;
    const center = new THREE.Vector3(aim.x, gy, aim.z);
    this._spawnSign(center);
    this.audio?.explosion?.();
    if (this.timestopActive) {
      // Damage is dealt only once time resumes.
      this.pendingResume.push({ center: center.clone(), radius: this.cfg.stopSign.radius, damage: this.cfg.stopSign.damage, fill: this.cfg.stopSign.fill });
    } else {
      this._applySlam(center, this.cfg.stopSign.radius, this.cfg.stopSign.damage, this.cfg.stopSign.fill);
    }
    return true;
  }

  _applySlam(center, radius, damage, fill) {
    const hits = this.enemies.hitMelee(center, ANY_DIR, radius, damage, -1);
    if (hits?.length) this._fill(hits.length * fill);
    this.effects.explosion(center.clone());
    this.effects.shockwave(center.clone(), radius, 0xd83b3b);
  }

  _spawnSign(center) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 3, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.7, flatShading: true }),
    );
    post.position.y = 1.5;
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 1.7, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xd83b3b, emissive: 0x551010, emissiveIntensity: 0.5, roughness: 0.6, flatShading: true }),
    );
    sign.position.y = 3.2;
    g.add(post, sign);
    g.position.set(center.x, center.y + 7, center.z); // starts high, slams down
    g.frustumCulled = false;
    this.scene.add(g);
    this.signs.push({ mesh: g, age: 0, ttl: 0.9, groundY: center.y });
  }

  _updateSigns(delta) {
    for (let i = this.signs.length - 1; i >= 0; i -= 1) {
      const s = this.signs[i];
      // The sign is frozen along with everything else while time is stopped.
      if (this.timestopActive) continue;
      s.age += delta;
      const drop = THREE.MathUtils.clamp(s.age / 0.12, 0, 1); // slam down fast
      s.mesh.position.y = THREE.MathUtils.lerp(s.groundY + 7, s.groundY, drop);
      if (s.age >= s.ttl) {
        this.scene.remove(s.mesh);
        s.mesh.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); });
        this.signs.splice(i, 1);
      }
    }
  }

  // --- The World (timestop) --------------------------------------------------
  timestop() {
    if (this.timestopActive) return false;
    if (this.gauge < this.gaugeMax) { this.hud?.showMessage?.('La barra del tiempo no está llena', 900); return false; }
    this.gauge = 0;
    this.timestopActive = true;
    this.timestopTimer = this.cfg.timestop.duration;
    this.hud?.showMessage?.('🌐 ZA WARUDO! ¡Toki yo tomare!', 2200);
    this.audio?.explosion?.();
    return true;
  }

  _endTimestop() {
    this.timestopActive = false;
    this.timestopTimer = 0;
    // Every hanging knife launches along its kept direction (now lethal).
    for (const k of this.knives) {
      k.frozen = false;
      k.freezeTimer = 0;
      k.velocity.copy(k.dir).multiplyScalar(k.speed);
      k.life = Math.max(k.life, this.cfg.knife.life);
    }
    // Deferred Stop Sign slams resolve now.
    for (const s of this.pendingResume) this._applySlam(s.center, s.radius, s.damage, s.fill);
    this.pendingResume.length = 0;
    this.hud?.showMessage?.('El tiempo vuelve a moverse', 1200);
  }

  // --- update ----------------------------------------------------------------
  update(delta) {
    for (const id of Object.keys(this.cooldowns)) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - delta);
    }
    if (this.timestopActive) {
      this.timestopTimer -= delta;
      if (this.timestopTimer <= 0) this._endTimestop();
    }
    this._updateKnives(delta);
    this._updateSigns(delta);
  }

  _solid(pos) {
    if (!this.world?.getBlock) return false;
    const type = this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    return Boolean(type) && type !== 'water';
  }

  dispose() {
    for (const k of this.knives) { this.scene.remove(k.mesh); k.mesh.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); }); }
    for (const s of this.signs) { this.scene.remove(s.mesh); s.mesh.traverse((c) => { c.geometry?.dispose?.(); c.material?.dispose?.(); }); }
    this.knives.length = 0;
    this.signs.length = 0;
    this.pendingResume.length = 0;
  }
}

export default DioController;
