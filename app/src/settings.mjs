// WHERE EVERYTHING LIVES.
//
// One machine-specific value matters: the game's `Game Files` folder. Everything else is derived
// from it or from the repository. The value is stored in `settings.json` in the USER DATA FOLDER and
// exported here; `re.mjs` publishes it to `tools/re` through CMBS_GAME_FILES before that library
// is loaded, so the app and the reverse-engineering library always agree on the game folder.
//
// Changing the folder requires restarting the server: `tools/re` reads it once, at load.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

export const APP_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const REPO_DIR = path.resolve(APP_DIR, '..');
// THE USER DATA FOLDER (14/11/2026, the author: a package shared with the community). settings.json and every campaign
// live OUTSIDE the app folder, in %LOCALAPPDATA%\CMBS Roguelike, so a new version extracted into a new folder finds the
// campaigns of the old one. Beside the app ("portable") when the app folder already holds them (an older package, or a
// player who wants it so: an empty app\campaigns is enough), and always in a source checkout (it has .git — the QA
// sandbox worktree too), where the tests and tools expect app/campaigns. CMBS_DATA_DIR overrides both (the packager's
// proof runs the copy against a throwaway folder).
export const PORTABLE = !process.env.CMBS_DATA_DIR && (fs.existsSync(path.join(APP_DIR, 'settings.json'))
  || fs.existsSync(path.join(APP_DIR, 'campaigns')) || fs.existsSync(path.join(REPO_DIR, '.git')));
const LOCAL_APP_DATA = process.env.LOCALAPPDATA
  || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local') : path.join(os.homedir(), '.local', 'share'));
export const USER_DIR = path.resolve(process.env.CMBS_DATA_DIR || (PORTABLE ? APP_DIR : path.join(LOCAL_APP_DATA, 'CMBS Roguelike')));
export const SETTINGS_FILE = path.join(USER_DIR, 'settings.json');
export const CAMPAIGNS_DIR = path.join(USER_DIR, 'campaigns');
export const DATA_DIR = path.join(APP_DIR, 'data');
export const WEB_DIR = path.join(APP_DIR, 'web');
export const ASSETS_DIR = path.join(REPO_DIR, 'assets');
export const RESEARCH_DIR = path.join(REPO_DIR, 'research');

// ------------------------------------------------------------------- finding the game folder
//
// The app needs one machine-specific thing, and asking for it should be the fallback, not the
// first move. So it looks: where Steam says its libraries are, where the installers put the game,
// and then the same handful of paths on every drive in the machine. Each candidate is scored on
// what it actually contains, because a folder named right and empty is worse than no answer.

const slash = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const GAME = 'Combat Mission Black Sea';

// Windows keeps the real spelling of a path even though it ignores case when matching, and the
// registry hands back `c:/program files (x86)/steam`. This asks the filesystem how the folder is
// actually written, so what gets stored and shown is what the player would see in Explorer.
function canonical(p) {
  try { return slash(fs.realpathSync.native(p)); } catch { return slash(p); }
}

// Under any drive root or Steam library. `Game Files` is where CM keeps everything.
const UNDER_ROOT = [
  `Steam/steamapps/common/${GAME}`,
  `SteamLibrary/steamapps/common/${GAME}`,
  `Program Files (x86)/Steam/steamapps/common/${GAME}`,
  `Program Files/Steam/steamapps/common/${GAME}`,
  `Program Files (x86)/Battlefront/${GAME}`,
  `Program Files/Battlefront/${GAME}`,
  `Program Files (x86)/Matrix Games/${GAME}`,
  `Program Files/Matrix Games/${GAME}`,
  `Battlefront/${GAME}`,
  `GOG Games/${GAME}`,
  `GOG Galaxy/Games/${GAME}`,
  `Program Files (x86)/GOG Galaxy/Games/${GAME}`,
  `Program Files/GOG Galaxy/Games/${GAME}`,
  `Games/${GAME}`,
  GAME,
];

