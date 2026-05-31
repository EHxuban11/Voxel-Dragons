import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory } from '../src/game/Inventory.js';
import { getCharacter } from '../src/content/characters/Characters.js';

test('duck inventory has guns + a wood block slot', () => {
  const inv = new Inventory(getCharacter('duck'));
  assert.ok(inv.slots.length > 0);
  assert.ok(inv.slots.some((s) => s.kind === 'weapon'));
  assert.ok(inv.slots.some((s) => s.kind === 'block' && s.type === 'wood'));
});

test('selection wraps with next/previous', () => {
  const inv = new Inventory(getCharacter('duck'));
  const n = inv.slots.length;
  inv.select(n - 1);
  inv.next();
  assert.equal(inv.selectedIndex, 0);
  inv.previous();
  assert.equal(inv.selectedIndex, n - 1);
});

test('placing a block decrements its count and respects empty', () => {
  const inv = new Inventory(getCharacter('duck'));
  const idx = inv.slots.findIndex((s) => s.kind === 'block');
  inv.select(idx);
  const before = inv.selectedSlot.count;
  assert.ok(inv.canPlaceSelected());
  inv.consumeSelectedBlock();
  assert.equal(inv.selectedSlot.count, before - 1);
  inv.selectedSlot.count = 0;
  assert.equal(inv.canPlaceSelected(), false);
  assert.equal(inv.consumeSelectedBlock(), null);
});

test('non-block characters cannot place', () => {
  const inv = new Inventory(getCharacter('knight'));
  assert.equal(inv.canPlaceSelected(), false);
});
