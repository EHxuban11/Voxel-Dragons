import './styles.css';
import { Game } from './modules/Game.js';

const root = document.querySelector('#app');
const game = new Game(root);
game.start();
