import * as THREE from 'three';
import { World } from './World.js';
import { Player } from './Player.js';
import { Weapons } from './Weapons.js';
import { DragonManager } from './DragonManager.js';
import { ZombieManager } from './ZombieManager.js';
import { Input } from './Input.js';
import { HUD } from './HUD.js';
import { Effects } from './Effects.js';
import { GameAudio } from './Audio.js';
import { Inventory } from './Inventory.js';
import { CHARACTERS } from './Characters.js';
import { buildViewmodel, disposeViewmodel } from './Viewmodels.js';
import { Shop } from './Shop.js';
import { BALANCE } from './GameBalance.js';

export class Game {
  constructor(root, options = {}) {
    this.root = root;
    this.character = options.character ?? CHARACTERS[0];
    this.onExit = options.onExit ?? null;
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.root.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 900);
    this.input = new Input({ target: this.renderer.domElement });
    this.audio = new GameAudio();
    this.effects = new Effects(this.scene);
    this.effects.camera = this.camera; // for camera-facing slash marks
    this.inventory = new Inventory(this.character);
    this.world = new World(BALANCE.world);
    this.player = new Player(this.camera, {
      ...BALANCE.player,
      maxHealth: this.character.health,
      maxShield: this.character.shield,
      moveSpeed: BALANCE.player.moveSpeed * (this.character.speedMult ?? 1),
    });
    this.player.setPosition(...this.world.getSpawnPoint().toArray());
    this.weapons = new Weapons({
      camera: this.camera,
      scene: this.scene,
      weapons: BALANCE.weapons,
      callbacks: {
        onHit: (hit) => {
          if (hit.weapon?.id === 'dagger' && hit.point) {
            // Daggers leave the same slash mark as the sword.
            this.effects.slashMark(hit.point, hit.dragon ? BALANCE.slash.dragonSize : BALANCE.slash.zombieSize);
          } else if (hit.point) {
            this.effects.impact(hit.point, hit.weapon?.flashColor ?? 0xffd166);
          }
          if (hit.killed) {
            this.effects.explosion(hit.point);
            this.audio.explosion();
          }
        },
        onProjectileImpact: (hit) => {
          if (hit.point) this.effects.impact(hit.point, hit.weapon?.flashColor ?? 0xcfd6df);
        },
        onBeam: (beam) => {
          this.effects.beam(beam.origin, beam.end, beam.color);
        },
        onTracer: (tracer) => {
          this.effects.tracer(tracer.origin, tracer.end, tracer.color);
        }
      }
    });
    const bounds = {
      minX: -BALANCE.world.width / 2 + 2,
      maxX: BALANCE.world.width / 2 - 2,
      minZ: -BALANCE.world.depth / 2 + 2,
      maxZ: BALANCE.world.depth / 2 - 2,
    };
    this.dragons = new DragonManager(this.scene, {
      count: 0,
      camera: this.camera,
      bounds,
      reflectDamage: BALANCE.guard.reflectDamage,
    });
    this.zombies = new ZombieManager(this.scene, {
      bounds,
      health: BALANCE.zombies.health,
      speed: BALANCE.zombies.speed,
      damage: BALANCE.zombies.damage,
      attackRange: BALANCE.zombies.attackRange,
      attackCooldown: BALANCE.zombies.attackCooldown,
      spawnRadiusMin: BALANCE.zombies.spawnRadiusMin,
      spawnRadiusMax: BALANCE.zombies.spawnRadiusMax,
    });

    // Gun shots resolve against the closest of either enemy manager.
    this.enemyTargets = {
      hitByRay: (ray, damage) => {
        const dragonPeek = this.dragons.peekRay(ray);
        const zombiePeek = this.zombies.peekRay(ray);
        if (dragonPeek && (!zombiePeek || dragonPeek.distance <= zombiePeek.distance)) {
          return this.dragons.applyRayHit(dragonPeek, damage);
        }
        if (zombiePeek) return this.zombies.applyRayHit(zombiePeek, damage);
        return null;
      },
      hitAllByRay: (ray, damage) => [
        ...this.dragons.hitAllByRay(ray, damage),
        ...this.zombies.hitAllByRay(ray, damage),
      ],
    };

