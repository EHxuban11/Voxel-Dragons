import './styles.css';
import { Game } from './modules/Game.js';
import { Menu } from './modules/Menu.js';
import { CHARACTERS } from './modules/Characters.js';
import { MAPS } from './modules/maps/index.js';

const root = document.querySelector('#app');

function showMenu() {
  const menu = new Menu(root, CHARACTERS, MAPS, (character, map) => {
    menu.hide();
    const game = new Game(root, { character, map, onExit: showMenu });
    game.start();
  });
}

showMenu();
