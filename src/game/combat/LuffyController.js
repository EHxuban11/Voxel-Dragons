import * as THREE from 'three';
import { BALANCE } from '../../core/config/GameBalance.js';

const ANY_DIR = new THREE.Vector3(1, 0, 0); // hitMelee with arcCos -1 ignores direction

// Luffy's kit. His arm is the weapon: every skill is a forward stretch-punch
// (a box hit along the look direction, so it aims up and down). A gear gauge
// fills by landing hits and empties when he is hit; filling it advances the
// form (Gear 1 -> 2 -> Gear 4 Boundman -> Snakeman -> Gear 5), each needing
// more. Each form scales the three hotbar skills and has its own right-click
// special (Gear 2: Cañón that resets the form; Boundman: King Kong Gun).
export class LuffyController {
  constructor(deps) {
    this.scene = deps.scene;
    this.effects = deps.effects;
    this.world = deps.world;
    this.enemies = deps.enemies;
    this.player = deps.player;
    this.camera = deps.camera;
    this.audio = deps.audio;
    this.hud = deps.hud;

    this.cfg = BALANCE.luffy;
    this.gearIndex = 0;
    this.gauge = 0;
    this.cooldowns = { pistol: 0, bazooka: 0, gatling: 0, secondary: 0 };
    this.gatling = null;     // active barrage: { timer, tick, side, stats }
    this.pendingSlam = null; // King Kong Gun: { timer, cfg }
    this.transients = [];    // stretch-arm + smoke visuals
  }

  // --- gear / gauge ----------------------------------------------------------
  gear() { return this.cfg.gears[this.gearIndex]; }
  get gaugeMax() { return this.cfg.gaugeMax[this.gearIndex]; }
  get gearName() { return this.cfg.gearNames[this.gearIndex]; }
  get gaugeRatio() { return THREE.MathUtils.clamp(this.gauge / this.gaugeMax, 0, 1); }
  currentLabels() { return this.gear().labels; }

  _fill(amount) {
    if (this.gearIndex >= this.cfg.gaugeMax.length - 1) { this.gauge = this.gaugeMax; return; }
    this.gauge += amount;
    if (this.gauge >= this.gaugeMax) {
      this.gearIndex += 1;
      this.gauge = 0;
      this.hud?.showMessage?.(`⬆ ${this.gearName}`, 1300);
      this.audio?.explosion?.();
      this.effects?.shockwave?.(this.player.object.position.clone(), 3.5, 0xff7a3a);
    }
  }

  // Hit by an enemy: the gauge empties (the form is kept).
  onPlayerHit() {
    if (this.gauge > 0) this.gauge = 0;
  }

  resetToGear1() {
    this.gearIndex = 0;
    this.gauge = 0;
  }

  // --- aim helpers -----------------------------------------------------------
  origin() { return this.camera.getWorldPosition(new THREE.Vector3()); }
  direction() { return this.camera.getWorldDirection(new THREE.Vector3()); }
  _right(dir) {
    const r = new THREE.Vector3(dir.z, 0, -dir.x);
    if (r.lengthSq() < 1e-4) r.set(1, 0, 0);
    return r.normalize();
  }

  // Resolve a hotbar archetype to the current form's stats.
  skillStats(id) {
    const base = this.cfg.base[id];
    const g = this.gear();
    return {
      ...base,
      damage: Math.round(base.damage * g.dmg),
      range: base.range * g.range,
      halfWidth: base.halfWidth * g.width,
      cooldown: base.cooldown * g.cd,
      smoke: g.smoke,
    };
  }

  // --- hotbar skills ---------------------------------------------------------
  useSkill(id) {
    if (!this.cfg.base[id]) return false;
    if ((this.cooldowns[id] ?? 0) > 0) return false;
    if (id === 'gatling' && this.gatling) return false;
    const stats = this.skillStats(id);
    this.cooldowns[id] = stats.cooldown;
    if (id === 'pistol') this._punch(stats, { scale: 1.0, color: 0xffe0b0 });
    else if (id === 'bazooka') this._bazooka(stats);
    else if (id === 'gatling') this.gatling = { timer: stats.duration ?? 2.0, tick: 0, side: 1, stats };
    return true;
  }

