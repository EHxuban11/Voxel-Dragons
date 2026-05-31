import './styles.css';
import { Game } from './game/Game.js';
import { Menu } from './ui/Menu.js';
import { CHARACTERS } from './content/characters/Characters.js';
import { MAPS } from './content/maps/index.js';

const root = document.querySelector('#app');

function showMenu() {
  const menu = new Menu(root, CHARACTERS, MAPS, (character, map) => {
    menu.hide();
    const game = new Game(root, { character, map, onExit: showMenu });
    game.start();
  });
}

showMenu();
