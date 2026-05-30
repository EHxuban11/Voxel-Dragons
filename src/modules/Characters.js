// Playable characters. No 3D models are needed — only the loadout and the
// special ability differ. The menu shows the name + emoji of each one.
export const CHARACTERS = [
  {
    id: 'duck',
    name: 'Pato',
    emoji: '🦆',
    loadout: 'guns', // rifle / shotgun / blaster + buildable blocks
    canPlaceBlocks: true,
    ability: 'place', // right click places blocks
  },
  {
    id: 'knight',
    name: 'Caballero',
    emoji: '⚔️',
    loadout: 'sword', // melee sword
    canPlaceBlocks: false,
    ability: 'guard', // right click raises a parrying guard
  },
  {
    id: 'hunter',
    name: 'Cazador',
    emoji: '🔪',
    loadout: 'dagger', // throws daggers that arc with gravity
    canPlaceBlocks: false,
    ability: 'dash', // right click / F dashes in the movement direction
  },
];

export function getCharacter(id) {
  return CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0];
}

export default CHARACTERS;
