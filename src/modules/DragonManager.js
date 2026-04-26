import * as THREE from 'three';

const DEFAULT_DRAGON_COUNT = 3;
const FIREBALL_COLLISION_RADIUS = 1.15;

function lerpAngle(from, to, alpha) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * THREE.MathUtils.clamp(alpha, 0, 1);
}

function getWorldPosition(target, fallback = new THREE.Vector3()) {
  if (!target) return fallback.set(0, 0, 0);
  if (target.isVector3) return fallback.copy(target);
  if (target.position?.isVector3) return fallback.copy(target.position);
  if (target.object?.position?.isVector3) return fallback.copy(target.object.position);
  if (typeof target.x === 'number' && typeof target.y === 'number' && typeof target.z === 'number') {
    return fallback.set(target.x, target.y, target.z);
  }
  return fallback.set(0, 0, 0);
}

export class DragonManager {
  constructor(sceneOrOptions = null, maybeOptions = {}) {
    const scene = sceneOrOptions?.isScene ? sceneOrOptions : null;
    const options = scene ? maybeOptions : sceneOrOptions || {};

    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'DragonManager';
    this.dragons = [];
    this.fireballs = [];
    this.impacts = [];
    this.tmpPlayerPosition = new THREE.Vector3();
    this.tmpTarget = new THREE.Vector3();
    this.tmpDirection = new THREE.Vector3();
    this.tmpPreviousPosition = new THREE.Vector3();
    this.tmpRaycaster = new THREE.Raycaster();
    this.elapsed = 0;

    this.count = options.count ?? DEFAULT_DRAGON_COUNT;
    this.origin = options.origin?.isVector3 ? options.origin.clone() : new THREE.Vector3(0, 0, 0);
    this.spawnRadius = options.spawnRadius ?? 34;
    this.minAltitude = options.minAltitude ?? 13;
    this.maxAltitude = options.maxAltitude ?? 22;
    this.fireballDamage = options.fireballDamage ?? 14;
    this.fireballSpeed = options.fireballSpeed ?? 24;

    this.createSharedAssets();
    this.spawnDragons(this.count);

    if (this.scene) {
      this.scene.add(this.group);
    }
  }

