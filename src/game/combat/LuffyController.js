import * as THREE from 'three';
import { BALANCE } from '../../core/config/GameBalance.js';

const ANY_DIR = new THREE.Vector3(1, 0, 0); // hitMelee with arcCos -1 ignores direction
const DOWN = new THREE.Vector3(0, -1, 0);

// Luffy's kit. His arm is the weapon: most skills are a forward stretch-punch
// (a box hit along the look direction, so they aim up and down). A gear gauge
// fills by landing hits and empties when he is hit; filling it advances the
// form. Each form (Gear 1/2, Gear 4 Boundman/Snakeman, Gear 5) defines its own
// three hotbar slots and a right-click special.
//
// Transitions: Gear1 -fill-> Gear2 -fill-> Boundman -fill-> Gear5;
//              Boundman -right click-> Snakeman -fill-> Gear5;
//              Gear2 -right click-> Cañón (resets to Gear 1).
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
    this.pendingSlam = null; // leap special: { timer, cfg, mode }
    this.transients = [];    // stretch-arm + smoke visuals
  }

  // --- gear / gauge ----------------------------------------------------------
  gear() { return this.cfg.gears[this.gearIndex]; }
  get gaugeMax() { return this.cfg.gaugeMax[this.gearIndex]; }
  get gearName() { return this.gear().name; }
  get gaugeRatio() { return THREE.MathUtils.clamp(this.gauge / this.gaugeMax, 0, 1); }
  get speedMult() { return this.gear().speed ?? 1; }
  get jumpMult() { return this.gear().jump ?? 1; }
  currentLabels() {
    const s = this.gear().slots;
    return { pistol: s.pistol.label, bazooka: s.bazooka.label, gatling: s.gatling.label };
  }

  _fill(amount) {
    const top = this.cfg.gaugeMax.length - 1;
    if (this.gearIndex >= top) { this.gauge = this.gaugeMax; return; }
    this.gauge += amount;
    if (this.gauge >= this.gaugeMax) {
      this.gearIndex = this.gear().fillTo; // read current form's target, then advance
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

  slotStats(id) {
    const base = this.cfg.base[id];
    const slot = this.gear().slots[id];
    return {
      ...base,
      label: slot.label,
      behavior: slot.behavior,
      damage: Math.round(base.damage * slot.dmg),
      range: base.range * slot.range,
      halfWidth: base.halfWidth * slot.width,
      cooldown: base.cooldown * slot.cd,
      smoke: this.gear().smoke,
    };
  }

  // --- hotbar skills ---------------------------------------------------------
  useSkill(id) {
    const slot = this.gear().slots[id];
    if (!slot) return false;
    if ((this.cooldowns[id] ?? 0) > 0) return false;

    const b = slot.behavior;
    // Leap specials read their own cfg (own damage + cooldown).
    if (b === 'kingkong' || b === 'bajrang' || b === 'skybeam') {
      if (this.gatling) return false;
      const cfg = this.cfg[b];
      this.cooldowns[id] = cfg.cooldown;
      this._leap(cfg, b === 'skybeam' ? 'beam' : 'slam', b);
      return true;
    }

    if (b === 'gatling' && this.gatling) return false;
    const stats = this.slotStats(id);
    this.cooldowns[id] = stats.cooldown;
    if (b === 'gatling') this.gatling = { timer: stats.duration ?? 2.0, tick: 0, side: 1, stats };
    else if (b === 'bazooka') this._bazooka(stats);
    else this._punch(stats, { autoaim: b === 'autoaim', pierce: b === 'penetrate' });
    return true;
  }

  // One forward stretch-punch (a box hit along the aim, or toward the nearest
  // enemy when autoaiming).
  _punch(stats, { scale = 1, color = 0xffe0b0, sideOffset = 0, autoaim = false, pierce = false } = {}) {
    const origin = this.origin();
    let dir = this.direction();
    if (autoaim) {
      const near = this.enemies.nearestTo?.(origin, stats.range + 8);
      if (near) dir = near.clone().sub(origin).normalize();
    }
    const right = this._right(dir);
    const from = origin.clone().addScaledVector(right, sideOffset);

    const hits = this.enemies.hitBox(from, dir, right, stats.range, stats.halfWidth, stats.damage);
    if (hits.length) this._fill(hits.length * (stats.fill ?? 1));

    const reach = (hits.length && !pierce) ? Math.min(stats.range, this._nearest(hits, from)) + 0.4 : stats.range;
    this._spawnArm(from, dir, reach, scale, stats.smoke, pierce ? 0xbfe0ff : color);
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

  // Leap up, then resolve a ground slam (or a sky lightning beam) below.
  _leap(cfg, mode, name) {
    this.player.velocity.y = Math.max(this.player.velocity.y, cfg.jump);
    this.player.isGrounded = false;
    this.pendingSlam = { timer: cfg.slamDelay, cfg, mode };
    const labels = { kingkong: '🦍 King Kong Gun', bajrang: '🐵 Bajrang Gun', skybeam: '⚡ Rayo Divino' };
    this.hud?.showMessage?.(labels[name] ?? 'Golpe', 1200);
    this.audio?.shoot?.('blaster');
  }

  _resolveSlam(cfg, mode) {
    const center = this.player.object.position.clone();
    center.y = this.world?.getGroundHeight?.(center.x, center.z) ?? center.y;
    const hits = this.enemies.hitMelee(center, ANY_DIR, cfg.radius, cfg.damage, -1);
    if (hits?.length) this._fill(hits.length * 0.5);
    this.enemies.knockback(center, cfg.radius, cfg.knockback);
    this.effects.explosion(center);
    this.effects.shockwave(center.clone(), cfg.radius, 0xffffff);
    this.effects.shockwave(center.clone(), cfg.radius * 0.6, 0xffd060);
    if (mode === 'beam') {
      const top = center.clone();
      top.y += 30;
      this.effects.beam?.(top, center.clone(), 0xbfe0ff);
    } else {
      this._spawnArm(center.clone().setY(center.y + 9), DOWN, 9, 3.2, true, 0xffd0a0);
    }
    this.audio?.explosion?.();
  }

  // --- right-click special (form-dependent) ---------------------------------
  secondary() {
    const sec = this.gear().secondary;
    if (sec === 'cannon') return this._cannon();
    if (sec === 'toSnakeman') return this._toSnakeman();
    this.hud?.showMessage?.('Sin habilidad de clic derecho', 700);
    return false;
  }

  // Gear 2 — Cañón: a giant forward punch that spends the form back to Gear 1.
  _cannon() {
    if ((this.cooldowns.secondary ?? 0) > 0) return false;
    const bp = this.cfg.cannon;
    this.cooldowns.secondary = 0.4;
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

  // Boundman — right-click: morph into Snakeman (keeps the gauge progress).
  _toSnakeman() {
    this.gearIndex = 3;
    this.hud?.showMessage?.('🐍 Gear 4: Snakeman', 1300);
    this.audio?.explosion?.();
    this.effects?.shockwave?.(this.player.object.position.clone(), 3.2, 0x9be36a);
    return true;
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
      if (this.pendingSlam.timer <= 0) {
        this._resolveSlam(this.pendingSlam.cfg, this.pendingSlam.mode);
        this.pendingSlam = null;
      }
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
