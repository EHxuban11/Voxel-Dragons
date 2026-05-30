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
import { BALANCE } from './GameBalance.js';

export class Game {
  constructor(root, options = {}) {
    this.root = root;
    this.character = options.character ?? CHARACTERS[0];
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
    this.inventory = new Inventory(this.character);
    this.world = new World(BALANCE.world);
    this.player = new Player(this.camera, BALANCE.player);
    this.player.setPosition(...this.world.getSpawnPoint().toArray());
    this.weapons = new Weapons({
      camera: this.camera,
      scene: this.scene,
      weapons: BALANCE.weapons,
      callbacks: {
        onHit: (hit) => {
          if (hit.point) this.effects.impact(hit.point, hit.weapon?.flashColor ?? 0xffd166);
          if (hit.killed) {
            this.effects.explosion(hit.point);
            this.audio.explosion();
          }
        },
        onProjectileImpact: (hit) => {
          if (hit.point) this.effects.explosion(hit.point);
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
    this.paused = false;
    this.started = false;
    this.wave = 0;
    this.meleeCooldown = 0;
    this.guardCooldown = 0;
    this.targetOutline = this.createTargetOutline();

    this.scene.add(this.world);
    this.scene.add(this.player.object);
    this.scene.add(this.targetOutline);
    this.setupScene();
    this.bindEvents();
    this.startNextWave();
  }

  startNextWave() {
    this.wave += 1;
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

    this.meleeCooldown = Math.max(0, this.meleeCooldown - delta);
    this.guardCooldown = Math.max(0, this.guardCooldown - delta);
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
      this.syncSelectedWeapon();
    }
    if (this.input.consume('weaponPrev')) {
      this.inventory.previous();
      this.syncSelectedWeapon();
    }
    for (let i = 1; i <= this.inventory.slots.length; i += 1) {
      if (this.input.consume(`weapon${i}`)) {
        this.inventory.select(i - 1);
        this.syncSelectedWeapon();
      }
    }
    if (this.input.consume('alternate')) {
      if (this.character.ability === 'guard') {
        this.activateGuard();
      } else {
        this.placeSelectedBlock();
      }
    }
    if (this.input.consume('use')) {
      this.mineTargetBlock();
    }

    this.player.update(delta, this.input, this.world);
    this.world.update(delta);
    this.dragons.update(delta, this.player, this.scene);
    this.zombies.update(delta, this.player, this.world);
    this.handleZombieEvents();

    if (this.dragons.getAliveCount() === 0 && this.zombies.getAliveCount() === 0) {
      this.startNextWave();
    }
    this.weapons.update(delta);
    this.effects.update(delta);

    const attackClicked = this.input.consume('attack');
    if (this.input.pointerLocked && this.input.isDown('Mouse0')) {
      const slot = this.inventory.selectedSlot;
      if (slot?.kind === 'weapon') {
        this.handleFire();
      } else if (slot?.kind === 'melee') {
        this.meleeAttack();
      }
    }
    if (this.input.pointerLocked && attackClicked && this.inventory.selectedSlot?.kind === 'block') {
      this.mineTargetBlock();
    }

    this.handleDragonFireballs(delta);

    if (!this.player.isAlive) {
      this.respawnPlayer();
    }

    this.updateTargetOutline();
    this.effects.applyCameraShake(this.camera);
    const selectedSlot = this.inventory.selectedSlot;
    const isMelee = selectedSlot?.kind === 'melee';
    this.hud.update({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      shield: this.player.shield,
      maxShield: this.player.maxShield,
      ammo: isMelee ? { ammo: 0, maxAmmo: 0 } : this.weapons.getAmmoState(true),
      ammoText: isMelee ? '∞' : null,
      weapon: isMelee ? selectedSlot.label : this.weapons.getCurrentWeaponName(),
      dragons: this.dragons.getAliveCount(),
      dragonsTotal: this.dragons.dragons.length,
      zombies: this.zombies.getAliveCount(),
      guard: this.player.guardActive,
      wave: this.wave,
      inventory: this.inventory.snapshot(),
      locked: this.input.pointerLocked
    });

    this.renderer.render(this.scene, this.camera);
    this.input.update();
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

  meleeAttack() {
    if (this.meleeCooldown > 0) return;
    this.meleeCooldown = BALANCE.sword.cooldown;

    const origin = this.getCameraWorldPosition();
    const direction = this.getLookDirection();
    const { damage, range, arcCos } = BALANCE.sword;

    const hits = [
      ...this.zombies.hitMelee(origin, direction, range, damage, arcCos),
      ...this.dragons.hitMelee(origin, direction, range, damage, arcCos),
    ];

    for (const hit of hits) {
      this.effects.impact(hit.position, 0xffffff);
      if (hit.killed) {
        this.effects.explosion(hit.position);
        this.audio.explosion();
      }
    }

    // White slash arc in front of the player.
    this.effects.beam(origin, origin.clone().addScaledVector(direction, range), 0xffffff);
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

  syncSelectedWeapon() {
    const slot = this.inventory.selectedSlot;
    if (slot?.kind === 'weapon') {
      this.weapons.switchWeapon(slot.weaponIndex);
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
}