  // One forward stretch-punch (a box hit along the aim).
  _punch(stats, { scale = 1, color = 0xffe0b0, sideOffset = 0 } = {}) {
    const origin = this.origin();
    const dir = this.direction();
    const right = this._right(dir);
    const from = origin.clone().addScaledVector(right, sideOffset);

    const hits = this.enemies.hitBox(from, dir, right, stats.range, stats.halfWidth, stats.damage);
    if (hits.length) this._fill(hits.length * (stats.fill ?? 1));

    const reach = hits.length ? Math.min(stats.range, this._nearest(hits, from)) + 0.4 : stats.range;
    this._spawnArm(from, dir, reach, scale, stats.smoke, color);
    for (const h of hits) {
      this.effects.impact(h.position, color);
      if (stats.smoke) this._spawnSmoke(h.position);
    }
    if (stats.knockback) {
      const center = from.clone().addScaledVector(dir, reach);
      this.enemies.knockback(center, stats.halfWidth + 1, stats.knockback);
    }
    this.audio?.shoot?.('pistol');
    return hits;
  }

  // Bazooka: both arms slam forward (offset to each side) + a shockwave.
  _bazooka(stats) {
    const dir = this.direction();
    const origin = this.origin();
    this._punch(stats, { scale: 1.6, color: 0xffd0a0, sideOffset: -0.25 });
    this._punch({ ...stats, fill: 0, knockback: 0 }, { scale: 1.6, color: 0xffd0a0, sideOffset: 0.25 });
    const tip = origin.clone().addScaledVector(dir, Math.min(stats.range, 6));
    this.effects.shockwave(tip, stats.halfWidth + 1, 0xffe0b0);
    if (stats.smoke) this._spawnSmoke(tip);
    this.audio?.explosion?.();
  }

  // --- right-click special (form-dependent) ---------------------------------
  secondary() {
    const sec = this.gear().secondary;
    if (sec === 'cannon') return this._cannon();
    if (sec === 'kingkong') return this._kingKong();
    this.hud?.showMessage?.('Sin habilidad de clic derecho', 700);
    return false;
  }

  // Gear 2 — Cañón: a giant forward punch that spends the form back to Gear 1.
  _cannon() {
    if ((this.cooldowns.secondary ?? 0) > 0) return false;
    const bp = this.cfg.cannon;
    this.cooldowns.secondary = bp.cooldown;
    const origin = this.origin();
    const dir = this.direction();
    const right = this._right(dir);

    const hits = this.enemies.hitBox(origin, dir, right, bp.range, bp.halfWidth, bp.damage);
    this._spawnArm(origin, dir, bp.range, 3.4, true, 0xffd0a0);
    const tip = origin.clone().addScaledVector(dir, Math.min(bp.range, 7));
    this.effects.explosion(tip);
    this.effects.shockwave(tip, bp.halfWidth + 2, 0xffffff);
    this.effects.shockwave(tip.clone(), bp.halfWidth + 4, 0xffd060);
    for (const h of hits) this.effects.impact(h.position, 0xffd0a0);
    this.enemies.knockback(tip, bp.halfWidth + 2, bp.knockback);
    this.audio?.explosion?.();
    this.hud?.showMessage?.('💥 Gomu Gomu no… ¡Cañón!', 1400);

    this.resetToGear1(); // spend the whole form
    return true;
  }

  // Boundman — King Kong Gun: leap up, then a giant ground slam.
  _kingKong() {
    if ((this.cooldowns.secondary ?? 0) > 0) return false;
    const kk = this.cfg.kingkong;
    this.cooldowns.secondary = kk.cooldown;
    this.player.velocity.y = Math.max(this.player.velocity.y, kk.jump); // leap
    this.player.isGrounded = false;
    this.pendingSlam = { timer: kk.slamDelay, cfg: kk };
    this.hud?.showMessage?.('🦍 King Kong Gun', 1300);
    this.audio?.shoot?.('blaster');
    return true;
  }

