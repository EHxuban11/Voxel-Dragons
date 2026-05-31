// Pixel-art portraits for the character-select screen (16x16, scaled up with
// image-rendering: pixelated). Cached as data URLs.

const cache = new Map();
const SKIN = '#e7b48a';

function make(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const px = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  draw(px);
  return canvas.toDataURL();
}

const EYES = (px, color = '#1b1b1b') => { px(6, 6, 1, 1, color); px(9, 6, 1, 1, color); };

const DRAWERS = {
  duck: (px) => {
    px(3, 10, 10, 6, '#ffd166');      // body
    px(4, 3, 8, 6, '#ffe08a');        // head
    px(5, 8, 6, 2, '#ff8c1a');        // bill
    EYES(px);
  },
  knight: (px) => {
    px(3, 10, 10, 6, '#9aa6b2');      // armor
    px(4, 11, 10, 1, '#c9d2db');      // shoulder trim
    px(4, 3, 8, 6, SKIN);             // face
    px(4, 2, 8, 3, '#b9c2cc');        // helmet
    px(4, 6, 8, 2, '#2a2f35');        // visor band
    px(5, 6, 1, 2, '#6fd0ff');        // eye glint
    px(10, 6, 1, 2, '#6fd0ff');
  },
  hunter: (px) => {
    px(3, 10, 10, 6, '#3f6b3a');      // tunic
    px(5, 4, 6, 5, SKIN);             // face
    px(4, 2, 8, 3, '#2c4a28');        // hood top
    px(4, 4, 1, 4, '#2c4a28');        // hood sides
    px(11, 4, 1, 4, '#2c4a28');
    EYES(px);
  },
  samurai: (px) => {
    px(3, 10, 10, 6, '#b33636');      // armor
    px(4, 4, 8, 5, SKIN);             // face
    px(4, 2, 8, 3, '#8c2a2a');        // kabuto
    px(7, 0, 2, 2, '#ffd166');        // crest
    px(4, 7, 8, 1, '#5e1d1d');        // mempo
    EYES(px);
  },
  mage: (px) => {
    px(3, 11, 10, 5, '#6a3fb5');      // robe
    px(5, 6, 6, 5, SKIN);             // face
    px(4, 5, 8, 1, '#4a2f86');        // hat brim
    px(6, 3, 4, 2, '#4a2f86');        // hat
    px(7, 1, 2, 2, '#4a2f86');        // hat tip
    px(8, 0, 1, 1, '#ffd166');        // star
    EYES(px);
  },
};

export function getCharacterArt(id) {
  if (cache.has(id)) return cache.get(id);
  const drawer = DRAWERS[id] ?? DRAWERS.duck;
  const url = make(drawer);
  cache.set(id, url);
  return url;
}

export default getCharacterArt;
