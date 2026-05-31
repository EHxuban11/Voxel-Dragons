// Minimal big-endian NBT encoder for tests (mirrors the format the parser reads).
const enc = new TextEncoder();

export const TAG = { BYTE: 1, SHORT: 2, INT: 3, LONG: 4, STRING: 8, LIST: 9, COMPOUND: 10, LONG_ARRAY: 12 };

export class NBTWriter {
  constructor() { this.bytes = []; }
  u8(n) { this.bytes.push(n & 0xff); return this; }
  be(value, size) {
    let v = BigInt(value);
    for (let i = size - 1; i >= 0; i -= 1) this.bytes.push(Number((v >> BigInt(8 * i)) & 0xffn));
    return this;
  }
  str(s) {
    const b = enc.encode(s);
    this.bytes.push(b.length >> 8, b.length & 0xff);
    for (const c of b) this.bytes.push(c);
    return this;
  }
  tag(type, name) { this.u8(type); return this.str(name); }
  end() { return this.u8(0); }
  build() { return Uint8Array.from(this.bytes); }
}

export async function gzip(bytes) {
  const s = new Response(bytes).body.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function zlib(bytes) {
  const s = new Response(bytes).body.pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
