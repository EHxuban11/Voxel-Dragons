// Programmatic colour-fidelity check: for every block in the Minecraft reference
// table (/tmp/mc-ref.json), resolve it through blockData and compare the colour
// the game will render against the real Minecraft texture colour. Flags large
// deltas so we can spot wrong hexes / palette bugs without eyeballing.
//
//   nvm use 22.12.0 && node tools/check-fidelity.mjs [threshold]

import { readFileSync } from 'node:fs';
import { resolveBlock } from '../src/content/maps/custom/blockData.js';

const ref = JSON.parse(readFileSync('/tmp/mc-ref.json', 'utf8'));
const THRESH = Number(process.argv[2] ?? 70); // Euclidean RGB distance

// Built-in game-type base colours (engine/World.js BLOCK_TYPES).
const BUILTIN = {
  grass: 0x58a548, dirt: 0x8b5a2b, stone: 0x7b7f86, sand: 0xd8c477,
  snow: 0xf3f7fb, ice: 0xa7d8ef, water: 0x2f8ed8, lava: 0xd24a12, wood: 0x8a5a32,
  leaves: 0x2f7d32, spruce_log: 0x4a3320, spruce_leaves: 0x28452f,
};

function toRGB(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }
function parseHex(s) { return typeof s === 'number' ? s : parseInt(String(s).replace(/^0x/i, '').slice(0, 6), 16); }
function dist(a, b) { const [r1, g1, b1] = toRGB(a); const [r2, g2, b2] = toRGB(b); return Math.round(Math.hypot(r1 - r2, g1 - g2, b1 - b2)); }

function resolvedColor(name) {
  const r = resolveBlock(name);
  if (r.skip) return { skip: true };
  if (r.type) return { color: BUILTIN[r.type] ?? null, via: `builtin:${r.type}` };
  const s = r.spec;
  if (s.faces) return { color: s.faces.top.color, via: `face/${s.faces.top.kind ?? 'speckle'}` };
  // ore renders mostly its stone base with a few gem specks → compare the base.
  if (s.texture === 'ore') return { color: s.baseColor ?? 0x7e7e7e, via: 'ore-base' };
  return { color: s.color, via: s.texture ?? 'speckle' };
}

const rows = [];
let skipped = 0; let ok = 0;
for (const [name, info] of Object.entries(ref)) {
  const target = parseHex(info.top);
  const got = resolvedColor(name);
  if (got.skip) { skipped += 1; continue; }
  if (got.color == null) { rows.push({ name, d: 999, got: 'NULL', via: got.via, ref: info.top, cat: info.cat }); continue; }
  const d = dist(target, got.color);
  if (d > THRESH) {
    rows.push({ name, d, got: '0x' + got.color.toString(16).padStart(6, '0'), via: got.via, ref: info.top, cat: info.cat });
  } else ok += 1;
}

rows.sort((a, b) => b.d - a.d);
console.log(`Reference blocks: ${Object.keys(ref).length} | within ${THRESH}: ${ok} | skipped: ${skipped} | FLAGGED: ${rows.length}\n`);
for (const r of rows) {
  console.log(`Δ${String(r.d).padStart(3)}  ${r.name.padEnd(30)} ref ${r.ref}  got ${r.got.padEnd(10)} (${r.via})  [${r.cat}]`);
}
