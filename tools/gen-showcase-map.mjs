// Generates a synthetic Minecraft world .zip that exercises the importer end to
// end, so we can screenshot how Voxel renders an imported map and iterate on
// fidelity. It writes a small "diorama" (grass/dirt/stone ground, a water pool,
// a sand patch, two oak trees) plus a regular grid of 1x3 sample pillars — one
// per block type — covering both well-mapped blocks and ones that currently
// fall through to dynamic colours.
//
//   node tools/gen-showcase-map.mjs            -> writes /tmp/voxel-showcase.zip
//   node tools/gen-showcase-map.mjs out.zip    -> custom path
//
// Uses the test NBT/zip encoders so it stays in lockstep with what the parser
// reads. Requires Node >= 18 (CompressionStream) — run with the nvm 22.12 node.

import { writeFileSync } from 'node:fs';
import { NBTWriter, TAG, gzip, zlib } from '../tests/helpers/nbt-encode.js';
import { makeStoredZip } from '../tests/helpers/make-zip.js';

const SECTION_Y = 4;        // world Y 64..79 lives in section 4
const SECTION_BASE = SECTION_Y * 16; // 64
const DATA_VERSION = 3465;  // 1.20+ (padded packing)

// ---- block sample grid -------------------------------------------------------
// Each entry becomes a 3-tall pillar. Grouped roughly by category so the
// screenshot reads like a palette. These cover the common building blocks of a
// downloaded map; the importer should make every one look right.
const SAMPLES = [
  // stone family
  'stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'mossy_stone_bricks',
  'cracked_stone_bricks', 'andesite', 'diorite', 'granite', 'polished_andesite',
  'polished_diorite', 'polished_granite', 'smooth_stone', 'deepslate', 'cobbled_deepslate',
  'deepslate_bricks', 'polished_deepslate', 'tuff', 'calcite', 'dripstone_block',
  'bedrock', 'gravel', 'blackstone', 'basalt', 'polished_blackstone_bricks',
  // dirt / terrain
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'mycelium', 'rooted_dirt', 'mud',
  'clay', 'farmland', 'dirt_path',
  // sand
  'sand', 'red_sand', 'sandstone', 'cut_sandstone', 'smooth_sandstone',
  'red_sandstone', 'cut_red_sandstone',
  // wood: logs
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log', 'stripped_oak_log', 'stripped_spruce_log',
  // wood: planks
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks',
  'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks',
  // leaves
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves',
  'dark_oak_leaves', 'cherry_leaves', 'azalea_leaves',
  // ores / mineral blocks
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'emerald_ore', 'redstone_ore',
  'lapis_ore', 'copper_ore', 'coal_block', 'iron_block', 'gold_block', 'diamond_block',
  'emerald_block', 'redstone_block', 'lapis_block', 'copper_block', 'netherite_block',
  'raw_iron_block', 'raw_copper_block', 'raw_gold_block',
  // building blocks
  'bricks', 'bookshelf', 'crafting_table', 'oak_log_pillar', 'glowstone', 'sea_lantern',
  'quartz_block', 'smooth_quartz', 'quartz_bricks', 'chiseled_quartz_block', 'obsidian',
  'crying_obsidian', 'prismarine', 'prismarine_bricks', 'dark_prismarine',
  'honeycomb_block', 'hay_block', 'melon', 'pumpkin', 'carved_pumpkin', 'jack_o_lantern',
  'slime_block', 'honey_block', 'sponge', 'amethyst_block', 'budding_amethyst',
  // glass
  'glass', 'white_stained_glass', 'red_stained_glass', 'blue_stained_glass',
  'green_stained_glass', 'black_stained_glass', 'tinted_glass',
  // wool (all 16)
  'white_wool', 'orange_wool', 'magenta_wool', 'light_blue_wool', 'yellow_wool',
  'lime_wool', 'pink_wool', 'gray_wool', 'light_gray_wool', 'cyan_wool',
  'purple_wool', 'blue_wool', 'brown_wool', 'green_wool', 'red_wool', 'black_wool',
  // concrete (all 16)
  'white_concrete', 'orange_concrete', 'magenta_concrete', 'light_blue_concrete',
  'yellow_concrete', 'lime_concrete', 'pink_concrete', 'gray_concrete',
  'light_gray_concrete', 'cyan_concrete', 'purple_concrete', 'blue_concrete',
  'brown_concrete', 'green_concrete', 'red_concrete', 'black_concrete',
  // terracotta
  'terracotta', 'white_terracotta', 'orange_terracotta', 'red_terracotta',
  'light_blue_terracotta', 'cyan_terracotta', 'yellow_terracotta', 'brown_terracotta',
  // nether / end
  'netherrack', 'nether_bricks', 'soul_sand', 'soul_soil', 'magma_block',
  'glowstone_nether', 'crimson_planks', 'warped_planks', 'crimson_stem', 'warped_stem',
  'end_stone', 'end_stone_bricks', 'purpur_block', 'purpur_pillar',
  // copper oxidation
  'exposed_copper', 'weathered_copper', 'oxidized_copper', 'cut_copper',
];

