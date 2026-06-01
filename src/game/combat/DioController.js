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

  // Right click: six independent knives scattered at random points within an
  // invisible disc in front of the view, all flying forward.
  sixKnives() {
    if (this.cooldowns.six > 0) return false;
    this.cooldowns.six = this.cfg.six.cooldown;
    const dir = this.direction();
    const right = this._right(dir);
    const up = new THREE.Vector3().crossVectors(dir, right).normalize(); // view-up
    const n = this.cfg.six.count;
    for (let i = 0; i < n; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.cfg.six.circleRadius; // uniform in the disc
      const offset = right.clone().multiplyScalar(Math.cos(angle) * r).addScaledVector(up, Math.sin(angle) * r);
      this._spawnKnife(dir, this.cfg.six.damage, this.cfg.six.fill, offset);
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
      if (this.enemies.anyNear(k.position, this.cfg.knife.hitRadius)) {
        const hits = this.enemies.hitMelee(k.position, ANY_DIR, this.cfg.knife.hitRadius, k.damage, -1);
        if (hits.length) {
          this._fill(k.fill);
          this.effects.impact(k.position, 0xfff0a0);
          this._removeKnife(i);
          continue;
        }
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
  // Swings a road sign down from Dio's hand into the ground ahead; the damage
  // lands when the sign hits the floor (not on press). Because the swing is
  // frozen while time is stopped, a Stop Sign used during The World only deals
  // its damage once time resumes and the sign finishes its arc.
  stopSign() {
    if (this.cooldowns.stopSign > 0) return false;
    this.cooldowns.stopSign = this.cfg.stopSign.cooldown;
    const dir = this.direction();
    const origin = this.origin();
    const aim = origin.clone().addScaledVector(dir, this.cfg.stopSign.ahead);
    const gy = this.world?.getGroundHeight?.(aim.x, aim.z) ?? aim.y;
    const center = new THREE.Vector3(aim.x, gy, aim.z);
    this._spawnSign(origin, dir, center);
    return true;
  }

  _applySlam(center, radius, damage, fill) {
    const hits = this.enemies.hitMelee(center, ANY_DIR, radius, damage, -1);
    if (hits?.length) this._fill(hits.length * fill);
    this.effects.explosion(center.clone());
    this.effects.shockwave(center.clone(), radius, 0xd83b3b);
    this.audio?.explosion?.();
  }

  _spawnSign(origin, dir, center) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 3, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.7, flatShading: true }),
    );
    post.position.y = -1.4; // grip is at the top; the panel leads the swing
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 1.7, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xd83b3b, emissive: 0x551010, emissiveIntensity: 0.5, roughness: 0.6, flatShading: true }),
    );
    sign.position.y = -3.0;
    g.add(post, sign);
    const hand = origin.clone().addScaledVector(dir, 1.0);
    hand.y = origin.y; // starts at hand height, swings down to the ground
    g.position.copy(hand);
    g.frustumCulled = false;
    this.scene.add(g);
    this.signs.push({
      mesh: g,
      age: 0,
      swing: this.cfg.stopSign.swing,
      hold: this.cfg.stopSign.hold,
      from: hand.clone(),
      to: center.clone(),
      slam: { center: center.clone(), radius: this.cfg.stopSign.radius, damage: this.cfg.stopSign.damage, fill: this.cfg.stopSign.fill },
      applied: false,
    });
  }

  _updateSigns(delta) {
    for (let i = this.signs.length - 1; i >= 0; i -= 1) {
      const s = this.signs[i];
      // Frozen mid-swing while time is stopped — so the damage defers to resume.
      if (this.timestopActive) continue;
      s.age += delta;
      const k = THREE.MathUtils.clamp(s.age / s.swing, 0, 1);
      s.mesh.position.lerpVectors(s.from, s.to, k);
      s.mesh.position.y += Math.sin(k * Math.PI) * 0.8; // slight arc
      s.mesh.rotation.x = THREE.MathUtils.lerp(-1.45, 0.05, k); // overhead -> flat slam
      s.mesh.rotation.y += delta * 8; // whirl as it comes down
      if (k >= 1 && !s.applied) {
        s.applied = true;
        this._applySlam(s.slam.center, s.slam.radius, s.slam.damage, s.slam.fill);
      }
      if (s.age >= s.swing + s.hold) {
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
    // Any Stop Sign frozen mid-swing now finishes its arc and lands its damage.
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
  }
}

export default DioController;
