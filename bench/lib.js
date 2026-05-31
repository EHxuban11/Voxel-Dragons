// Tiny benchmarking helper: warmup + timed samples, reports median/mean/min.
// Pure Node (performance.now), no dependencies — runs identically on Win/Mac.

export function bench(name, fn, { iterations = 50, warmup = 5 } = {}) {
  for (let i = 0; i < warmup; i += 1) fn();
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return summarize(name, samples, iterations);
}

export async function benchAsync(name, fn, { iterations = 20, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i += 1) await fn();
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return summarize(name, samples, iterations);
}

function summarize(name, samples, iterations) {
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { name, median, mean, min: samples[0], iterations };
}

export function printTable(rows) {
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  const nameW = Math.max(...rows.map((r) => r.name.length), 8) + 2;
  console.log(`\n${pad('module / hot path', nameW)}${padL('median ms', 12)}${padL('mean ms', 11)}${padL('min ms', 10)}${padL('iters', 8)}`);
  console.log('-'.repeat(nameW + 41));
  for (const r of rows) {
    console.log(`${pad(r.name, nameW)}${padL(r.median.toFixed(3), 12)}${padL(r.mean.toFixed(3), 11)}${padL(r.min.toFixed(3), 10)}${padL(r.iterations, 8)}`);
  }
  console.log('');
}