// What a real install has. Scenarios is the one that must be there — the others raise confidence,
// and `Saved Games` in particular only appears once the game has saved something. `Data` (the patch
// files) sits at the game root, one level up from Game Files (29/10: it used to be looked for inside).
const MARKS = ['Scenarios', 'Campaigns', 'Quick Battle Maps', 'Saved Games', '../Data'];

export function validate(gameFiles) {
  if (!gameFiles || !fs.existsSync(gameFiles)) return { ok: false, score: 0, has: [], missing: ['the folder itself'] };
  const has = MARKS.filter((m) => fs.existsSync(path.join(gameFiles, m)));
  const missing = MARKS.filter((m) => !has.includes(m));
  // The formation library is the author's own, built in the editor; it sits beside Game Files and is
  // not part of any install, so it counts for confidence but never against a folder.
  const lib = fs.existsSync(path.join(gameFiles, '..', 'LIB'));
  const nome = (m) => m.replace('../', '');
  return { ok: has.includes('Scenarios'), score: has.length + (lib ? 1 : 0), has: has.map(nome), missing: missing.map(nome), lib };
}

function steamLibraries() {
  const out = [];
  const roots = ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam'];
  // Steam records its own location in the registry; reading it costs one child process and finds
  // installs that are nowhere near Program Files.
  if (process.platform === 'win32') {
    try {
      const q = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = q.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) roots.unshift(slash(m[1].trim()));
    } catch { /* no Steam, or reg is not available */ }
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    out.push(root);
    // Every extra library folder the user added, as Steam itself lists them.
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) out.push(slash(m[1].replace(/\\\\/g, '/')));
    } catch { /* older Steam, or no extra libraries */ }
  }
  return [...new Set(out)];
}

