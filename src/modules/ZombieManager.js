import * as THREE from 'three';

const DEFAULT_BOUNDS = { minX: -22, maxX: 22, minZ: -22, maxZ: 22 };

function getWorldPosition(target, fallback = new THREE.Vector3()) {
  if (!target) return fallback.set(0, 0, 0);
  if (target.isVector3) return fallback.copy(target);
  if (target.object?.position?.isVector3) return fallback.copy(target.object.position);
  if (target.position?.isVector3) return fallback.copy(target.position);
  return fallback.set(0, 0, 0);
}

function groundHeight(world, x, z, fallback = 0) {
  if (typeof world?.getGroundHeight === 'function') {
    return world.getGroundHeight(x, z);
  }
  return fallback;
}

export class ZombieManager {
  constructor(scene = null, options = {}) {
    this.scene = scene?.isScene ? scene : null;
    this.group = new THREE.Group();
    this.group.name = 'ZombieManager';
    this.zombies = [];
    this.events = [];
    this.elapsed = 0;

    this.bounds = { ...DEFAULT_BOUNDS, ...(options.bounds ?? {}) };
    this.health = options.health ?? 30;
    this.speed = options.speed ?? 3.4;
    this.damage = options.damage ?? 8;
    this.attackRange = options.attackRange ?? 2.3;
    this.attackCooldown = options.attackCooldown ?? 1.1;
    this.spawnRadiusMin = options.spawnRadiusMin ?? 14;
    this.spawnRadiusMax = options.spawnRadiusMax ?? 24;

    this.tmpPlayer = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();
    this.tmpRaycaster = new THREE.Raycaster();

    this.geometry = {
      body: new THREE.BoxGeometry(0.8, 1.3, 0.5),
      head: new THREE.BoxGeometry(0.6, 0.6, 0.6),
      arm: new THREE.BoxGeometry(0.22, 0.9, 0.22),
    };
    this.material = {
      body: new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 0.95, flatShading: true }),
      head: new THREE.MeshStandardMaterial({ color: 0x6fae54, roughness: 0.95, flatShading: true }),
    };

    if (this.scene) this.scene.add(this.group);
  }

  createZombieMesh(index) {
    const zombie = new THREE.Group();
    zombie.name = `Zombie_${index}`;

    const body = new THREE.Mesh(this.geometry.body, this.material.body);
    body.position.y = 0.65;
    body.castShadow = true;
    zombie.add(body);

    const head = new THREE.Mesh(this.geometry.head, this.material.head);
    head.position.y = 1.6;
    head.castShadow = true;
    zombie.add(head);

    // Outstretched arms so it reads as a zombie shambling forward.
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(this.geometry.arm, this.material.body);
      arm.position.set(side * 0.5, 0.95, 0.35);
      arm.rotation.x = -Math.PI / 2.2;
      zombie.add(arm);
    }

    zombie.traverse((child) => {
      if (child.isMesh) child.userData.zombieRoot = zombie;
    });

    return zombie;
  }

  spawnWave(count, player, world) {
    this.clearZombies();
    const center = getWorldPosition(player, this.tmpPlayer);

    for (let i = 0; i < count; i += 1) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + (i * 1.7);
      const radius = THREE.MathUtils.lerp(this.spawnRadiusMin, this.spawnRadiusMax, (i % 3) / 2);
      const x = THREE.MathUtils.clamp(center.x + Math.cos(angle) * radius, this.bounds.minX, this.bounds.maxX);
      const z = THREE.MathUtils.clamp(center.z + Math.sin(angle) * radius, this.bounds.minZ, this.bounds.maxZ);

      const zombie = {
        id: i,
        health: this.health,
        maxHealth: this.health,
        speed: this.speed * (0.85 + (i % 4) * 0.08),
        damage: this.damage,
        attackTimer: 0.6 + (i % 5) * 0.15,
        mesh: this.createZombieMesh(i),
        dead: false,
      };
      zombie.mesh.position.set(x, groundHeight(world, x, z), z);
      zombie.mesh.userData.zombie = zombie;
      this.group.add(zombie.mesh);
      this.zombies.push(zombie);
    }
  }

  update(delta, player, world) {
    const dt = Math.min(delta || 0, 0.08);
    this.elapsed += dt;
    const playerPos = getWorldPosition(player, this.tmpPlayer);
    const guardActive = Boolean(player?.guardActive);

    for (const zombie of this.zombies) {
      if (zombie.dead) continue;

      this.tmpDir.set(playerPos.x - zombie.mesh.position.x, 0, playerPos.z - zombie.mesh.position.z);
      const distance = this.tmpDir.length();

      if (distance > 0.0001) {
        this.tmpDir.normalize();
        zombie.mesh.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
      }

      if (distance > this.attackRange) {
        zombie.mesh.position.x += this.tmpDir.x * zombie.speed * dt;
        zombie.mesh.position.z += this.tmpDir.z * zombie.speed * dt;
      }

      zombie.mesh.position.x = THREE.MathUtils.clamp(zombie.mesh.position.x, this.bounds.minX, this.bounds.maxX);
      zombie.mesh.position.z = THREE.MathUtils.clamp(zombie.mesh.position.z, this.bounds.minZ, this.bounds.maxZ);
      zombie.mesh.position.y = groundHeight(world, zombie.mesh.position.x, zombie.mesh.position.z);

      // shamble bob
      zombie.mesh.children[0].rotation.z = Math.sin(this.elapsed * 6 + zombie.id) * 0.08;

      zombie.attackTimer -= dt;
      if (distance <= this.attackRange && zombie.attackTimer <= 0) {
        if (guardActive) {
          // Parried: the zombie dies on the player's guard.
          this.killZombie(zombie);
          this.events.push({ type: 'parry', position: zombie.mesh.position.clone() });
        } else {
          this.events.push({ type: 'attack', position: zombie.mesh.position.clone(), damage: zombie.damage });
        }
        zombie.attackTimer = this.attackCooldown;
      }
    }
  }

  // --- ranged hit support (guns) -------------------------------------------
  peekRay(ray) {
    const isRaycaster = typeof ray?.intersectObjects === 'function' && ray.ray;
    const raycaster = isRaycaster ? ray : this.tmpRaycaster;
    if (!isRaycaster) {
      if (ray?.origin && ray?.direction) {
        raycaster.ray.copy(ray);
        raycaster.near = 0;
        raycaster.far = Infinity;
      } else {
        return null;
      }
    }

    const meshes = [];
    for (const zombie of this.zombies) {
      if (!zombie.dead) zombie.mesh.traverse((child) => { if (child.isMesh) meshes.push(child); });
    }

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    const root = hits[0].object.userData.zombieRoot;
    const zombie = this.zombies.find((candidate) => candidate.mesh === root);
    if (!zombie || zombie.dead) return null;
    return { zombie, point: hits[0].point.clone(), distance: hits[0].distance };
  }

  applyRayHit(peek, damage) {
    const zombie = peek.zombie;
    zombie.health = Math.max(0, zombie.health - damage);
    if (zombie.health <= 0) this.killZombie(zombie);
    return {
      dragon: null,
      zombie,
      point: peek.point,
      distance: peek.distance,
      killed: zombie.dead,
      health: zombie.health,
    };
  }

  hitByRay(ray, damage = 25) {
    const peek = this.peekRay(ray);
    return peek ? this.applyRayHit(peek, damage) : null;
  }

  hitAllByRay(ray, damage = 25) {
    const isRaycaster = typeof ray?.intersectObjects === 'function' && ray.ray;
    const raycaster = isRaycaster ? ray : this.tmpRaycaster;
    if (!isRaycaster) {
      if (ray?.origin && ray?.direction) {
        raycaster.ray.copy(ray);
        raycaster.near = 0;
        raycaster.far = Infinity;
      } else {
        return [];
      }
    }

    const meshes = [];
    for (const zombie of this.zombies) {
      if (!zombie.dead) zombie.mesh.traverse((child) => { if (child.isMesh) meshes.push(child); });
    }

    const hits = raycaster.intersectObjects(meshes, false);
    const results = [];
    const seen = new Set();
    for (const intersection of hits) {
      const root = intersection.object.userData.zombieRoot;
      const zombie = this.zombies.find((candidate) => candidate.mesh === root);
      if (!zombie || zombie.dead || seen.has(zombie.id)) continue;
      seen.add(zombie.id);
      zombie.health = Math.max(0, zombie.health - damage);
      if (zombie.health <= 0) this.killZombie(zombie);
      results.push({ dragon: null, zombie, point: intersection.point.clone(), distance: intersection.distance, killed: zombie.dead, health: zombie.health });
    }
    return results;
  }

  // --- melee hit support (sword) -------------------------------------------
  hitMelee(origin, direction, range, damage, arcCos = 0.3) {
    const results = [];
    for (const zombie of this.zombies) {
      if (zombie.dead) continue;
      this.tmpDir.subVectors(zombie.mesh.position, origin);
      const distance = this.tmpDir.length();
      if (distance > range || distance < 0.0001) continue;
      this.tmpDir.normalize();
      if (this.tmpDir.dot(direction) < arcCos) continue;
      zombie.health = Math.max(0, zombie.health - damage);
      const killed = zombie.health <= 0;
      if (killed) this.killZombie(zombie);
      results.push({ position: zombie.mesh.position.clone(), killed });
    }
    return results;
  }

  killZombie(zombie) {
    zombie.dead = true;
    zombie.mesh.visible = false;
    this.group.remove(zombie.mesh);
  }

  clearZombies() {
    for (const zombie of this.zombies) {
      this.group.remove(zombie.mesh);
    }
    this.zombies.length = 0;
  }

  getAliveCount() {
    let count = 0;
    for (const zombie of this.zombies) if (!zombie.dead) count += 1;
    return count;
  }

  consumeEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.clearZombies();
    for (const geometry of Object.values(this.geometry)) geometry.dispose();
    for (const material of Object.values(this.material)) material.dispose();
  }
}

export default ZombieManager;
