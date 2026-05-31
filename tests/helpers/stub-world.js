// A headless stand-in for the engine World, implementing only the building
// primitives that map descriptors (content/maps) call. Lets us test map
// generation without Three.js or a canvas.
export function makeStubWorld(options = {}) {
  const opts = { width: 80, depth: 80, maxHeight: 22, waterLevel: 6, seed: 1337, ...options };
  const blocks = new Map();
  const key = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const spruces = [];
  const trees = [];

  const hash = (x, z, off = 0) => {
    let h = Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(z), 668265263) ^ Math.imul(off + opts.seed, 1442695041);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  return {
    options: opts,
    blocks,
    spruces,
    trees,
    setBlock(x, y, z, type) { const k = key(x, y, z); if (type == null) blocks.delete(k); else blocks.set(k, type); return true; },
    getBlock(x, y, z) { return blocks.get(key(x, y, z)) ?? null; },
    clearColumn(x, z) { for (let y = 0; y < opts.maxHeight; y += 1) blocks.delete(key(x, y, z)); },
    getSurfaceY(x, z) { for (let y = opts.maxHeight - 1; y >= 0; y -= 1) { const t = this.getBlock(x, y, z); if (t && t !== 'water') return y; } return null; },
    noise2D(x, z, scale, off = 0) { return hash(Math.floor(x / scale), Math.floor(z / scale), off); },
    hash,
    forEachColumn(cb, margin = 0) {
      const hw = Math.floor(opts.width / 2);
      const hd = Math.floor(opts.depth / 2);
      for (let x = -hw + margin; x < opts.width - hw - margin; x += 1) {
        for (let z = -hd + margin; z < opts.depth - hd - margin; z += 1) cb(x, z);
      }
    },
    plantTree(x, by, z) { trees.push([x, z]); for (let t = 1; t <= 4; t += 1) this.setBlock(x, by + t, z, 'wood'); this.setBlock(x, by + 5, z, 'leaves'); },
    plantSpruce(x, by, z, h = 12) {
      spruces.push([x, z]);
      for (let t = 1; t <= h; t += 1) this.setBlock(x, by + t, z, 'spruce_log');
      this.setBlock(x, by + h + 1, z, 'snow');
      this.setBlock(x + 1, by + 4, z, 'spruce_leaves');
    },
    types() { return new Set(blocks.values()); },
  };
}
