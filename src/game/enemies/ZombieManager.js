import * as THREE from 'three';
import { moveHorizontal, easeToGround, steerToward } from '../../engine/Collision.js';

const DEFAULT_BOUNDS = { minX: -22, maxX: 22, minZ: -22, maxZ: 22 };
const ENEMY_RADIUS = 0.4;  // body half-width for wall collision
const ENEMY_HEIGHT = 2;    // ground mobs are 2 blocks tall

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

// Ground monsters all stand exactly this many blocks tall. Scaling the whole
// model uniformly (from the feet at y=0) guarantees the height without shearing
// the rotated limbs that a non-uniform scale would distort.
const MOB_HEIGHT = 2;
function fitToHeight(group, target = MOB_HEIGHT) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const height = box.max.y - box.min.y;
  if (height > 0.0001) group.scale.setScalar(target / height);
}

export class ZombieManager {
  constructor(scene = null, options = {}) {
    this.scene = scene?.isScene ? scene : null;
    this.camera = options.camera ?? null;
    this.group = new THREE.Group();
    this.group.name = 'ZombieManager';
    this.zombies = [];
    this.events = [];
    this.elapsed = 0;

    // Training-ground damage dummy.
    this.dummy = null;
    this.dummyLabel = null;
    this.dummyTimer = 0;
    this._lastDummyValue = -1;
    this.tmpQuaternion = new THREE.Quaternion();

    this.bounds = { ...DEFAULT_BOUNDS, ...(options.bounds ?? {}) };
    this.health = options.health ?? 30;
    this.speed = options.speed ?? 3.4;
    this.headshotDamageMult = options.headshotDamageMult ?? 1; // >1 in campaign
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
    head.userData.isHead = true; // headshot hitbox
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

    fitToHeight(zombie);
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

  spawnTrainingGround(player, world) {
    this.clearZombies();
    const center = getWorldPosition(player, this.tmpPlayer);
    const yaw = player?.cameraHolder?.rotation?.y ?? 0;
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    const rows = 3;
    const perRow = 9;
    const lateral = 1.8;
    const rowGap = 4; // 4 blocks between rows
    const startDist = 6;

    let id = 0;
    for (let r = 0; r < rows; r += 1) {
      const dist = startDist + r * rowGap;
      for (let i = 0; i < perRow; i += 1) {
        const off = (i - (perRow - 1) / 2) * lateral;
        const x = center.x + forwardX * dist + rightX * off;
        const z = center.z + forwardZ * dist + rightZ * off;
        this._spawnStaticZombie(id, x, z, yaw, world, false);
        id += 1;
      }
    }

    // Invincible damage dummy, set apart to the side.
    const dummyX = center.x + forwardX * 8 + rightX * 13;
    const dummyZ = center.z + forwardZ * 8 + rightZ * 13;
    this.dummy = this._spawnStaticZombie(id, dummyX, dummyZ, yaw, world, true);
    this.dummyTimer = 0;
    this._lastDummyValue = -1;
    this.dummyLabel = this._createDummyLabel();

    // A live zombie that attacks but never moves, set just in front of you.
    const rootedX = center.x + forwardX * 4;
    const rootedZ = center.z + forwardZ * 4;
    this._spawnRootedZombie(id + 1, rootedX, rootedZ, yaw, world);
  }

  _spawnStaticZombie(id, x, z, yaw, world, isDummy) {
    const cx = THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX);
    const cz = THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ);
    const gy = groundHeight(world, cx, cz);
    const zombie = {
      id,
      health: isDummy ? Infinity : this.health,
      maxHealth: isDummy ? Infinity : this.health,
      speed: 0,
      damage: 0,
      attackTimer: Infinity,
      static: true,
      dummy: isDummy,
      training: !isDummy, // rows reset to their spot / respawn; the dummy doesn't
      home: { x: cx, y: gy, z: cz },
      homeYaw: yaw + Math.PI,
      idleTimer: 0,
      damageAccum: 0,
      mesh: this.createZombieMesh(id),
      dead: false,
    };
    zombie.mesh.position.set(cx, gy, cz);
    zombie.mesh.rotation.y = yaw + Math.PI; // face the player
    zombie.mesh.userData.zombie = zombie;

    if (isDummy) {
      // Tint it gold so it reads as the special meter dummy.
      zombie.mesh.traverse((child) => {
        if (child.isMesh) {
          child.material = child.material.clone();
          child.material.color.setHex(0xd9b44a);
        }
      });
    }

