// Maps Minecraft block names to the game's block types. Anything without a
// natural counterpart becomes a generated "dynamic" block with a colour guessed
// from its name and the default solid-block properties (e.g. slime_block → a
// green solid block). The resolver accumulates those into `extraBlocks`, which
// the World merges into its block + material registry.

function stripNamespace(name) {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
}

// Direct name → game type for the most common blocks.
const EXACT = {
  grass_block: 'grass', moss_block: 'grass', grass_path: 'grass', dirt_path: 'grass',
  dirt: 'dirt', coarse_dirt: 'dirt', rooted_dirt: 'dirt', podzol: 'dirt', mycelium: 'dirt',
  farmland: 'dirt', mud: 'dirt', clay: 'dirt',
  stone: 'stone', cobblestone: 'stone', mossy_cobblestone: 'stone', bedrock: 'stone',
  gravel: 'stone', andesite: 'stone', diorite: 'stone', granite: 'stone', tuff: 'stone',
  calcite: 'stone', dripstone_block: 'stone', smooth_stone: 'stone', stone_bricks: 'stone',
  sand: 'sand', red_sand: 'sand', sandstone: 'sand', red_sandstone: 'sand', smooth_sandstone: 'sand',
  water: 'water', bubble_column: 'water', kelp: 'water', kelp_plant: 'water', seagrass: 'water',
  snow: 'snow', snow_block: 'snow', powder_snow: 'snow',
  ice: 'ice', packed_ice: 'ice', blue_ice: 'ice', frosted_ice: 'ice',
  oak_planks: 'wood', spruce_planks: 'wood', birch_planks: 'wood', jungle_planks: 'wood',
  acacia_planks: 'wood', dark_oak_planks: 'wood', mangrove_planks: 'wood',
};

function mapKnown(name) {
  if (EXACT[name]) return EXACT[name];

  if (name.endsWith('_leaves')) return name.includes('spruce') ? 'spruce_leaves' : 'leaves';
  if (name.endsWith('_log') || name.endsWith('_wood') || name.startsWith('stripped_') || name.endsWith('_stem') || name.endsWith('_hyphae')) {
    return name.includes('spruce') ? 'spruce_log' : 'wood';
  }
  if (name.endsWith('_planks')) return 'wood';
  if (name.includes('sandstone') || name.includes('sand')) return 'sand';
  if (name.includes('grass_block')) return 'grass';
  if (name.includes('dirt')) return 'dirt';
  if (name.includes('water')) return 'water';
  if (name.includes('packed_ice') || name.includes('blue_ice') || name === 'ice') return 'ice';
  if (name.includes('snow')) return 'snow';
  if (name.includes('deepslate') || name.includes('cobble') || name.includes('blackstone')
    || name.includes('basalt') || name.includes('_ore') || name.endsWith('stone')) return 'stone';
  return null;
}

// Keyword → colour for materials/ores/etc.
const COLOR_RULES = [
  [/slime/, 0x7ac74f], [/honey/, 0xf6b733], [/glowstone|sea_lantern|shroomlight|lantern/, 0xe8c14a],
  [/gold/, 0xf6d33c], [/iron/, 0xd8d8d8], [/diamond/, 0x5be8df], [/emerald/, 0x2bd25c],
  [/lapis/, 0x2f55c0], [/amethyst/, 0x9a6fd0], [/copper/, 0xc07b54], [/netherite/, 0x4a4248],
  [/redstone/, 0xc02a2a], [/obsidian/, 0x18102a], [/prismarine/, 0x4f9e93], [/quartz/, 0xeae3d8],
  [/brick/, 0x9a4b3a], [/glass/, 0xbfe6f5], [/coal/, 0x222228], [/bone/, 0xe8e6dc],
  [/pumpkin|melon/, 0xe0791a], [/netherrack|nether/, 0x6e2b2b], [/lava|magma|fire/, 0xe25a1a],
  [/wool|carpet|bed/, null], [/concrete|terracotta|glazed|stained|shulker/, null],
];

// Colour words used by wool/concrete/terracotta variants.
const COLOR_WORDS = {
  white: 0xe9edf0, orange: 0xe07a1a, magenta: 0xc154b8, light_blue: 0x6aa6e0, yellow: 0xe6cf3a,
  lime: 0x73c93a, pink: 0xe089b0, gray: 0x4a4f55, light_gray: 0x9ba1a6, cyan: 0x2f9aa6,
  purple: 0x8a4fc0, blue: 0x3a5cc8, brown: 0x7c5a36, green: 0x57843a, red: 0xc0392b, black: 0x222228,
};

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  const hue = ((h >>> 0) % 360) / 360;
  // pastel: medium saturation/lightness via a quick HSL→RGB
  const s = 0.45;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  const seg = Math.floor(hue * 6);
  if (seg === 0) { r = c; g = x; }
  else if (seg === 1) { r = x; g = c; }
  else if (seg === 2) { g = c; b = x; }
  else if (seg === 3) { g = x; b = c; }
  else if (seg === 4) { r = x; b = c; }
  else { r = c; b = x; }
  return ((Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255));
}

function colorFor(name) {
  for (const word of Object.keys(COLOR_WORDS)) {
    if (name.startsWith(`${word}_`)) return COLOR_WORDS[word];
  }
  for (const [re, color] of COLOR_RULES) {
    if (re.test(name)) {
      if (color !== null) return color;
      // colour-word variants (wool/concrete/...) fall back to their word colour
      for (const word of Object.keys(COLOR_WORDS)) {
        if (name.includes(word)) return COLOR_WORDS[word];
      }
    }
  }
  return hashColor(name);
}

export class BlockResolver {
  constructor() {
    this.extraBlocks = {}; // dynamic types → { color, roughness, metalness }
    this.cache = new Map();
    this.unmatched = new Set();
  }

  resolve(rawName) {
    const name = stripNamespace(rawName);
    const cached = this.cache.get(name);
    if (cached) return cached;

    let type = mapKnown(name);
    if (!type) {
      type = `mc_${name.replace(/[^a-z0-9_]/g, '_')}`;
      if (!this.extraBlocks[type]) {
        this.extraBlocks[type] = { color: colorFor(name), roughness: 0.9, metalness: 0 };
      }
      this.unmatched.add(name);
    }
    this.cache.set(name, type);
    return type;
  }
}

export default BlockResolver;