  _slam(kk) {
    const center = this.player.object.position.clone();
    const groundY = this.world?.getGroundHeight?.(center.x, center.z) ?? center.y;
    center.y = groundY;
    const hits = this.enemies.hitMelee(center, ANY_DIR, kk.radius, kk.damage, -1); // AoE
    if (hits?.length) this._fill(hits.length * 0.5);
    this.enemies.knockback(center, kk.radius, kk.knockback);
    this.effects.explosion(center);
    this.effects.shockwave(center.clone(), kk.radius, 0xffffff);
    this.effects.shockwave(center.clone(), kk.radius * 0.6, 0xffd060);
    this.audio?.explosion?.();
    // A giant fist crashing straight down onto the spot.
    this._spawnArm(center.clone().setY(center.y + 9), new THREE.Vector3(0, -1, 0), 9, 3.2, true, 0xffd0a0);
  }

  // --- visuals ---------------------------------------------------------------
  _nearest(hits, from) {
    let best = Infinity;
    for (const h of hits) {
      const d = h.position?.distanceTo?.(from);
      if (typeof d === 'number' && d < best) best = d;
    }
    return Number.isFinite(best) ? best : 0;
  }

  _spawnArm(origin, dir, length, scale, smoke, color) {
    const thickness = 0.18 * scale;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(thickness, thickness, Math.max(0.5, length)),
      new THREE.MeshStandardMaterial({ color: 0xe7b48a, roughness: 0.95, emissive: color, emissiveIntensity: 0.25, flatShading: true }),
    );
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    arm.position.copy(origin).addScaledVector(dir, length / 2);
    arm.frustumCulled = false;
    this.scene.add(arm);
    this.transients.push({ mesh: arm, material: arm.material, age: 0, ttl: 0.16, kind: 'arm' });

    const fist = new THREE.Mesh(
      new THREE.BoxGeometry(0.34 * scale, 0.34 * scale, 0.34 * scale),
      new THREE.MeshStandardMaterial({ color: 0xe7b48a, roughness: 0.95, emissive: color, emissiveIntensity: 0.3, flatShading: true }),
    );
    fist.position.copy(origin).addScaledVector(dir, length);
    fist.frustumCulled = false;
    this.scene.add(fist);
    this.transients.push({ mesh: fist, material: fist.material, age: 0, ttl: 0.18, kind: 'arm' });

    if (smoke) this._spawnSmoke(origin.clone().addScaledVector(dir, length * 0.5));
  }

  _spawnSmoke(position) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.position.copy(position);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.transients.push({ mesh, material: mesh.material, age: 0, ttl: 0.5, kind: 'smoke' });
  }

  // --- update loop -----------------------------------------------------------
  update(delta) {
    for (const id of Object.keys(this.cooldowns)) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - delta);
    }

    if (this.gatling) {
      this.gatling.timer -= delta;
      this.gatling.tick -= delta;
      if (this.gatling.tick <= 0) {
        this.gatling.tick = this.gatling.stats.interval;
        this.gatling.side *= -1;
        this._punch(this.gatling.stats, { scale: 0.8, color: 0xfff0c0, sideOffset: 0.3 * this.gatling.side });
      }
      if (this.gatling.timer <= 0) this.gatling = null;
    }

    if (this.pendingSlam) {
      this.pendingSlam.timer -= delta;
      if (this.pendingSlam.timer <= 0) { this._slam(this.pendingSlam.cfg); this.pendingSlam = null; }
    }

    for (let i = this.transients.length - 1; i >= 0; i -= 1) {
      const t = this.transients[i];
      t.age += delta;
      const k = THREE.MathUtils.clamp(1 - t.age / t.ttl, 0, 1);
      if (t.kind === 'smoke') {
        t.mesh.scale.setScalar(1 + t.age * 4);
        t.material.opacity = 0.55 * k;
      } else {
        t.material.transparent = true;
        t.material.opacity = k;
      }
      if (t.age >= t.ttl) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.material.dispose();
        this.transients.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const t of this.transients) {
      this.scene.remove(t.mesh);
      t.mesh.geometry?.dispose?.();
      t.material?.dispose?.();
    }
    this.transients.length = 0;
  }
}

export default LuffyController;
