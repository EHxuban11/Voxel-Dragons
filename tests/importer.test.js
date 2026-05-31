import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importMinecraftMap } from '../src/content/maps/custom/importer.js';
import { makeStubWorld } from './helpers/stub-world.js';
import { NBTWriter, TAG, gzip, zlib } from './helpers/nbt-encode.js';

// Build a 1.18 chunk: palette [air, stone, slime_block]; stone at index 0,
// slime at block index 17 (bits=4, padded packing -> long1 = 2<<4 = 32).
function buildChunkNBT() {
  const w = new NBTWriter();
  w.u8(TAG.COMPOUND).str('');
  w.tag(TAG.INT, 'DataVersion').be(3465, 4);
  w.tag(TAG.INT, 'xPos').be(0, 4);
  w.tag(TAG.INT, 'zPos').be(0, 4);
  w.tag(TAG.LIST, 'sections').u8(TAG.COMPOUND).be(1, 4);
  w.tag(TAG.BYTE, 'Y').u8(4);
  w.tag(TAG.COMPOUND, 'block_states');
  w.tag(TAG.LIST, 'palette').u8(TAG.COMPOUND).be(3, 4);
  w.tag(TAG.STRING, 'Name').str('minecraft:air').end();
  w.tag(TAG.STRING, 'Name').str('minecraft:stone').end();
  w.tag(TAG.STRING, 'Name').str('minecraft:slime_block').end();
  w.tag(TAG.LONG_ARRAY, 'data').be(256, 4);
  w.be(1n, 8).be(32n, 8);
  for (let k = 2; k < 256; k += 1) w.be(0n, 8);
  w.end(); // block_states
  w.end(); // section
  w.end(); // root
  return w.build();
}

function buildLevelNBT() {
  const w = new NBTWriter();
  w.u8(TAG.COMPOUND).str('');
  w.tag(TAG.COMPOUND, 'Data');
  w.tag(TAG.INT, 'SpawnX').be(0, 4);
  w.tag(TAG.INT, 'SpawnZ').be(0, 4);
  w.end();
  w.end();
  return w.build();
}

async function buildRegion() {
  const comp = await zlib(buildChunkNBT());
  const sectors = Math.ceil((5 + comp.length) / 4096);
  const region = new Uint8Array(8192 + sectors * 4096);
  const dv = new DataView(region.buffer);
  region[2] = 2; region[3] = sectors;     // location entry 0 -> sector 2
  dv.setUint32(8192, 1 + comp.length, false);
  region[8192 + 4] = 2;                    // zlib compression
  region.set(comp, 8192 + 5);
  return region;
}

test('imports a synthetic Minecraft world end-to-end', async () => {
  const { makeStoredZip } = await import('./helpers/make-zip.js');
  const zipBytes = makeStoredZip([
    { name: 'world/level.dat', data: await gzip(buildLevelNBT()) },
    { name: 'world/region/r.0.0.mca', data: await buildRegion() },
  ]);
  const file = { name: 'world.zip', arrayBuffer: async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) };

  const map = await importMinecraftMap(file);

  assert.equal(map.dimensions.width, 64);
  assert.equal(map.dimensions.maxHeight, 48);
  // slime_block has no game equivalent -> dynamic block tinted slime-green.
  assert.ok(map.extraBlocks.mc_slime_block, 'slime should become a dynamic block');
  assert.equal(map.extraBlocks.mc_slime_block.color, 0x7ac74f);

  // generate() must place a stone floor + the two clipped blocks (top layers kept -> y 47).
  const world = makeStubWorld(map.dimensions);
  map.generate(world);
  assert.equal(world.getBlock(0, 47, 0), 'stone');
  assert.equal(world.getBlock(1, 47, 1), 'mc_slime_block');
  assert.equal(world.getBlock(0, 0, 0), 'stone'); // floor
});
