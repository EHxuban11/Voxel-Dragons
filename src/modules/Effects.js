import * as THREE from 'three';

const DEFAULT_SKY = 0x8fc9ff;
const DEFAULT_FOG_NEAR = 80;
const DEFAULT_FOG_FAR = 340;

const TMP_COLOR = new THREE.Color();
const TMP_VECTOR = new THREE.Vector3();

function resolvePosition(position) {
  if (position?.isVector3) return position.clone();
  if (position?.position?.isVector3) return position.position.clone();
  if (typeof position?.x === 'number' && typeof position?.y === 'number' && typeof position?.z === 'number') {
    return new THREE.Vector3(position.x, position.y, position.z);
  }
  return new THREE.Vector3();
}

function randomDirection() {
  const theta = Math.random() * Math.PI * 2;
  const y = Math.random() * 2 - 1;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  return TMP_VECTOR.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius).clone();
}

function disposeObject(object) {
  object?.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

export class Effects {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.effects = [];
    this.lights = [];
    this.lastShakeOffset = new THREE.Vector3();
    this.shake = {
      time: 0,
      duration: 0,
      intensity: 0,
    };

    this.options = {
      skyColor: options.skyColor ?? DEFAULT_SKY,
      fogNear: options.fogNear ?? DEFAULT_FOG_NEAR,
      fogFar: options.fogFar ?? DEFAULT_FOG_FAR,
    };
  }

  impact(position, color = 0xffd166) {
    const origin = resolvePosition(position);

    this._spawnBurst({
      position: origin,
      color,
      count: 18,
      ttl: 0.42,
      size: 0.08,
      opacity: 0.95,
      speed: [3.5, 8],
      gravity: -8,
      drag: 2.3,
    });

    this._addLight(origin, color, 1.4, 4.5, 0.09);
    this._addShake(0.035, 0.08);
  }

  explosion(position) {
    const origin = resolvePosition(position);

    this._spawnBurst({
      position: origin,
      color: 0xff7a1a,
      count: 54,
      ttl: 0.72,
      size: 0.16,
      opacity: 1,
      speed: [5, 15],
      gravity: -4,
      drag: 1.35,
    });

    this._spawnBurst({
      position: origin,
      color: 0x4f514d,
      count: 36,
      ttl: 1.45,
      size: 0.34,
      opacity: 0.48,
      speed: [1.2, 6],
      gravity: 1.9,
      drag: 0.75,
      liftBias: 0.65,
    });

    this._spawnExpandingSphere(origin, 0xff5f16, 0.35, 4.2, 0.32);
    this._addLight(origin, 0xff7a1a, 8, 18, 0.45);
    this._addShake(0.28, 0.42);
  }

  update(delta) {
    const dt = Math.max(0, Math.min(delta || 0, 0.08));

    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      const alive = effect.update(dt);
      if (!alive) {
        this.scene?.remove?.(effect.object);
        disposeObject(effect.object);
        this.effects.splice(i, 1);
      }
    }

    for (let i = this.lights.length - 1; i >= 0; i -= 1) {
      const light = this.lights[i];
      light.age += dt;
      const progress = THREE.MathUtils.clamp(light.age / light.ttl, 0, 1);
      light.object.intensity = light.baseIntensity * (1 - progress);
      if (progress >= 1) {
        this.scene?.remove?.(light.object);
        this.lights.splice(i, 1);
      }
    }

    if (this.shake.time > 0) {
      this.shake.time = Math.max(0, this.shake.time - dt);
    }
  }

  applyCameraShake(camera) {
    if (!camera?.position) return;

    if (this.lastShakeOffset.lengthSq() > 0) {
      camera.position.sub(this.lastShakeOffset);
      this.lastShakeOffset.set(0, 0, 0);
    }

    if (this.shake.time <= 0 || this.shake.duration <= 0 || this.shake.intensity <= 0) return;

    const fade = this.shake.time / this.shake.duration;
    const amount = this.shake.intensity * fade * fade;
    this.lastShakeOffset.set(
      (Math.random() - 0.5) * amount,
      (Math.random() - 0.5) * amount,
      (Math.random() - 0.5) * amount * 0.45,
    );
    camera.position.add(this.lastShakeOffset);
  }

  setSky(color = this.options.skyColor) {
    if (!this.scene) return null;
    this.scene.background = new THREE.Color(color);
    return this.scene.background;
  }

  setFog(color = this.options.skyColor, near = this.options.fogNear, far = this.options.fogFar) {
    if (!this.scene) return null;
    this.scene.fog = new THREE.Fog(color, near, far);
    return this.scene.fog;
  }

  addDefaultLighting() {
    if (!this.scene) return null;

    const group = new THREE.Group();
    group.name = 'EffectsLighting';

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x31451e, 1.5);
    const sun = new THREE.DirectionalLight(0xfff0c5, 2.4);
    sun.position.set(70, 120, 50);
    sun.castShadow = true;
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;

    group.add(hemi, sun);
    this.scene.add(group);
    return group;
  }

  configureEnvironment(options = {}) {
    const skyColor = options.skyColor ?? this.options.skyColor;
    this.setSky(skyColor);
    this.setFog(skyColor, options.fogNear ?? this.options.fogNear, options.fogFar ?? this.options.fogFar);
    if (options.lighting !== false) {
      return this.addDefaultLighting();
    }
    return null;
  }

  dispose() {
    if (this.lastShakeOffset.lengthSq() > 0) {
      this.lastShakeOffset.set(0, 0, 0);
    }

    for (const effect of this.effects) {
      this.scene?.remove?.(effect.object);
      disposeObject(effect.object);
    }
    this.effects.length = 0;

    for (const light of this.lights) {
      this.scene?.remove?.(light.object);
    }
    this.lights.length = 0;
  }

  _spawnBurst(config) {
    const positions = new Float32Array(config.count * 3);
    const colors = new Float32Array(config.count * 3);
    const velocities = [];
    const baseColor = TMP_COLOR.set(config.color);
    const liftBias = config.liftBias ?? 0;

    for (let i = 0; i < config.count; i += 1) {
      const index = i * 3;
      const jitter = randomDirection().multiplyScalar(Math.random() * 0.08);
      positions[index] = config.position.x + jitter.x;
      positions[index + 1] = config.position.y + jitter.y;
      positions[index + 2] = config.position.z + jitter.z;

      const direction = randomDirection();
      direction.y += liftBias;
      direction.normalize();
      const speed = THREE.MathUtils.lerp(config.speed[0], config.speed[1], Math.random());
      velocities.push(direction.multiplyScalar(speed));

      const color = baseColor.clone().lerp(new THREE.Color(0xffffff), Math.random() * 0.18);
      colors[index] = color.r;
      colors[index + 1] = color.g;
      colors[index + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: config.size,
      vertexColors: true,
      transparent: true,
      opacity: config.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene?.add?.(points);

    const effect = {
      object: points,
      age: 0,
      ttl: config.ttl,
      update: (delta) => {
        effect.age += delta;
        const progress = THREE.MathUtils.clamp(effect.age / effect.ttl, 0, 1);
        const attr = geometry.getAttribute('position');

        for (let i = 0; i < velocities.length; i += 1) {
          const index = i * 3;
          const velocity = velocities[i];
          velocity.y += config.gravity * delta;
          velocity.multiplyScalar(Math.exp(-config.drag * delta));
          attr.array[index] += velocity.x * delta;
          attr.array[index + 1] += velocity.y * delta;
          attr.array[index + 2] += velocity.z * delta;
        }

        attr.needsUpdate = true;
        material.opacity = config.opacity * (1 - progress);
        material.size = config.size * (1 + progress * 1.4);
        return progress < 1;
      },
    };

    this.effects.push(effect);
  }

  _spawnExpandingSphere(position, color, startScale, endScale, ttl) {
    const geometry = new THREE.SphereGeometry(1, 14, 10);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(startScale);
    this.scene?.add?.(mesh);

    const effect = {
      object: mesh,
      age: 0,
      ttl,
      update: (delta) => {
        effect.age += delta;
        const progress = THREE.MathUtils.clamp(effect.age / effect.ttl, 0, 1);
        mesh.scale.setScalar(THREE.MathUtils.lerp(startScale, endScale, progress));
        material.opacity = 0.6 * (1 - progress);
        return progress < 1;
      },
    };

    this.effects.push(effect);
  }

  _addLight(position, color, intensity, distance, ttl) {
    if (!this.scene) return;
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.copy(position);
    this.scene.add(light);
    this.lights.push({
      object: light,
      age: 0,
      ttl,
      baseIntensity: intensity,
    });
  }

  _addShake(intensity, duration) {
    this.shake.intensity = Math.max(this.shake.intensity, intensity);
    this.shake.duration = Math.max(this.shake.duration, duration);
    this.shake.time = Math.max(this.shake.time, duration);
  }
}

export default Effects;
