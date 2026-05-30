const GUN_SLOTS = [
  { kind: 'weapon', weaponIndex: 0, label: 'Rifle', count: null, color: '#ffd166' },
  { kind: 'weapon', weaponIndex: 1, label: 'Shotgun', count: null, color: '#ff9f1c' },
  { kind: 'weapon', weaponIndex: 2, label: 'Blaster', count: null, color: '#54d2ff' },
  { kind: 'weapon', weaponIndex: 3, label: 'Pistola', count: null, color: '#fff0a0' },
];

const BLOCK_SLOTS = [
  { kind: 'block', type: 'wood', label: 'Madera', count: 40, color: '#8a5a32' },
];

const SWORD_SLOT = { kind: 'melee', model: 'sword', label: 'Espada', count: null, color: '#d7dde6' };
const KATANA_SLOT = { kind: 'melee', model: 'katana', label: 'Katana', count: null, color: '#e8e2d0' };
const DAGGER_SLOT = { kind: 'weapon', weaponIndex: 4, label: 'Daga', count: null, color: '#cfd6df' };

function buildSlots(character) {
  if (character?.loadout === 'sword') {
    return [{ ...SWORD_SLOT }];
  }
  if (character?.loadout === 'katana') {
    return [{ ...KATANA_SLOT }];
  }
  if (character?.loadout === 'dagger') {
    return [
      { ...DAGGER_SLOT },
      { kind: 'ability', abilityId: 'bomb', label: 'Bomba', count: 2, color: '#3b3b3b' },
      { kind: 'ability', abilityId: 'aerial', label: 'ataque to guapo', count: null, color: '#66ccff' },
    ];
  }
  // Default (duck): guns plus buildable blocks.
  const slots = GUN_SLOTS.map((slot) => ({ ...slot }));
  if (character?.canPlaceBlocks !== false) {
    slots.push(...BLOCK_SLOTS.map((slot) => ({ ...slot })));
  }
  return slots;
}

export class Inventory {
  constructor(character = null) {
    this.slots = buildSlots(character);
    this.selectedIndex = 0;
    this.open = false;
  }

  get selectedSlot() {
    return this.slots[this.selectedIndex];
  }

  select(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) return false;
    this.selectedIndex = index;
    return true;
  }

  next() {
    this.selectedIndex = (this.selectedIndex + 1) % this.slots.length;
  }

  previous() {
    this.selectedIndex = (this.selectedIndex - 1 + this.slots.length) % this.slots.length;
  }

  toggleOpen() {
    this.open = !this.open;
    return this.open;
  }

  canPlaceSelected() {
    const slot = this.selectedSlot;
    return slot?.kind === 'block' && slot.count > 0;
  }

  consumeSelectedBlock() {
    if (!this.canPlaceSelected()) return null;
    this.selectedSlot.count -= 1;
    return this.selectedSlot.type;
  }

  addBlock(type, amount = 1) {
    const slot = this.slots.find((entry) => entry.kind === 'block' && entry.type === type);
    if (!slot) return false;
    slot.count += Math.max(1, amount);
    return true;
  }

  snapshot() {
    return {
      open: this.open,
      selectedIndex: this.selectedIndex,
      slots: this.slots.map((slot) => ({ ...slot })),
    };
  }
}

export default Inventory;
