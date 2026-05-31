import './styles.css';
import { Game } from './game/Game.js';
import { Menu } from './ui/Menu.js';
import { CHARACTERS } from './content/characters/Characters.js';
import { MAPS } from './content/maps/index.js';
import { createWebPlatform } from './platform/web/createWebPlatform.js';
import { importMinecraftMap } from './content/maps/custom/importer.js';

const root = document.querySelector('#app');

let currentGame = null;

// Composition root: the only place that knows the concrete host. It builds the
// browser platform and injects it into the game; a fresh platform is created
// per run and torn down when the game disposes (on return to the menu).
function startGame(character, map) {
  const platform = createWebPlatform({ root });
  currentGame = new Game(root, { platform, character, map, onExit: showMenu });
  currentGame.start();
  return currentGame;
}

function showMenu() {
  const menu = new Menu(root, CHARACTERS, MAPS, (character, map) => {
    menu.hide();
    startGame(character, map);
  });
}

showMenu();

// Dev-only hook for the screenshot/verification harness (tools/shot.mjs). Guarded
// by import.meta.env.DEV so it is stripped from production builds. Mirrors the
// profileBridge dev-only convention.
if (import.meta.env.DEV) {
  window.__voxel = {
    CHARACTERS,
    MAPS,
    importMinecraftMap,
    startGame,
    get game() { return currentGame; },
  };
}
