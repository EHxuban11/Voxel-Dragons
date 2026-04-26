export class Inventory {
  constructor() {
    this.slots = [
      { kind: 'block', type: 'grass', label: 'Cesped', count: 32, color: '#58a548' },
      { kind: 'block', type: 'dirt', label: 'Tierra', count: 48, color: '#8b5a2b' },
      { kind: 'block', type: 'stone', label: 'Piedra', count: 48, color: '#7b7f86' },
      { kind: 'block', type: 'sand', label: 'Arena', count: 24, color: '#d8c477' },
      { kind: 'block', type: 'wood', label: 'Madera', count: 24, color: '#8a5a32' },
      { kind: 'weapon', weaponIndex: 0, label: 'Rifle', count: null, color: '#ffd166' },
      { kind: 'weapon', weaponIndex: 1, label: 'Shotgun', count: null, color: '#ff9f1c' },
      { kind: 'weapon', weaponIndex: 2, label: 'Blaster', count: null, color: '#54d2ff' },
    ];
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
