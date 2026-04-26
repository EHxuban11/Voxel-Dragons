import * as THREE from 'three';

const BLOCK_SIZE = 1;
const DEFAULT_OPTIONS = {
  width: 48,
  depth: 48,
  maxHeight: 20,
  waterLevel: 6,
  seed: 1337,
};

const BLOCK_TYPES = Object.freeze({
  grass: {
    color: 0x58a548,
    roughness: 0.9,
    metalness: 0,
  },
  dirt: {
    color: 0x8b5a2b,
    roughness: 1,
    metalness: 0,
  },
  stone: {
    color: 0x7b7f86,
    roughness: 0.95,
    metalness: 0,
  },
  sand: {
    color: 0xd8c477,
    roughness: 1,
    metalness: 0,
  },
  wood: {
    color: 0x8a5a32,
    roughness: 0.9,
    metalness: 0,
  },
  leaves: {
    color: 0x2f7d32,
    roughness: 1,
    metalness: 0,
  },
  water: {
    color: 0x2f8ed8,
    roughness: 0.45,
    metalness: 0,
    transparent: true,
    opacity: 0.62,
  },
});

const VALID_TYPES = new Set(Object.keys(BLOCK_TYPES));
const NEIGHBOR_OFFSETS = Object.freeze([
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]);

function blockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function parseBlockKey(key) {
  return key.split(',').map(Number);
}

