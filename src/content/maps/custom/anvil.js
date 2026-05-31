// Anvil region (.mca) reader. A region file holds up to 32x32 chunks behind a
// 8 KiB header; each chunk is a compressed NBT structure. This extracts the
// block grid from chunks in the modern palette formats:
//   - 1.18+   : root `sections[]`, each with `block_states.{palette,data}`
//   - 1.13-17 : root `Level.Sections[]`, each with `Palette` + `BlockStates`
// Legacy numeric-id chunks (pre 1.13) are not supported.

import { parseNBT } from './nbt.js';
import { zlibInflate, gunzip } from './decompress.js';

const SECTOR = 4096;

function stripNamespace(name) {
  if (!name) return name;
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

const AIR = new Set(['air', 'cave_air', 'void_air']);
export function isAir(name) {
  return !name || AIR.has(name);
}

function ceilLog2(n) {
  return n <= 1 ? 0 : Math.ceil(Math.log2(n));
}

// Unpacks `count` palette indices from an array of 64-bit longs (BigInt).
// padded=false (pre-1.16) packs bits tightly across long boundaries;
// padded=true (1.16+) keeps each long's entries from spanning into the next.
function unpackIndices(longs, bits, count, padded) {
  const out = new Uint16Array(count);
  const mask = (1n << BigInt(bits)) - 1n;
  const u = longs.map((v) => BigInt.asUintN(64, v)); // treat as unsigned

  if (padded) {
    const perLong = Math.floor(64 / bits);
    const bbits = BigInt(bits);
    for (let i = 0; i < count; i += 1) {
      const li = Math.floor(i / perLong);
      const shift = BigInt((i % perLong) * bits);
      out[i] = Number((u[li] >> shift) & mask);
    }
  } else {
    const bbits = BigInt(bits);
    for (let i = 0; i < count; i += 1) {
      const bitPos = i * bits;
      const li = bitPos >> 6;
      const offset = BigInt(bitPos & 63);
      let value = u[li] >> offset;
      if (Number(offset) + bits > 64 && li + 1 < u.length) {
        value |= u[li + 1] << (64n - offset);
      }
      out[i] = Number(value & mask);
    }
  }
  return out;
}

async function decompressChunk(compType, bytes) {
  if (compType === 1) return gunzip(bytes);
  if (compType === 2) return zlibInflate(bytes);
  if (compType === 3) return bytes; // uncompressed
  throw new Error(`Compresión de chunk no soportada: ${compType}`);
}

// Calls cb(chunkNBT, chunkX, chunkZ) for every present chunk in the region.
export async function eachChunk(regionBytes, regionX, regionZ, cb) {
  const bytes = regionBytes instanceof Uint8Array ? regionBytes : new Uint8Array(regionBytes);
  if (bytes.byteLength < SECTOR) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < 1024; index += 1) {
    const loc = index * 4;
    const sectorOffset = (bytes[loc] << 16) | (bytes[loc + 1] << 8) | bytes[loc + 2];
    const sectorCount = bytes[loc + 3];
    if (sectorOffset === 0 || sectorCount === 0) continue;

    const start = sectorOffset * SECTOR;
    if (start + 5 > bytes.byteLength) continue;
    const length = view.getUint32(start, false);
    if (length <= 0 || start + 4 + length > bytes.byteLength) continue;
    const compType = bytes[start + 4];
    const payload = bytes.subarray(start + 5, start + 4 + length);

    let nbt;
    try {
      nbt = parseNBT(await decompressChunk(compType, payload));
    } catch {
      continue; // skip unreadable chunks rather than aborting the whole import
    }

    const chunkX = regionX * 32 + (index % 32);
    const chunkZ = regionZ * 32 + Math.floor(index / 32);
    cb(nbt, chunkX, chunkZ);
  }
}

// Walks the sections of one chunk, calling onBlock(x, y, z, blockName) for every
// non-air block (absolute world coordinates).
export function extractBlocks(nbt, chunkX, chunkZ, onBlock) {
  const dataVersion = nbt.DataVersion ?? (nbt.Level && nbt.Level.DataVersion) ?? 0;
  const padded = dataVersion >= 2529; // 1.16+ uses non-spanning packing

  let sections;
  if (Array.isArray(nbt.sections)) sections = nbt.sections;
  else if (nbt.Level && Array.isArray(nbt.Level.Sections)) sections = nbt.Level.Sections;
  else return;

  for (const sec of sections) {
    const sectionY = sec.Y;
    if (sectionY === undefined) continue;

    let palette;
    let data;
    if (sec.block_states) { palette = sec.block_states.palette; data = sec.block_states.data; }
    else if (sec.Palette) { palette = sec.Palette; data = sec.BlockStates; }
    else continue;
    if (!palette || palette.length === 0) continue;

    const names = palette.map((p) => stripNamespace(p && p.Name));

    // Single-entry palettes omit the data array: the whole section is that block.
    if (palette.length === 1 || !data || data.length === 0) {
      const name = names[0];
      if (isAir(name)) continue;
      for (let i = 0; i < 4096; i += 1) {
        const x = i & 15;
        const z = (i >> 4) & 15;
        const y = (i >> 8) & 15;
        onBlock(chunkX * 16 + x, sectionY * 16 + y, chunkZ * 16 + z, name);
      }
      continue;
    }

    const bits = Math.max(4, ceilLog2(palette.length));
    const indices = unpackIndices(data, bits, 4096, padded);
    for (let i = 0; i < 4096; i += 1) {
      const name = names[indices[i]];
      if (isAir(name)) continue;
      const x = i & 15;
      const z = (i >> 4) & 15;
      const y = (i >> 8) & 15;
      onBlock(chunkX * 16 + x, sectionY * 16 + y, chunkZ * 16 + z, name);
    }
  }
}

// Parses a region filename like "r.-1.2.mca" into [regionX, regionZ].
export function parseRegionCoords(path) {
  const m = /r\.(-?\d+)\.(-?\d+)\.mca$/.exec(path);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}
