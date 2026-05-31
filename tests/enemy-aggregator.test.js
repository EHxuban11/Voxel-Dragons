import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnemyAggregator } from '../src/game/enemies/EnemyAggregator.js';

// A fake manager records calls and exposes a scripted ray peek/alive count.
function fakeManager(tag, { rayDistance = null, alive = 0 } = {}) {
  const calls = [];
  const list = Array.from({ length: alive }, (_, i) => ({ dead: false, mesh: { position: { distanceTo: () => 99 } }, id: i }));
  return {
    tag, calls, [`${tag}s`]: list,
    hitMelee: () => { calls.push('hitMelee'); return [tag]; },
    hitBox: () => { calls.push('hitBox'); return [tag]; },
    knockback: (...a) => calls.push(['knockback', ...a]),
    slow: () => calls.push('slow'),
    tornadoPull: () => calls.push('tornadoPull'),
    heal: () => calls.push('heal'),
    hitAllByRay: () => { calls.push('hitAllByRay'); return [tag]; },
    peekRay: () => (rayDistance == null ? null : { distance: rayDistance }),
    applyRayHit: (peek, dmg) => ({ tag, dmg, distance: peek.distance }),
    getAliveCount: () => alive,
  };
}

test('fans melee/box/allByRay out to every manager and concatenates', () => {
  const dragons = fakeManager('dragon');
  const zombies = fakeManager('zombie');
  const skeletons = fakeManager('skeleton');
  const witches = fakeManager('witch');
  const enemies = createEnemyAggregator({ dragons, zombies, skeletons, witches, world: {} });

  assert.deepEqual(enemies.hitMelee(0, 0, 0, 0, 0).sort(), ['dragon', 'skeleton', 'witch', 'zombie']);
  assert.deepEqual(enemies.hitAllByRay({}, 1).sort(), ['dragon', 'skeleton', 'witch', 'zombie']);
  assert.equal(enemies.aliveCount(), 0);
});

test('hitByRay resolves against the nearest manager only', () => {
  const dragons = fakeManager('dragon', { rayDistance: 10 });
  const zombies = fakeManager('zombie', { rayDistance: 3 });   // closest
  const skeletons = fakeManager('skeleton', { rayDistance: 7 });
  const witches = fakeManager('witch'); // no hit
  const enemies = createEnemyAggregator({ dragons, zombies, skeletons, witches, world: {} });

  const hit = enemies.hitByRay({}, 25);
  assert.equal(hit.tag, 'zombie');
  assert.equal(hit.distance, 3);
});

test('knockback forwards the world; tornadoPull skips dragons', () => {
  const world = { id: 'world' };
  const dragons = fakeManager('dragon');
  const zombies = fakeManager('zombie');
  const skeletons = fakeManager('skeleton');
  const witches = fakeManager('witch');
  const enemies = createEnemyAggregator({ dragons, zombies, skeletons, witches, world });

  enemies.knockback({ x: 0 }, 5, 2);
  // recorded as ['knockback', center, radius, force, world]
  assert.ok(dragons.calls.some((c) => Array.isArray(c) && c[0] === 'knockback' && c[4] === world));

  enemies.tornadoPull({ x: 0 }, 5, 0);
  assert.ok(!dragons.calls.includes('tornadoPull'), 'dragons must not be tornado-pulled');
  assert.ok(zombies.calls.includes('tornadoPull'));
});
