import './styles.css';
import { Game } from './game/Game.js';
import { Menu } from './ui/Menu.js';
import { CHARACTERS } from './content/characters/Characters.js';
import { MAPS } from './content/maps/index.js';
import { createWebPlatform } from './platform/web/createWebPlatform.js';

const root = document.querySelector('#app');

// Composition root: the only place that knows the concrete host. It builds the
// browser platform and injects it into the game; a fresh platform is created
// per run and torn down when the game disposes (on return to the menu).
function showMenu() {
  const menu = new Menu(root, CHARACTERS, MAPS, (character, map) => {
    menu.hide();
    const platform = createWebPlatform({ root });
    const game = new Game(root, { platform, character, map, onExit: showMenu });
    game.start();
  });
}

showMenu();