function fade(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hash2D(x, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2D(x, z, seed, scale) {
  const sx = x / scale;
  const sz = z / scale;
  const x0 = Math.floor(sx);
  const z0 = Math.floor(sz);
  const tx = fade(sx - x0);
  const tz = fade(sz - z0);

  const a = hash2D(x0, z0, seed);
  const b = hash2D(x0 + 1, z0, seed);
  const c = hash2D(x0, z0 + 1, seed);
  const d = hash2D(x0 + 1, z0 + 1, seed);

  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export class World extends THREE.Group {
  constructor(options = {}) {
    super();

    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.blocks = new Map();
    this.meshes = new Map();
    this.time = 0;

    this.geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    this.materials = new Map(
      Object.entries(BLOCK_TYPES).map(([type, config]) => [
        type,
        new THREE.MeshStandardMaterial({
          color: config.color,
          roughness: config.roughness,
          metalness: config.metalness,
          transparent: Boolean(config.transparent),
          opacity: config.opacity ?? 1,
          depthWrite: !config.transparent,
        }),
      ]),
    );

    this.generate();
  }

  generate() {
    this.clearMeshes();
    this.blocks.clear();

    const { width, depth, maxHeight, waterLevel, seed } = this.options;
    const halfWidth = Math.floor(width / 2);
    const halfDepth = Math.floor(depth / 2);

    for (let x = -halfWidth; x < width - halfWidth; x += 1) {
      for (let z = -halfDepth; z < depth - halfDepth; z += 1) {
        const broad = valueNoise2D(x, z, seed, 18);
        const detail = valueNoise2D(x + 91, z - 47, seed + 19, 7);
        const height = Math.max(
          1,
          Math.min(maxHeight - 2, Math.floor(waterLevel + (broad - 0.45) * 10 + (detail - 0.5) * 4)),
        );

        for (let y = 0; y <= height; y += 1) {
          let type = 'stone';
          if (y === height && height <= waterLevel + 1) {
            type = 'sand';
          } else if (y === height && height >= waterLevel) {
            type = 'grass';
          } else if (y >= height - 3) {
            type = 'dirt';
          }
          this.setBlock(x, y, z, type, false);
        }

        for (let y = height + 1; y <= waterLevel; y += 1) {
          this.setBlock(x, y, z, 'water', false);
        }
      }
    }

    this.generateTrees();
    this.rebuildMeshes();
  }

  generateTrees() {
    const { width, depth, seed, waterLevel } = this.options;
    const halfWidth = Math.floor(width / 2);
    const halfDepth = Math.floor(depth / 2);

    for (let x = -halfWidth + 3; x < width - halfWidth - 3; x += 1) {
      for (let z = -halfDepth + 3; z < depth - halfDepth - 3; z += 1) {
        if (hash2D(x * 3, z * 3, seed + 91) > 0.985) {
          const y = this.getSurfaceY(x, z);
          if (y === null || y < waterLevel || this.getBlock(x, y, z) !== 'grass') continue;
          for (let trunk = 1; trunk <= 4; trunk += 1) {
            this.setBlock(x, y + trunk, z, 'wood', false);
          }
          for (let lx = -2; lx <= 2; lx += 1) {
            for (let ly = 3; ly <= 5; ly += 1) {
              for (let lz = -2; lz <= 2; lz += 1) {
                if (Math.abs(lx) + Math.abs(lz) + Math.max(0, ly - 4) <= 4) {
                  this.setBlock(x + lx, y + ly, z + lz, 'leaves', false);
                }
              }
            }
          }
        }
      }
    }
  }

  getSpawnPoint() {
    const { width, depth, waterLevel } = this.options;
    const searchRadius = Math.floor(Math.min(width, depth) / 2);

    let best = null;
    for (let radius = 0; radius <= searchRadius; radius += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          if (Math.abs(x) !== radius && Math.abs(z) !== radius) continue;

          const y = this.getSurfaceY(x, z);
          if (y !== null && y >= waterLevel && this.getBlock(x, y, z) !== 'water') {
            best = new THREE.Vector3(x + 0.5, y + 2.2, z + 0.5);
            return best;
          }
        }
      }
    }

    const fallbackY = this.getSurfaceY(0, 0) ?? waterLevel;
    return new THREE.Vector3(0.5, fallbackY + 2.2, 0.5);
  }

  raycastBlock(origin, direction, maxDistance = 6) {
    const rayOrigin = origin instanceof THREE.Vector3 ? origin : new THREE.Vector3(origin.x, origin.y, origin.z);
    const rayDirection = direction instanceof THREE.Vector3
      ? direction.clone()
      : new THREE.Vector3(direction.x, direction.y, direction.z);

    if (rayDirection.lengthSq() === 0 || maxDistance <= 0) return null;
    rayDirection.normalize();

    let x = Math.floor(rayOrigin.x);
    let y = Math.floor(rayOrigin.y);
    let z = Math.floor(rayOrigin.z);

    const stepX = Math.sign(rayDirection.x);
    const stepY = Math.sign(rayDirection.y);
    const stepZ = Math.sign(rayDirection.z);

    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / rayDirection.x);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / rayDirection.y);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / rayDirection.z);

    let tMaxX = this.nextBoundaryDistance(rayOrigin.x, rayDirection.x, x);
    let tMaxY = this.nextBoundaryDistance(rayOrigin.y, rayDirection.y, y);
    let tMaxZ = this.nextBoundaryDistance(rayOrigin.z, rayDirection.z, z);
    let distance = 0;
    let normal = new THREE.Vector3(0, 0, 0);
    let previous = new THREE.Vector3(x, y, z);

    while (distance <= maxDistance) {
      const type = this.getBlock(x, y, z);
      if (type) {
        const position = new THREE.Vector3(x, y, z);
        const point = rayOrigin.clone().addScaledVector(rayDirection, Math.max(0, distance));
        return {
          position,
          normal: normal.clone(),
          previous: previous.clone(),
          point,
          distance,
          type,
        };
      }

      previous.set(x, y, z);
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        x += stepX;
        distance = tMaxX;
        tMaxX += tDeltaX;
        normal.set(-stepX, 0, 0);
      } else if (tMaxY <= tMaxZ) {
        y += stepY;
        distance = tMaxY;
        tMaxY += tDeltaY;
        normal.set(0, -stepY, 0);
      } else {
        z += stepZ;
        distance = tMaxZ;
        tMaxZ += tDeltaZ;
        normal.set(0, 0, -stepZ);
      }
    }

    return null;
  }

  removeBlock(hit) {
    if (!hit?.position) return false;
    const { x, y, z } = hit.position;
    return this.setBlock(x, y, z, null);
  }

  addBlock(hit, type = 'dirt') {
    if (!hit?.position || !VALID_TYPES.has(type)) return false;

    const normal = hit.normal ?? new THREE.Vector3(0, 1, 0);
    const x = Math.floor(hit.position.x + normal.x);
    const y = Math.floor(hit.position.y + normal.y);
    const z = Math.floor(hit.position.z + normal.z);

    if (this.getBlock(x, y, z)) return false;
    return this.setBlock(x, y, z, type);
  }

  update(delta) {
    this.time += delta;
    const water = this.materials.get('water');
    if (water) {
      water.opacity = 0.56 + Math.sin(this.time * 1.5) * 0.06;
      water.needsUpdate = true;
    }
  }

  getBlock(x, y, z) {
    return this.blocks.get(blockKey(Math.floor(x), Math.floor(y), Math.floor(z))) ?? null;
  }

  setBlock(x, y, z, type, rebuild = true) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const key = blockKey(ix, iy, iz);

    if (type === null || type === undefined) {
      const removed = this.blocks.delete(key);
      if (removed && rebuild) this.rebuildMeshes();
      return removed;
    }

    if (!VALID_TYPES.has(type) || iy < 0 || iy >= this.options.maxHeight) return false;
    this.blocks.set(key, type);
    if (rebuild) this.rebuildMeshes();
    return true;
  }

  getSurfaceY(x, z) {
    let surface = null;
    for (let y = this.options.maxHeight - 1; y >= 0; y -= 1) {
      const type = this.getBlock(x, y, z);
      if (type && type !== 'water') {
        surface = y;
        break;
      }
    }
    return surface;
  }

  getGroundHeight(x, z) {
    const surface = this.getSurfaceY(x, z);
    return surface === null ? 0 : surface + 1.02;
  }

  rebuildMeshes() {
    this.clearMeshes();

    const blocksByType = new Map(Object.keys(BLOCK_TYPES).map((type) => [type, []]));
    for (const [key, type] of this.blocks) {
      const position = parseBlockKey(key);
      if (this.isRenderableBlock(position[0], position[1], position[2], type)) {
        blocksByType.get(type)?.push(position);
      }
    }

    const matrix = new THREE.Matrix4();
    for (const [type, positions] of blocksByType) {
      if (positions.length === 0) continue;

      const mesh = new THREE.InstancedMesh(this.geometry, this.materials.get(type), positions.length);
      mesh.name = `World:${type}`;
      mesh.castShadow = type !== 'water';
      mesh.receiveShadow = true;

      positions.forEach(([x, y, z], index) => {
        matrix.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
        mesh.setMatrixAt(index, matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
      this.meshes.set(type, mesh);
      this.add(mesh);
    }
  }

  clearMeshes() {
    for (const mesh of this.meshes.values()) {
      this.remove(mesh);
      mesh.dispose?.();
    }
    this.meshes.clear();
  }

  nextBoundaryDistance(value, direction, cell) {
    if (direction > 0) return (cell + 1 - value) / direction;
    if (direction < 0) return (value - cell) / -direction;
    return Infinity;
  }

  isRenderableBlock(x, y, z, type) {
    for (const [ox, oy, oz] of NEIGHBOR_OFFSETS) {
      const neighbor = this.getBlock(x + ox, y + oy, z + oz);
      if (!neighbor) return true;
      if (type !== 'water' && neighbor === 'water') return true;
      if (type === 'water' && neighbor !== 'water') return true;
    }
    return false;
  }

  dispose() {
    this.clearMeshes();
    this.geometry.dispose();
    for (const material of this.materials.values()) {
      material.dispose();
    }
    this.materials.clear();
    this.blocks.clear();
  }
}

export default World;