// GOG records every game it installed (and every DLC, all with the same folder) under one registry key. The query is
// parsed by a pure function so the test can feed it a sample.
export function parseGogQuery(text) {
  const out = [];
  for (const m of String(text).matchAll(/^\s*path\s+REG_SZ\s+(.+?)\s*$/gim)) out.push(slash(m[1]));
  return [...new Set(out.map((p) => p.toLowerCase()))].map((l) => out.find((p) => p.toLowerCase() === l));
}
function gogGames() {
  if (process.platform !== 'win32') return [];
  try {
    return parseGogQuery(execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s', '/v', 'path'],
      { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; /* no GOG */ }
}

function driveRoots() {
  if (process.platform !== 'win32') return ['/', process.env.HOME || '/'].filter(Boolean);
  const out = [];
  for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
    const d = String.fromCharCode(c) + ':/';
    try { if (fs.existsSync(d)) out.push(d); } catch { /* not ready, e.g. an empty card reader */ }
  }
  return out;
}

// Every folder worth trying, best guess first, with no duplicates.
export function candidates() {
  const out = [];
  // Case-insensitively, because Windows is: the registry hands back `c:/program files (x86)/steam`
  // and the same folder would otherwise be tried twice under two spellings.
  const seen = new Set();
  const add = (p) => {
    const s = slash(p);
    if (!s || seen.has(s.toLowerCase())) return;
    seen.add(s.toLowerCase());
    out.push(s);
  };
  for (const lib of steamLibraries()) add(path.join(lib, 'steamapps', 'common', GAME, 'Game Files'));
  for (const g of gogGames()) add(path.join(g, 'Game Files'));
  for (const root of driveRoots()) for (const rel of UNDER_ROOT) add(path.join(root, rel, 'Game Files'));
  return out;
}

// The search. Returns the best folder found and what was tried, so the setup screen can say why
// nothing was found instead of only that nothing was.
export function detect() {
  const tried = [];
  const seen = new Set();
  let best = null;
  for (const c of candidates()) {
    const v = validate(c);
    if (!v.ok) continue;
    // Two spellings of one folder are one folder — that is the whole point of asking the
    // filesystem for the real name before comparing.
    const p = canonical(c);
    if (seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    tried.push({ path: p, score: v.score, has: v.has });
    if (!best || v.score > best.score) best = { path: p, score: v.score, has: v.has };
  }
  return { found: best ? best.path : null, best, tried, looked: candidates().length };
}

function discover() {
  const d = detect();
  return { gameFiles: d.found, detection: d };
}

function load() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}

const stored = load();

// A folder the user chose is never overruled: if it still holds a game, it stays. The search only
// runs when there is nothing stored, or when what was stored has stopped being a game folder —
// the game moved, the drive changed letter, the settings file came from another machine.
const chosen = stored.gameFiles ? slash(stored.gameFiles) : null;
export const DISCOVERY = chosen && validate(chosen).ok
  ? { source: 'settings', gameFiles: chosen, detection: null }
  : (() => {
    const d = discover();
    return { source: d.gameFiles ? (chosen ? 'detected (the stored folder is not a game folder)' : 'detected') : 'not found', ...d };
  })();

const settings = {
  version: 1,
  // With nothing found the first candidate stands in, so every path in the app still builds and
  // the setup screen can show what is wrong instead of the server failing to start.
  gameFiles: DISCOVERY.gameFiles || candidates()[0] || slash(path.join(REPO_DIR, 'Game Files')),
  // The maps are always the packaged ones (assets/qb_*, the selection in data/mapas.json); there is no
  // switch to the game's own Quick Battle Maps any more (autor, 04/10/2026). An old `useGameMaps` in
  // settings.json is ignored.
  // Same idea for the formation library: the repository copy by default, the game folder on request.
  useGameLib: stored.useGameLib === true,
  port: stored.port || 8765,
  // the last system check (sistema.mjs): null until the first run opens the System check screen
  systemCheck: stored.systemCheck || null,
};
// Only a real find is written down; a placeholder must not become tomorrow's stored setting.
// A data folder that cannot be written must not kill the server before it can say so: Setup shows the red row.
try {
  if (DISCOVERY.gameFiles && DISCOVERY.gameFiles !== chosen) save({ gameFiles: DISCOVERY.gameFiles });
  else if (!fs.existsSync(SETTINGS_FILE) && DISCOVERY.gameFiles) save(settings);
} catch (e) { console.error(`  could not write ${SETTINGS_FILE}: ${e.message}`); }

export function save(next) {
  Object.assign(settings, next, { gameFiles: slash(next.gameFiles || settings.gameFiles) });
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 1) + '\n');
  return settings;
}

export function current() {
  const v = validate(settings.gameFiles);
  return { ...settings, ...paths(), gameFilesOk: v.ok, gameFilesHas: v.has, howFound: DISCOVERY.source, dataDir: USER_DIR, settingsFile: SETTINGS_FILE, portable: PORTABLE };
}

export const GAME_FILES = settings.gameFiles;
export const PORT = settings.port;

