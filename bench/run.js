// Benchmarks the compute-heavy, headless-measurable hot paths across the modular
// architecture. Per-frame gameplay (enemy AI, mesh rebuild) is FPS-critical but
// is coupled to Three.js/WebGL and needs in-browser profiling — out of scope for
// this headless suite, which targets the pure-compute modules that are the real
// candidates for a "migrate to faster code/WASM" pass.
//
// Run: node bench/run.js
import { bench, benchAsync, printTable } from './lib.js';
import { extractBlocks } from '../src/content/maps/custom/anvil.js';
import { parseNBT } from '../src/content/maps/custom/nbt.js';
import { importMinecraftMap } from '../src/content/maps/custom/importer.js';
import { meadow } from '../src/content/maps/meadow.js';
import { snowland } from '../src/content/maps/snowland.js';
import { NBTWriter, TAG, gzip, zlib } from '../tests/helpers/nbt-encode.js';
import { makeStoredZip } from '../tests/helpers/make-zip.js';
import { makeStubWorld } from '../tests/helpers/stub-world.js';

const ceilLog2 = (n) => (n <= 1 ? 0 : Math.ceil(Math.log2(n)));

// --- synthetic chunk for the Anvil block-state unpacker (the BigInt hot loop) -
function makeChunkObject(sections = 16, paletteSize = 40) {
  const palette = Array.from({ length: paletteSize }, (_, i) => ({ Name: `minecraft:block${i}` }));
  const bits = Math.max(4, ceilLog2(paletteSize));
  const perLong = Math.floor(64 / bits);
  const len = Math.ceil(4096 / perLong);
  const data = Array.from({ length: len }, (_, k) => {
    const hi = (Math.imul(k + 1, 2654435761) >>> 0).toString(16).padStart(8, '0');
    return BigInt.asIntN(64, BigInt(`0x${hi}9e3779b1`));
  });
  const secs = Array.from({ length: sections }, (_, s) => ({ Y: s, block_states: { palette, data } }));
  return { DataVersion: 3465, xPos: 0, zPos: 0, sections: secs };
}

// --- a real chunk encoded to NBT bytes (palette air/stone/slime, full section) -
function buildChunkBytes() {
  const w = new NBTWriter();
  w.u8(TAG.COMPOUND).str('');
  w.tag(TAG.INT, 'DataVersion').be(3465, 4);
  w.tag(TAG.INT, 'xPos').be(0, 4);
  w.tag(TAG.INT, 'zPos').be(0, 4);
  w.tag(TAG.LIST, 'sections').u8(TAG.COMPOUND).be(8, 4);
  for (let s = 0; s < 8; s += 1) {
    w.tag(TAG.BYTE, 'Y').u8(s);
    w.tag(TAG.COMPOUND, 'block_states');
    w.tag(TAG.LIST, 'palette').u8(TAG.COMPOUND).be(3, 4);
    w.tag(TAG.STRING, 'Name').str('minecraft:air').end();
    w.tag(TAG.STRING, 'Name').str('minecraft:stone').end();
    w.tag(TAG.STRING, 'Name').str('minecraft:slime_block').end();
    w.tag(TAG.LONG_ARRAY, 'data').be(256, 4);
    for (let k = 0; k < 256; k += 1) w.be(BigInt(k * 7 + 1), 8);
    w.end(); // block_states
    w.end(); // section
  }
  w.end(); // root
  return w.build();
}

async function buildWorldZip(chunksPerAxis = 4) {
  const chunkBytes = buildChunkBytes();
  const comp = await zlib(chunkBytes);
  const count = chunksPerAxis * chunksPerAxis;
  const sectors = Math.ceil((5 + comp.length) / 4096);
  const region = new Uint8Array(8192 + count * sectors * 4096);
  const dv = new DataView(region.buffer);
  let sector = 2;
  for (let cz = 0; cz < chunksPerAxis; cz += 1) {
    for (let cx = 0; cx < chunksPerAxis; cx += 1) {
      const index = cx + cz * 32;
      region[index * 4] = (sector >> 16) & 0xff;
      region[index * 4 + 1] = (sector >> 8) & 0xff;
      region[index * 4 + 2] = sector & 0xff;
      region[index * 4 + 3] = sectors;
      const off = sector * 4096;
      dv.setUint32(off, 1 + comp.length, false);
      region[off + 4] = 2;
      region.set(comp, off + 5);
      sector += sectors;
    }
  }
  const level = new NBTWriter();
  level.u8(TAG.COMPOUND).str('').tag(TAG.COMPOUND, 'Data')
    .tag(TAG.INT, 'SpawnX').be(0, 4).tag(TAG.INT, 'SpawnZ').be(0, 4).end().end();
  return makeStoredZip([
    { name: 'world/level.dat', data: await gzip(level.build()) },
    { name: 'world/region/r.0.0.mca', data: region },
  ]);
}

async function main() {
  const rows = [];

  // A. Anvil block-state unpacking — 16 sections * 4096 = 65536 blocks/call.
  const chunk = makeChunkObject(16, 40);
  let acc = 0;
  const onBlock = () => { acc += 1; };
  rows.push(bench('anvil.extractBlocks  (65 536 blocks)', () => { acc = 0; extractBlocks(chunk, 0, 0, onBlock); }, { iterations: 60 }));

  // B. NBT parse of a real chunk buffer.
  const chunkBytes = buildChunkBytes();
  rows.push(bench('nbt.parseNBT  (8-section chunk)', () => { parseNBT(chunkBytes); }, { iterations: 200 }));

  // C. Importer end-to-end on a 4x4-chunk synthetic world (zip+zlib+nbt+anvil+map).
  const worldZip = await buildWorldZip(4);
  const file = { name: 'world.zip', arrayBuffer: async () => worldZip.buffer.slice(worldZip.byteOffset, worldZip.byteOffset + worldZip.byteLength) };
  rows.push(await benchAsync('importer.importMinecraftMap  (16 chunks)', async () => { await importMinecraftMap(file); }, { iterations: 15 }));

  // D. Map generators (worldgen loop + string-keyed block Map), 80x80.
  rows.push(bench('maps.meadow.generate  (80x80)', () => { meadow.generate(makeStubWorld()); }, { iterations: 30 }));
  rows.push(bench('maps.snowland.generate  (80x80)', () => { snowland.generate(makeStubWorld()); }, { iterations: 30 }));

  printTable(rows);
  // keep `acc` observable so the unpack loop isn't optimized away
  if (acc < 0) console.log(acc);
}

main();
