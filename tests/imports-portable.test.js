// Cross-platform safety net. The game ships as a browser bundle, so "runs on
// Windows/Mac/Linux" comes down to the toolchain (Node+Vite, both portable) and
// the source being free of OS-specific assumptions. The one trap that passes on
// case-insensitive macOS/Windows but breaks on case-sensitive Linux is an import
// whose casing doesn't match the file on disk — so we verify every relative
// import resolves with EXACT case. We also guard against CRLF creeping into JS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// True only if every path segment from ROOT down to `abs` matches on-disk case.
function existsExactCase(abs) {
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..')) return fs.existsSync(abs); // outside the repo: don't case-check
  let dir = ROOT;
  for (const seg of rel.split(path.sep)) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return false; }
    if (!entries.includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}

function resolveSpec(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = /\.[a-z]+$/i.test(spec)
    ? [base]
    : [`${base}.js`, path.join(base, 'index.js')];
  return candidates;
}

const FILES = walk(SRC);
const IMPORT_RE = /\b(?:import|export)\b[^'"]*?\bfrom\s*['"](\.[^'"]+)['"]/g;
const BARE_IMPORT_RE = /\bimport\s*['"](\.[^'"]+)['"]/g; // side-effect imports: import './x.js'

test('source tree is non-trivial', () => {
  assert.ok(FILES.length > 30, `expected many source files, found ${FILES.length}`);
});

test('every relative import resolves with exact case (Linux-safe)', () => {
  const problems = [];
  for (const file of FILES) {
    const text = fs.readFileSync(file, 'utf8');
    const specs = new Set();
    for (const m of text.matchAll(IMPORT_RE)) specs.add(m[1]);
    for (const m of text.matchAll(BARE_IMPORT_RE)) specs.add(m[1]);
    for (const spec of specs) {
      const ok = resolveSpec(file, spec).some(existsExactCase);
      if (!ok) problems.push(`${path.relative(ROOT, file)}  ->  ${spec}`);
    }
  }
  assert.deepEqual(problems, [], `imports that won't resolve on a case-sensitive filesystem:\n${problems.join('\n')}`);
});

test('no CRLF line endings in source (avoids Windows churn / parser quirks)', () => {
  const offenders = FILES.filter((f) => fs.readFileSync(f, 'utf8').includes('\r\n'));
  assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), [], 'files contain CRLF');
});
