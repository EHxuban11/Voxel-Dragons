// Targeted screenshot: import a zip, start the game, park the spectator camera
// at an explicit position/target, write one PNG. For inspecting specific blocks.
//
//   node tools/shot-aim.mjs <zip> <out.png> px py pz tx ty tz

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const pwDir = execSync('find ~/.npm/_npx -maxdepth 4 -type d -name playwright 2>/dev/null | head -1', { shell: '/bin/zsh' }).toString().trim();
const { chromium } = require(pwDir);

const [zip, out, px, py, pz, tx, ty, tz] = process.argv.slice(2);
const pos = [Number(px), Number(py), Number(pz)];
const target = [Number(tx) || 0, Number(ty) || 0, Number(tz) || 0];

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'load' });
await page.waitForSelector('[data-menu="file"]', { state: 'attached' });
await page.setInputFiles('[data-menu="file"]', zip);
await page.waitForFunction(() => /importado|No se pudo/i.test(document.querySelector('[data-menu="status"]')?.textContent || ''), { timeout: 60000 });
await page.click('[data-menu="start"]');
await page.waitForFunction(() => window.__voxel?.game?.world, { timeout: 30000 });
await page.evaluate(([p, t]) => window.__voxel.game.setSpectator(p, t), [pos, target]);
await page.waitForTimeout(800);
await page.screenshot({ path: out });
console.log('wrote', out, 'pos', pos, 'target', target);
if (errors.length) console.log('ERRORS:', errors.slice(0, 8).join(' | '));
await browser.close();