  createSharedAssets() {
    this.geometry = {
      body: new THREE.BoxGeometry(3.4, 1.25, 1.45),
      belly: new THREE.BoxGeometry(2.2, 0.35, 0.95),
      head: new THREE.BoxGeometry(1.25, 0.9, 0.9),
      neck: new THREE.BoxGeometry(1.1, 0.65, 0.75),
      tail: new THREE.ConeGeometry(0.5, 2.8, 4),
      wing: new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-4.2, 0.18, -0.35),
        new THREE.Vector3(-1.15, 0.05, -2.75),
      ]),
      horn: new THREE.ConeGeometry(0.14, 0.55, 4),
      fireball: new THREE.SphereGeometry(0.42, 8, 6),
    };
    this.geometry.wing.setIndex([0, 1, 2]);
    this.geometry.wing.computeVertexNormals();

    this.material = {
      body: new THREE.MeshStandardMaterial({ color: 0x3e6f45, roughness: 0.85, flatShading: true }),
      belly: new THREE.MeshStandardMaterial({ color: 0x8aa36a, roughness: 0.9, flatShading: true }),
      wing: new THREE.MeshStandardMaterial({
        color: 0x2d5538,
        roughness: 0.9,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
      horn: new THREE.MeshStandardMaterial({ color: 0xd8d0a8, roughness: 0.7, flatShading: true }),
      fireball: new THREE.MeshStandardMaterial({
        color: 0xff6b1a,
        emissive: 0xff3400,
        emissiveIntensity: 1.35,
        roughness: 0.55,
        flatShading: true,
      }),
    };
  }

  spawnDragons(count = DEFAULT_DRAGON_COUNT) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const altitude = THREE.MathUtils.lerp(this.minAltitude, this.maxAltitude, i / Math.max(1, count - 1));
      const dragon = {
        id: i,
        health: 100,
        maxHealth: 100,
        aggression: 0.58 + i * 0.13,
        angle,
        altitude,
        radius: this.spawnRadius + i * 5,
        speed: 0.24 + i * 0.035,
        attackCooldown: 1.5 + i * 0.55,
        mesh: this.createDragonMesh(i),
        velocity: new THREE.Vector3(),
        dead: false,
      };

      dragon.mesh.position.set(
        this.origin.x + Math.cos(angle) * dragon.radius,
        altitude,
        this.origin.z + Math.sin(angle) * dragon.radius,
      );
      dragon.mesh.userData.dragon = dragon;
      this.group.add(dragon.mesh);
      this.dragons.push(dragon);
    }
  }

  createDragonMesh(index) {
    const dragon = new THREE.Group();
    dragon.name = `LowPolyDragon_${index}`;

    const body = new THREE.Mesh(this.geometry.body, this.material.body);
    body.castShadow = true;
    body.receiveShadow = true;
    dragon.add(body);

    const belly = new THREE.Mesh(this.geometry.belly, this.material.belly);
    belly.position.set(0.15, -0.55, 0);
    dragon.add(belly);

    const neck = new THREE.Mesh(this.geometry.neck, this.material.body);
    neck.position.set(2, 0.35, 0);
    neck.rotation.z = -0.25;
    dragon.add(neck);

    const head = new THREE.Mesh(this.geometry.head, this.material.body);
    head.position.set(2.9, 0.55, 0);
    head.castShadow = true;
    dragon.add(head);

    const tail = new THREE.Mesh(this.geometry.tail, this.material.body);
    tail.position.set(-2.45, 0.15, 0);
    tail.rotation.z = Math.PI / 2;
    dragon.add(tail);

    const leftWing = new THREE.Mesh(this.geometry.wing, this.material.wing);
    leftWing.name = 'leftWing';
    leftWing.position.set(0.15, 0.35, 0.75);
    dragon.add(leftWing);

    const rightWing = new THREE.Mesh(this.geometry.wing, this.material.wing);
    rightWing.name = 'rightWing';
    rightWing.position.set(0.15, 0.35, -0.75);
    rightWing.scale.z = -1;
    dragon.add(rightWing);

    for (const z of [-0.28, 0.28]) {
      const horn = new THREE.Mesh(this.geometry.horn, this.material.horn);
      horn.position.set(3.35, 1.05, z);
      horn.rotation.z = -Math.PI / 2.8;
      dragon.add(horn);
    }

    dragon.traverse((child) => {
      if (child.isMesh) {
        child.userData.dragonRoot = dragon;
      }
    });

    return dragon;
  }

  update(delta, player = null, scene = null) {
    if (scene && !this.scene) {
      this.scene = scene;
      this.scene.add(this.group);
    }

    const dt = Math.min(delta || 0, 0.08);
    this.elapsed += dt;
    const playerPosition = getWorldPosition(player, this.tmpPlayerPosition);

    for (const dragon of this.dragons) {
      if (dragon.dead) continue;
      this.updateDragon(dragon, dt, playerPosition);
      this.tryFireball(dragon, dt, player, playerPosition);
    }

    this.updateFireballs(dt, player, playerPosition);
  }

  updateDragon(dragon, delta, playerPosition) {
    dragon.angle += dragon.speed * delta;
    const pressure = dragon.aggression * 0.35;
    const orbitCenter = playerPosition.lengthSq() > 0.001 ? playerPosition : this.origin;
    const radius = dragon.radius * (1 - pressure);
    const bob = Math.sin(this.elapsed * 2.5 + dragon.id * 1.7) * 1.6;

    this.tmpTarget.set(
      orbitCenter.x + Math.cos(dragon.angle) * radius,
      dragon.altitude + bob,
      orbitCenter.z + Math.sin(dragon.angle) * radius,
    );

    this.tmpPreviousPosition.copy(dragon.mesh.position);
    dragon.mesh.position.lerp(this.tmpTarget, Math.min(1, delta * (0.75 + dragon.aggression)));
    dragon.velocity.subVectors(dragon.mesh.position, this.tmpPreviousPosition);

    if (dragon.velocity.lengthSq() > 0.0001) {
      const heading = Math.atan2(dragon.velocity.x, dragon.velocity.z);
      dragon.mesh.rotation.y = lerpAngle(dragon.mesh.rotation.y, heading, delta * 4);
      dragon.mesh.rotation.z = THREE.MathUtils.clamp(-dragon.velocity.y * 0.18, -0.35, 0.35);
    }

    const flap = Math.sin(this.elapsed * 12 + dragon.id) * 0.55;
    const leftWing = dragon.mesh.getObjectByName('leftWing');
    const rightWing = dragon.mesh.getObjectByName('rightWing');
    if (leftWing && rightWing) {
      leftWing.rotation.x = flap;
      rightWing.rotation.x = -flap;
    }
  }

  tryFireball(dragon, delta, player, playerPosition) {
    if (!player) return;

    dragon.attackCooldown -= delta;
    const distanceToPlayer = dragon.mesh.position.distanceTo(playerPosition);
    const attackRange = 52 * dragon.aggression;
    if (dragon.attackCooldown > 0 || distanceToPlayer > attackRange) return;

    this.tmpDirection.subVectors(playerPosition, dragon.mesh.position).normalize();
    if (this.tmpDirection.lengthSq() === 0) return;

    const fireball = new THREE.Mesh(this.geometry.fireball, this.material.fireball);
    fireball.name = 'DragonFireball';
    fireball.position.copy(dragon.mesh.position).addScaledVector(this.tmpDirection, 2.9);
    fireball.userData.velocity = this.tmpDirection.clone().multiplyScalar(this.fireballSpeed);
    fireball.userData.life = 3.25;
    fireball.userData.damage = this.fireballDamage;
    fireball.userData.owner = dragon;
    this.group.add(fireball);
    this.fireballs.push(fireball);

    dragon.attackCooldown = THREE.MathUtils.lerp(3.2, 1.35, dragon.aggression);
  }

  updateFireballs(delta, player, playerPosition) {
    for (let i = this.fireballs.length - 1; i >= 0; i -= 1) {
      const fireball = this.fireballs[i];
      fireball.userData.life -= delta;
      fireball.position.addScaledVector(fireball.userData.velocity, delta);
      fireball.rotation.x += delta * 8;
      fireball.rotation.y += delta * 5;

      const hitPlayer = Boolean(player) && fireball.position.distanceTo(playerPosition) <= FIREBALL_COLLISION_RADIUS;
      const expired = fireball.userData.life <= 0 || fireball.position.y < -2;
      if (hitPlayer || expired) {
        this.impacts.push({
          position: fireball.position.clone(),
          damage: fireball.userData.damage,
          hitPlayer,
        });
        this.group.remove(fireball);
        this.fireballs.splice(i, 1);
      }
    }
  }

  hitByRay(ray, damage = 25) {
    if (!ray) return null;

    const isRaycaster = typeof ray.intersectObjects === 'function' && ray.ray;
    const raycaster = isRaycaster ? ray : this.tmpRaycaster;
    if (!isRaycaster) {
      if (ray.origin && ray.direction) {
        raycaster.ray.copy(ray);
      } else {
        return null;
      }
      raycaster.near = 0;
      raycaster.far = Infinity;
    }

    const meshes = [];
    for (const dragon of this.dragons) {
      if (!dragon.dead) {
        dragon.mesh.traverse((child) => {
          if (child.isMesh) meshes.push(child);
        });
      }
    }

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    const root = hits[0].object.userData.dragonRoot;
    const dragon = this.dragons.find((candidate) => candidate.mesh === root);
    if (!dragon) return null;

    dragon.health = Math.max(0, dragon.health - damage);
    if (dragon.health <= 0) {
      this.killDragon(dragon);
    }

    return {
      dragon,
      point: hits[0].point.clone(),
      distance: hits[0].distance,
      killed: dragon.dead,
      health: dragon.health,
    };
  }

  killDragon(dragon) {
    dragon.dead = true;
    dragon.mesh.visible = false;
    this.group.remove(dragon.mesh);
  }

  getAliveDragons() {
    return this.dragons.filter((dragon) => !dragon.dead);
  }

  getAliveCount() {
    return this.getAliveDragons().length;
  }

  consumeImpacts() {
    const impacts = this.impacts;
    this.impacts = [];
    return impacts;
  }

  dispose() {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    for (const fireball of this.fireballs) {
      this.group.remove(fireball);
    }
    this.fireballs.length = 0;
    this.impacts.length = 0;
    this.dragons.length = 0;

    for (const geometry of Object.values(this.geometry)) {
      geometry.dispose();
    }
    for (const material of Object.values(this.material)) {
      material.dispose();
    }
  }
}

export default DragonManager;
