// Turns an uploaded Minecraft world (a .zip downloaded from e.g. minecraftmaps)
// into a playable map descriptor. It unzips the save, finds the overworld region
// files, reads a window of the build around the world spawn, clips it to the
// game's voxel volume (keeping the top layers) and maps every block to a game
// block type — inventing a coloured block for anything unmatched.

import { ZipArchive } from './zip.js';
import { gunzip } from './decompress.js';
import { parseNBT } from './nbt.js';
import { eachChunk, extractBlocks, parseRegionCoords } from './anvil.js';
import { BlockResolver } from './blockMap.js';

// The custom world's footprint. Bigger than the built-in maps so builds fit,
// but bounded so a full save doesn't blow up memory / the mesh rebuild.
const DIMS = { width: 64, depth: 64, maxHeight: 48, waterLevel: 8 };

const ENVIRONMENT = {
  sky: 0x9fb8d4,
  fog: { color: 0xb9c9dc, near: 70, far: 280 },
  hemisphere: { sky: 0xdceaf7, ground: 0x4a4f44, intensity: 1.4 },
  sun: { color: 0xfff4da, intensity: 2.3 },
};

function findRegionEntries(zip) {
  // Prefer the overworld (a "region/" folder not under DIM-1 / DIM1).
  const all = zip.list().filter((p) => p.endsWith('.mca') && p.includes('region/'));
  const overworld = all.filter((p) => !/DIM-?1\//.test(p));
  const chosen = overworld.length ? overworld : all;
  return chosen
    .map((path) => ({ path, coords: parseRegionCoords(path) }))
    .filter((r) => r.coords);
}

async function readSpawn(zip) {
  const levelPath = zip.list().find((p) => p.endsWith('level.dat'));
  if (!levelPath) return { x: 0, z: 0 };
  try {
    const nbt = parseNBT(await gunzip(await zip.read(levelPath)));
    const data = nbt.Data ?? nbt;
    if (typeof data.SpawnX === 'number' && typeof data.SpawnZ === 'number') {
      return { x: data.SpawnX, z: data.SpawnZ };
    }
  } catch {
    /* fall through to origin */
  }
  return { x: 0, z: 0 };
}

function regionOverlapsWindow(coords, win) {
  const [rx, rz] = coords;
  const rMinX = rx * 512;
  const rMinZ = rz * 512;
  return !(rMinX + 511 < win.minX || rMinX > win.maxX || rMinZ + 511 < win.minZ || rMinZ > win.maxZ);
}

// Iterates every non-air block of the chosen regions that falls inside the XZ
// window, calling cb(localX, localZ, mcY, blockName) with window-local X/Z.
async function forEachWindowBlock(regions, win, cb) {
  for (const region of regions) {
    await eachChunk(region.bytes, region.coords[0], region.coords[1], (nbt, cx, cz) => {
      const bx = cx * 16;
      const bz = cz * 16;
      if (bx + 15 < win.minX || bx > win.maxX || bz + 15 < win.minZ || bz > win.maxZ) return;
      extractBlocks(nbt, cx, cz, (x, y, z, name) => {
        if (x < win.minX || x > win.maxX || z < win.minZ || z > win.maxZ) return;
        cb(x - win.minX, z - win.minZ, y, name);
      });
    });
  }
}

export async function importMinecraftMap(file, onProgress = () => {}) {
  onProgress('Leyendo el archivo…');
  const buffer = await file.arrayBuffer();
  const zip = new ZipArchive(new Uint8Array(buffer));

  const regions = findRegionEntries(zip);
  if (regions.length === 0) {
    throw new Error('No se encontraron archivos region/*.mca (¿es un mundo de Minecraft?).');
  }

  const spawn = await readSpawn(zip);
  const win = {
    minX: spawn.x - DIMS.width / 2,
    maxX: spawn.x - DIMS.width / 2 + DIMS.width - 1,
    minZ: spawn.z - DIMS.depth / 2,
    maxZ: spawn.z - DIMS.depth / 2 + DIMS.depth - 1,
  };

  // Only decompress region files that overlap the window.
  const relevant = regions.filter((r) => regionOverlapsWindow(r.coords, win));
  const used = relevant.length ? relevant : regions.slice(0, 1);
  onProgress(`Descomprimiendo ${used.length} región(es)…`);
  for (const region of used) region.bytes = await zip.read(region.path);

  // Pass 1: find the highest solid block so we keep the top layers of the build.
  onProgress('Analizando alturas…');
  let maxY = -Infinity;
  await forEachWindowBlock(used, win, (_lx, _lz, my) => { if (my > maxY) maxY = my; });
  if (maxY === -Infinity) throw new Error('La ventana del mapa está vacía (sin bloques).');
  const base = maxY - (DIMS.maxHeight - 1);

  // Pass 2: place the clipped blocks.
  onProgress('Convirtiendo bloques…');
  const resolver = new BlockResolver();
  const xs = [];
  const ys = [];
  const zs = [];
  const types = [];
  await forEachWindowBlock(used, win, (lx, lz, my, name) => {
    const gameY = my - base;
    if (gameY < 1 || gameY >= DIMS.maxHeight) return; // y=0 is reserved for the floor
    xs.push(lx);
    ys.push(gameY);
    zs.push(lz);
    types.push(resolver.resolve(name));
  });

  const halfW = Math.floor(DIMS.width / 2);
  const halfD = Math.floor(DIMS.depth / 2);
  const name = file.name.replace(/\.(zip|mca)$/i, '').slice(0, 24) || 'Custom';

  return {
    id: `custom-${name}-${xs.length}`,
    name,
    emoji: '📦',
    note: `Importado · ${Object.keys(resolver.extraBlocks).length} bloques nuevos`,
    dimensions: { ...DIMS },
    extraBlocks: resolver.extraBlocks,
    environment: ENVIRONMENT,
    generate(world) {
      // Solid floor so there are never bottomless gaps to fall through.
      world.forEachColumn((x, z) => world.setBlock(x, 0, z, 'stone', false));
      for (let i = 0; i < xs.length; i += 1) {
        world.setBlock(xs[i] - halfW, ys[i], zs[i] - halfD, types[i], false);
      }
    },
  };
}

export default importMinecraftMap;