// ---- section packing ---------------------------------------------------------
function ceilLog2(n) { return n <= 1 ? 0 : Math.ceil(Math.log2(n)); }

// Packs 4096 palette indices into modern (1.16+) padded longs.
function packPadded(indices, bits) {
  const perLong = Math.floor(64 / bits);
  const longs = [];
  for (let i = 0; i < indices.length; i += perLong) {
    let v = 0n;
    for (let j = 0; j < perLong && i + j < indices.length; j += 1) {
      v |= BigInt(indices[i + j] & ((1 << bits) - 1)) << BigInt(j * bits);
    }
    longs.push(BigInt.asIntN(64, v));
  }
  return longs;
}

// Builds one chunk NBT from a fill function (lx,ly,lz)->name|{name,props}|null
// over the single section (16x16x16, world Y 64..79). null/'air' is air.
function buildChunkNBT(chunkX, chunkZ, fill) {
  // Build palette + 4096 index array. Palette entries carry optional Properties.
  const palette = [{ name: 'air' }];
  const paletteIndex = new Map([['air', 0]]);
  const indices = new Uint16Array(4096);
  for (let i = 0; i < 4096; i += 1) {
    const x = i & 15;
    const z = (i >> 4) & 15;
    const y = (i >> 8) & 15;
    const val = fill(x, y, z) ?? 'air';
    const entry = typeof val === 'string' ? { name: val } : val;
    const key = `${entry.name}|${entry.props ? JSON.stringify(entry.props) : ''}`;
    let idx = paletteIndex.get(key);
    if (idx === undefined) { idx = palette.length; palette.push(entry); paletteIndex.set(key, idx); }
    indices[i] = idx;
  }

  const w = new NBTWriter();
  w.u8(TAG.COMPOUND).str('');
  w.tag(TAG.INT, 'DataVersion').be(DATA_VERSION, 4);
  w.tag(TAG.INT, 'xPos').be(chunkX, 4);
  w.tag(TAG.INT, 'zPos').be(chunkZ, 4);
  w.tag(TAG.LIST, 'sections').u8(TAG.COMPOUND).be(1, 4);
  w.tag(TAG.BYTE, 'Y').u8(SECTION_Y);
  w.tag(TAG.COMPOUND, 'block_states');
  w.tag(TAG.LIST, 'palette').u8(TAG.COMPOUND).be(palette.length, 4);
  for (const entry of palette) {
    w.tag(TAG.STRING, 'Name').str(`minecraft:${entry.name}`);
    if (entry.props) {
      w.tag(TAG.COMPOUND, 'Properties');
      for (const [pk, pv] of Object.entries(entry.props)) w.tag(TAG.STRING, pk).str(String(pv));
      w.end();
    }
    w.end();
  }
  if (palette.length > 1) {
    const bits = Math.max(4, ceilLog2(palette.length));
    const longs = packPadded(indices, bits);
    w.tag(TAG.LONG_ARRAY, 'data').be(longs.length, 4);
    for (const l of longs) w.be(l, 8);
  }
  w.end(); // block_states
  w.end(); // section
  w.end(); // root
  return w.build();
}

// ---- world layout ------------------------------------------------------------
// Diorama lives in chunk (0,0): a 16x16 footprint of natural terrain. The sample
// grid spreads across chunks (1,0),(2,0),(0,1)... as needed. We lay everything
// out in absolute world coords then bucket into chunks.

const placements = new Map(); // "wx,wy,wz" -> name
function put(wx, wy, wz, name) { placements.set(`${wx},${wy},${wz}`, name); }

// Natural diorama in chunk 0 (world x,z in 0..15).
for (let x = 0; x < 16; x += 1) {
  for (let z = 0; z < 16; z += 1) {
    put(x, 64, z, 'grass_block');
    put(x, 65, z, null);
  }
}
// water pool
for (let x = 2; x <= 5; x += 1) for (let z = 2; z <= 5; z += 1) { put(x, 64, z, 'water'); }
// sand patch
for (let x = 9; x <= 13; x += 1) for (let z = 9; z <= 13; z += 1) { put(x, 64, z, 'sand'); }
// two oak trees
function tree(bx, bz, leafName, logName) {
  for (let h = 65; h <= 68; h += 1) put(bx, h, bz, logName);
  for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) put(bx + dx, 69, bz + dz, leafName);
  put(bx, 70, bz, leafName);
}
tree(8, 4, 'oak_leaves', 'oak_log');
tree(12, 6, 'spruce_leaves', 'spruce_log');

