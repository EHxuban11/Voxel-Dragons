// AssemblyScript source for the Anvil block-state unpacker, compiled to WASM.
// WASM has native u64, so the 64-bit bit math that JavaScript can only do via
// (slow) BigInt runs at machine speed here.
//
// Linear-memory layout (set up from JS): the packed `data` longs live at byte 0,
// the unpacked u16 indices are written starting at byte 16384.
// Build: npm run build:wasm  (regenerates src/.../anvil-unpack-wasm.js)

const DATA_OFF: usize = 0;
const OUT_OFF: usize = 16384;

export function unpack(bits: i32, count: i32, padded: i32): void {
  const mask: u64 = ((<u64>1) << (<u64>bits)) - 1;

  if (padded != 0) {
    // Modern (1.16+): entries never span a 64-bit boundary.
    const perLong: i32 = 64 / bits;
    for (let i: i32 = 0; i < count; i++) {
      const li: i32 = i / perLong;
      const shift: i32 = (i % perLong) * bits;
      const v: u64 = load<u64>(DATA_OFF + (<usize>li << 3));
      store<u16>(OUT_OFF + (<usize>i << 1), <u16>((v >> (<u64>shift)) & mask));
    }
  } else {
    // Legacy (pre-1.16): tight packing can span 64-bit boundaries.
    for (let i: i32 = 0; i < count; i++) {
      const bitPos: i32 = i * bits;
      const li: i32 = bitPos >> 6;
      const offset: i32 = bitPos & 63;
      let value: u64 = load<u64>(DATA_OFF + (<usize>li << 3)) >> (<u64>offset);
      if (offset + bits > 64) {
        value |= load<u64>(DATA_OFF + ((<usize>li + 1) << 3)) << (<u64>(64 - offset));
      }
      store<u16>(OUT_OFF + (<usize>i << 1), <u16>(value & mask));
    }
  }
}