export function paths(gameFiles = settings.gameFiles) {
  return {
    gameFiles,
    scenarios: path.join(gameFiles, 'Scenarios'),
    campaigns: path.join(gameFiles, 'Campaigns'),
    savedGames: path.join(gameFiles, 'Saved Games'),
    // The formation library: one .btt per purchasable formation, built in the game's editor. It is
    // NOT part of a game install — it was made by hand — so the repository carries its own copy and
    // that is what the app reads. Without this, the app on someone else's machine would open with
    // an empty library and nothing to buy. Set `useGameLib` to read the one beside the game folder
    // instead, which is what to do while editing the library itself.
    lib: settings.useGameLib ? path.join(gameFiles, '..', 'LIB') : path.join(ASSETS_DIR, 'lib'),
    maps: path.join(ASSETS_DIR, 'qb_attack'),
    // The quick-battle maps (one version of each, 23/10: `qb_attack`) and the meeting engagements (`qb_meet`) under assets.
    // `catalog.mapFile` picks.
    mapsBase: ASSETS_DIR,
    campaignTemplate: path.join(ASSETS_DIR, 'campaign_template_red.cam'),
    // the app's own pictures in the game (17/10/2026): the logo (briefing 224x224, list headers 170x170) and the
    // bitmap fonts of the images it draws (tools/re/fonte_atlas.mjs); the only tracked part of app/art
    artBriefing: path.join(APP_DIR, 'art', 'briefing'),
    mapImages: path.join(ASSETS_DIR, 'map_images'),
    typeTable: path.join(RESEARCH_DIR, 'tipos_roster.json'),
    toeWeapons: path.join(RESEARCH_DIR, 'toe_armas.json'),
    toeVehicles: path.join(RESEARCH_DIR, 'toe_veiculos.json'),
    // A dotacao de FABRICA (E80): colhida so de saves que o app nunca tocou. Primeira fonte do
    // refit para municao e granada, porque as outras duas medem MAXIMO/p90 e inflam a cada batalha.
    issue: path.join(RESEARCH_DIR, 'dotacao.json'),
    weaponAmmo: path.join(RESEARCH_DIR, 'armas_municao.json'),
    grenades: path.join(RESEARCH_DIR, 'toe_granadas.json'),
    weapons: path.join(RESEARCH_DIR, 'armas.json'),
    // o preco e a categoria de CADA arma e item (18/10, autor): tools/precos_armas_importar.mjs; o que nao esta la cai nas regras
    weaponPrices: path.join(RESEARCH_DIR, 'precos_armas.json'),
    mapCensus: path.join(RESEARCH_DIR, 'mapas_attack.json'),
    libCosts: path.join(RESEARCH_DIR, 'custos.json'),
  };
}

// Everything the app needs before it can generate anything. The UI shows this list on the setup
// screen; a red line here is the first thing to look at when something does not work.
export function checkEnvironment() {
  const p = paths();
  const dir = (name, file, why, writable = false) => {
    const ok = fs.existsSync(file);
    let detail = ok ? '' : 'not found';
    if (ok && writable) {
      try { const probe = path.join(file, '.cmbsdc-write-test'); fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe); }
      catch (e) { return { name, ok: false, path: file, why, detail: 'no write permission: ' + e.message }; }
    }
    if (ok && fs.statSync(file).isDirectory()) detail = `${fs.readdirSync(file).length} entries`;
    else if (ok) detail = `${fs.statSync(file).size} bytes`;
    return { name, ok, path: file, why, detail };
  };
  try { fs.mkdirSync(USER_DIR, { recursive: true }); } catch { /* the row below says why */ }
  return [
    dir('App data', USER_DIR, 'settings.json and every campaign the app makes', true),
    dir('Game Files', p.gameFiles, 'root of the game data'),
    dir('Scenarios', p.scenarios, 'the app writes each generated battle here', true),
    dir('Campaigns', p.campaigns, 'the app writes the .cam here', true),
    dir('Saved Games', p.savedGames, 'the app reads the transition save from here'),
    dir('Formation library', p.lib, settings.useGameLib ? 'the sources every force is built from — the copy beside the game folder' : 'the sources every force is built from — the copy in this repository'),
    dir('Quick battle maps', p.maps, 'the map pool'),
    dir('Campaign template', p.campaignTemplate, 'header cloned into every generated .cam'),
    dir('Unit type table', p.typeTable, 'roster blocks by unit type'),
    dir('TO&E weapons', p.toeWeapons, 'what each slot of each unit type carries, for the refit'),
    dir('TO&E vehicle ammo', p.toeVehicles, 'the ammunition a vehicle or gun is issued, for the refit'),
    dir('Weapon ammo', p.weaponAmmo, 'what each weapon is issued, for the man who came back with half a load'),
    dir('Grenades', p.grenades, 'grenades per slot — they live outside the ammo vector, so nothing used to replace them'),
    dir('Map census', p.mapCensus, 'tier, area and profile of each map'),
  ];
}
