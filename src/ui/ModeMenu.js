import { injectStyles } from './Menu.js';

// First screen: pick a game mode. Reuses the pixel-art menu styles.
export class ModeMenu {
  constructor(container, { onWaves, onCampaign, onSandbox } = {}) {
    injectStyles();
    this.container = container;
    this.root = document.createElement('div');
    this.root.className = 'vd-menu';
    this.root.innerHTML = `
      <h1 class="vd-menu-title">Voxel Dragons</h1>
      <p class="vd-menu-subtitle">Elige modo</p>
      <div class="vd-menu-maps">
        <div class="vd-map-card" data-mode="waves">
          <div><div class="vd-map-name">Por oleadas</div><div class="vd-map-note">Elige personaje y mapa</div></div>
        </div>
        <div class="vd-map-card" data-mode="campaign">
          <div><div class="vd-map-name">Campaña</div><div class="vd-map-note">Modo historia por personaje</div></div>
        </div>
        <div class="vd-map-card" data-mode="sandbox">
          <div><div class="vd-map-name">Sandbox</div><div class="vd-map-note">Explora sin enemigos · trae tu mapa</div></div>
        </div>
      </div>
    `;
    this.root.querySelector('[data-mode="waves"]').addEventListener('click', () => onWaves?.());
    this.root.querySelector('[data-mode="campaign"]').addEventListener('click', () => onCampaign?.());
    this.root.querySelector('[data-mode="sandbox"]').addEventListener('click', () => onSandbox?.());
    this.container.appendChild(this.root);
  }

  hide() { this.root.remove(); }
}

export default ModeMenu;