// ---- shapes demo (chunk z=1): stairs, slabs, fences, panes, carpet, snow ----
for (let x = 0; x < 16; x += 1) for (let z = 17; z < 31; z += 1) put(x, 64, z, 'grass_block');
for (let s = 0; s < 5; s += 1) put(2 + s, 65 + s, 19, { name: 'oak_stairs', props: { half: 'bottom', facing: 'east' } });
for (let s = 0; s < 5; s += 1) put(2 + s, 65 + s, 21, { name: 'oak_stairs', props: { half: 'top', facing: 'east' } });
for (let x = 8; x < 14; x += 1) for (let z = 18; z < 21; z += 1) put(x, 65, z, { name: 'stone_brick_slab', props: { type: 'bottom' } });
for (let x = 8; x < 14; x += 1) put(x, 65, 22, { name: 'stone_brick_slab', props: { type: 'top' } });
for (let z = 24; z < 30; z += 1) put(2, 65, z, 'oak_fence');
for (let z = 24; z < 30; z += 1) { put(5, 65, z, 'glass_pane'); put(5, 66, z, 'glass_pane'); }
for (let x = 8; x < 12; x += 1) for (let z = 24; z < 28; z += 1) put(x, 65, z, 'white_carpet');
for (let x = 12; x < 15; x += 1) for (let z = 24; z < 28; z += 1) put(x, 65, z, { name: 'snow', props: { layers: '3' } });

// Sample grid: pillars spaced 3 apart, starting at world x=20, z=0. 12 columns.
const COLS = 12;
const SPACING = 3;
const GRID_X0 = 20;
const GRID_Z0 = 1;
SAMPLES.forEach((name, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const wx = GRID_X0 + col * SPACING;
  const wz = GRID_Z0 + row * SPACING;
  // small grass base so pillars are readable
  put(wx, 64, wz, 'grass_block');
  for (let h = 65; h <= 67; h += 1) put(wx, h, wz, name);
});

// ---- bucket placements into chunks & build region ----------------------------
const chunkFills = new Map(); // "cx,cz" -> Map("lx,ly,lz"->name)
for (const [k, name] of placements) {
  const [wx, wy, wz] = k.split(',').map(Number);
  const cx = Math.floor(wx / 16);
  const cz = Math.floor(wz / 16);
  const lx = wx - cx * 16;
  const lz = wz - cz * 16;
  const ly = wy - SECTION_BASE;
  if (ly < 0 || ly > 15) continue;
  const ck = `${cx},${cz}`;
  if (!chunkFills.has(ck)) chunkFills.set(ck, new Map());
  chunkFills.get(ck).set(`${lx},${ly},${lz}`, name);
}

// Build region r.0.0.mca holding all our chunks (all have cx,cz in 0..31).
async function buildRegion() {
  const SECTOR = 4096;
  const header = new Uint8Array(8192); // 4KiB locations + 4KiB timestamps
  const body = [];
  let sectorCursor = 2; // first 2 sectors are the header

  for (const [ck, fill] of chunkFills) {
    const [cx, cz] = ck.split(',').map(Number);
    const nbt = buildChunkNBT(cx, cz, (lx, ly, lz) => fill.get(`${lx},${ly},${lz}`) ?? null);
    const comp = await zlib(nbt);
    const payload = new Uint8Array(5 + comp.length);
    new DataView(payload.buffer).setUint32(0, 1 + comp.length, false);
    payload[4] = 2; // zlib
    payload.set(comp, 5);
    const sectors = Math.ceil(payload.length / SECTOR);
    const padded = new Uint8Array(sectors * SECTOR);
    padded.set(payload, 0);
    body.push(padded);

    const index = cz * 32 + cx; // matches importer: index%32=cx, floor(index/32)=cz
    const loc = index * 4;
    header[loc] = (sectorCursor >> 16) & 0xff;
    header[loc + 1] = (sectorCursor >> 8) & 0xff;
    header[loc + 2] = sectorCursor & 0xff;
    header[loc + 3] = sectors;
    sectorCursor += sectors;
  }

  let total = header.length;
  for (const b of body) total += b.length;
  const region = new Uint8Array(total);
  region.set(header, 0);
  let p = header.length;
  for (const b of body) { region.set(b, p); p += b.length; }
  return region;
}

function buildLevelNBT() {
  const w = new NBTWriter();
  w.u8(TAG.COMPOUND).str('');
  w.tag(TAG.COMPOUND, 'Data');
  w.tag(TAG.INT, 'SpawnX').be(24, 4);
  w.tag(TAG.INT, 'SpawnZ').be(8, 4);
  w.end();
  w.end();
  return w.build();
}

const out = process.argv[2] ?? '/tmp/voxel-showcase.zip';
const region = await buildRegion();
const level = await gzip(buildLevelNBT());
const zip = makeStoredZip([
  { name: 'showcase/level.dat', data: level },
  { name: 'showcase/region/r.0.0.mca', data: region },
]);
writeFileSync(out, zip);
console.log(`wrote ${out} (${zip.length} bytes), ${SAMPLES.length} sample blocks, ${chunkFills.size} chunks`);
