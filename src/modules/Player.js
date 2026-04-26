import * as THREE from 'three';

const DEFAULTS = {
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
};

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const MOVE = new THREE.Vector3();

function hasInput(input, names) {
  if (!input) return false;

  const keys = input.keys || input.pressed || input.down;
  for (const name of names) {
    if (input[name]) return true;
    if (keys instanceof Set && keys.has(name)) return true;
    if (keys instanceof Map && keys.get(name)) return true;
    if (keys && keys[name]) return true;
  }

  return false;
}

function readAxis(input, positiveNames, negativeNames) {
  return Number(hasInput(input, positiveNames)) - Number(hasInput(input, negativeNames));
}

function readLookDelta(input) {
  if (!input) return { x: 0, y: 0 };

  if (input.mouseDelta) {
    return {
      x: input.mouseDelta.x || 0,
      y: input.mouseDelta.y || 0,
    };
  }

  if (input.mouse) {
    return {
      x: input.mouse.dx || 0,
      y: input.mouse.dy || 0,
    };
  }

  return {
    x: input.lookX || input.mouseX || input.deltaX || 0,
    y: input.lookY || input.mouseY || input.deltaY || 0,
  };
}

function getGroundY(world, position, fallback) {
  if (!world) return fallback;
  if (typeof world.getGroundHeight === 'function') {
    return world.getGroundHeight(position.x, position.z);
  }
  if (typeof world.getFloorHeight === 'function') {
    return world.getFloorHeight(position.x, position.z);
  }
  if (Number.isFinite(world.groundY)) return world.groundY;
  if (Number.isFinite(world.floorY)) return world.floorY;
  return fallback;
}

export class Player {
  constructor(camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000), options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.camera = camera;

    this.cameraHolder = new THREE.Object3D();
    this.pitchHolder = new THREE.Object3D();
    this.cameraHolder.add(this.pitchHolder);
    this.pitchHolder.add(this.camera);

    this.camera.position.set(0, this.config.height, 0);
    this.position = this.cameraHolder.position;
    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.health = this.config.maxHealth;
    this.maxHealth = this.config.maxHealth;
    this.ammo = this.config.ammo;
    this.maxAmmo = this.config.maxAmmo;

    this.isGrounded = false;
    this.isAlive = true;
  }

  get object() {
    return this.cameraHolder;
  }

  setPosition(x, y, z) {
    this.cameraHolder.position.set(x, y, z);
    return this;
  }

  look(yawDelta, pitchDelta) {
    this.cameraHolder.rotation.y -= yawDelta * this.config.mouseSensitivity;
    this.pitchHolder.rotation.x -= pitchDelta * this.config.mouseSensitivity;
    this.pitchHolder.rotation.x = THREE.MathUtils.clamp(
      this.pitchHolder.rotation.x,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );
  }

  update(delta, input = {}, world = null) {
    if (!Number.isFinite(delta) || delta <= 0 || !this.isAlive) return;

    const lookDelta = readLookDelta(input);
    if (lookDelta.x || lookDelta.y) {
      this.look(lookDelta.x, lookDelta.y);
    }

    const xAxis = readAxis(input, ['KeyD', 'd', 'right', 'moveRight'], ['KeyA', 'a', 'left', 'moveLeft']);
    const zAxis = readAxis(input, ['KeyW', 'w', 'forward', 'moveForward'], ['KeyS', 's', 'backward', 'moveBackward']);

    FORWARD.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraHolder.rotation.y);
    RIGHT.set(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraHolder.rotation.y);
    MOVE.copy(FORWARD).multiplyScalar(zAxis).addScaledVector(RIGHT, xAxis);

    if (MOVE.lengthSq() > 0) {
      MOVE.normalize();
    }

    const sprinting = hasInput(input, ['ShiftLeft', 'ShiftRight', 'shift', 'sprint']);
    const speed = this.config.moveSpeed * (sprinting ? this.config.sprintMultiplier : 1);
    this.velocity.x = MOVE.x * speed;
    this.velocity.z = MOVE.z * speed;

    if (this.isGrounded && hasInput(input, ['Space', ' ', 'space', 'jump'])) {
      this.velocity.y = this.config.jumpSpeed;
      this.isGrounded = false;
    }

    this.velocity.y -= this.config.gravity * delta;
    this.cameraHolder.position.addScaledVector(this.velocity, delta);

    const groundY = getGroundY(world, this.cameraHolder.position, this.config.groundY);
    if (this.cameraHolder.position.y <= groundY) {
      this.cameraHolder.position.y = groundY;
      this.velocity.y = Math.max(0, this.velocity.y);
      this.isGrounded = true;
    }

    this.direction.copy(FORWARD);
  }

  damage(amount) {
    this.health = Math.max(0, this.health - Math.max(0, amount));
    this.isAlive = this.health > 0;
    return this.health;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
    this.isAlive = this.health > 0;
    return this.health;
  }

  consumeAmmo(amount = 1) {
    if (this.ammo < amount) return false;
    this.ammo -= amount;
    return true;
  }

  reload(amount = this.maxAmmo) {
    this.ammo = THREE.MathUtils.clamp(amount, 0, this.maxAmmo);
    return this.ammo;
  }
}

export default Player;
