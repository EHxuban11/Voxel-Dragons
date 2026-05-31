import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev-only profiling bridge: the in-browser profiler POSTs snapshots to
// /__profile while you play, and they are written to profiling/ so the agent
// (and you) can read and analyze real-hardware performance. See the `profiling`
// skill and src/dev/profileExporter.js. Never active in `vite build`.
function profileBridge() {
  return {
    name: 'voxel-profile-bridge',
    apply: 'serve',
    configureServer(server) {
      const dir = resolve(server.config.root, 'profiling');
      server.middlewares.use('/__profile', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            mkdirSync(dir, { recursive: true });
            const data = body || '{}';
            const day = new Date().toISOString().slice(0, 10);
            writeFileSync(resolve(dir, 'latest.json'), data);
            appendFileSync(resolve(dir, `session-${day}.jsonl`), `${data.replace(/\s*\n\s*/g, ' ')}\n`);
            res.statusCode = 204;
            res.end();
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  server: { host: '127.0.0.1' },
  plugins: [profileBridge()],
});
