import './styles.css';
import { Game } from './modules/Game.js';
import { Menu, promptUsername } from './modules/Menu.js';
import { CHARACTERS } from './modules/Characters.js';

const root = document.querySelector('#app');

let username = 'Jugador';

function showMenu() {
  const menu = new Menu(root, CHARACTERS, (character) => {
    menu.hide();
    const game = new Game(root, { character, username, onExit: showMenu });
    game.start();
  });
}

// Ask for the username once, before the first character selection.
promptUsername(root, (name) => {
  username = name;
  showMenu();
});
