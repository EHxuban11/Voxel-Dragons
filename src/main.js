import './styles.css';
import { Game } from './game/Game.js';
import { Menu, promptUsername } from './ui/Menu.js';
import { ModeMenu } from './ui/ModeMenu.js';
import { CampaignMenu } from './ui/CampaignMenu.js';
import { CHARACTERS, getCharacter } from './content/characters/Characters.js';
import { MAPS, getMap } from './content/maps/index.js';
import { CAMPAIGNS } from './content/campaigns/index.js';
import { createWebPlatform } from './platform/web/createWebPlatform.js';

const root = document.querySelector('#app');

// Collected once at startup; floats over the player's avatar for other players.
let username = 'Jugador';

// Composition root: builds a fresh browser platform per run and injects it into
// the game; returns to the mode menu on exit.
function launch(options) {
  const platform = createWebPlatform({ root });
  const game = new Game(root, { platform, username, onExit: showModeMenu, ...options });
  game.start();
}

function showModeMenu() {
  const menu = new ModeMenu(root, {
    onWaves: () => { menu.hide(); showWavesMenu(); },
    onCampaign: () => { menu.hide(); showCampaignMenu(); },
    onSandbox: () => { menu.hide(); showSandboxMenu(); },
  });
}

function showWavesMenu() {
  const menu = new Menu(root, CHARACTERS, MAPS, (character, map) => {
    menu.hide();
    launch({ character, map, mode: 'waves' });
  });
}

// Sandbox uses the same picker as waves (all characters + meadow/snow + import a
// custom map), but launches a free-roam run with no waves or enemies.
function showSandboxMenu() {
  const menu = new Menu(root, CHARACTERS, MAPS, (character, map) => {
    menu.hide();
    launch({ character, map, mode: 'sandbox' });
  });
}

function showCampaignMenu() {
  const menu = new CampaignMenu(
    root,
    CAMPAIGNS,
    (campaign) => {
      menu.hide();
      launch({
        character: getCharacter(campaign.character),
        map: getMap(campaign.map),
        mode: 'campaign',
        campaign,
      });
    },
    () => { menu.hide(); showModeMenu(); },
  );
}

// Ask for the username once, then drop into the mode menu.
promptUsername(root, (name) => {
  username = name;
  showModeMenu();
});
