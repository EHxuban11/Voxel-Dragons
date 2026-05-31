// Screenshot harness for visual verification of the importer.
//
//   nvm use 22.12.0 && node tools/shot.mjs <zipPath> <outDir> [angleTag]
//
// Drives the running dev server (http://127.0.0.1:5174) with the npx-cached
// Playwright + bundled headless chromium (software WebGL via SwiftShader):
//   1. uploads the .zip through the real menu import flow,
//   2. starts the game on the imported map,
//   3. parks a dev spectator camera (window.__voxel) at several angles,
//   4. writes PNGs.
//
// Requires the dev server up and Node >= 18. Resolves Playwright dynamically.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);

function findPlaywright() {
  const out = execSync('find ~/.npm/_npx -maxdepth 4 -type d -name playwright 2>/dev/null | head -1', { shell: '/bin/zsh' })
    .toString().trim();
  if (!out) throw new Error('Playwright not found in npx cache. Run `npx playwright --version` once.');
  return out;
}

const zipPath = process.argv[2] ?? '/tmp/voxel-showcase.zip';
const outDir = process.argv[3] ?? '/tmp/voxel-shots';
const URL = 'http://127.0.0.1:5174/';
if (!existsSync(zipPath)) throw new Error(`zip not found: ${zipPath}`);
mkdirSync(outDir, { recursive: true });

const pw = require(findPlaywright());
const { chromium } = pw;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('[data-menu="file"]', { state: 'attached' });

// Upload the world through the real import flow and wait for it to finish.
await page.setInputFiles('[data-menu="file"]', zipPath);
await page.waitForFunction(() => {
  const s = document.querySelector('[data-menu="status"]');
  return s && /importado|No se pudo/i.test(s.textContent || '');
}, { timeout: 60000 });
const status = await page.$eval('[data-menu="status"]', (n) => n.textContent);
console.log('import status:', status);

// Start the game on the imported (auto-selected) map.
await page.click('[data-menu="start"]');
await page.waitForFunction(() => window.__voxel && window.__voxel.game && window.__voxel.game.world, { timeout: 30000 });

const dims = await page.evaluate(() => {
  const o = window.__voxel.game.world.options;
  return { width: o.width, depth: o.depth, maxHeight: o.maxHeight };
});
console.log('world dims:', dims);

// A few spectator angles around the build centre (world origin is the centre).
const span = Math.max(dims.width, dims.depth);
const h = dims.maxHeight;
const tag = process.argv[4] ? `-${process.argv[4]}` : '';
const shots = [
  ['aerial', [0, span * 1.05 + h, span * 0.55], [0, 0, 0]],
  ['iso', [span * 0.62, h + span * 0.45, span * 0.62], [0, h * 0.3, 0]],
  ['ground', [span * 0.30, h * 0.6 + 2, span * 0.30], [0, h * 0.35, 0]],
];

for (const [name, pos, target] of shots) {
  await page.evaluate(([p, t]) => window.__voxel.game.setSpectator(p, t), [pos, target]);
  await page.waitForTimeout(700);
  const file = `${outDir}/${name}${tag}.png`;
  await page.screenshot({ path: file });
  console.log('wrote', file);
}

if (errors.length) console.log('PAGE ERRORS:\n' + errors.slice(0, 20).join('\n'));
await browser.close();
