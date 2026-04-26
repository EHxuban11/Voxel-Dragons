const DEFAULT_STATE = {
  health: 100,
  maxHealth: 100,
  ammo: 0,
  maxAmmo: 0,
  weapon: 'Blaster',
  dragons: 0,
  dragonsTotal: null,
  inventory: null,
};

const STYLE_ID = 'voxel-dragons-hud-style';

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .vd-hud {
      position: fixed;
      inset: 0;
      z-index: 20;
      pointer-events: none;
      color: #f7fbff;
      font: 700 14px/1.2 Arial, Helvetica, sans-serif;
      text-shadow: 0 2px 0 rgba(0, 0, 0, 0.65);
      user-select: none;
    }

    .vd-crosshair {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 22px;
      height: 22px;
      transform: translate(-50%, -50%);
      opacity: 0.92;
    }

    .vd-crosshair::before,
    .vd-crosshair::after {
      content: '';
      position: absolute;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 0 8px rgba(255, 255, 255, 0.28);
      border-radius: 1px;
    }

    .vd-crosshair::before {
      left: 10px;
      top: 0;
      width: 2px;
      height: 22px;
    }

    .vd-crosshair::after {
      left: 0;
      top: 10px;
      width: 22px;
      height: 2px;
    }

    .vd-bottom-left,
    .vd-bottom-right,
    .vd-top-right,
    .vd-message,
    .vd-help {
      position: absolute;
      box-sizing: border-box;
    }

    .vd-bottom-left {
      left: 18px;
      bottom: 86px;
      min-width: min(360px, calc(100vw - 36px));
    }

    .vd-bottom-right {
      right: 18px;
      bottom: 86px;
      display: grid;
      gap: 6px;
      justify-items: end;
    }

    .vd-top-right {
      right: 18px;
      top: 18px;
      padding: 8px 10px;
      background: rgba(10, 14, 18, 0.48);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 6px;
      backdrop-filter: blur(4px);
    }

    .vd-help {
      left: 18px;
      top: 18px;
      max-width: min(420px, calc(100vw - 36px));
      color: rgba(245, 248, 255, 0.82);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
      background: rgba(10, 14, 18, 0.38);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      padding: 7px 9px;
    }

    .vd-health-label {
      margin-bottom: 6px;
      color: #fff5f5;
    }

    .vd-health-shell {
      height: 18px;
      overflow: hidden;
      background: rgba(18, 22, 26, 0.72);
      border: 2px solid rgba(255, 255, 255, 0.38);
      box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.45);
    }

    .vd-health-fill {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #d83b3b, #ff6b45 58%, #ffd166);
      transform-origin: left center;
      transition: transform 120ms ease-out, filter 120ms ease-out;
    }

    .vd-weapon {
      color: #e9f6ff;
      font-size: 15px;
    }

    .vd-ammo {
      color: #fff2a8;
      font-size: 22px;
      line-height: 1;
    }

    .vd-message {
      left: 50%;
      top: 18%;
      max-width: min(520px, calc(100vw - 36px));
      transform: translateX(-50%);
      opacity: 0;
      transition: opacity 140ms ease-out, transform 140ms ease-out;
      padding: 9px 12px;
      text-align: center;
      background: rgba(8, 12, 16, 0.62);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
    }

    .vd-message.is-visible {
      opacity: 1;
      transform: translateX(-50%) translateY(-4px);
    }

    .vd-vignette {
      position: absolute;
      inset: 0;
      opacity: 0;
      background:
        radial-gradient(circle at center, rgba(255, 0, 0, 0) 42%, rgba(190, 0, 0, 0.38) 100%),
        rgba(255, 0, 0, 0.12);
      transition: opacity 220ms ease-out;
    }

    .vd-vignette.is-active {
      opacity: 1;
      transition: opacity 45ms ease-out;
    }

    .vd-hotbar {
      position: absolute;
      left: 50%;
      bottom: 14px;
      display: grid;
      grid-template-columns: repeat(8, 54px);
      gap: 4px;
      transform: translateX(-50%);
    }

    .vd-slot {
      position: relative;
      width: 54px;
      height: 54px;
      box-sizing: border-box;
      border: 3px solid rgba(25, 25, 25, 0.82);
      background: rgba(72, 72, 72, 0.72);
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.16);
    }

    .vd-slot.is-selected {
      border-color: #f5f0c8;
      background: rgba(120, 120, 120, 0.82);
      transform: translateY(-3px);
    }

    .vd-slot-swatch {
      position: absolute;
      left: 9px;
      top: 8px;
      width: 30px;
      height: 30px;
      background: var(--slot-color);
      border: 2px solid rgba(0, 0, 0, 0.42);
      box-shadow: inset -8px -8px 0 rgba(0, 0, 0, 0.18), inset 5px 5px 0 rgba(255, 255, 255, 0.16);
    }

    .vd-slot-key {
      position: absolute;
      left: 4px;
      top: 3px;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.72);
    }

    .vd-slot-count {
      position: absolute;
      right: 5px;
      bottom: 3px;
      font-size: 13px;
    }

    .vd-inventory {
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(520px, calc(100vw - 32px));
      transform: translate(-50%, -50%);
      display: none;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      padding: 14px;
      box-sizing: border-box;
      background: rgba(34, 34, 34, 0.9);
      border: 3px solid rgba(0, 0, 0, 0.86);
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.14), 0 16px 40px rgba(0, 0, 0, 0.38);
    }

    .vd-inventory.is-open {
      display: grid;
    }

    .vd-inv-item {
      position: relative;
      min-height: 58px;
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 8px;
      align-items: center;
      padding: 8px;
      box-sizing: border-box;
      background: rgba(88, 88, 88, 0.7);
      border: 2px solid rgba(0, 0, 0, 0.55);
    }

    .vd-inv-item .vd-slot-swatch {
      position: static;
      width: 32px;
      height: 32px;
    }

    .vd-inv-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }

    @media (max-width: 620px) {
      .vd-bottom-left,
      .vd-bottom-right,
      .vd-help,
      .vd-top-right {
        left: 12px;
        right: 12px;
      }

      .vd-bottom-left {
        bottom: 82px;
      }

      .vd-bottom-right {
        bottom: 82px;
      }

      .vd-top-right {
        top: 48px;
        width: max-content;
        left: auto;
      }

      .vd-help {
        top: 12px;
      }

      .vd-hotbar {
        grid-template-columns: repeat(8, 40px);
        gap: 2px;
      }

      .vd-slot {
        width: 40px;
        height: 40px;
      }

      .vd-slot-swatch {
        left: 7px;
        top: 7px;
        width: 21px;
        height: 21px;
      }

      .vd-inventory {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `;
  document.head.appendChild(style);
}

function firstNumber(source, keys, fallback) {
  for (const key of keys) {
    const value = source?.[key];
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return fallback;
}

function firstText(source, keys, fallback) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return fallback;
}

function getWeaponName(state) {
  if (typeof state.weapon === 'string') {
    return state.weapon;
  }

  if (state.weapon && typeof state.weapon.name === 'string') {
    return state.weapon.name;
  }

  return firstText(state, ['weaponName', 'currentWeapon'], DEFAULT_STATE.weapon);
}

function getAmmo(state) {
  if (state.weapon && typeof state.weapon === 'object') {
    return {
      ammo: firstNumber(state.weapon, ['ammo', 'currentAmmo', 'magazine'], DEFAULT_STATE.ammo),
      maxAmmo: firstNumber(state.weapon, ['maxAmmo', 'clipSize', 'magazineSize'], DEFAULT_STATE.maxAmmo),
    };
  }

  return {
    ammo: firstNumber(state, ['ammo', 'currentAmmo', 'bullets'], DEFAULT_STATE.ammo),
    maxAmmo: firstNumber(state, ['maxAmmo', 'clipSize', 'magazineSize'], DEFAULT_STATE.maxAmmo),
  };
}

function getDragonCount(state) {
  const killed = firstNumber(state, ['dragonsKilled', 'dragonKills', 'dragonsDefeated'], null);
  const alive = firstNumber(state, ['dragons', 'dragonsAlive', 'dragonCount'], null);
  const total = firstNumber(state, ['dragonsTotal', 'totalDragons'], DEFAULT_STATE.dragonsTotal);

  if (killed !== null) {
    return { value: killed, total };
  }

  return { value: alive ?? DEFAULT_STATE.dragons, total };
}

export class HUD {
  constructor(container = document.body) {
    injectStyles();

    this.container = container;
    this.messageTimeout = null;
    this.damageTimeout = null;

    this.root = document.createElement('div');
    this.root.className = 'vd-hud';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `
      <div class="vd-vignette"></div>
      <div class="vd-crosshair"></div>
      <div class="vd-help">WASD mover | 1-8 hotbar | click izq minar/disparar | click der colocar | E inventario</div>
      <div class="vd-top-right">Dragones: <span data-hud="dragons">0</span></div>
      <div class="vd-message" data-hud="message"></div>
      <div class="vd-inventory" data-hud="inventoryPanel"></div>
      <div class="vd-bottom-left">
        <div class="vd-health-label">Vida <span data-hud="health">100</span>%</div>
        <div class="vd-health-shell"><div class="vd-health-fill" data-hud="healthFill"></div></div>
      </div>
      <div class="vd-bottom-right">
        <div class="vd-weapon" data-hud="weapon">Blaster</div>
        <div class="vd-ammo" data-hud="ammo">0</div>
      </div>
      <div class="vd-hotbar" data-hud="hotbar"></div>
    `;

    this.nodes = {
      vignette: this.root.querySelector('.vd-vignette'),
      health: this.root.querySelector('[data-hud="health"]'),
      healthFill: this.root.querySelector('[data-hud="healthFill"]'),
      ammo: this.root.querySelector('[data-hud="ammo"]'),
      weapon: this.root.querySelector('[data-hud="weapon"]'),
      dragons: this.root.querySelector('[data-hud="dragons"]'),
      message: this.root.querySelector('[data-hud="message"]'),
      hotbar: this.root.querySelector('[data-hud="hotbar"]'),
      inventoryPanel: this.root.querySelector('[data-hud="inventoryPanel"]'),
    };

    this.container.appendChild(this.root);
    this.update(DEFAULT_STATE);
  }

  update(state = {}) {
    const nextState = { ...DEFAULT_STATE, ...state };
    const maxHealth = Math.max(1, firstNumber(nextState, ['maxHealth', 'healthMax'], DEFAULT_STATE.maxHealth));
    const health = Math.max(0, Math.min(maxHealth, firstNumber(nextState, ['health', 'hp'], DEFAULT_STATE.health)));
    const healthPercent = Math.round((health / maxHealth) * 100);
    const { ammo, maxAmmo } = getAmmo(nextState);
    const weapon = getWeaponName(nextState);
    const dragons = getDragonCount(nextState);

    this.nodes.health.textContent = String(healthPercent);
    this.nodes.healthFill.style.transform = `scaleX(${health / maxHealth})`;
    this.nodes.healthFill.style.filter = healthPercent <= 25 ? 'saturate(1.35) brightness(1.15)' : '';
    this.nodes.weapon.textContent = weapon;
    this.nodes.ammo.textContent = maxAmmo > 0 ? `${ammo} / ${maxAmmo}` : String(ammo);
    this.nodes.dragons.textContent = dragons.total === null ? String(dragons.value) : `${dragons.value} / ${dragons.total}`;
    this.renderInventory(nextState.inventory);
  }

  renderInventory(inventory) {
    if (!inventory?.slots) return;

    this.nodes.hotbar.innerHTML = inventory.slots.map((slot, index) => `
      <div class="vd-slot ${index === inventory.selectedIndex ? 'is-selected' : ''}" style="--slot-color: ${slot.color}">
        <div class="vd-slot-key">${index + 1}</div>
        <div class="vd-slot-swatch"></div>
        <div class="vd-slot-count">${slot.count === null ? '' : slot.count}</div>
      </div>
    `).join('');

    this.nodes.inventoryPanel.classList.toggle('is-open', Boolean(inventory.open));
    this.nodes.inventoryPanel.innerHTML = inventory.slots.map((slot) => `
      <div class="vd-inv-item" style="--slot-color: ${slot.color}">
        <div class="vd-slot-swatch"></div>
        <div>
          <div class="vd-inv-name">${slot.label}</div>
          <div>${slot.kind === 'block' ? `${slot.count} bloques` : 'Arma'}</div>
        </div>
      </div>
    `).join('');
  }

  showMessage(text, ms = 1800) {
    window.clearTimeout(this.messageTimeout);
    this.nodes.message.textContent = text;
    this.nodes.message.classList.toggle('is-visible', Boolean(text));

    if (text && ms > 0) {
      this.messageTimeout = window.setTimeout(() => {
        this.nodes.message.classList.remove('is-visible');
      }, ms);
    }
  }

  flashDamage() {
    window.clearTimeout(this.damageTimeout);
    this.nodes.vignette.classList.add('is-active');
    this.damageTimeout = window.setTimeout(() => {
      this.nodes.vignette.classList.remove('is-active');
    }, 90);
  }

  destroy() {
    window.clearTimeout(this.messageTimeout);
    window.clearTimeout(this.damageTimeout);
    this.root.remove();
  }
}

export default HUD;