    this.hud = new HUD(this.root);
    this.started = false;
    this.state = 'playing'; // 'playing' | 'shop' | 'dead'
    this.wave = 0;
    this.meleeCooldown = 0;
    this.guardCooldown = 0;
    this.dashCooldown = 0;
    this.swordCharging = false;
    this.swordCharge = 0;
    this.viewmodel = null;

    // Run progression / economy.
    this.coins = 0;
    this.hasRevive = true; // the heart; consumed on first death
    this.buffs = { damage: 0, speed: 0, health: 0, shield: 0 };
    this.meleeDamage = BALANCE.sword.damage;
    this.shop = null;
    this.shopDone = false;
    this.victory = false;
    this.deathTimer = 0;

    // The player cannot leave the map (invisible barrier at the edges).
    this.playerBounds = {
      minX: -BALANCE.world.width / 2 + 1,
      maxX: BALANCE.world.width / 2 - 1,
      minZ: -BALANCE.world.depth / 2 + 1,
      maxZ: BALANCE.world.depth / 2 - 1,
    };

    this.targetOutline = this.createTargetOutline();

    this.scene.add(this.world);
    this.scene.add(this.player.object);
    this.scene.add(this.targetOutline);
    this.addBoundaryBarrier();
    this.setupScene();
    this.bindEvents();
    this.onSelectionChanged();
    this.startNextWave();
  }

  grantWaveAmmo() {
    for (const [name, amount] of Object.entries(BALANCE.progression.waveAmmo)) {
      this.weapons.addAmmo(name, amount);
    }
  }

  addBoundaryBarrier() {
    const { minX, maxX, minZ, maxZ } = this.playerBounds;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const geometry = new THREE.BoxGeometry(width, 60, depth);
    const material = new THREE.MeshBasicMaterial({
      color: 0x6fc3ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const barrier = new THREE.Mesh(geometry, material);
    barrier.position.set((minX + maxX) / 2, 18, (minZ + maxZ) / 2);
    this.scene.add(barrier);
  }

  startNextWave() {
    this.wave += 1;

    // The shop opens once, right before the configured wave, and that is also
    // where you are handed reserve ammo for the guns.
    if (this.wave === BALANCE.progression.shopWave && !this.shopDone) {
      this.grantWaveAmmo();
      this.openShop();
    }

    this.dragons.spawnWave(this.wave);
    this.zombies.spawnWave(this.wave, this.player, this.world);
    this.hud.showMessage(`Oleada ${this.wave}`, 1500);
  }

  setupScene() {
    this.scene.background = new THREE.Color(BALANCE.colors.sky);
    this.scene.fog = new THREE.Fog(BALANCE.colors.sky, 80, 340);
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x31451e, 1.5);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0c5, 2.4);
    sun.position.set(70, 120, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    this.scene.add(sun);
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    this.renderer.domElement.addEventListener('click', () => {
      this.audio.unlock();
      this.input.requestPointerLock();
      this.started = true;
    });
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  start() {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const delta = Math.min(this.clock.getDelta(), 0.05);

    // Death screen: everything is frozen; return to the menu after 3 seconds.
    if (this.state === 'dead') {
      this.deathTimer -= delta;
      if (this.deathTimer <= 0) {
        this.exitToMenu();
        return;
      }
      this.renderer.render(this.scene, this.camera);
      this.input.update();
      return;
    }

    // Shop is open: the run is paused while buffs are purchased.
    if (this.state === 'shop') {
      this.renderer.render(this.scene, this.camera);
      this.input.update();
      return;
    }

    this.meleeCooldown = Math.max(0, this.meleeCooldown - delta);
    this.guardCooldown = Math.max(0, this.guardCooldown - delta);
    this.dashCooldown = Math.max(0, this.dashCooldown - delta);
    this.player.updateGuard(delta);

    if (this.input.consume('reload')) {
      this.weapons.reload();
      this.audio.reload();
    }
    if (this.input.consume('interact')) {
      this.inventory.toggleOpen();
    }
    if (this.input.consume('weaponNext')) {
      this.inventory.next();
      this.onSelectionChanged();
    }
    if (this.input.consume('weaponPrev')) {
      this.inventory.previous();
      this.onSelectionChanged();
    }
    for (let i = 1; i <= this.inventory.slots.length; i += 1) {
      if (this.input.consume(`weapon${i}`)) {
        this.inventory.select(i - 1);
        this.onSelectionChanged();
      }
    }
    // Right click and the F key both trigger the character's secondary action.
    if (this.input.consume('alternate')) {
      this.useSecondaryAction();
    }
    // Debug: P clears the round's enemies, jumping to the next wave.
    if (this.input.consume('debugSkipWave')) {
      this.dragons.clearDragons();
      this.zombies.clearZombies();
    }

    this.player.update(delta, this.input, this.world);
    this.clampPlayerToBounds();
    this.world.update(delta);
    this.dragons.update(delta, this.player, this.scene);
    this.zombies.update(delta, this.player, this.world);
    this.handleZombieEvents();

    // Coins are earned by killing enemies.
    this.coins += this.dragons.consumeKills() * BALANCE.coins.dragon
      + this.zombies.consumeKills() * BALANCE.coins.zombie;

    if (!this.victory && this.dragons.getAliveCount() === 0 && this.zombies.getAliveCount() === 0) {
      this.advanceWave();
    }
    this.weapons.update(delta);
    this.effects.update(delta);

    // Left click and the E key both attack.
    const attackClicked = this.input.consume('attack');
    const attacking = this.input.pointerLocked && (this.input.isDown('Mouse0') || this.input.isDown('KeyE'));
    const attackSlot = this.inventory.selectedSlot;
    if (attackSlot?.kind === 'melee') {
      // Knight sword: hold to charge a stronger attack, release to swing.
      if (attacking) {
        this.swordCharging = true;
        this.swordCharge += delta;
      } else if (this.swordCharging) {
        this.releaseSwordAttack(this.swordCharge);
        this.swordCharging = false;
        this.swordCharge = 0;
      }
      this.updateSwordChargeVisual();
    } else if (attacking) {
      if (attackSlot?.kind === 'weapon') {
        this.handleFire();
      }
    }
    if (this.input.pointerLocked && attackClicked && attackSlot?.kind === 'block') {
      this.mineTargetBlock();
    }

    this.handleDragonFireballs(delta);

    if (!this.player.isAlive) {
      this.handlePlayerDeath();
    }

    this.updateTargetOutline();
    this.effects.applyCameraShake(this.camera);
    const selectedSlot = this.inventory.selectedSlot;
    const isMelee = selectedSlot?.kind === 'melee';
    const weaponId = selectedSlot?.kind === 'weapon' ? this.weapons.currentWeapon?.id : null;
    const isGun = Boolean(weaponId) && weaponId !== 'dagger';
    const ammoState = this.weapons.getAmmoState(true);
    this.hud.update({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      shield: this.player.shield,
      maxShield: this.player.maxShield,
      ammo: ammoState,
      // Only the duck's guns show ammo (clip / reserve). Sword and dagger hide it.
      ammoText: isGun ? `${ammoState.ammo} / ${ammoState.reserveAmmo}` : '',
      weapon: isMelee ? selectedSlot.label : this.weapons.getCurrentWeaponName(),
      dragons: this.dragons.getAliveCount(),
      dragonsTotal: this.dragons.dragons.length,
      zombies: this.zombies.getAliveCount(),
      coins: this.coins,
      revive: this.hasRevive,
      guard: this.player.guardActive,
      wave: this.wave,
      waveCount: BALANCE.progression.waveCount,
      inventory: this.inventory.snapshot(),
      locked: this.input.pointerLocked
    });

    this.renderer.render(this.scene, this.camera);
    this.input.update();
  }

  clampPlayerToBounds() {
    const pos = this.player.object.position;
    pos.x = THREE.MathUtils.clamp(pos.x, this.playerBounds.minX, this.playerBounds.maxX);
    pos.z = THREE.MathUtils.clamp(pos.z, this.playerBounds.minZ, this.playerBounds.maxZ);
  }

  advanceWave() {
    if (this.wave >= BALANCE.progression.waveCount) {
      this.triggerVictory();
      return;
    }
    this.startNextWave();
  }

  triggerVictory() {
    this.victory = true;
    this.hud.showMessage('¡Has ganado! 🎉', 6000);
  }

  handlePlayerDeath() {
    if (this.hasRevive) {
      // First death: the heart greys out and you respawn normally.
      this.hasRevive = false;
      this.respawnPlayer();
    } else {
      // Second death: game over.
      this.triggerGameOver();
    }
  }

  triggerGameOver() {
    this.state = 'dead';
    this.deathTimer = 3;
    this.hud.showDeathScreen();
    this.input.exitPointerLock();
  }

  exitToMenu() {
    if (this._exited) return;
    this._exited = true;
    this.dispose();
    this.onExit?.();
  }

  openShop() {
    this.state = 'shop';
    this.input.exitPointerLock();
    this.shop = new Shop(this.root, {
      items: BALANCE.shop.items,
      getCoins: () => this.coins,
      getOwned: (id) => this.buffs[id] ?? 0,
      onBuy: (item) => this.buyBuff(item),
      onClose: () => this.closeShop(),
    });
  }

  closeShop() {
    this.shop?.hide?.();
    this.shop = null;
    this.shopDone = true;
    this.state = 'playing';
  }

  buyBuff(item) {
    if (this.coins < item.cost) return false;
    this.coins -= item.cost;
    this.buffs[item.id] = (this.buffs[item.id] ?? 0) + 1;
    this.applyBuff(item.id);
    return true;
  }

  applyBuff(id) {
    switch (id) {
      case 'damage':
        this.weapons.scaleDamage(1.25);
        this.meleeDamage *= 1.25;
        break;
      case 'speed':
        this.player.config.moveSpeed *= 1.15;
        break;
      case 'health':
        this.player.maxHealth += 40;
        this.player.health = Math.min(this.player.maxHealth, this.player.health + 40);
        break;
      case 'shield':
        this.player.maxShield += 25;
        this.player.shield = Math.min(this.player.maxShield, this.player.shield + 25);
        break;
      default:
        break;
    }
  }

  handleFire() {
    const fired = this.weapons.fire({
      scene: this.scene,
      world: this.world,
      dragons: this.enemyTargets,
      effects: this.effects,
      camera: this.camera
    });
    if (fired) {
      this.audio.shoot(this.weapons.getCurrentWeaponName());
    }
  }

  applyMeleeHits(zombieHits, dragonHits, color = 0xffffff, sizeMult = 1) {
    for (const hit of zombieHits) {
      this.effects.slashMark(hit.position, BALANCE.slash.zombieSize * sizeMult, color);
      if (hit.killed) {
        this.effects.explosion(hit.position);
        this.audio.explosion();
      }
    }
    for (const hit of dragonHits) {
      this.effects.slashMark(hit.position, BALANCE.slash.dragonSize * sizeMult, color);
      if (hit.killed) {
        this.effects.explosion(hit.position);
        this.audio.explosion();
      }
    }
  }

  meleeAttack() {
    if (this.meleeCooldown > 0) return;
    this.meleeCooldown = BALANCE.sword.cooldown;

    const origin = this.getCameraWorldPosition();
    const direction = this.getLookDirection();
    const { range, arcCos } = BALANCE.sword;
    const damage = this.meleeDamage;

    const zombieHits = this.zombies.hitMelee(origin, direction, range, damage, arcCos);
    const dragonHits = this.dragons.hitMelee(origin, direction, range, damage, arcCos);
    this.applyMeleeHits(zombieHits, dragonHits, 0xffffff, 1);
  }

  releaseSwordAttack(charge) {
    if (charge >= BALANCE.sword.aoeCharge) {
      this.circularAoe();
    } else if (charge >= BALANCE.sword.sweepCharge) {
      this.giantSweep();
    } else {
      this.meleeAttack();
    }
  }

  giantSweep() {
    const origin = this.getCameraWorldPosition();
    const direction = this.getLookDirection();
    const { sweepRange, sweepArcCos, sweepDamageMult } = BALANCE.sword;
    const damage = this.meleeDamage * sweepDamageMult;

    const zombieHits = this.zombies.hitMelee(origin, direction, sweepRange, damage, sweepArcCos);
    const dragonHits = this.dragons.hitMelee(origin, direction, sweepRange, damage, sweepArcCos);
    this.applyMeleeHits(zombieHits, dragonHits, 0x4aa0ff, 1.4);

    // Big blue slash in the look direction.
    const center = this.player.object.position.clone();
    center.y += this.player.config.height * 0.6;
    center.addScaledVector(direction, sweepRange * 0.4);
    this.effects.slashMark(center, sweepRange, 0x4aa0ff);
    this.audio.explosion();
  }

  circularAoe() {
    const origin = this.getCameraWorldPosition();
    const direction = this.getLookDirection();
    const { aoeRadius, aoeDamageMult } = BALANCE.sword;
    const damage = this.meleeDamage * aoeDamageMult;

    // arcCos of -1 makes the hit ignore direction (full 360° circle).
    const zombieHits = this.zombies.hitMelee(origin, direction, aoeRadius, damage, -1);
    const dragonHits = this.dragons.hitMelee(origin, direction, aoeRadius, damage, -1);
    this.applyMeleeHits(zombieHits, dragonHits, 0xffffff, 1.2);

    const center = this.player.object.position.clone();
    center.y += 0.2;
    this.effects.shockwave(center, aoeRadius, 0xffffff);
    this.audio.explosion();
  }

  updateSwordChargeVisual() {
    if (!this.viewmodel) return;
    let emissive = 0x000000;
    let intensity = 0;
    if (this.swordCharging) {
      if (this.swordCharge >= BALANCE.sword.aoeCharge) {
        emissive = 0xffffff;
        intensity = 1.6;
      } else if (this.swordCharge >= BALANCE.sword.sweepCharge) {
        emissive = 0x2a6bff;
        intensity = 1.3;
      }
    }
    this.viewmodel.traverse((child) => {
      if (child.material?.emissive) {
        child.material.emissive.setHex(emissive);
        child.material.emissiveIntensity = intensity;
      }
    });
  }

  activateGuard() {
    if (this.guardCooldown > 0 || this.player.guardActive) return;
    this.player.activateGuard(BALANCE.guard.duration);
    this.guardCooldown = BALANCE.guard.duration + BALANCE.guard.cooldown;
    this.effects.impact(this.player.object.position, 0x9fe8ff);
  }

  handleZombieEvents() {
    for (const event of this.zombies.consumeEvents()) {
      if (event.type === 'attack') {
        this.player.damage(event.damage);
        this.hud.flashDamage();
        this.audio.damage();
      } else if (event.type === 'parry') {
        this.effects.impact(event.position, 0x9fe8ff);
      }
    }
  }

  onSelectionChanged() {
    this.syncSelectedWeapon();
    this.updateViewmodel();
  }

  syncSelectedWeapon() {
    const slot = this.inventory.selectedSlot;
    if (slot?.kind === 'weapon') {
      this.weapons.switchWeapon(slot.weaponIndex);
    }
  }

  updateViewmodel() {
    if (this.viewmodel) {
      this.camera.remove(this.viewmodel);
      disposeViewmodel(this.viewmodel);
      this.viewmodel = null;
    }

    const slot = this.inventory.selectedSlot;
    let kind = null;
    if (slot?.kind === 'melee') {
      kind = 'sword';
    } else if (slot?.kind === 'weapon') {
      const label = (slot.label ?? '').toLowerCase();
      if (label.includes('rifle')) kind = 'rifle';
      else if (label.includes('shotgun')) kind = 'shotgun';
      else if (label.includes('blaster')) kind = 'blaster';
      else if (label.includes('daga')) kind = 'dagger';
    }

    const model = kind ? buildViewmodel(kind) : null;
    if (model) {
      this.camera.add(model);
      this.viewmodel = model;
    }
  }

  useSecondaryAction() {
    switch (this.character.ability) {
      case 'guard':
        this.activateGuard();
        break;
      case 'dash':
        this.activateDash();
        break;
      default:
        this.placeSelectedBlock();
        break;
    }
  }

  activateDash() {
    if (this.dashCooldown > 0) return;
    if (this.player.startDash(BALANCE.dash.distance, BALANCE.dash.speed)) {
      this.dashCooldown = BALANCE.dash.cooldown;
      this.effects.impact(this.player.object.position, 0xbfe0ff);
    }
  }

  mineTargetBlock() {
    if (!this.character.canPlaceBlocks) return;
    const hit = this.world.raycastBlock(this.getCameraWorldPosition(), this.getLookDirection(), BALANCE.world.interactionRange);
    if (!hit || hit.type === 'water') return;
    if (this.world.removeBlock(hit)) {
      this.inventory.addBlock(hit.type);
      this.effects.impact(hit.point, 0xffffff);
    }
  }

  placeSelectedBlock() {
    if (!this.character.canPlaceBlocks) return;
    if (!this.inventory.canPlaceSelected()) return;
    const hit = this.world.raycastBlock(this.getCameraWorldPosition(), this.getLookDirection(), BALANCE.world.interactionRange);
    if (!hit) return;
    const type = this.inventory.selectedSlot.type;
    if (this.world.addBlock(hit, type)) {
      this.inventory.consumeSelectedBlock();
      this.effects.impact(hit.point, this.inventory.selectedSlot.color);
    }
  }

  respawnPlayer() {
    this.player.revive();
    this.player.setPosition(...this.world.getSpawnPoint().toArray());
    this.hud.flashDamage();
    this.hud.showMessage('Has reaparecido', 1200);
  }

  handleDragonFireballs() {
    for (const ball of this.dragons.consumeImpacts()) {
      this.effects.explosion(ball.position);
      this.audio.explosion();
      if (ball.hitPlayer && ball.damage > 0) {
        this.player.damage(ball.damage);
        this.hud.flashDamage();
        this.audio.damage();
      }
    }
  }

  getLookDirection() {
    return this.camera.getWorldDirection(new THREE.Vector3());
  }

  getCameraWorldPosition() {
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  createTargetOutline() {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03));
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const outline = new THREE.LineSegments(geometry, material);
    outline.visible = false;
    return outline;
  }

  updateTargetOutline() {
    const hit = this.world.raycastBlock(this.getCameraWorldPosition(), this.getLookDirection(), BALANCE.world.interactionRange);
    if (!hit || hit.type === 'water') {
      this.targetOutline.visible = false;
      return;
    }
    this.targetOutline.visible = true;
    this.targetOutline.position.set(hit.position.x + 0.5, hit.position.y + 0.5, hit.position.z + 0.5);
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.input.dispose?.();
    this.hud.destroy?.();
    this.shop?.hide?.();
    this.dragons.dispose?.();
    this.zombies.dispose?.();
    this.world.dispose?.();
    if (this.viewmodel) {
      this.camera.remove(this.viewmodel);
      disposeViewmodel(this.viewmodel);
      this.viewmodel = null;
    }
    this.renderer.domElement.remove();
    this.renderer.dispose?.();
  }
}
