import * as THREE from 'three';
import { World } from './World.js';
import { Player } from './Player.js';
import { Weapons } from './Weapons.js';
import { DragonManager } from './DragonManager.js';
import { Input } from './Input.js';
import { HUD } from './HUD.js';
import { Effects } from './Effects.js';
import { GameAudio } from './Audio.js';
import { Inventory } from './Inventory.js';
import { BALANCE } from './GameBalance.js';

export class Game {
  constructor(root) {
    this.root = root;
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
    this.inventory = new Inventory();
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
        }
      }
    });
    this.dragons = new DragonManager(this.scene);
    this.hud = new HUD(this.root);
    this.paused = false;
    this.started = false;
    this.targetOutline = this.createTargetOutline();

    this.scene.add(this.world);
    this.scene.add(this.player.object);
    this.scene.add(this.targetOutline);
    this.setupScene();
    this.bindEvents();
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
      this.hud.showMessage('Caza dragones activada', 1200);
    });
    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  start() {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  tick() {
    const delta = Math.min(this.clock.getDelta(), 0.05);

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
      this.placeSelectedBlock();
    }
    if (this.input.consume('use')) {
      this.mineTargetBlock();
    }

    this.player.update(delta, this.input, this.world);
    this.world.update(delta);
    this.dragons.update(delta, this.player, this.scene);
    this.weapons.update(delta);
    this.effects.update(delta);

    if (this.input.pointerLocked && this.input.isDown('Mouse0') && this.inventory.selectedSlot?.kind === 'weapon') {
      this.handleFire();
    } else if (this.input.pointerLocked && this.input.consume('attack')) {
      this.mineTargetBlock();
    }

    this.handleDragonFireballs(delta);
    this.updateTargetOutline();
    this.effects.applyCameraShake(this.camera);
    this.hud.update({
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      ammo: this.weapons.getAmmoState(true),
      weapon: this.weapons.getCurrentWeaponName(),
      dragons: this.dragons.getAliveCount(),
      dragonsTotal: this.dragons.dragons.length,
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
      dragons: this.dragons,
      effects: this.effects,
      camera: this.camera
    });
    if (fired) {
      this.audio.shoot(this.weapons.getCurrentWeaponName());
    }
  }

  syncSelectedWeapon() {
    const slot = this.inventory.selectedSlot;
    if (slot?.kind === 'weapon') {
      this.weapons.switchWeapon(slot.weaponIndex);
    }
  }

  mineTargetBlock() {
    const hit = this.world.raycastBlock(this.camera.position, this.getLookDirection(), BALANCE.world.interactionRange);
    if (!hit || hit.type === 'water') return;
    if (this.world.removeBlock(hit)) {
      this.inventory.addBlock(hit.type);
      this.effects.impact(hit.point, 0xffffff);
    }
  }

  placeSelectedBlock() {
    if (!this.inventory.canPlaceSelected()) return;
    const hit = this.world.raycastBlock(this.camera.position, this.getLookDirection(), BALANCE.world.interactionRange);
    if (!hit) return;
    const type = this.inventory.selectedSlot.type;
    if (this.world.addBlock(hit, type)) {
      this.inventory.consumeSelectedBlock();
      this.effects.impact(hit.point, this.inventory.selectedSlot.color);
    }
  }

  handleDragonFireballs() {
    for (const ball of this.dragons.consumeImpacts()) {
      this.effects.explosion(ball.position);
      this.audio.explosion();
      if (ball.position.distanceTo(this.player.object.position) < 5) {
        this.player.damage(ball.damage);
        this.hud.flashDamage();
        this.audio.damage();
      }
    }
  }

  getLookDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
  }

  createTargetOutline() {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03));
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const outline = new THREE.LineSegments(geometry, material);
    outline.visible = false;
    return outline;
  }

  updateTargetOutline() {
    const hit = this.world.raycastBlock(this.camera.position, this.getLookDirection(), BALANCE.world.interactionRange);
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
