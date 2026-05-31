import { getCharacterArt } from './CharacterArt.js';

const STYLE_ID = 'voxel-dragons-menu-style';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vd-menu {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 22px;
      color: #f7fbff;
      font-family: Arial, Helvetica, sans-serif;
      text-align: center;
      background:
        radial-gradient(circle at 50% 18%, rgba(120, 190, 255, 0.35), transparent 60%),
        linear-gradient(180deg, #1b2a3a 0%, #0d141d 100%);
      user-select: none;
    }

    .vd-menu-title {
      font-size: clamp(32px, 6vw, 64px);
      font-weight: 800;
      letter-spacing: 2px;
      margin: 0;
      text-shadow: 0 4px 0 rgba(0, 0, 0, 0.55);
    }

    .vd-menu-subtitle {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 1px;
      color: rgba(231, 246, 255, 0.78);
      text-transform: uppercase;
    }

    .vd-menu-characters {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .vd-char-card {
      width: 150px;
      padding: 18px 14px;
      box-sizing: border-box;
      background: rgba(20, 28, 38, 0.72);
      border: 3px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      cursor: pointer;
      transition: transform 120ms ease-out, border-color 120ms ease-out, background 120ms ease-out;
    }

    .vd-char-card:hover {
      transform: translateY(-3px);
      background: rgba(36, 48, 62, 0.82);
    }

    .vd-char-card.is-selected {
      border-color: #ffd166;
      background: rgba(48, 64, 82, 0.92);
      transform: translateY(-4px);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4);
    }

    .vd-char-art {
      width: 84px;
      height: 84px;
      margin: 0 auto;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 100% 100%;
      image-rendering: pixelated;
      filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.45));
    }

    .vd-char-name {
      margin-top: 12px;
      font-size: 18px;
      font-weight: 800;
    }

    .vd-menu-start {
      margin-top: 6px;
      padding: 14px 42px;
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 1px;
      color: #102014;
      background: linear-gradient(180deg, #8be36a, #49a82f);
      border: none;
      border-radius: 10px;
      cursor: pointer;
      box-shadow: 0 6px 0 #2f6e1d, 0 10px 22px rgba(0, 0, 0, 0.4);
      transition: transform 90ms ease-out, box-shadow 90ms ease-out;
    }

    .vd-menu-start:active {
      transform: translateY(4px);
      box-shadow: 0 2px 0 #2f6e1d, 0 6px 14px rgba(0, 0, 0, 0.4);
    }

    .vd-name-input {
      width: min(320px, 80vw);
      padding: 14px 16px;
      font-size: 20px;
      font-weight: 700;
      text-align: center;
      color: #f7fbff;
      background: rgba(20, 28, 38, 0.82);
      border: 3px solid rgba(255, 255, 255, 0.22);
      border-radius: 10px;
      outline: none;
    }

    .vd-name-input:focus {
      border-color: #ffd166;
    }
  `;
  document.head.appendChild(style);
}

// Asks for the player's username before character selection. Resolves with the
// trimmed name (or a default if left blank).
export function promptUsername(container, onSubmit) {
  injectStyles();
  const root = document.createElement('div');
  root.className = 'vd-menu';
  root.innerHTML = `
    <h1 class="vd-menu-title">Voxel Dragons</h1>
    <p class="vd-menu-subtitle">¿Cuál es tu nombre de usuario?</p>
    <input class="vd-name-input" data-menu="name" maxlength="16" placeholder="Jugador" />
    <button class="vd-menu-start" data-menu="confirm">Continuar</button>
  `;
  container.appendChild(root);

  const input = root.querySelector('[data-menu="name"]');
  const confirm = () => {
    const name = (input.value || '').trim() || 'Jugador';
    root.remove();
    onSubmit?.(name);
  };
  root.querySelector('[data-menu="confirm"]').addEventListener('click', confirm);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') confirm(); });
  setTimeout(() => input.focus(), 0);

  return root;
}

export class Menu {
  constructor(container, characters, onStart) {
    injectStyles();
    this.container = container;
    this.characters = characters;
    this.onStart = onStart;
    this.selectedId = characters[0]?.id ?? null;

    this.root = document.createElement('div');
    this.root.className = 'vd-menu';
    this.root.innerHTML = `
      <h1 class="vd-menu-title">Voxel Dragons</h1>
      <p class="vd-menu-subtitle">Seleccionar personaje</p>
      <div class="vd-menu-characters" data-menu="characters"></div>
      <button class="vd-menu-start" data-menu="start">Empezar partida</button>
    `;

    this.charactersNode = this.root.querySelector('[data-menu="characters"]');
    this.renderCharacters();

    this.root.querySelector('[data-menu="start"]').addEventListener('click', () => {
      const character = this.characters.find((c) => c.id === this.selectedId) ?? this.characters[0];
      this.onStart?.(character);
    });

    this.container.appendChild(this.root);
  }

  renderCharacters() {
    this.charactersNode.innerHTML = this.characters.map((character) => `
      <div class="vd-char-card ${character.id === this.selectedId ? 'is-selected' : ''}" data-char="${character.id}">
        <div class="vd-char-art" style="background-image:url(${getCharacterArt(character.id)})"></div>
        <div class="vd-char-name">${character.name}</div>
      </div>
    `).join('');

    for (const card of this.charactersNode.querySelectorAll('[data-char]')) {
      card.addEventListener('click', () => {
        this.selectedId = card.getAttribute('data-char');
        this.renderCharacters();
      });
    }
  }

  hide() {
    this.root.remove();
  }
}

export default Menu;