    this.group.add(zombie.mesh);
    this.zombies.push(zombie);
    return zombie;
  }

  // A hostile zombie that faces the player and attacks when in range, but never
  // moves from its spot (red-tinted so it reads as the live target).
  _spawnRootedZombie(id, x, z, yaw, world) {
    const cx = THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX);
    const cz = THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ);
    const gy = groundHeight(world, cx, cz);
    const zombie = {
      id,
      health: this.health,
      maxHealth: this.health,
      speed: 0,
      damage: this.damage,
      attackTimer: 0.6,
      rooted: true,
      training: true,
      home: { x: cx, y: gy, z: cz },
      homeYaw: yaw + Math.PI,
      idleTimer: 0,
      dead: false,
      mesh: this.createZombieMesh(id),
    };
    zombie.mesh.position.set(cx, gy, cz);
    zombie.mesh.rotation.y = yaw + Math.PI;
    zombie.mesh.userData.zombie = zombie;
    zombie.mesh.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.color.setHex(0xb33636);
      }
    });
    this.group.add(zombie.mesh);
    this.zombies.push(zombie);
    return zombie;
  }

  // Sends a training target back to its spawn at full health (used both when its
  // 7s idle timer elapses and after it "dies").
  _respawnTraining(zombie) {
    zombie.health = zombie.maxHealth;
    zombie.dead = false;
    zombie.respawnTimer = null;
    zombie.idleTimer = 0;
    if (zombie.home) zombie.mesh.position.set(zombie.home.x, zombie.home.y, zombie.home.z);
    if (zombie.homeYaw != null) zombie.mesh.rotation.y = zombie.homeYaw;
    zombie.mesh.visible = true;
    if (!zombie.mesh.parent) this.group.add(zombie.mesh);
  }

  _createDummyLabel() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), material);
    mesh.renderOrder = 1001;
    mesh.frustumCulled = false;
    mesh.userData.canvas = canvas;
    mesh.userData.texture = texture;
    this.group.add(mesh);
    return mesh;
  }

  _drawDummyLabel(value) {
    const canvas = this.dummyLabel.userData.canvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(8, 12, 16, 0.6)';
    ctx.fillRect(8, 8, 240, 112);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('Daño (10s)', 128, 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px Arial';
    ctx.fillText(String(Math.round(value)), 128, 88);
    this.dummyLabel.userData.texture.needsUpdate = true;
  }

  _updateDummy(dt) {
    if (!this.dummy || this.dummy.dead || !this.dummyLabel) return;

    this.dummyTimer += dt;
    if (this.dummyTimer >= 10) {
      this.dummyTimer = 0;
      this.dummy.damageAccum = 0; // reset every 10 seconds
    }

    if (this.dummy.damageAccum !== this._lastDummyValue) {
      this._drawDummyLabel(this.dummy.damageAccum);
      this._lastDummyValue = this.dummy.damageAccum;
    }

    this.dummyLabel.position.copy(this.dummy.mesh.position);
    this.dummyLabel.position.y += 3.6;
    if (this.camera) {
      this.camera.getWorldQuaternion(this.tmpQuaternion);
      this.dummyLabel.quaternion.copy(this.tmpQuaternion);
    }
  }

  update(delta, player, world) {
    const dt = Math.min(delta || 0, 0.08);
    this.elapsed += dt;
    const playerPos = getWorldPosition(player, this.tmpPlayer);
    const guardActive = Boolean(player?.guardActive);

    for (const zombie of this.zombies) {
      if (zombie.dead) {
        // Training targets reappear at their spawn a couple of seconds after dying.
        if (zombie.training && zombie.respawnTimer != null) {
          zombie.respawnTimer -= dt;
          if (zombie.respawnTimer <= 0) this._respawnTraining(zombie);
        }
        continue;
      }

      // Training targets snap back to their spawn after 7s without being hit.
      if (zombie.training) {
        zombie.idleTimer = (zombie.idleTimer ?? 0) + dt;
        if (zombie.idleTimer >= 7) this._respawnTraining(zombie);
      }

      // Slow (mage blizzard): reduce speed and keep the frozen tint.
      let speedFactor = 1;
      if (zombie.slowTimer > 0) {
        zombie.slowTimer -= dt;
        speedFactor = zombie.slowFactor ?? 1;
        if (zombie.slowTimer <= 0) this._clearSlowTint(zombie);
      }

      // Lifted by the fire tornado: the tornado controls the position this frame.
      if (zombie.liftTimer > 0) {
        zombie.liftTimer -= dt;
        continue;
      }

      if (zombie.static) continue; // training dummies never move or attack

      this.tmpDir.set(playerPos.x - zombie.mesh.position.x, 0, playerPos.z - zombie.mesh.position.z);
      const distance = this.tmpDir.length();

      if (distance > 0.0001) {
        this.tmpDir.normalize();
        zombie.mesh.rotation.y = Math.atan2(this.tmpDir.x, this.tmpDir.z);
      }

      if (!zombie.rooted && distance > this.attackRange) {
        const speed = zombie.speed * speedFactor * dt;
        const avoidWater = (cx, cz) => world?.isWaterColumn?.(cx, cz);
        // Simple AI: if the straight line to the player is blocked, steer toward a
        // nearby walkable heading so the zombie goes around obstacles (and water).
        const dir = steerToward(world, zombie.mesh.position, this.tmpDir, ENEMY_RADIUS, ENEMY_HEIGHT, 1.1, avoidWater);
        moveHorizontal(world, zombie.mesh.position, dir.x * speed, dir.z * speed, ENEMY_RADIUS, ENEMY_HEIGHT, 1.1, avoidWater);
        zombie.mesh.position.x = THREE.MathUtils.clamp(zombie.mesh.position.x, this.bounds.minX, this.bounds.maxX);
        zombie.mesh.position.z = THREE.MathUtils.clamp(zombie.mesh.position.z, this.bounds.minZ, this.bounds.maxZ);
        // Face where it's actually heading (around the obstacle), not just the player.
        if (dir !== this.tmpDir) zombie.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      }

      // Smooth height change (stair-step) instead of snapping to the ground.
      easeToGround(zombie.mesh.position, groundHeight(world, zombie.mesh.position.x, zombie.mesh.position.z), dt);

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

    this._updateDummy(dt);
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
    return { zombie, point: hits[0].point.clone(), distance: hits[0].distance, head: Boolean(hits[0].object.userData.isHead) };
  }

  // Applies damage. The invincible training dummy just tallies the damage.
  damageZombie(zombie, amount) {
    if (zombie.dummy) {
      zombie.damageAccum = (zombie.damageAccum || 0) + amount;
      return false;
    }
    zombie.idleTimer = 0; // any hit restarts the training auto-return timer
    zombie.health = Math.max(0, zombie.health - amount);
    if (zombie.health <= 0) {
      if (zombie.training) {
        // Training targets don't truly die: hide, then respawn at their spot.
        zombie.dead = true;
        zombie.mesh.visible = false;
        zombie.respawnTimer = 2;
        return true;
      }
      this.killZombie(zombie);
      return true;
    }
    return false;
  }

  applyRayHit(peek, damage) {
    const zombie = peek.zombie;
    const dmg = peek.head ? damage * this.headshotDamageMult : damage;
    const killed = this.damageZombie(zombie, dmg);
    return {
      dragon: null,
      zombie,
      point: peek.point,
      distance: peek.distance,
      killed,
      health: zombie.health,
      headshot: Boolean(peek.head),
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
      const head = Boolean(intersection.object.userData.isHead);
      const killed = this.damageZombie(zombie, head ? damage * this.headshotDamageMult : damage);
      results.push({ dragon: null, zombie, point: intersection.point.clone(), distance: intersection.distance, killed, health: zombie.health, headshot: head });
    }
    return results;
  }

  // --- status effects (mage) -----------------------------------------------
  slow(center, radius, factor, duration) {
    for (const zombie of this.zombies) {
      if (zombie.dead) continue;
      const dx = zombie.mesh.position.x - center.x;
      const dz = zombie.mesh.position.z - center.z;
      if (Math.hypot(dx, dz) > radius) continue;
      zombie.slowTimer = duration;
      zombie.slowFactor = factor;
      this._applySlowTint(zombie);
    }
  }

  _applySlowTint(zombie) {
    zombie.mesh.traverse((child) => {
      if (!child.isMesh) return;
      if (!child.userData.baseMat) child.userData.baseMat = child.material;
      if (!child.userData.iceMat) {
        child.userData.iceMat = child.userData.baseMat.clone();
        child.userData.iceMat.color = child.userData.baseMat.color.clone().lerp(new THREE.Color(0x8fd3ff), 0.7);
        child.userData.iceMat.emissive = new THREE.Color(0x2a6bdf);
        child.userData.iceMat.emissiveIntensity = 0.6;
      }
      child.material = child.userData.iceMat;
    });
  }

  _clearSlowTint(zombie) {
    zombie.slowTimer = 0;
    zombie.mesh.traverse((child) => {
      if (child.isMesh && child.userData.baseMat) child.material = child.userData.baseMat;
    });
  }

  // Fire tornado: pull zombies in, lift and spin them while damaging over time.
  tornadoPull(center, radius, elapsed) {
    const lifted = [];
    for (const zombie of this.zombies) {
      if (zombie.dead || zombie.static) continue;
      const dx = center.x - zombie.mesh.position.x;
      const dz = center.z - zombie.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius) continue;
      zombie.liftTimer = 0.2; // keep it controlled by the tornado
      const angle = elapsed * 6 + zombie.id;
      const orbit = Math.min(dist, radius * 0.5);
      zombie.mesh.position.x = center.x + Math.cos(angle) * orbit;
      zombie.mesh.position.z = center.z + Math.sin(angle) * orbit;
      zombie.mesh.position.y = center.y + 1.5 + (Math.sin(elapsed * 3 + zombie.id) * 0.5 + 1) * 2.5;
      zombie.mesh.rotation.y = angle;
      lifted.push(zombie);
    }
    return lifted;
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
      const killed = this.damageZombie(zombie, damage);
      results.push({ position: zombie.mesh.position.clone(), killed });
    }
    return results;
  }

  hitBox(origin, forward, right, length, halfWidth, damage) {
    const results = [];
    const v = new THREE.Vector3();
    for (const zombie of this.zombies) {
      if (zombie.dead) continue;
      v.subVectors(zombie.mesh.position, origin);
      const f = v.dot(forward);
      const lateral = Math.abs(v.dot(right));
      if (f < -1 || f > length || lateral > halfWidth || Math.abs(v.y) > 5) continue;
      const killed = this.damageZombie(zombie, damage);
      results.push({ position: zombie.mesh.position.clone(), killed });
    }
    return results;
  }

  knockback(center, radius, force, world) {
    for (const zombie of this.zombies) {
      if (zombie.dead || zombie.static) continue;
      const dx = zombie.mesh.position.x - center.x;
      const dz = zombie.mesh.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius || dist < 0.0001) continue;
      const inv = 1 / dist;
      const nx = THREE.MathUtils.clamp(zombie.mesh.position.x + dx * inv * force, this.bounds.minX, this.bounds.maxX);
      const nz = THREE.MathUtils.clamp(zombie.mesh.position.z + dz * inv * force, this.bounds.minZ, this.bounds.maxZ);
      zombie.mesh.position.set(nx, groundHeight(world, nx, nz), nz);
    }
  }

  heal(center, radius, amount) {
    for (const zombie of this.zombies) {
      if (zombie.dead || zombie.dummy) continue;
      if (zombie.mesh.position.distanceTo(center) > radius) continue;
      zombie.health = Math.min(zombie.maxHealth, zombie.health + amount);
    }
  }

  killZombie(zombie) {
    zombie.dead = true;
    zombie.mesh.visible = false;
    this.group.remove(zombie.mesh);
    this.kills = (this.kills ?? 0) + 1;
  }

  consumeKills() {
    const kills = this.kills ?? 0;
    this.kills = 0;
    return kills;
  }

  clearZombies() {
    for (const zombie of this.zombies) {
      this.group.remove(zombie.mesh);
    }
    this.zombies.length = 0;

    if (this.dummyLabel) {
      this.group.remove(this.dummyLabel);
      this.dummyLabel.userData.texture?.dispose?.();
      this.dummyLabel.material?.dispose?.();
      this.dummyLabel.geometry?.dispose?.();
      this.dummyLabel = null;
    }
    this.dummy = null;
    this.dummyTimer = 0;
    this._lastDummyValue = -1;
  }

  // Glow every mesh red (or restore originals) — the "no-hit" threat marker.
  setHighlighted(on, color = 0xff2020) {
    for (const mat of Object.values(this.material)) {
      if (!mat || !mat.emissive) continue;
      if (mat.userData.baseEmissive === undefined) {
        mat.userData.baseEmissive = mat.emissive.getHex();
        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
      }
      if (on) { mat.emissive.setHex(color); mat.emissiveIntensity = 0.85; }
      else { mat.emissive.setHex(mat.userData.baseEmissive); mat.emissiveIntensity = mat.userData.baseEmissiveIntensity; }
    }
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
