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
    this.camera = options.camera ?? null;
    this.world = options.world ?? null;
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
    this.tmpQuaternion = new THREE.Quaternion();
    this.elapsed = 0;

    this.count = options.count ?? DEFAULT_DRAGON_COUNT;
    this.origin = options.origin?.isVector3 ? options.origin.clone() : new THREE.Vector3(0, 0, 0);
    this.spawnRadius = options.spawnRadius ?? 34;
    this.minAltitude = options.minAltitude ?? 13;
    this.maxAltitude = options.maxAltitude ?? 22;
    this.bounds = {
      minX: options.bounds?.minX ?? -22,
      maxX: options.bounds?.maxX ?? 22,
      minZ: options.bounds?.minZ ?? -22,
      maxZ: options.bounds?.maxZ ?? 22,
    };
    this.fireballDamage = options.fireballDamage ?? 14;
    this.fireballSpeed = options.fireballSpeed ?? 24;
    this.reflectDamage = options.reflectDamage ?? 100;

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
      reflectedFireball: new THREE.MeshStandardMaterial({
        color: 0x54d2ff,
        emissive: 0x1f9bff,
        emissiveIntensity: 1.6,
        roughness: 0.5,
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
        // Orbit radius oscillates so dragons drift in and out around the
        // player. Kept inside the map bounds (clamped in updateDragon too).
        orbitRadius: 10 + (i % 3) * 4,
        radiusAmplitude: 5 + (i % 3) * 2,
        radiusRate: 0.45 + (i % 4) * 0.16,
        radiusPhase: i * 1.3,
        speed: 0.24 + i * 0.035,
        attackCooldown: 1.5 + i * 0.55,
        mesh: this.createDragonMesh(i),
        healthBar: this.createHealthBar(),
        velocity: new THREE.Vector3(),
        dead: false,
      };

      dragon.mesh.position.set(
        this.origin.x + Math.cos(angle) * dragon.orbitRadius,
        altitude,
        this.origin.z + Math.sin(angle) * dragon.orbitRadius,
      );
      dragon.mesh.userData.dragon = dragon;
      this.group.add(dragon.mesh);
      this.group.add(dragon.healthBar);
      this.dragons.push(dragon);
    }
  }

  createHealthBar() {
    const width = 3;
    const height = 0.4;
    const group = new THREE.Group();

    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 0.18, height + 0.18),
      new THREE.MeshBasicMaterial({
        color: 0x101418,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    bg.renderOrder = 998;
    bg.frustumCulled = false;

    const fillGeometry = new THREE.PlaneGeometry(1, height);
    fillGeometry.translate(0.5, 0, 0); // left-anchored unit quad
    const fill = new THREE.Mesh(
      fillGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x49d049,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    fill.position.x = -width / 2;
    fill.scale.x = width;
    fill.position.z = 0.01;
    fill.renderOrder = 999;
    fill.frustumCulled = false;

    group.add(bg, fill);
    group.userData.fill = fill;
    group.userData.width = width;
    group.frustumCulled = false;
    return group;
  }

  clearDragons() {
    for (const dragon of this.dragons) {
      this.group.remove(dragon.mesh);
      if (dragon.healthBar) this.group.remove(dragon.healthBar);
    }
    this.dragons.length = 0;
  }

  spawnWave(count) {
    this.clearDragons();
    this.spawnDragons(Math.max(0, Math.floor(count)));
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
      this.updateHealthBar(dragon);
    }

    this.updateFireballs(dt, player, playerPosition);
  }

  updateDragon(dragon, delta, playerPosition) {
    let speedFactor = 1;
    if (dragon.slowTimer > 0) {
      dragon.slowTimer -= delta;
      speedFactor = dragon.slowFactor ?? 1;
      if (dragon.slowTimer <= 0) this._clearSlowTint(dragon);
    }
    dragon.angle += dragon.speed * speedFactor * delta;
    const orbitCenter = playerPosition.lengthSq() > 0.001 ? playerPosition : this.origin;

    // Radius breathes in and out so the dragon circles the player, sometimes
    // swooping closer and sometimes pulling away.
    const radius = dragon.orbitRadius
      + Math.sin(this.elapsed * dragon.radiusRate + dragon.radiusPhase) * dragon.radiusAmplitude;
    const bob = Math.sin(this.elapsed * 2.5 + dragon.id * 1.7) * 1.6;

    const targetX = orbitCenter.x + Math.cos(dragon.angle) * radius;
    const targetZ = orbitCenter.z + Math.sin(dragon.angle) * radius;

    this.tmpTarget.set(
      THREE.MathUtils.clamp(targetX, this.bounds.minX, this.bounds.maxX),
      dragon.altitude + bob,
      THREE.MathUtils.clamp(targetZ, this.bounds.minZ, this.bounds.maxZ),
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

  updateHealthBar(dragon) {
    const bar = dragon.healthBar;
    if (!bar) return;

    bar.position.copy(dragon.mesh.position);
    bar.position.y += 3.3;

    if (this.camera) {
      this.camera.getWorldQuaternion(this.tmpQuaternion);
      bar.quaternion.copy(this.tmpQuaternion);
    }

    const ratio = THREE.MathUtils.clamp(dragon.health / dragon.maxHealth, 0, 1);
    const fill = bar.userData.fill;
    fill.scale.x = bar.userData.width * ratio;
    fill.visible = ratio > 0;
    fill.material.color.setHex(ratio > 0.5 ? 0x49d049 : ratio > 0.25 ? 0xe0c020 : 0xd83b3b);
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

  _fireballBlocked(position) {
    if (!this.world || typeof this.world.getBlock !== 'function') return false;
    const type = this.world.getBlock(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
    return Boolean(type) && type !== 'water';
  }

  updateFireballs(delta, player, playerPosition) {
    for (let i = this.fireballs.length - 1; i >= 0; i -= 1) {
      const fireball = this.fireballs[i];
      const data = fireball.userData;
      data.life -= delta;

      // Reflected fireballs home back toward the dragon that fired them.
      if (data.reflected) {
        const target = data.homingTarget;
        if (!target || target.dead || data.life <= 0 || fireball.position.y < -2) {
          this.group.remove(fireball);
          this.fireballs.splice(i, 1);
          continue;
        }

        this.tmpDirection.subVectors(target.mesh.position, fireball.position);
        const distance = this.tmpDirection.length();
        if (distance > 0.0001) this.tmpDirection.normalize();
        const speed = data.velocity.length() || this.fireballSpeed;
        data.velocity.lerp(this.tmpDirection.multiplyScalar(speed), Math.min(1, delta * 6));
        fireball.position.addScaledVector(data.velocity, delta);
        fireball.rotation.x += delta * 9;

        if (this._fireballBlocked(fireball.position)) {
          this.impacts.push({ position: fireball.position.clone(), damage: 0, hitPlayer: false });
          this.group.remove(fireball);
          this.fireballs.splice(i, 1);
          continue;
        }

        if (distance <= FIREBALL_COLLISION_RADIUS + 1.4) {
          target.health = Math.max(0, target.health - data.damage);
          const killed = target.health <= 0;
          if (killed) this.killDragon(target);
          this.impacts.push({ position: fireball.position.clone(), damage: 0, hitPlayer: false, hitDragon: true, killed });
          this.group.remove(fireball);
          this.fireballs.splice(i, 1);
        }
        continue;
      }

      fireball.position.addScaledVector(data.velocity, delta);
      fireball.rotation.x += delta * 8;
      fireball.rotation.y += delta * 5;

      // Terrain blocks the fireball.
      if (this._fireballBlocked(fireball.position)) {
        this.impacts.push({ position: fireball.position.clone(), damage: 0, hitPlayer: false });
        this.group.remove(fireball);
        this.fireballs.splice(i, 1);
        continue;
      }

      const hitPlayer = Boolean(player) && fireball.position.distanceTo(playerPosition) <= FIREBALL_COLLISION_RADIUS;
      const expired = data.life <= 0 || fireball.position.y < -2;

      // Parry: a raised guard reflects the fireball back at its owner dragon.
      if (hitPlayer && player?.guardActive && data.owner && !data.owner.dead) {
        data.reflected = true;
        data.homingTarget = data.owner;
        data.damage = this.reflectDamage;
        data.life = 4;
        this.tmpDirection.subVectors(data.owner.mesh.position, fireball.position).normalize();
        data.velocity.copy(this.tmpDirection).multiplyScalar(this.fireballSpeed * 1.3);
        fireball.material = this.material.reflectedFireball;
        this.impacts.push({ position: fireball.position.clone(), damage: 0, hitPlayer: false, reflected: true });
        continue;
      }

      if (hitPlayer || expired) {
        this.impacts.push({ position: fireball.position.clone(), damage: data.damage, hitPlayer });
        this.group.remove(fireball);
        this.fireballs.splice(i, 1);
      }
    }
  }

  peekRay(ray) {
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

    return { dragon, point: hits[0].point.clone(), distance: hits[0].distance };
  }

  applyRayHit(peek, damage) {
    const dragon = peek.dragon;
    dragon.health = Math.max(0, dragon.health - damage);
    if (dragon.health <= 0) {
      this.killDragon(dragon);
    }
    return {
      dragon,
      point: peek.point,
      distance: peek.distance,
      killed: dragon.dead,
      health: dragon.health,
    };
  }

  hitByRay(ray, damage = 25) {
    const peek = this.peekRay(ray);
    return peek ? this.applyRayHit(peek, damage) : null;
  }

  hitMelee(origin, direction, range, damage, arcCos = 0.3) {
    const results = [];
    const toTarget = new THREE.Vector3();
    for (const dragon of this.dragons) {
      if (dragon.dead) continue;
      toTarget.subVectors(dragon.mesh.position, origin);
      const distance = toTarget.length();
      if (distance > range || distance < 0.0001) continue;
      toTarget.normalize();
      if (toTarget.dot(direction) < arcCos) continue;
      dragon.health = Math.max(0, dragon.health - damage);
      const killed = dragon.health <= 0;
      if (killed) this.killDragon(dragon);
      results.push({ position: dragon.mesh.position.clone(), killed });
    }
    return results;
  }

  hitAllByRay(ray, damage = 25) {
    if (!ray) return [];

    const isRaycaster = typeof ray.intersectObjects === 'function' && ray.ray;
    const raycaster = isRaycaster ? ray : this.tmpRaycaster;
    if (!isRaycaster) {
      if (ray.origin && ray.direction) {
        raycaster.ray.copy(ray);
      } else {
        return [];
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
    const results = [];
    const seen = new Set();

    for (const intersection of hits) {
      const root = intersection.object.userData.dragonRoot;
      const dragon = this.dragons.find((candidate) => candidate.mesh === root);
      if (!dragon || dragon.dead || seen.has(dragon.id)) continue;

      seen.add(dragon.id);
      dragon.health = Math.max(0, dragon.health - damage);
      if (dragon.health <= 0) {
        this.killDragon(dragon);
      }

      results.push({
        dragon,
        point: intersection.point.clone(),
        distance: intersection.distance,
        killed: dragon.dead,
        health: dragon.health,
      });
    }

    return results;
  }

  hitBox(origin, forward, right, length, halfWidth, damage) {
    const results = [];
    const v = new THREE.Vector3();
    for (const dragon of this.dragons) {
      if (dragon.dead) continue;
      v.subVectors(dragon.mesh.position, origin);
      const f = v.dot(forward);
      const lateral = Math.abs(v.dot(right));
      if (f < -1 || f > length || lateral > halfWidth || Math.abs(v.y) > 5) continue;
      dragon.health = Math.max(0, dragon.health - damage);
      const killed = dragon.health <= 0;
      if (killed) this.killDragon(dragon);
      results.push({ position: dragon.mesh.position.clone(), killed });
    }
    return results;
  }

  knockback(center, radius, force) {
    for (const dragon of this.dragons) {
      if (dragon.dead) continue;
      const dx = dragon.mesh.position.x - center.x;
      const dz = dragon.mesh.position.z - center.z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius || dist < 0.0001) continue;
      const inv = 1 / dist;
      dragon.mesh.position.x = THREE.MathUtils.clamp(dragon.mesh.position.x + dx * inv * force, this.bounds.minX, this.bounds.maxX);
      dragon.mesh.position.z = THREE.MathUtils.clamp(dragon.mesh.position.z + dz * inv * force, this.bounds.minZ, this.bounds.maxZ);
    }
  }

  slow(center, radius, factor, duration) {
    for (const dragon of this.dragons) {
      if (dragon.dead) continue;
      const dx = dragon.mesh.position.x - center.x;
      const dz = dragon.mesh.position.z - center.z;
      if (Math.hypot(dx, dz) > radius) continue;
      dragon.slowTimer = duration;
      dragon.slowFactor = factor;
      this._applySlowTint(dragon);
    }
  }

  _applySlowTint(dragon) {
    dragon.mesh.traverse((child) => {
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

  _clearSlowTint(dragon) {
    dragon.slowTimer = 0;
    dragon.mesh.traverse((child) => {
      if (child.isMesh && child.userData.baseMat) child.material = child.userData.baseMat;
    });
  }

  killDragon(dragon) {
    dragon.dead = true;
    dragon.mesh.visible = false;
    this.group.remove(dragon.mesh);
    if (dragon.healthBar) this.group.remove(dragon.healthBar);
    this.kills = (this.kills ?? 0) + 1;
  }

  consumeKills() {
    const kills = this.kills ?? 0;
    this.kills = 0;
    return kills;
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
