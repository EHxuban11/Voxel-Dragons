// Builds a minimal STORED (uncompressed) .zip in memory, no external tools — so
// the importer test runs identically on Windows and Mac. The game's ZipArchive
// reader does not verify CRCs, so they are left as 0.
const enc = new TextEncoder();

export function makeStoredZip(files) {
  // files: [{ name, data: Uint8Array }]
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const localOffset = offset;

    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), // sig, version, flags, method(0=stored)
      ...u16(0), ...u16(0), ...u32(0),                       // time, date, crc32(0)
      ...u32(data.length), ...u32(data.length),              // comp size, uncomp size
      ...u16(nameBytes.length), ...u16(0),                   // name len, extra len
      ...nameBytes,
    ];
    chunks.push(Uint8Array.from(local), data);
    offset += local.length + data.length;

    central.push(...[
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), // sig, made-by, need, flags, method
      ...u16(0), ...u16(0), ...u32(0),                                   // time, date, crc
      ...u32(data.length), ...u32(data.length),                          // sizes
      ...u16(nameBytes.length), ...u16(0), ...u16(0),                    // name, extra, comment lens
      ...u16(0), ...u16(0), ...u32(0),                                   // disk, int attrs, ext attrs
      ...u32(localOffset),
      ...nameBytes,
    ]);
  }

  const centralStart = offset;
  const centralBytes = Uint8Array.from(central);
  const eocd = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralBytes.length), ...u32(centralStart),
    ...u16(0),
  ]);

  const total = centralStart + centralBytes.length + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  out.set(centralBytes, p); p += centralBytes.length;
  out.set(eocd, p);
  return out;
}
