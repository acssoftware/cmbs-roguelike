'use strict';
// The whole front end. No framework, no build step: the server hands this file over as it is.
// State lives on the server; this file only draws it and sends commands.

// NADA DE "null" NA TELA (autor, 25/10): o `el()` pula null/undefined/false, mas o append/replaceChildren do DOM os escreve
// como texto, e um `cond ? el(...) : null` passado direto aparecia como "null" ao lado dos botoes (o Quartermaster da US).
// Os tres metodos passam a pular o que o `el()` pula, na pagina inteira.
for (const P of [Element.prototype, DocumentFragment.prototype]) {
  for (const k of ['append', 'prepend', 'replaceChildren']) {
    const orig = P[k];
    P[k] = function (...nos) { return orig.apply(this, nos.filter((x) => x !== null && x !== undefined && x !== false)); };
  }
}

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid.nodeType ? kid : String(kid));
  return n;
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || res.statusText), { id: data?.error?.id });
  return data;
}

// o tipo de batalha como o jogador le: 'Meet' e o nome do censo para Meeting Engagement (13/10/2026)
// 23/10 (autor): a batalha comum nao tem mais tipo (Probe/Attack/Assault eram o mesmo mapa); so o encontro e nomeado
const kindLabel = (k) => (k === 'Meet' ? 'Meeting Engagement' : '');
// o tipo com o separador, ou nada
const kindTail = (k, sep) => (kindLabel(k) ? sep + kindLabel(k) : '');

// O QUE QUEBRA NA PAGINA VAI PARA O SERVIDOR (03/10): sem isto um erro so existia no console do
// navegador, e o diagnostico salvo nao dizia nada. Nunca lanca — reportar nao pode virar outro erro.
let reportados = 0;

function reportClientError(where, e) {
  if (reportados++ > 50) return;
  try {
    fetch('/api/client-error', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where, message: (e && e.message) || String(e), stack: (e && e.stack) || '', slug: CAMPAIGN?.slug || null, page: location.hash }),
    }).catch(() => {});
  } catch { /* nada */ }
}
window.addEventListener('error', (ev) => reportClientError('window.error', ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => reportClientError('unhandledrejection', ev.reason));

// THE START SCREEN'S WALLPAPER (01/11, author): one of the home arts, drawn each time the app opens (app/art/home_art_N.png,
// as JPG in web/art). home.jpg stays in the CSS as the fallback.
const HOME_ARTS = ['home.jpg', 'home_2.jpg', 'home_3.jpg', 'home_4.jpg', 'home_5.jpg', 'home_6.jpg'];
$('#start').style.backgroundImage = `url(art/${HOME_ARTS[Math.floor(Math.random() * HOME_ARTS.length)]})`;

const SECTIONS = ['start', 'home', 'setup', 'system', 'params', 'campaign', 'job', 'closed', 'about', 'rules'];
function show(id) {
  for (const s of SECTIONS) $('#' + s).hidden = s !== id;
  $('#navbar').hidden = ['start', 'closed', 'job'].includes(id);
}

// ARRIVING AT A SCREEN MEANS SEEING ITS TOP. The debrief is long and the button that leads to the
// Quartermaster is at the bottom of it, so switching tabs left the player halfway down a screen he
// had never seen the head of — the author hit this every battle. The page scrolls on the window (the
// header is the only sticky thing), so this is the whole fix.
function aoTopo() { window.scrollTo({ top: 0, behavior: 'auto' }); }

// Must match API_LEVEL in server.mjs. The page comes off disk on every reload; the server does
// not, so reloading the page fixes nothing when the two have drifted apart — only restarting the
// process does, and that is what the banner says.
const API_EXPECTED = 21;
// Two ways the running server can be out of date, and only one of them used to be caught.
//   1. it is older than THIS PAGE — the API handshake, below;
//   2. it is older than the FILES ON DISK — node loads a module once, so a fix written while the
//      server is up does not exist for it. That one cost autor two campaigns of the clock bug: the
//      correction was on disk, the process was from before it, and nothing on screen said so.
function checkServerVersion(level, stale) {
  const b = $('#stale');
  const velho = level !== API_EXPECTED;
  b.hidden = !velho && !stale;
  if (b.hidden) return true;
  b.textContent = velho
    ? `The server is running an older build than this page (API ${level ?? 'before 3'}, page ${API_EXPECTED}). `
      + 'Reloading the browser does not help: quit the app (the tray icon next to the clock, or Quit on the start menu) and start it again.'
    : `The server is running code older than the files on disk — \`${stale.file}\` ${stale.why || 'changed'} after it started. `
      + 'What it generates now is the old behaviour. Quit the app (the tray icon next to the clock, or Quit on the start menu) and start it again.';
  return !velho;
}

let STATUS = null;
let NEW = null;      // { nation, picks: [{formation, tree, keep:Set}] }
let CAMPAIGN = null; // last loaded campaign state

// -------------------------------------------------------------------------------------- home

// UMA FALHA DA PAGINA NUNCA FICA CALADA (05/10/2026, QA r2 A8-A11). Uma faixa no topo, com a mensagem do servidor (ou
// da rede) e um botao para tentar de novo. Antes, a primeira carga falhando deixava a pagina em branco, e abrir uma
// campanha ou procurar o save falhando nao dizia nada.
function falhaVisivel(texto, tentar = () => location.reload()) {
  let f = document.querySelector('#app-error');
  if (!f) { f = el('div', { id: 'app-error', class: 'banner bad' }); document.body.prepend(f); }
  f.hidden = false;
  f.replaceChildren(el('span', {}, texto + ' '), el('button', { class: 'linky', onclick: () => { f.hidden = true; tentar(); } }, 'Try again'), ' ',
    el('button', { class: 'linky', onclick: () => { f.hidden = true; } }, 'Dismiss'));
}

// O PERSONNEL LE O SAVE INTEIRO (16-30 MB) no servidor; as sub-abas da Forca o pediam de novo a cada clique (QA S13).
// Guardado por campanha e pelo que muda o save lido: estagio, batalha, save pendente e save de partida.
let PERSONNEL_CACHE = { chave: null, valor: null };
async function personnelOf(s) {
  const chave = JSON.stringify([s.slug, s.stage, s.battleNumber, s.pending?.savePath || null, s.current?.playFrom?.file || null, (s.standDown || []).length, (s.lost || []).length]);
  if (PERSONNEL_CACHE.chave === chave && PERSONNEL_CACHE.valor) return PERSONNEL_CACHE.valor;
  const valor = await api('GET', `/api/campaigns/${encodeURIComponent(s.slug)}/personnel`);
  PERSONNEL_CACHE = { chave, valor };
  return valor;
}

async function loadStatus() {
  STATUS = await api('GET', '/api/status');
  checkServerVersion(STATUS.api, STATUS.stale);
  // the app version (14/11): under the start menu title and on About
  for (const id of ['#start-version', '#about-version']) { const v = $(id); if (v) v.textContent = STATUS.version ? `Version ${STATUS.version}` : ''; }
  const bad = STATUS.environment.filter((e) => !e.ok);
  const warn = $('#env-warning');
  warn.hidden = !bad.length;
  if (bad.length) warn.textContent = `Setup is incomplete: ${bad.map((b) => b.name).join(', ')}. Open Setup to see why.`;
  return STATUS;
}

function renderHome() {
  const list = $('#campaign-list');
  list.replaceChildren();
  if (!STATUS.campaigns.length) list.append(el('p', { class: 'hint' }, 'No campaigns yet.'));
  for (const c of STATUS.campaigns) {
    list.append(el('div', { class: 'card' },
      el('h4', {}, c.name),
      el('div', { class: 'meta' }, `${c.nation} · battle ${c.battleNumber} · ${c.credits} credits · ${c.defeatsUnlimited ? 'unlimited defeats' : `${c.defeatsLeft} defeat(s) left`}`),
      el('div', { class: 'meta dim' }, c.stage === 'over' ? `${c.outcome === 'lost' ? 'lost' : 'completed'}${c.score != null ? ` · score ${c.score.toLocaleString('en-US')}` : ''}${c.rank ? ` · rank ${c.rank}` : ''}` : c.kitOut === 'pending' ? 'the special forces kit-out is waiting' : c.kitOut === 'play' ? 'the kit-out is waiting to be played' : c.kitOut === 'result' ? 'kit out the special forces' : c.stage === 'result' ? 'a result is waiting' : c.stage === 'choose' ? 'choose the first battle' : c.stage === 'brief' && !c.hasForce ? 'raise your force' : 'a battle is waiting'),
      el('div', { class: 'actions' },
        el('button', { onclick: () => openCampaign(c.slug) }, 'Open'),
        el('button', { class: 'linky', onclick: () => deleteCampaign(c.slug, c.name) }, 'Delete'))));
  }
  // O HALL OF FAME (autor, 25/10): as campanhas encerradas, pelo placar
  const fama = STATUS.campaigns.filter((c) => c.stage === 'over' && c.score != null).sort((a, b) => b.score - a.score);
  const hall = $('#hall-of-fame');
  if (hall) {
    hall.replaceChildren();
    hall.hidden = !fama.length;
    if (fama.length) {
      hall.append(el('h2', {}, 'Hall of Fame'), el('div', { class: 'hall' }, ...fama.map((c, i) => el('button', { class: 'hall-row', onclick: () => openCampaign(c.slug), title: 'Open the outcome' },
        el('span', { class: 'hall-pos' }, `${i + 1}`),
        el('span', { class: 'hall-rank rank-' + (c.rank || 'D') }, c.rank || '—'),
        el('span', { class: 'hall-name' }, el('b', {}, c.name), el('span', {}, `${c.nation}${c.difficulty ? ' · ' + c.difficulty : ''} · ${c.outcome === 'lost' ? 'lost' : 'completed'}${c.finishedAt ? ' · ' + new Date(c.finishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}`)),
        el('span', { class: 'hall-score' }, c.score.toLocaleString('en-US'))))));
    }
  }
  show('home');
}

async function deleteCampaign(slug, name) {
  if (!confirm(`Delete the app's folder for "${name}"?\n\nThe .cam already written into the game folder is NOT removed.`)) return;
  await api('DELETE', '/api/campaigns/' + encodeURIComponent(slug));
  await loadStatus();
  renderHome();
}

// ------------------------------------------------------------------------------------- setup

function renderSetup() {
  const s = STATUS.settings;
  $('#game-files').value = s.gameFiles;
  $('#use-game-lib').checked = !!s.useGameLib;

  // The one thing the app cannot work out on its own if the search comes back empty. Said here,
  // plainly, instead of leaving the player to read a table of red rows.
  const ask = $('#find-game');
  ask.hidden = s.gameFilesOk !== false;
  if (!ask.hidden) {
    ask.replaceChildren(
      el('div', {}, el('b', {}, 'The game folder was not found.')),
      el('div', {}, 'It is the folder called ', el('code', {}, 'Game Files'),
        ', inside where Combat Mission: Black Sea is installed — it holds ',
        el('code', {}, 'Scenarios'), ' and ', el('code', {}, 'Campaigns'),
        '. Type it above and press Save, or press "Search for it" to look again.'));
  }
  $('#game-files-how').textContent = s.gameFilesOk
    ? `Found by: ${s.howFound}. It has ${(s.gameFilesHas || []).join(', ') || 'nothing the app recognises'}.`
    : '';
  // where the campaigns live (14/11): the data folder, outside the app folder unless it is a portable install
  $('#data-dir').textContent = s.dataDir || '';
  $('#data-dir-how').textContent = s.portable
    ? 'Portable: beside the app, because the app folder already holds campaigns (or this is a copy of the source code).'
    : 'Outside the app folder, so a new version of the app finds them. Back this folder up to keep your campaigns.';
  const t = $('#env-table');
  // o resumo da ultima checagem do sistema e o botao que a roda de novo
  const sc = s.systemCheck;
  $('#system-summary').textContent = !sc ? 'The system check has not run on this computer yet.'
    : `Last run ${new Date(sc.at).toLocaleString('en-GB')}: ${sc.ok ? 'everything the app needs is in place' : `${sc.falhas} problem(s) to fix`}${sc.avisos ? `, ${sc.avisos} warning(s)` : ''}.`;
  t.replaceChildren(el('tr', {}, el('th', {}, 'What'), el('th', {}, 'Where'), el('th', {}, 'State')));
  for (const e of STATUS.environment) {
    t.append(el('tr', {},
      el('td', {}, el('div', {}, e.name), el('div', { class: 'hint' }, e.why)),
      el('td', {}, el('div', { class: 'file' }, e.path)),
      el('td', { class: e.ok ? 'ok' : 'no' }, e.ok ? 'ok — ' + e.detail : e.detail)));
  }
  show('setup');
}

$('#save-settings').addEventListener('click', async () => {
  const r = await api('PUT', '/api/settings', { gameFiles: $('#game-files').value.trim(), useGameLib: $('#use-game-lib').checked });
  const note = $('#settings-note');
  note.hidden = false;
  note.className = r.check && !r.check.ok ? 'banner bad' : 'banner';
  note.textContent = r.check && !r.check.ok
    ? `Saved, but that folder does not look like a game folder — no ${r.check.missing.join(', ')} in it. Check the path before restarting.`
    : 'Saved. ' + r.note + '.';
  if (r.systemCheck && !r.systemCheck.ok) { note.className = 'banner bad'; note.textContent += ` The system check found ${r.systemCheck.falhas} problem(s) with this folder: press "Run the system check" to see them.`; }
  await loadStatus();
  renderSetup();
  note.hidden = false;
});

$('#detect-game').addEventListener('click', async () => {
  const note = $('#settings-note');
  note.hidden = false;
  note.className = 'banner';
  note.textContent = 'Looking…';
  const r = await api('POST', '/api/detect');
  if (!r.found) {
    note.className = 'banner bad';
    note.textContent = `Nothing found in ${r.looked} likely places (Steam's own library list, the usual install folders, and every drive). `
      + 'Type the folder above and press Save.';
    return;
  }
  $('#game-files').value = r.found;
  note.className = 'banner good';
  note.textContent = r.tried.length > 1
    ? `Found ${r.tried.length} game folders; the fullest one is filled in above. Press Save to keep it.`
    : 'Found it — filled in above. Press Save to keep it.';
});

// --------------------------------------------------------------------------------- system check
//
// A CHECAGEM DO SISTEMA (autor, 29/10): na primeira execucao a pagina abre aqui; depois, so se a ultima achou uma
// falha, ou pelo botao do Setup. O servidor confere (app/src/sistema.mjs); a tela so lista: o que esta certo, o que e
// aviso (segue) e o que e falha (Continue desligado), com o conserto de cada um.
const MARCA_SISTEMA = { ok: '✓', aviso: '⚠', falha: '✗' };
async function renderSystem({ denovo = false } = {}) {
  const lista = $('#system-list');
  lista.replaceChildren(el('p', { class: 'hint' }, 'Checking…'));
  $('#system-verdict').hidden = true;
  $('#system-continue').disabled = true;
  $('#system-continue').title = 'Checking…';
  show('system');
  let r;
  try { r = await api(denovo ? 'POST' : 'GET', '/api/system-check'); }
  catch (e) { lista.replaceChildren(el('div', { class: 'banner bad' }, `The check did not run: ${e.message}`)); return; }
  lista.replaceChildren(...r.itens.map((i) => el('div', { class: 'sys-item sys-' + i.estado, 'data-id': i.id },
    el('span', { class: 'sys-mark' }, MARCA_SISTEMA[i.estado] || '?'),
    el('div', {}, el('b', {}, i.titulo), el('div', { class: 'file' }, i.detalhe),
      i.estado !== 'ok' && i.conserto ? el('div', { class: 'hint' }, i.conserto) : ''))));
  const head = $('#system-verdict');
  head.hidden = false;
  head.className = r.ok ? 'banner good' : 'banner bad';
  head.textContent = r.ok
    ? (r.avisos ? 'The app can run. Read the warnings below; they do not stop it.' : 'Everything the app needs is in place.')
    : `${r.falhas} problem(s) must be fixed before the app can make battles. Each one says how.`;
  $('#system-continue').disabled = !r.ok;
  $('#system-continue').title = r.ok ? '' : 'Fix the lines marked ✗ first, then press Check again';
  $('#system-setup').hidden = !r.itens.some((i) => i.id === 'game' && i.estado === 'falha');
  await loadStatus();
}
$('#system-again').addEventListener('click', () => renderSystem({ denovo: true }));
$('#system-continue').addEventListener('click', () => go({ screen: 'start' }, { replace: true }));
$('#system-setup').addEventListener('click', () => go({ screen: 'setup' }));
$('#run-system-check').addEventListener('click', () => go({ screen: 'system' }));
$('#open-data-dir').addEventListener('click', async () => {
  try { await api('POST', '/api/open-data-folder'); } catch (e) { alert(e.message); }
});

// ------------------------------------------------------------------------------ new campaign

// The labels also live in the back end (catalog.SIDES / catalog.ARMIES). Keeping a copy here means
// the screen still opens when the server is older than the page — which happens every time the app
// changes and only the browser is reloaded, since `src/*.mjs` is read once at startup and `web/` on
// every request.
const SIDE_LABELS = { US: { label: 'United States and Ukraine', other: 'RU' }, RU: { label: 'Russia', other: 'US' } };
const ARMY_LABELS = { US: 'United States', UKR: 'Ukraine', RU: 'Russia' };
const ARMY_ORDER = ['US', 'UKR', 'RU'];
const armyLabel = (a) => ARMY_LABELS[a] || a;

// The formation picker is used twice: once to raise a force, once to buy into one between
// battles. Everything about it is the same except where it draws and what it may spend, so those
// two things live on the basket and the rest of the code never asks which screen it is on.
// A CESTA DA FORCA DA BATALHA 1 (18/10): o Quartermaster de uma campanha que nasceu sem forca.
const RAISE_ELS = { library: '#raise-library', picks: '#raise-picks', budget: '#raise-budget', create: '#raise-create' };

// OS PARAMETROS DA CAMPANHA, decididos antes da forca. Ficam aqui enquanto a tela esta aberta e
// viram campos do estado quando a campanha nasce.
let PARAMS = null;

function startNew() {
  PARAMS = { armies: ['US', 'UKR'], enemySide: 'RU', ratio: null, rescueChance: null, opPoints: null, defeats: null };
  $('#new-name').value = '';
  $('#params-error').hidden = true;
  fillRatio();
  fillRescue();
  fillOps();
  fillDefeats();
  fillSpecialForces();
  fillDifficulty();
  applyPreset(STATUS.rules.difficulty?.default || 'Medium');
  go({ screen: 'params' });
}

// A DIFICULDADE (18/10, autor): presets da regra. Escolher um escreve todos os campos; mudar qualquer campo recalcula, e o
// que nao bate com nenhum e Custom. A comparacao e a mesma do servidor (campaign.difficultyOf).
const presetsOf = () => STATUS.rules.difficulty?.presets || [];
function difficultyOf(p) {
  const sf = STATUS.rules.formations?.specialForcesPrice;
  const arm = (a) => [...(a || [])].sort().join();
  const hit = presetsOf().find((x) => arm(x.armies) === arm(p.armies) && x.enemySide === p.enemySide && Number(x.ratio) === Number(p.ratio)
    && Number(x.rescueChance) === Number(p.rescueChance) && Number(x.opPoints) === Number(p.opPoints) && String(x.defeats) === String(p.defeats)
    && Number(x.specialForcesPrice ?? sf) === Number(p.specialForcesPrice ?? sf));   // 06/11: o preco da SF faz parte do preset
  return hit ? hit.name : 'Custom';
}
function readParamSelects() {
  PARAMS.ratio = Number($('#param-ratio').value);
  PARAMS.rescueChance = Number($('#param-rescue').value);
  PARAMS.opPoints = Number($('#param-ops').value);
  PARAMS.defeats = $('#param-defeats').value === 'unlimited' ? 'unlimited' : Number($('#param-defeats').value);
  PARAMS.specialForcesPrice = Number($('#param-sf').value);
}
function syncDifficulty() {
  if (!PARAMS) return;
  readParamSelects();
  PARAMS.difficulty = difficultyOf(PARAMS);
  drawDifficulty();
}
// OS BOTOES DA DIFICULDADE (18/10, autor: na horizontal, nao num dropdown). Custom acende quando nada bate; nao se escolhe.
function drawDifficulty() {
  const atual = PARAMS?.difficulty || null;
  $('#param-difficulty').replaceChildren(...[...presetsOf().map((p) => p.name), 'Custom'].map((n) => {
    const custom = n === 'Custom';
    return el('button', {
      type: 'button', class: 'choice' + (custom ? ' custom' : '') + (n === atual ? ' on' : ''), 'data-difficulty': n,
      ...(custom ? { title: 'Any change to the parameters below that matches no preset' } : {}),
      onclick: () => { if (!custom) applyPreset(n); },
    }, n);
  }));
}
function fillDifficulty() {
  drawDifficulty();
  for (const id of ['#param-ratio', '#param-rescue', '#param-ops', '#param-defeats', '#param-sf']) $(id).onchange = syncDifficulty;
}
function applyPreset(name) {
  const p = presetsOf().find((x) => x.name === name);
  if (!p) { renderParams(); return; }
  PARAMS.armies = ARMY_ORDER.filter((a) => p.armies.includes(a));
  PARAMS.enemySide = p.enemySide;
  const pon = (id, v) => { const s = $(id); if ([...s.options].some((o) => o.value === String(v))) s.value = String(v); };
  pon('#param-ratio', p.ratio); pon('#param-rescue', p.rescueChance); pon('#param-ops', p.opPoints); pon('#param-defeats', p.defeats);
  pon('#param-sf', p.specialForcesPrice ?? STATUS.rules.formations?.specialForcesPrice);
  renderParams();
}

// A biblioteca e um conjunto de exercitos e o inimigo e um lado. Os dois desenham daqui, porque
// escolher o exercito muda o texto do inimigo: lutar contra o proprio exercito e permitido — o jogo
// so tem dois lados, e nada impede russo contra russo — mas merece ser dito em voz alta.
function renderParams() {
  const caixa = $('#param-armies');
  caixa.replaceChildren(...ARMY_ORDER.map((a) => {
    const on = PARAMS.armies.includes(a);
    const cb = el('input', { type: 'checkbox', ...(on ? { checked: 'checked' } : {}) });
    cb.addEventListener('change', () => {
      PARAMS.armies = cb.checked ? [...PARAMS.armies, a] : PARAMS.armies.filter((x) => x !== a);
      PARAMS.armies = ARMY_ORDER.filter((x) => PARAMS.armies.includes(x));
      renderParams();
    });
    return el('label', { class: 'choice' + (on ? ' on' : '') }, cb, el('span', {}, armyLabel(a)));
  }));

  const lados = $('#param-enemy');
  lados.replaceChildren(...Object.keys(SIDE_LABELS).map((s) => {
    const on = PARAMS.enemySide === s;
    const rb = el('input', { type: 'radio', name: 'enemy-side', ...(on ? { checked: 'checked' } : {}) });
    rb.addEventListener('change', () => { PARAMS.enemySide = s; renderParams(); });
    return el('label', { class: 'choice' + (on ? ' on' : '') }, rb, el('span', {}, SIDE_LABELS[s].label));
  }));

  const comuns = PARAMS.armies.filter((a) => (PARAMS.enemySide === 'US' ? a === 'US' || a === 'UKR' : a === 'RU'));
  $('#enemy-note').textContent = PARAMS.enemySide === 'US'
    ? `You attack in every battle. The defense is a battalion of one of the two armies, drawn fresh each battle — some of your battles will be against Americans and some against Ukrainians.${comuns.length ? ` Note that ${comuns.map(armyLabel).join(' and ')} ${comuns.length > 1 ? 'are' : 'is'} also in your own library, so you will be fighting your own army.` : ''}`
    : `You attack in every battle, and the defense is a Russian battalion.${comuns.length ? ' Note that Russia is also in your own library, so you will be fighting your own army.' : ''}`;
  $('#params-error').hidden = PARAMS.armies.length > 0;
  if (!PARAMS.armies.length) $('#params-error').textContent = 'Pick at least one army for your library — there is nothing to buy otherwise.';
  $('#params-next').disabled = !PARAMS.armies.length;
  syncDifficulty();
}

// A CAMPANHA NASCE SEM FORCA (18/10, autor: Battle Path > Quartermaster > Intel > Battle). A tela de parametros cria a
// campanha; a forca e comprada no Quartermaster depois que a batalha 1 e escolhida no caminho. O nome e exigido aqui: um
// botao desabilitado sem dizer por que foi o que confundiu numa versao anterior.
async function createFromParams() {
  const nome = $('#new-name').value.trim();
  const b = $('#params-error');
  if (!nome) { b.hidden = false; b.textContent = 'Give the campaign a name.'; $('#new-name').focus(); return; }
  if (!PARAMS.armies.length) return;
  syncDifficulty();
  b.hidden = true;
  try {
    const { job } = await api('POST', '/api/campaigns', {
      name: nome,
      armies: PARAMS.armies,
      enemySide: PARAMS.enemySide,
      forceRatio: PARAMS.ratio,
      rescueChance: PARAMS.rescueChance,
      opPoints: PARAMS.opPoints,
      defeatsAllowed: PARAMS.defeats,
      specialForcesPrice: PARAMS.specialForcesPrice,
      picks: [],
    });
    const state = await watchJob(job, 'Creating the campaign');
    CAMPAIGN = state;
    NEW = null; PARAMS = null;
    await loadStatus();
    await go({ screen: 'campaign', slug: state.slug, tab: state.stage === 'choose' ? 'path' : 'menu' });
  } catch (e) {
    if (e.handled) return;
    show('params');
    b.hidden = false;
    b.textContent = e.message + (e.id ? ` (error ${e.id})` : '');
  }
}

// What a pick of the basket is, for the server (price, creation, raise, recruit).
const pickPayload = (p) => ({ source: p.formation.file, nation: p.formation.nation, points: p.formation.points, keep: [...p.keep], xp: p.xp, extras: p.formation.sf ? [] : extrasPayload(p), swaps: p.formation.sf ? [] : p.swaps || [], sf: !!p.formation.sf });

// The enemy's size is one number, chosen once. It multiplies the tier budget and nothing else,
// so the mix of the defense stays what the rules say and only the amount changes — and it holds
// for the whole campaign, because changing it midway would make the battles behind and the
// battles ahead two different games.
// O TIPO DO MAPA (autor, 11/10: "falta a informacao de tipo de mapa: mixed, urban e open"): o perfil do censo, que tambem
// move o dinheiro da defesa entre infantaria e veiculos (defense.profileShift).
function profileWord(p) {
  return { misto: 'Mixed', urbano: 'Urban', aberto: 'Open' }[p] || (p ? String(p) : '');
}


// A RAZAO DE FORCA (30/10, a escada): a dificuldade. As opcoes saem da regra; o preset que usa cada uma vai no rotulo.
// Desde 01/11 ela escala o inimigo do Attack. 15/11 (autor): o rotulo dizia "enemy N cr in battle 1" (startingCredits / R),
// numero que nao e o do inimigo de verdade (o peso do no e o mapa o movem); agora diz so a proporcao.
function fillRatio() {
  const D = STATUS.rules.difficulty || {};
  const pres = D.presets || [];
  const padrao = pres.find((p) => p.name === D.default)?.ratio;
  $('#param-ratio').replaceChildren(...(D.ratioOptions || []).map((v) => {
    const quem = pres.find((p) => Number(p.ratio) === v);
    const leitura = v >= 1 ? `you field ${v}× the enemy` : `the enemy fields ${(1 / v).toFixed(2)}× you`;
    return el('option', { value: String(v), ...(v === padrao ? { selected: 'selected' } : {}) },
      `${v} : 1 — ${leitura}${quem ? ` (${quem.name})` : ''}`);
  }));
}

// A CHANCE DO SOCORRIDO VOLTAR, por campanha. As opcoes saem da regra, como as do inimigo: a tela
// nao inventa numero que o servidor nao aceita.
function fillRescue() {
  const rep = STATUS.rules.replacement || {};
  const opcoes = rep.rescueChanceOptions || [0, 0.25, 0.5, 0.75, 1];
  const padrao = rep.rescueChance ?? 0.5;
  const sel = $('#param-rescue');
  sel.replaceChildren(...opcoes.map((v) => el('option', {
    value: String(v), ...(v === padrao ? { selected: 'selected' } : {}),
  }, v === 0 ? '0% — nobody comes back on his own' : v === 1 ? '100% — every wounded man comes back' : `${Math.round(v * 100)}%`)));
}

// QUANTAS DERROTAS A CAMPANHA AGUENTA (E179): 0 a 4 ou sem limite, o que a regra oferece.
const defeatsWord = (d) => (d === 'unlimited' ? 'no defeat ends it' : d === 0 ? 'Ironman: the first defeat ends it' : `${d} defeat${d === 1 ? '' : 's'} allowed`);
function fillDefeats() {
  const R = STATUS.rules;
  const opcoes = R.defeatsAllowedOptions || [R.defeatsAllowed];
  $('#param-defeats').replaceChildren(...opcoes.map((v) => el('option', { value: String(v), ...(v === R.defeatsAllowed ? { selected: 'selected' } : {}) },
    v === 'unlimited' ? 'Unlimited — no defeat ends the campaign' : v === 0 ? 'Ironman — the first defeat ends the campaign' : `${v}`)));
}

// O PRECO DAS SPECIAL FORCES DA CAMPANHA (18/10, autor): gratis ou 600 cr desde 21/10; o padrao e o da regra. Desde 06/11 faz parte do preset (600 em todos; gratis e Custom).
function fillSpecialForces() {
  const F = STATUS.rules.formations || {};
  const opcoes = F.specialForcesPriceOptions || [F.specialForcesPrice];
  $('#param-sf').replaceChildren(...opcoes.map((v) => el('option', { value: String(v), ...(v === F.specialForcesPrice ? { selected: 'selected' } : {}) }, v === 0 ? 'Free' : `${v} cr`)));
}

// OS PONTOS OPERACIONAIS DO COMECO (E176), da regra do caminho.
function fillOps() {
  const p = STATUS.rules.path || {};
  const opcoes = p.startingPointsOptions || [0, 1, 2, 3];
  const padrao = p.startingPointsDefault ?? 2;
  $('#param-ops').replaceChildren(...opcoes.map((v) => el('option', { value: String(v), ...(v === padrao ? { selected: 'selected' } : {}) }, `${v} point${v === 1 ? '' : 's'}`)));
}

// A campanha da cesta, nas consultas que mostram precos: o preco das Special Forces e parametro dela (18/10).
const slugDaCesta = () => (NEW && NEW.slug ? `&slug=${encodeURIComponent(NEW.slug)}` : '');

async function loadFormations() {
  const r = await api('GET', `/api/catalog?armies=${(NEW.armies || ['US', 'UKR']).join(',')}${slugDaCesta()}`);
  const formations = r.formations || [];
  NEW.available = new Set(formations.map((f) => f.file));
  if (!r.armies) checkServerVersion(undefined);   // the banner at the top of the page says what to do
  NEW.library = formations;
  // a biblioteca abre por custo, a mais cara primeiro, na criacao e no quartermaster (autor, 10-11/10)
  NEW.libSort = NEW.libSort || { key: 'price', dir: -1 };
  drawLibrary();
}

// THE LIBRARY AS A TABLE, above the charts (autor, 27/09): Country, Name, Units, Cost, Type, View.
// Two gestures on one row, and they must not be the same click: the row TAKES the formation, the
// View button only LOOKS at it. Special forces are one per campaign, so once the force has one the
// other special-forces rows are locked.
const samePick = (p, f) => p.formation.file === f.file && !!p.formation.sf === !!f.sf;
// AVAILABILITY (autor, 04/10): quantas copias da formacao a campanha pode ter (rules.formations). A
// copia vendida inteira nao conta; Special Forces tem o seu proprio teto.
const availabilityOf = (f) => (f.sf ? 1 : Number((STATUS.rules?.formations?.availability || {})[f.file] ?? STATUS.rules?.formations?.availabilityDefault ?? 1));
const copiesOf = (f) => (NEW ? NEW.picks.filter((p) => samePick(p, f) && !p.sold) : []);
// Duas copias do mesmo arquivo nao podem dividir a selecao: a segunda leva um `uid` proprio.
const pickId = (pick) => pick.uid || pick.formation.file;
function drawLibrary() {
  const box = NEW.library ? $(NEW.el.library) : null;
  if (!box) return;
  const max = STATUS.rules?.formations?.maxSpecialForces ?? 1;
  const temSF = NEW.picks.filter((p) => p.formation.sf).length;
  const cols = [
    { key: 'nation', label: 'Country' }, { key: 'name', label: 'Name' },
    { key: 'units', label: 'Units', num: true }, { key: 'price', label: 'Cost', num: true },
    { key: 'type', label: 'Type' },
    // AVAILABILITY (autor, 11/10): X/Y = copias na forca / o limite da campanha (formacoes_e_pendentes.xlsx -> rules)
    { key: 'picks', label: 'Picks', num: true },
    { key: 'buy', label: '', fixed: true },
    { key: 'view', label: 'View', fixed: true },
  ];
  const { key, dir } = NEW.libSort;
  // a coluna Picks ordena pelo que ainda cabe
  for (const f of NEW.library) f.picks = availabilityOf(f) - copiesOf(f).length;
  const rows = [...NEW.library].sort((x, y) => {
    const a = x[key], b = y[key];
    const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''));
    return c * dir || (y.units || 0) - (x.units || 0) || x.name.localeCompare(y.name);
  });
  const t = el('table');
  t.append(el('tr', {}, ...cols.map((c) => {
    const th = el('th', {}, c.label + (key === c.key ? (dir > 0 ? ' ▲' : ' ▼') : ''));
    if (!c.fixed) {
      th.addEventListener('click', () => {
        NEW.libSort = key === c.key ? { key, dir: -dir } : { key: c.key, dir: c.num ? -1 : 1 };
        drawLibrary();
      });
    }
    return th;
  })));
  for (const f of rows) {
    const picked = NEW.picks.some((p) => samePick(p, f));
    const copias = copiesOf(f).length, teto = availabilityOf(f);
    const locked = f.sf && !picked && temSF >= max;
    const ver = el('button', { class: 'linky view' }, 'View');
    ver.title = `See the order of battle of ${f.name} without buying it`;
    ver.addEventListener('click', (ev) => { ev.stopPropagation(); viewFormation(f); });
    const cheio = copias >= teto;
    // O BOTAO ADD (autor, 16/10; "Add" desde 29/10, era "Buy"): so ele poe a formacao na forca, vazia (a SF inteira);
    // a linha nao responde ao clique
    const porque = locked ? `Only ${max} special forces formation${max > 1 ? 's' : ''} per campaign`
      : copias < teto ? (copias ? `Add a copy (${copias} of ${teto} taken)` : `Add it to your force with nothing selected, then take the units you want (up to ${teto} per campaign)`) : `All ${teto} cop${teto > 1 ? 'ies' : 'y'} taken`;
    const comprar = el('button', { class: 'buy', title: f.sf && !locked && !cheio ? 'Add it to your force — special forces come whole' : porque, ...(locked || cheio ? { disabled: 'disabled' } : {}) }, 'Add');
    comprar.addEventListener('click', (ev) => { ev.stopPropagation(); addPick(f, { copia: teto > 1 && copias > 0 && copias < teto }); });
    const tr = el('tr', { class: 'row' + (picked ? ' picked' : '') + (locked ? ' locked' : '') + (cheio ? ' full' : '') },
      el('td', {}, el('span', { class: 'flag' }, f.nation)),
      el('td', {}, f.name),
      el('td', { class: 'num', title: `${f.units} roster line${f.units === 1 ? '' : 's'}: every unit of the formation takes one, kept or not` }, `${f.units}${f.offMapUnits ? ` (${f.offMapUnits} off-map)` : ''}`),
      el('td', { class: 'num' }, `${f.price} cr`),
      el('td', { class: f.sf ? 'type-sf' : '' }, f.type || ''),
      el('td', { class: 'num picks' + (cheio ? ' cheio' : ''), title: `${copias} in your force, ${teto} allowed per campaign` }, `${copias}/${teto}`),
      el('td', {}, comprar),
      el('td', {}, ver));
    t.append(tr);
  }
  box.replaceChildren(t);
}

// A SPECIAL FORCES CHART SHOWS ONLY WHAT IT IS: the kept subtrees and the headings above them. The
// rest of the source is in the file, absent, and never for sale — so it is not drawn.
function sfTree(tree, keep) {
  const corta = (n) => {
    if (keep.has(n.key)) return n;
    const filhos = n.children.map(corta).filter(Boolean);
    return filhos.length ? { ...n, children: filhos } : null;
  };
  return { ...tree, roots: tree.roots.map(corta).filter(Boolean) };
}

// A special forces pick arrives whole and fixed: the keys come from the rule (the server forces them
// again), and the chart offers no take and no drop.
// OS HOMENS ANTES DE EXISTIREM (28/09). Na criacao o jogo ainda nao nomeou ninguem; a arvore da SF vem
// com o kit de fabrica de cada unidade (`sf=1`), e o chart mostra as vagas com a arma de cada uma, sem
// troca. A troca abre no quartermaster, depois da primeira batalha.
const KIT_NOTE = 'Factory kit per slot. Weapons change after the first battle.';
const KIT_HINT = 'The men are named when the unit first takes the field. These are its slots and the factory weapon of each — weapons can be changed in the quartermaster after its first battle.';
function kitMen(n) {
  if (n.kit === undefined) return null;
  if (n.kit === null) return { nation: null, men: [], note: 'No factory data for this unit yet.', readOnly: true };
  return {
    nation: null, readOnly: true, note: KIT_NOTE, hint: KIT_HINT,
    men: n.kit.map((k) => ({ index: `kit${k.slot}`, name: `Slot ${k.slot + 1}`, weapon: k.weapon, weaponName: k.weaponName, secondName: k.secondName, canChange: false, state: 0 })),
  };
}
const KIT_MEN = { of: kitMen, menu: () => [], chosen: () => null, choose: () => null, count: () => 0, reset: () => null };

async function addSpecialForces(formation) {
  const inteira = await api('GET', `/api/catalog/tree?source=${encodeURIComponent(formation.file)}&nation=${formation.nation}&sf=1${slugDaCesta()}`);
  const keep = new Set(formation.keep || []);
  const tree = sfTree(inteira, keep);
  const pick = { formation, tree, keep, open: new Set(tree.roots.map((r) => r.key)), xp: {}, swaps: [], attached: new Set(), fixed: true };
  NEW.picks.push(pick);
  renderPicks();
  // AS ARMAS DAS SF SO DEPOIS QUE O JOGO CRIA OS SOLDADOS (autor, 18/10), e desde 19/10 isso e o KIT-OUT: uma batalha de
  // mentira antes da batalha escolhida, onde ele so da Cease Fire.
  if (!NEW.sfNotice) {
    NEW.sfNotice = true;
    const kitOn = !(STATUS.rules.formations && STATUS.rules.formations.kitOut && STATUS.rules.formations.kitOut.on === false);
    notice('Special forces', kitOn ? [
      'Buying special forces adds a kit-out before your next battle.',
      'Combat Mission creates the individual soldiers only when a unit first takes the field. The kit-out puts your special forces alone on a small map:',
      ['Deploy.', 'Choose Cease Fire.', 'Come back with the save the game writes at the transition.'],
      'Then the quartermaster lets you change the weapon and the item of each man, and the battle you chose comes after it.',
    ] : [
      'The weapon and the kit of each soldier can only be changed after the unit\'s first battle.',
      'Combat Mission creates the individual soldiers when the unit first takes the field, and until then there is nobody to equip. After that battle, the quartermaster lets you change what each man of this formation carries.',
    ]);
  }
  return pick;
}

// ---------------------------------------------------------------- looking without buying
//
// The library says "9 units, 1250 cr" and nothing about what is IN there. The chart already knows
// how to draw a formation; this is the same chart with everything that writes taken out of it, over
// the whole window, from either screen that shows the library.
let VIEWER = null;
function closeViewer() { if (VIEWER) { VIEWER.hidden = true; VIEWER.replaceChildren(); } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && VIEWER && !VIEWER.hidden) closeViewer(); });

async function viewFormation(f) {
  const host = VIEWER || (VIEWER = document.body.appendChild(el('div', { id: 'viewer', class: 'viewer' })));
  const head = (extra) => el('div', { class: 'viewer-head' },
    el('span', { class: 'flag' }, f.nation),
    el('strong', {}, f.name),
    extra,
    el('button', { class: 'linky', onclick: closeViewer }, '✕ close'));
  host.hidden = false;
  host.replaceChildren(head(el('span', { class: 'hint' }, 'Reading the library…')));

  let tree;
  try {
    tree = await api('GET', `/api/catalog/tree?source=${encodeURIComponent(f.file)}&nation=${f.nation}`);
  } catch (e) {
    host.replaceChildren(head(el('span', { class: 'hint no' }, e.message)));
    return;
  }

  const folhas = [];
  const chaves = [];
  const anda = (n) => { chaves.push(n.key); if (n.isFormation) n.children.forEach(anda); else folhas.push(n); };
  tree.roots.forEach(anda);
  const total = folhas.reduce((a, n) => a + (n.price || 0), 0);
  const fora = folhas.filter((n) => n.offMap).length;

  // Everything reads as present: this is what the formation IS, not a force being assembled, so
  // there is no "in" and "out" to draw.
  const pick = { formation: f, tree, keep: new Set(chaves), open: new Set(tree.roots.map((r) => r.key)), view: { x: 0, y: 0, z: 1 } };
  const desenhar = () => {
    host.replaceChildren(
      head(el('span', { class: 'hint' },
        `${folhas.length} unit${folhas.length === 1 ? '' : 's'}${fora ? `, ${fora} off-map` : ''} · `,
        el('span', { class: 'price' }, `${total} cr whole`),
        ` · priced as ${f.nation}`)),
      renderCanvas(pick, desenhar, (n) => n.price || 0, { readOnly: true, onClose: closeViewer }));
  };
  desenhar();
}

$('#params-next').addEventListener('click', createFromParams);
$('#params-cancel').addEventListener('click', () => { NEW = null; PARAMS = null; go({ screen: 'home' }); });
$('#new-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createFromParams(); });

// A formation the player already owns is priced by what he is ADDING to it: the units already in
// the field cost nothing, they are simply there. Walked here rather than asked of the server,
// because the tree already carries a price per unit, computed with this campaign's nation factor.
function leaves(pick, fn) {
  // O fantasma e o desenho de uma unidade que pertence a OUTRA escolha: quem conta dinheiro ou
  // aplica modificador tem de passar direto por ele, senao a mesma maquina e contada duas vezes.
  const walk = (n) => { if (n.ghost) return; if (n.isFormation) n.children.forEach(walk); else fn(n); };
  pick.tree.roots.forEach(walk);
}
// A unit bought from the arsenal is bought at the experience the player picks for it, like one
// bought from the library (E53): the bill follows `pick.xp`, and the choice travels to the server
// by core id.
function addedTo(pick) {
  const ids = []; const xp = {}; let cost = 0, units = 0, onMap = 0;
  leaves(pick, (n) => {
    if (n.owned || !pick.keep.has(n.key)) return;
    cost += unitPrice(pick, n); units += 1; if (!n.offMap) onMap += 1;
    if (n.coreId !== null && n.coreId !== undefined) {
      ids.push(n.coreId);
      const chosen = (pick.xp || {})[n.key];
      if (chosen && chosen !== n.experience) xp[n.coreId] = chosen;
    }
  });
  // os veiculos anexados a esta formacao, que ja e dele (30/10): vao ao servidor como `attachOwned`
  for (const e of pick.extras || []) { cost += e.price || 0; units += 1; onMap += 1; }
  return { ids, xp, cost, units, onMap };
}

// ------------------------------------------------------------------ experience, and what it costs
// The library rolls a level for every unit and freezes it in the file — the same source always
// hands out the same troops. The player can buy better (or cheaper), and the bill follows. The
// scale rides along with the tree so the screen can price a change without a round trip; the
// server prices the real thing when it bills.
const xpLevels = (pick) => pick.tree.experienceLevels || [];
const xpFactor = (pick, level) => (pick.tree.experienceFactor || {})[level] ?? 1;
const leavesOf = (node, out = []) => { if (node.isFormation) node.children.forEach((c) => leavesOf(c, out)); else out.push(node); return out; };
// A target reference point has no veterancy, and the server does not charge it for one either.
const xpPriced = (n) => n.role !== 'trp';

// What a unit WILL BE: the choice, or what the library rolled. A formation answers for everything
// under it, and `null` means its units do not agree.
function xpOf(pick, node) {
  pick.xp = pick.xp || {};
  if (!node.isFormation) return pick.xp[node.key] || node.experience || null;
  const all = [...new Set(leavesOf(node).filter(xpPriced).map((n) => pick.xp[n.key] || n.experience))];
  return all.length === 1 ? all[0] : null;
}

function unitPrice(pick, node) {
  const chosen = (pick.xp || {})[node.key];
  // A unit whose equipment was swapped is priced as the new type: `base` has no veterancy in it.
  const opt = swapOf(pick, node);
  if (opt) return Math.round(opt.base * (xpPriced(node) && (chosen || node.experience) ? xpFactor(pick, chosen || node.experience) : 1));
  const base = node.price || 0;
  if (!chosen || !xpPriced(node) || !node.experience) return base;
  return Math.round(base * xpFactor(pick, chosen) / xpFactor(pick, node.experience));
}

// THE EQUIPMENT A UNIT WILL HAVE — the editor's bottom blocks (FORMATO 43.2). A swap on the pick is
// `{ key, group, to }`: every unit under `key` whose group is `group` becomes the type `to`. The
// deepest swap that covers the unit wins; none, or one that lands on what the library rolled, means
// the unit stays as it is.
// The KEY of an option is its type, plus the block path when the group carries the same type twice
// (group 603 is two different mortars, FORMATO 41.1).
const optionsOf = (pick, group) => ((pick.tree.equipment || {}).groups?.[group]?.options || []);
const keyOf = (type, path) => String(type) + (path && path.length ? '@' + path.join('/') : '');
const optionOf = (pick, group, type, path) => optionsOf(pick, group).find((o) => String(o.type) === String(type) && (!path || !path.length || (o.path || []).join('/') === path.join('/')))
  || optionsOf(pick, group).find((o) => String(o.type) === String(type)) || null;
// A CHAVE DA OPCAO NA TELA (03/10). O servidor manda `o.key` no formato da tabela ("0xTAB,0xVAL"),
// e esta tela le o valor escolhido como "val,tab" decimal: o T-90AM (APS) [145,5] virava [5,145], o
// servidor recusava ("0x91,0x05 is not an option of group 624") e a cotacao do batalhao inteiro
// falhava — o autor via o "Committed" parar. E a folha nunca casava com a opcao, entao o seletor
// dizia "Mixed" mesmo com um tipo so. Agora a tela tem a sua chave, feita do tipo, mais o caminho
// so quando o grupo repete o tipo (o grupo 603, dois morteiros); a folha acha a sua opcao por
// `optionOf` e usa a mesma chave.
const optKey = (pick, group, o) => keyOf(o.type,
  optionsOf(pick, group).filter((q) => String(q.type) === String(o.type)).length > 1 ? o.path : null);
const leafKey = (pick, n) => { const o = swapOf(pick, n) || optionOf(pick, n.group, n.type, n.path); return o ? optKey(pick, n.group, o) : keyOf(n.type, n.path); };
function swapOf(pick, node) {
  if (node.isFormation || node.group == null) return null;
  let best = null;
  for (const s of pick.swaps || []) {
    if (s.group !== node.group) continue;
    if (node.key !== s.key && !node.key.startsWith(s.key + '.')) continue;
    if (!best || s.key.length > best.key.length) best = s;
  }
  if (!best || (String(best.to) === String(node.type) && (!best.path || !node.path || best.path.join('/') === node.path.join('/')))) return null;
  return optionOf(pick, node.group, best.to, best.path);
}
const nameOf = (pick, node) => { const o = swapOf(pick, node); return o ? o.name : node.name; };
// ------------------------------------------------------------------------------ the force
// TAKING a unit and SELECTING it are still one gesture each, and neither is a click on the block:
// the block's own buttons take it, and a drag on the BACKGROUND lassoes. That was the fix autor
// asked for — the same block with two clicks meaning different things was one too many.
//
// The lasso only narrows. With nothing caught, the Modifiers panel acts on the whole force; with
// something caught, on that part of it. Either way it only ever writes to units that are in the
// force, are not already fighting (those keep what they earned), and have veterancy at all.
let SEL = new Set();
// O FANTASMA RESPONDE PELO ORIGINAL. Ele e o desenho, dentro de uma escolha, de uma unidade que
// vive noutra — entao selecionar o fantasma tem de selecionar a unidade DE VERDADE, senao o painel
// de modificadores procura uma chave que so existe no desenho e nao acha nada. Era por isso que o
// veiculo avulso nao dava para pegar: ele nao tinha identidade propria na selecao.
const SEP = String.fromCharCode(0);
const selId = (pick, node) => (node.ghost
  ? `${node.ghostOf}${SEP}${node.ghostKey}`
  : `${pickId(pick)}${SEP}${node.key}`);
// Os arquivos desenhados NESTE grafico: o da propria escolha, mais o de cada avulso pendurado nela.
const filesDrawnIn = (pick) => [pickId(pick),
  ...(NEW ? NEW.picks : []).filter((p) => p.attachedHost && p.attachedHost.file === pick.formation.file)
    .map((p) => p.formation.file)];
function selSet(pick, nodes, additive) {
  // A lasso drawn in one formation's chart does not throw away what was caught in another's — e o
  // avulso desenhado aqui dentro conta como sendo deste grafico, senao ele sobrava de laco em laco.
  if (!additive) {
    const meus = filesDrawnIn(pick);
    for (const id of [...SEL]) if (meus.some((f) => id.startsWith(f + SEP))) SEL.delete(id);
  }
  for (const n of nodes) SEL.add(selId(pick, n));
  renderPicks();
}
function selClear() { if (SEL.size) { SEL = new Set(); renderPicks(); } }

// Every unit the panel would write to, and whether the lasso narrowed it.
function modTargets() {
  const todas = [];
  // Owned picks too (E53): a dormant unit ticked in the arsenal is a purchase like any other and
  // takes the level the player chooses; only what is already in the field keeps what it earned
  // (`n.owned`).
  for (const pick of (NEW ? NEW.picks : [])) {
    leaves(pick, (n) => { if (pick.keep.has(n.key) && !n.owned && xpPriced(n)) todas.push({ pick, node: n }); });
  }
  if (!SEL.size) return { list: todas, scoped: false };
  // A formation caught by the lasso carries everything under it, open on the chart or not.
  const presas = new Set();
  for (const pick of NEW.picks) {
    const w = (n) => {
      if (SEL.has(selId(pick, n))) for (const l of leavesOf(n)) presas.add(selId(pick, l));
      n.children.forEach(w);
    };
    pick.tree.roots.forEach(w);
  }
  // O laco tambem pega bloco que ainda nao esta na forca. Ele nao entra na conta — modificar o
  // que nao foi tomado nao custa nem faz nada —, mas o painel precisa dizer que ele ficou de fora,
  // senao o jogador seleciona dois e ve o preco de um.
  let fora = 0;
  for (const pick of NEW.picks) {
    leaves(pick, (n) => { if (presas.has(selId(pick, n)) && !pick.keep.has(n.key) && !n.owned && xpPriced(n)) fora++; });
  }
  return { list: todas.filter(({ pick, node }) => presas.has(selId(pick, node))), scoped: true, fora };
}

// AS UNIDADES SUAS QUE ESTAO SELECIONADAS (28/09). `modTargets` deixa de fora o que ja esta em campo —
// a experiencia dele nao se muda —, e por isso a linha de tirar de campo, que lia a selecao por ele,
// nunca achava a unidade solta: so a formacao inteira funcionava. Esta le a selecao direto, com o
// laco pegando tudo o que esta sob uma formacao selecionada.
function selectedOwned() {
  if (!SEL.size || !NEW) return [];
  const out = [];
  for (const pick of NEW.picks) {
    if (!pick.owned) continue;
    const presas = new Set();
    const w = (n) => {
      if (SEL.has(selId(pick, n))) for (const l of leavesOf(n)) presas.add(l.key);
      n.children.forEach(w);
    };
    pick.tree.roots.forEach(w);
    leaves(pick, (n) => { if (presas.has(n.key) && n.owned && n.coreId !== null && n.coreId !== undefined) out.push({ pick, node: n }); });
  }
  return out;
}

function forceApi(pick) {
  return {
    levelOf: (n) => xpOf(pick, n),
    nameOf: (n) => nameOf(pick, n),
    panel: renderModifiers,
    has: (n) => SEL.has(selId(pick, n)),
    select: (nodes, additive) => selSet(pick, nodes, additive),
    // Um clique no bloco: sozinho ele troca a selecao, com ctrl/shift ele soma. Clicar num bloco
    // que ja estava sozinho na selecao limpa — e o jeito de desfazer sem procurar o botao.
    click: (n, additive) => {
      const id = selId(pick, n);
      if (additive) { if (SEL.has(id)) SEL.delete(id); else SEL.add(id); renderPicks(); return; }
      SEL = new Set(SEL.size === 1 && SEL.has(id) ? [] : [id]);
      renderPicks();
    },
    clear: selClear,
    // O avulso comprado tem caminho de volta, e a peca de tiro indireto tem os dois jeitos. Os dois
    // vivem no bloco porque e nele que o jogador esta olhando quando muda de ideia.
    attached: (n) => {
      if (n.extra) return true;
      const a = detachOf(pick, n);
      return !!(a.pick && !n.owned && a.pick.attached && a.pick.attached.has(a.key));
    },
    detach: (n) => { const a = detachOf(pick, n); dropAttached(a.pick, a.key); renderPicks(); reprice(); },
    deployment: (n) => deploymentOf(pick, n),
    setDeployment: (n) => setDeployment(pick, n),
  };
}

// The formation the player has singled out, if it is exactly one. `modTargets` only ever walks
// units, so the heading itself has to be looked up here.
function selectedFormation() {
  const found = [];
  for (const pick of NEW.picks) {
    const walk = (n) => {
      if (n.isFormation && SEL.has(selId(pick, n))) found.push({ pick, node: n });
      (n.children || []).forEach(walk);
    };
    pick.tree.roots.forEach(walk);
  }
  return found.length === 1 ? found[0] : null;
}

// A formation of nothing but off-map units — a battery, an air section, supply — takes no
// attachments: the game itself does not allow it, and there is nothing on the map to attach to.
const takesAttachments = (node) => {
  let onMap = 0;
  const walk = (n) => { if (n.isFormation) (n.children || []).forEach(walk); else if (!n.offMap) onMap += 1; };
  walk(node);
  return onMap > 0;
};

// The name of a node by key, for counting what is already attached.
function nodeName(pick, key) {
  let out = null;
  const walk = (n) => { if (n.key === key) out = n.name; (n.children || []).forEach(walk); };
  pick.tree.roots.forEach(walk);
  return out;
}

function attachRow(alvos) {
  const alvo = selectedFormation();
  if (!alvo) return el('span');
  const row = el('div', { class: 'mods-row attach' });
  // A SPECIAL FORCES NAO LEVA ANEXO (regra de 10/10, campaign.priceOfPicks; autor 24/10: "desative a opcao"). A tela deixava
  // anexar e mandava a escolha sem o veiculo: desenhado, nunca cobrado nem criado.
  if (alvo.pick.formation.sf) {
    row.append(el('span', {}, 'Attach'), el('span', { class: 'hint' }, `${alvo.pick.formation.name} is special forces — it takes no attached vehicle.`));
    return row;
  }
  if (!takesAttachments(alvo.node)) {
    row.append(el('span', {}, 'Attach'), el('span', { class: 'hint' }, `${alvo.node.name} is a support formation — the game does not let anything be attached to it.`));
    return row;
  }
  // The list is built here, not when the dropdown opens: the browser opens it at once and an async
  // fill lands too late, which is why clicking it looked dead.
  // only vehicles of the formation's own army (25/11): the game leaves a US vehicle in a Ukrainian company out of the battle
  const nacao = alvo.pick.formation.nation;
  const todos = vehicleMenu();
  const vs = todos ? todos.filter((v) => !nacao || (v.copies || []).some((c) => c.nation === nacao)) : null;
  if (vs && !vs.length) {
    row.append(el('span', {}, 'Attach'), el('span', { class: 'hint' }, `No single vehicle of the ${nacao} army is sold — a vehicle of another army would be left out of the battle.`));
    return row;
  }
  const sel = el('select', { class: 'mods-sel' },
    el('option', { value: '' }, vs ? `Attach a ${nacao ? nacao + ' ' : ''}vehicle to ${alvo.node.name}…` : 'reading the library…'));
  if (!vs) sel.disabled = true;
  let papel = null;
  for (const v of vs || []) {
    if (v.role !== papel) { papel = v.role; sel.append(el('option', { value: '', disabled: 'disabled' }, `— ${papel} —`)); }
    // How many of this machine the force already carries, so a second one is a decision and not a
    // surprise.
    const jaTem = NEW.picks.reduce((a, p) => a + [...p.keep].filter((k) => (p.attachedTo || {})[k] && p.attached?.has(k) && nodeName(p, k) === v.name).length
      + (p.extras || []).filter((e) => e.tipo === v.name).length, 0);
    // numa formacao que ja e da campanha o anexo e uma copia da biblioteca, cobrada pelo preco dela (o Stryker de pelotao,
    // com Javelin: 540 cr Regular, nao os 108 do avulso); o menu diz esse (24/10)
    sel.append(el('option', { value: JSON.stringify(v) }, `${v.name} · ${v.price} cr${jaTem ? ` · ${jaTem} attached` : ''}`));
  }
  sel.addEventListener('change', () => {
    if (!sel.value) return;
    const v = JSON.parse(sel.value);
    sel.value = '';
    attachVehicle(v, alvo);
  });
  row.append(el('span', {}, 'Attach'), sel);
  void alvos;
  return row;
}

// TIRAR A FORMACAO DE CAMPO. Nao vende nada e nao desfaz nada do que ela aprendeu — decide se ela
// vai a proxima batalha. O batalhao que perdeu os veiculos e so atrapalha sai por aqui, e volta
// pelo mesmo botao quando houver credito para reequipa-lo.
// Funciona no que estiver selecionado: uma formacao inteira, ou as unidades que o laco pegou. A
// segunda forma e a que o autor pediu — o esquadrao que sobrou com um homem, que nao vale os
// creditos da reposicao e que ninguem quer ter de conduzir a mao durante a partida.
function standDownRow() {
  const daSelecao = selectedOwned().map(({ node }) => node);
  const alvo = selectedFormation();
  let nomeDoAlvo = null;
  let unidades = daSelecao;
  if (!unidades.length && alvo && alvo.pick.owned) {
    nomeDoAlvo = alvo.node.name;
    const walk = (n) => {
      if (n.isFormation) { (n.children || []).forEach(walk); return; }
      if (n.coreId !== null && n.coreId !== undefined) unidades.push(n);
    };
    walk(alvo.node);
  }
  if (!unidades.length) return el('span');

  const fora = new Set(CAMPAIGN?.standDown || []);
  const dentro = unidades.filter((n) => !fora.has(n.coreId));
  const jaFora = unidades.filter((n) => fora.has(n.coreId));
  const saindo = !dentro.length;                       // tudo isso ja esta fora: o botao volta
  const ids = (saindo ? jaFora : dentro).map((n) => n.coreId);
  if (!ids.length) return el('span');

  const quem = nomeDoAlvo ? `${nomeDoAlvo} — ${ids.length} units` : `${ids.length} unit${ids.length > 1 ? 's' : ''}`;
  const row = el('div', { class: 'mods-row attach' });
  row.append(el('span', {}, saindo ? 'Bring back' : 'Stand down'), el('button', {
    class: 'linky',
    onclick: async () => {
      try {
        const st = await api('POST', `/api/campaigns/${encodeURIComponent(CAMPAIGN.slug)}/standdown`, { coreIds: ids, out: !saindo });
        await loadStatus();
        renderCampaign(st);
      } catch (e) { if (!e.handled) alert(e.message); }
    },
  }, saindo ? `Field ${quem} again` : `Take ${quem} out of the force — nothing is sold`));
  if (!saindo && jaFora.length) row.append(el('span', { class: 'hint' }, `${jaFora.length} of them already out`));
  return row;
}

// VENDER (28/09). Regra do autor: "Se a unidade/formacao ja lutou uma batalha, sem reembolso." E
// rascunho, como toda compra do quartel-mestre: marca aqui, o rodape mostra o credito, e so o Apply
// grava. Mesmos alvos da linha de cima — as unidades selecionadas, ou a formacao escolhida inteira —
// menos o destroco, que nao se vende (tem a reposicao), e o que ja foi vendido.
let SELLING = new Map();                // coreId -> credito que volta (0 = venda parcial)
// SO A FORMACAO INTEIRA E PAGA (autor, 16/10/2026; a mesma regra do servidor, campaign.mjs sellPlan): o credito volta
// quando a venda leva TODAS as unidades do jogador de uma compra (o pick, primeiro numero da chave) — em campo ou tiradas
// de campo, nao vendidas, nao destruidas —, e entao volta o preco de todas, lutando ou nao. Venda parcial: nada.
const pickDaUnidade = (u) => Number(String(u.key).split('.')[0]);
function reembolsosDe(ids) {
  const C = CAMPAIGN || {};
  const vendidas = new Set((C.sold || []).map((x) => x.coreId)), fora = new Set(C.standDown || []), perdidas = new Set(C.lost || []);
  const porPick = new Map();
  for (const u of C.units || []) {
    if (vendidas.has(u.coreId) || perdidas.has(u.coreId) || !(u.present || fora.has(u.coreId))) continue;
    const i = pickDaUnidade(u); if (!porPick.has(i)) porPick.set(i, []); porPick.get(i).push(u);
  }
  const out = new Map();
  for (const id of ids) {
    const u = (C.units || []).find((x) => x.coreId === id);
    const deles = u ? porPick.get(pickDaUnidade(u)) || [] : [];
    // o que foi pago (29/10, a mesma regra de `sellPlan`/`pagoDe` no servidor), nao o preco de hoje
    out.set(id, u && deles.length && deles.every((x) => ids.has(x.coreId)) ? Math.round(Number.isFinite(u.paid) ? u.paid : (u.price || 0)) : 0);
  }
  return out;
}
function recalcularVenda() { const r = reembolsosDe(new Set(SELLING.keys())); for (const id of SELLING.keys()) SELLING.set(id, r.get(id) || 0); }
function sellRow() {
  const perdidas = new Set(CAMPAIGN?.lost || []);
  const vendidas = new Set((CAMPAIGN?.sold || []).map((x) => x.coreId));
  const vendavel = (n) => n.owned && n.coreId !== null && n.coreId !== undefined && !perdidas.has(n.coreId) && !vendidas.has(n.coreId);
  let unidades = selectedOwned().map(({ node }) => node).filter(vendavel);
  const alvo = selectedFormation();
  let nomeDoAlvo = null;
  if (!unidades.length && alvo && alvo.pick.owned) {
    nomeDoAlvo = alvo.node.name;
    const walk = (n) => { if (n.isFormation) { (n.children || []).forEach(walk); return; } if (vendavel(n)) unidades.push(n); };
    walk(alvo.node);
  }
  if (!unidades.length || !NEW.onSell) return el('span');
  const ids = unidades.map((n) => n.coreId);
  const desfazendo = ids.every((id) => SELLING.has(id));
  const comEsta = reembolsosDe(new Set([...SELLING.keys(), ...ids]));
  const credito = ids.reduce((a, id) => a + (comEsta.get(id) || 0), 0);
  const quem = nomeDoAlvo ? `${nomeDoAlvo} — ${ids.length} units` : `${ids.length} unit${ids.length > 1 ? 's' : ''}`;
  const row = el('div', { class: 'mods-row attach' });
  row.append(el('span', {}, desfazendo ? 'For sale' : 'Sell'), el('button', {
    class: 'linky',
    onclick: () => NEW.onSell(ids, !desfazendo),
  }, desfazendo ? `Keep ${quem} — cancel the sale` : `Sell ${quem} — ${credito ? credito + ' cr back' : 'no refund'}`));
  if (!desfazendo) {
    row.append(el('span', { class: 'hint' }, credito
      ? 'The whole formation: every unit is paid back, whether it fought or not.'
      : `Only a whole formation is paid back: ${ids.length > 1 ? 'these go' : 'it goes'} for nothing.`));
  }
  return row;
}

// DEVOLVER VARIAS DE UMA VEZ. O botao no bloco resolve uma; quem laçou meia duzia de caminhoes nao
// quer clicar seis vezes. So conta o que foi comprado avulso — o resto da selecao se tira pelo
// proprio bloco, que e onde "tomar" mora.
function detachRow(alvos) {
  const avulsas = (alvos || []).filter(({ pick, node }) => pick.attached && pick.attached.has(node.key) && !node.owned);
  if (!avulsas.length) return el('span');
  const custo = avulsas.reduce((a, { pick, node }) => a + unitPrice(pick, node), 0);
  const row = el('div', { class: 'mods-row attach' });
  row.append(el('span', {}, 'Bought singly'), el('button', {
    class: 'linky',
    onclick: () => {
      for (const { pick, node } of avulsas) dropAttached(pick, node.key);
      renderPicks();
      reprice();
    },
  }, `Give ${avulsas.length === 1 ? 'it' : `all ${avulsas.length}`} back — ${Math.round(custo)} cr returns`));
  return row;
}

// THE MODIFIERS PANEL. One control for the whole force instead of a dropdown on every block: with
// 153 units in a battalion the second reads as noise. Units that disagree show "Mixed" until
// something is chosen, which is then written to all of them.
function renderModifiers({ footer = false } = {}) {
  const { list: alvos, scoped, fora } = modTargets();
  // a experiencia se escolhe na COMPRA (18/10, autor): a unidade em campo nao entra aqui (modTargets), e o treino esta desligado
  const levels = NEW.picks.length ? xpLevels(NEW.picks[0]) : [];
  const box = el('div', { class: 'mods' + (footer ? ' foot' : '') });
  box.append(el('div', { class: 'mods-head' }, el('strong', {}, 'Modifiers'),
    el('span', { class: 'hint' + (scoped ? ' on' : '') },
      scoped
        ? (fora ? `${alvos.length} of ${alvos.length + fora} picked` : `${alvos.length} picked`)
        : alvos.length ? `your whole force · ${alvos.length} units` : 'nothing taken yet')));

  // The attach control belongs to the FORMATION, not to the units under it, so it is offered even
  // when the selection is a single heading and there is nothing to modify.
  const attach = attachRow(alvos);
  const standDown = standDownRow();
  const sell = sellRow();
  const detach = detachRow(alvos);
  // AS LINHAS DE EQUIPAMENTO NAO ESPERAM A UNIDADE SER TOMADA (autor, 29/10: "nao vejo a opcao de mudar o tipo de tanque e
  // BTR da formacao"). Elas agem sobre a FORMACAO (equipmentTargets) e a troca vale para o que for tomado depois — o
  // servidor aplica o swap na arvore inteira antes de podar pelo keep. Desde que a formacao chega vazia (29/10), `alvos`
  // (so o tomado) e vazio ao adicionar, e o retorno abaixo escondia as linhas ate o primeiro take.
  const equip = equipmentRows();
  if (!alvos.length) {
    for (const row of equip) box.append(row);
    box.append(attach);
    box.append(standDown);
    box.append(sell);
    const alvo = equip.length ? selectedFormation() : null;
    box.append(el('p', { class: 'hint' }, !scoped
      ? (equip.length
        ? 'Nothing taken yet. The equipment rows change what the units of the formation will be when you take them; experience and the price appear here once something is taken.'
        : 'Take units into the force and this changes what they are. Click a block or drag a lasso to work on part of it.')
      : fora
        ? (alvo
          ? `Nothing under ${alvo.node.name} is taken yet. The equipment rows change what its units will be when you take them; experience and the price appear once something is taken.`
          : `The ${fora === 1 ? 'block' : fora + ' blocks'} you picked ${fora === 1 ? 'is' : 'are'} not in your force yet. Take ${fora === 1 ? 'it' : 'them'} first — a unit you have not taken costs nothing and changes nothing.`)
        : 'Nothing you picked can be changed: what is already in the field keeps what it earned.'));
    if (scoped) box.append(el('div', { class: 'mods-foot' }, el('button', { class: 'linky', onclick: selClear }, 'Clear selection')));
    return box;
  }

  const niveis = [...new Set(alvos.map(({ pick, node }) => (pick.xp || {})[node.key] || node.experience))];
  const atual = niveis.length === 1 ? niveis[0] : null;
  const custo = alvos.reduce((a, { pick, node }) => a + unitPrice(pick, node), 0);
  const delta = alvos.reduce((a, { pick, node }) => a + unitPrice(pick, node) - (node.price || 0), 0);

  const sel = el('select', { class: 'mods-sel', onchange: (e) => applyXp(e.target.value) },
    // "Mixed" is a reading, not a choice: picking it again would quietly undo the overrides.
    atual === null ? el('option', { value: '', selected: 'selected', disabled: 'disabled' }, 'Mixed') : null,
    levels.map((L) => el('option', { value: L, ...(L === atual ? { selected: 'selected' } : {}) }, L)));

  box.append(el('label', { class: 'mods-row' }, el('span', {}, 'Experience'), sel));
  for (const row of equip) box.append(row);
  box.append(attach);
  box.append(standDown);
  box.append(sell);
  box.append(detach);
  box.append(el('div', { class: 'mods-row' }, el('span', {}, 'What it costs'),
    el('b', { class: 'mods-delta' }, `${Math.round(custo)} cr`)));
  if (delta) {
    box.append(el('div', { class: 'mods-row' }, el('span', {}, 'The change'),
      el('b', { class: 'mods-delta' + (delta > 0 ? ' up' : ' down') }, `${delta > 0 ? '+' : ''}${Math.round(delta)} cr`)));
  }
  if (fora) {
    box.append(el('p', { class: 'hint' }, `${fora} of the blocks you picked ${fora === 1 ? 'is' : 'are'} not in your force yet, so ${fora === 1 ? 'it is' : 'they are'} not in the price. Take ${fora === 1 ? 'it' : 'them'} and this will cover ${fora === 1 ? 'it' : 'them'} too.`));
  }
  if (scoped) box.append(el('p', { class: 'hint' }, 'Applies to what you picked. Clear it to work on the whole force again.'));
  if (scoped) box.append(el('div', { class: 'mods-foot' }, el('button', { class: 'linky', onclick: selClear }, 'Clear selection')));
  return box;
}

// Writing the choice to whatever the panel is pointed at, in one pass and one redraw.
function applyXp(level) {
  for (const { pick, node } of modTargets().list) {
    if (pick.fixed) continue;                      // special forces: always the rule's experience (10/10)
    if (!level || level === node.experience) delete pick.xp[node.key]; else pick.xp[node.key] = level;
  }
  renderPicks();
}

// THE EQUIPMENT ROWS — what the editor's bottom blocks do. They act on the formation the player has
// singled out, or on every formation he is buying when nothing is selected; one select per group
// under the target, and a choice applies to every unit of that group under it, as the editor's
// click on a block changes all 31 tanks of a battalion. A formation already in the field has no
// rows: its machines have crews and core ids, and the game would not take the change.
function equipmentTargets() {
  const sel = selectedFormation();
  if (sel) return sel.pick.owned || sel.node.owned ? [] : [sel];
  if (SEL.size) return [];
  return (NEW ? NEW.picks : []).filter((p) => !p.owned).flatMap((pick) => pick.tree.roots.map((node) => ({ pick, node })));
}
// THE GUN OF A BATTERY is another library file (FORMATO 124), so its row swaps the pick's SOURCE and
// keeps what the player chose under it — the twin has the same shape, and the keys are the same.
let GUNS = null;
let gunsComing = false;
function gunMenu() {
  if (GUNS || gunsComing) return GUNS;
  gunsComing = true;
  api('GET', `/api/catalog/guns?armies=${(NEW.armies || ['US', 'UKR']).join(',')}`)
    .then((r) => { GUNS = r.guns || {}; renderPicks(); })
    .catch(() => { GUNS = {}; })
    .finally(() => { gunsComing = false; });
  return null;
}
function gunTwinOf(pick) {
  const g = gunMenu();
  if (!g) return null;
  return Object.values(g).find((x) => x.nation === pick.formation.nation && x.options.some((o) => o.file === pick.formation.file)) || null;
}
async function setGun(pick, file) {
  const twin = gunTwinOf(pick);
  const opt = twin && twin.options.find((o) => o.file === file);
  if (!opt || opt.file === pick.formation.file) return;
  const tree = await api('GET', `/api/catalog/tree?source=${encodeURIComponent(opt.file)}&nation=${opt.nation}`);
  const keys = new Set(); const w = (n) => { keys.add(n.key); n.children.forEach(w); }; tree.roots.forEach(w);
  pick.formation = { ...pick.formation, file: opt.file, source: opt.source, name: opt.name, points: opt.points, price: opt.price, units: opt.units, offMapUnits: opt.offMapUnits };
  pick.tree = tree;
  pick.keep = new Set([...pick.keep].filter((k) => keys.has(k)));
  pick.open = new Set([...pick.open].filter((k) => keys.has(k)));
  pick.xp = Object.fromEntries(Object.entries(pick.xp || {}).filter(([k]) => keys.has(k)));
  pick.swaps = [];
  renderPicks();
}
function equipmentRows() {
  const rows = [];
  const alvos = equipmentTargets();
  for (const { pick, node } of alvos) {
    // special forces take no equipment swap (the server refuses one): the rail leaves them out (11/10)
    if (pick.fixed || (pick.formation && pick.formation.sf)) continue;
    // The tube, when the pick is a battery the library has in more than one calibre.
    const twin = !node.key.includes('.') ? gunTwinOf(pick) : null;
    if (twin && twin.options.length > 1) {
      const sel = el('select', { class: 'mods-sel', onchange: (e) => setGun(pick, e.target.value) },
        twin.options.map((o) => el('option', { value: o.file, ...(o.file === pick.formation.file ? { selected: 'selected' } : {}) }, `${o.gun} · ${o.price} cr`)));
      rows.push(el('label', { class: 'mods-row', title: 'The editor sells this battery with several guns, each as its own entry; picking one swaps the whole battery for that entry and keeps your choices under it.' },
        el('span', {}, `Gun${alvos.length > 1 ? ` · ${node.name}` : ''}`), sel));
    }
    const groups = (pick.tree.equipment || {}).groups || {};
    const folhas = leavesOf(node).filter((n) => n.group != null && !n.ghost && !n.owned);
    for (const g of [...new Set(folhas.map((n) => n.group))]) {
      const G = groups[g];
      if (!G || G.options.filter((o) => o.roster && o.named !== false).length < 2) continue;   // one way only: nothing to choose
      const mine = folhas.filter((n) => n.group === g);
      // What they are now: the swap in force, or what the library rolled. Several answers = Mixed.
      const atuais = new Map();
      for (const n of mine) { const k = leafKey(pick, n); atuais.set(k, (atuais.get(k) || 0) + 1); }
      const atual = atuais.size === 1 ? [...atuais.keys()][0] : null;
      // `label` is the name plus what the editor's blocks call it when the catalogue repeats a name
      // (four US `Squad (Rifle)`); `name` is the one the bill is made of. E96.
      const nomeDe = (k) => { const o = G.options.find((q) => optKey(pick, g, q) === k); return o ? o.label || o.name : k; };
      const sel = el('select', { class: 'mods-sel', onchange: (e) => applySwap(pick, node, g, e.target.value) },
        atual === null ? el('option', { value: '', selected: 'selected', disabled: 'disabled' }, `Mixed (${[...atuais].map(([k, c]) => `${nomeDe(k)} ×${c}`).join(', ')})`) : null,
        G.options.map((o) => el('option', {
          value: optKey(pick, g, o),
          ...(optKey(pick, g, o) === atual ? { selected: 'selected' } : {}),
          // A type with no roster template would crash the game on load, so it is shown and shut.
          ...(o.roster && o.named !== false ? {} : { disabled: 'disabled' }),
        }, `${o.label || o.name} · ${o.base} cr${o.named === false ? ' · name unknown' : ''}${o.roster ? '' : ' · no roster template'}${o.machine && o.refit === false ? ' · no refit table' : ''}${o.priced ? '' : ' · role price'}`)));
      rows.push(el('label', { class: 'mods-row', title: `Equipment of the ${mine.length} ${G.label} unit${mine.length > 1 ? 's' : ''} under ${node.name}. Changes all of them, as the editor's block does.` },
        el('span', {}, `${G.label}${alvos.length > 1 ? ` · ${node.name}` : ''} ×${mine.length}`), sel));
    }
  }
  return rows;
}
// Writing the choice: one swap per (formation, group) on the pick, replacing whatever was chosen
// under that formation for the same group; a choice equal to what the library rolled for every unit
// of the group is no swap at all. The bill and the chart follow through `unitPrice` and `nameOf`;
// the server prices the real thing when it bills.
function applySwap(pick, node, group, value) {
  if (pick.fixed || (pick.formation && pick.formation.sf)) return;
  pick.swaps = (pick.swaps || []).filter((s) => !(s.group === group && (s.key === node.key || s.key.startsWith(node.key + '.'))));
  if (value) {
    // the value is the option KEY: `val,tab` or `val,tab@603/657` when the path is what tells apart
    const [tipo, caminho] = value.split('@');
    const to = tipo.split(',').map(Number);
    const path = caminho ? caminho.split('/').map(Number) : (optionOf(pick, group, to) || {}).path || null;
    const folhas = leavesOf(node).filter((n) => n.group === group && !n.ghost);
    if (!folhas.every((n) => { const o = optionOf(pick, group, n.type, n.path); return (o ? optKey(pick, group, o) : keyOf(n.type, n.path)) === value; })) pick.swaps.push({ key: node.key, group, to, ...(path ? { path } : {}) });
  }
  renderPicks();
}

// Headings that are in the force only because something under them was taken. The server does the
// same closing-upward when it prices and when it builds (catalog.prunePlan); this is only so the
// screen says the same thing the bill does.
function impliedKeys(pick) {
  const out = new Set();
  const walk = (node) => {
    if (node.ghost) return false;
    let below = false;
    for (const c of node.children) below = walk(c) || below;
    if (below && !pick.keep.has(node.key)) out.add(node.key);
    return below || pick.keep.has(node.key);
  };
  pick.tree.roots.forEach(walk);
  return out;
}

// UMA ESCOLHA VAZIA (29/10): formacao nova sem nenhuma unidade tomada nem maquina anexada. Nao se envia: trava o Raise
// (reprice) e o Apply entre batalhas (drawTail). A SF chega inteira e nunca e vazia.
function escolhaVazia(p) {
  if (p.owned || p.formation.sf || extrasPayload(p).length) return false;
  const tem = (n) => (!n.isFormation && p.keep.has(n.key)) || (n.children || []).some(tem);
  return !p.tree.roots.some(tem);
}
const nomeDaEscolha = (p) => p.formation.name + (p.copy ? ` (copy ${p.copy})` : '');
const avisoVazias = (vs) => `${vs.join(', ')} ${vs.length > 1 ? 'have' : 'has'} nothing selected — take units from ${vs.length > 1 ? 'them' : 'it'} or remove ${vs.length > 1 ? 'them' : 'it'}.`;

async function addPick(formation, { keepOnly = null, copia = false } = {}) {
  const found = NEW.picks.find((p) => samePick(p, formation));
  if (found && !copia) return found;
  const n = copiesOf(formation).length;
  if (found && n >= availabilityOf(formation)) return found;
  if (formation.sf) return addSpecialForces(formation);
  const tree = await api('GET', `/api/catalog/tree?source=${encodeURIComponent(formation.file)}&nation=${formation.nation}`);
  // A FORMACAO CHEGA VAZIA (autor, 29/10): nada marcado, o jogador toma o que quer (antes vinham a raiz e o HQ dela).
  // So a Special Forces chega inteira (addSpecialForces). Uma escolha vazia trava o Apply (reprice).
  // A pick made to carry ONE machine starts with only that machine — pruning closes upward on its
  // own, so the headings above it come along without fielding anything.
  const keep = keepOnly ? new Set([keepOnly]) : new Set();
  const pick = { formation, tree, keep, open: new Set(tree.roots.map((r) => r.key)), xp: {}, swaps: [], attached: new Set() };
  if (n > 0) { let k = n + 1; while (NEW.picks.some((p) => pickId(p) === `${formation.file}#${k}`)) k++; pick.uid = `${formation.file}#${k}`; pick.copy = k; }
  NEW.picks.push(pick);
  renderPicks();
  // O PRECO DOS STRYKERS (autor, 18/10): o Stryker que vem com a formacao leva Javelin e custa mais; o avulso nao leva.
  // Uma vez por montagem de forca, ao comprar uma formacao de Stryker inteira (nao a copia de uma maquina so).
  if (!keepOnly && /Stryker/i.test(`${formation.name || ''} ${formation.file || ''}`) && !NEW.strykerNotice) {
    NEW.strykerNotice = true;
    notice('Why Strykers cost more here', [
      'A Stryker that comes with its formation carries Javelin launchers and missiles for the infantry, and it is priced for them.',
      'For cheaper transport, leave the formation\'s Strykers out and attach Strykers as single vehicles instead: they carry AT4s only, no Javelin.',
    ]);
  }
  return pick;
}

// UM AVISO NA TELA (18/10): caixa modal com titulo, paragrafos e um OK.
function notice(title, paragraphs) {
  const d = el('dialog', { class: 'notice' },
    el('h3', {}, title),
    // um item que e lista vira tópicos (19/10)
    ...paragraphs.map((t) => (Array.isArray(t) ? el('ul', {}, t.map((x) => el('li', {}, x))) : el('p', {}, t))),
    el('div', { class: 'notice-actions' }, el('button', { class: 'primary', onclick: () => { d.close(); d.remove(); } }, 'OK')));
  document.body.append(d);
  d.showModal();
}

// ATTACHING A SINGLE VEHICLE.
//
// In the game a machine bought on its own forms its own little group, and here it is the same: the
// force is composed from library sources, and a source pruned to one leaf is a legal force of one
// machine. What it is NOT is grafted into the formation's own branch — the app can reproduce every
// field the editor writes when it does that and the game still refuses to load the result (FORMATO
// section 56: one attachment loads, two crash). So the vehicle joins as its own group, marked in
// blue and labelled with the formation it was bought for, and that label is the app's, not the
// file's.
// The menu is fetched ONCE and kept, and the panel is redrawn when it lands — filling a dropdown
// after the browser has already opened it shows the player an empty list, which is what happened.
let VEHICLES = null;
let vehiclesComing = false;
function vehicleMenu() {
  if (VEHICLES || vehiclesComing) return VEHICLES;
  vehiclesComing = true;
  api('GET', `/api/catalog/vehicles?armies=${(NEW.armies || ['US', 'UKR']).join(',')}`)
    .then((r) => { VEHICLES = r.vehicles || []; renderPicks(); })
    .catch(() => { VEHICLES = []; })
    .finally(() => { vehiclesComing = false; });
  return null;
}

// BUYING THE SECOND ONE OF THE SAME MACHINE.
//
// A vehicle is one LEAF of one library source, so two Urals are two different leaves — the library
// has 88 of them across 22 battalions and the menu carries the ten cheapest. Each attach walks the
// copies and takes the first one nobody has taken yet, so the second Ural is a real second truck
// and not a click that does nothing, which is what the author hit.
// A primeira copia que ninguem tomou ainda. Separada de `attachVehicle` porque a troca on/off faz a
// mesma pergunta antes de desfazer nada: se nao houver copia livre do outro jeito, a unidade tem de
// ficar onde esta em vez de sumir.
// What the server needs of an extra: the unit's name, the formation it goes into, its type pair.
const extrasPayload = (p) => (p.extras || []).map((e) => ({ tipo: e.tipo, key: e.key, type: e.type }));

function copiaLivre(copies) {
  for (const c of copies || []) {
    const p = NEW.picks.find((x) => x.formation.file === c.source);
    if (p && p.keep.has(c.key)) continue;         // esta copia ja foi comprada
    return c;
  }
  return null;
}

// ONDE UMA COPIA IRIA PARAR, se fosse ela a anexada a `alvo`. "A primeira copia livre" nao basta
// para um anexo: o autor selecionou o Platoon (Armored) da 1a companhia, pediu um Abrams, e a copia
// livre mais barata da biblioteca era um tanque dormente do PROPRIO batalhao dele — na 2a companhia.
// A tela marcou a folha onde ela de fato mora (outro pelotao, outra cadeia de comando), pintou de
// azul e escreveu "attached to Platoon (Armored)", que tambem e o nome do pelotao errado. O Abrams
// so existe em duas fontes da biblioteca e uma delas e a dele, entao isso acontecia sempre.
//
//   'aqui'   folha dormente DEBAIXO da formacao escolhida, na escolha dela: marcar e a verdade.
//   'grupo'  fonte que ainda nao esta na forca (vira um grupinho proprio, desenhado sob o alvo), ou
//            um carregador que ja esta pendurado NESTE grafico.
//   'fora'   folha de uma escolha que tem grafico proprio, noutro lugar: da para comprar, mas ela
//            luta la e nao aqui — so com o jogador sabendo disso, e sem fingir que e anexo.
//   null     ja tomada, ou carregador pendurado no grafico de outra formacao (nao tem onde aparecer).
//
// Funcao pura de proposito (recebe as escolhas, nao le `NEW`): o teste 46 a roda fora do navegador.
function lugarDaCopia(c, picks, alvo) {
  const p = picks.find((x) => x.formation.file === c.source);
  if (!p) return 'grupo';
  if (p.keep.has(c.key)) return null;
  if (p === alvo.pick) return String(c.key).startsWith(alvo.node.key + '.') ? 'aqui' : 'fora';
  if (p.attachedHost) return p.attachedHost.file === alvo.pick.formation.file ? 'grupo' : null;
  return 'fora';
}

// A copia para anexar: a mais barata entre as que ficam COM o alvo ('aqui' ganha o empate, porque
// e a unica que entra de verdade na formacao); so quando nao ha nenhuma e que vale uma de 'fora'.
function escolherCopia(copies, picks, alvo) {
  const vistas = (copies || []).map((c) => ({ c, lugar: lugarDaCopia(c, picks, alvo) })).filter((x) => x.lugar);
  const peso = { aqui: 0, grupo: 1 };
  const junto = vistas.filter((x) => x.lugar !== 'fora').sort((a, b) => a.c.price - b.c.price || peso[a.lugar] - peso[b.lugar]);
  if (junto.length) return junto[0];
  const fora = vistas.filter((x) => x.lugar === 'fora').sort((a, b) => a.c.price - b.c.price);
  return fora[0] || null;
}

// `copia` ja escolhida e o caminho da troca on/off (`setDeployment`), que faz a propria pergunta
// antes de desfazer qualquer coisa e nao pode ouvir um "nao" depois.
async function attachVehicle(v, alvo, { copia: dada = null } = {}) {
  if (alvo.pick.formation.sf) return null;   // a Special Forces nao leva anexo (attachRow)
  // A FORMATION BEING BOUGHT takes the machine INSIDE it (E51): the pick carries an extra, and the
  // forge synthesizes the vehicle into that formation when the force is minted — it is then a real
  // child of that platoon, with its own core id and roster line, and the quartermaster shows it
  // where it is. Drawn here as a ghost under the formation, in blue, with a drop button.
  //
  // A FORMATION ALREADY IN THE CAMPAIGN takes it inside too (30/10, autor: "comprei o caminhao dentro do pelotao de
  // grenade launcher, mas ele aparece dentro do pelotao de engenharia"). It used to take the cheapest free copy in the
  // library, whose whole source was grafted at the end of the force — the machine fought wherever that copy lived. Now
  // the extra goes to the server as `attachOwned` and is inserted as the last child of that formation (id max + 1, the
  // editor's rule: no core id moves). The library-copy path below stays for `setDeployment`, which hands it a copy.
  if (!alvo.pick.owned || !dada) {
    alvo.pick.extras = alvo.pick.extras || [];
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    alvo.pick.extras.push({ id, tipo: v.name, key: alvo.node.key, type: v.type, price: v.price, role: v.role });
    alvo.pick.open.add(alvo.node.key);
    renderPicks();
    reprice();
    return { pick: alvo.pick, key: `extra:${id}` };
  }
  const escolha = dada ? { c: dada, lugar: null } : escolherCopia(v.copies, NEW.picks, alvo);
  if (!escolha) { alert(`The library has no more ${v.name} to give — every copy of it is already in your force.`); return null; }
  const copia = escolha.c;
  const dono = NEW.picks.find((x) => x.formation.file === copia.source);
  // FORA: a unica copia que sobrou e uma unidade dormente de uma formacao que ja tem grafico
  // proprio. Compra-la e legitimo — e ativar o que ja e dele —, mas ela entra na batalha no lugar
  // DELA. Entao a tela pergunta antes, marca a folha como uma tomada comum (com o botao de sempre
  // para desfazer) e nao escreve "attached to" em cima de uma coisa que nao e anexo.
  if (escolha.lugar === 'fora') {
    const onde = `${dono.formation.name}${copia.under ? `, under ${copia.under}` : ''}`;
    if (!confirm(`There is no free ${v.name} left that can be grouped with ${alvo.node.name}.\n\nThe cheapest one left is a dormant unit of ${onde}. It would join the battle THERE, in its own place in that formation — not alongside ${alvo.node.name}.\n\nTake it anyway, for ${copia.price} cr?`)) return null;
    dono.keep.add(copia.key);
    const ramos = copia.key.split('.');
    for (let i = 1; i < ramos.length; i++) dono.open.add(ramos.slice(0, i).join('.'));
    renderPicks();
    reprice();
    return { pick: dono, key: copia.key };
  }
  const pick = dono
    || await addPick({ file: copia.source, nation: copia.nation, name: copia.source.replace(/\.btt$/, '') }, { keepOnly: copia.key });
  pick.attached = pick.attached || new Set();
  pick.attached.add(copia.key);
  pick.keep.add(copia.key);
  pick.attachedTo = pick.attachedTo || {};
  pick.attachedTo[copia.key] = alvo.node.name;
  // Where the chart is to draw it: the formation it was bought for, in the pick that owns that
  // formation. The file knows nothing of this — it is the app keeping the promise the player made.
  //
  // Unless the machine comes from the host's OWN source, and then there is no promise to keep: it
  // belongs to that battalion already, so ticking it is enough and it shows up where it really is
  // — which `lugarDaCopia` only allows when "where it really is" is UNDER the chosen formation.
  // (Marking it as its own host would also hide the host's chart, since a pick drawn inside
  // another is not drawn on its own.)
  //
  // O hospedeiro e POR MAQUINA (`attachedAt`): o mesmo carregador pode levar um tanque para um
  // pelotao e outro para o pelotao vizinho. `attachedHost` continua dizendo em que GRAFICO o
  // carregador e desenhado, e so e escrito uma vez — antes cada anexo novo o sobrescrevia e
  // arrastava os fantasmas anteriores para debaixo da ultima formacao escolhida.
  if (pick !== alvo.pick) {
    if (!pick.attachedHost) pick.attachedHost = { file: alvo.pick.formation.file, key: alvo.node.key };
    pick.attachedAt = pick.attachedAt || {};
    pick.attachedAt[copia.key] = { file: alvo.pick.formation.file, key: alvo.node.key };
    alvo.pick.open.add(alvo.node.key);
  }
  // Open the branch down to it, or the block is bought and invisible.
  const parts = copia.key.split('.');
  for (let i = 1; i < parts.length; i++) pick.open.add(parts.slice(0, i).join('.'));
  renderPicks();
  reprice();
  return { pick, key: copia.key };
}

// LARGAR O QUE FOI COMPRADO AVULSO.
//
// Comprar era um caminho so de ida: o bloco vinha, ficava azul e nao havia botao nenhum nele. autor
// pediu o caminho de volta. Devolver a maquina e tirar as tres marcas que a compra deixou — a
// tomada, a marca de anexo e o rotulo de para quem ela foi comprada — e, se a escolha existia SO
// para carrega-la, ela vai junto: um batalhao inteiro na tela por causa de um caminhao que ja nao
// esta la seria pior do que nao ter o botao.
function keptLeaves(pick) {
  let n = 0;
  leaves(pick, (x) => { if (pick.keep.has(x.key)) n += 1; });
  return n;
}
function dropAttached(pick, key) {
  if (!pick) return;
  // An extra never entered the pick's tree: dropping it is taking it off the list.
  if (String(key).startsWith('extra:')) {
    pick.extras = (pick.extras || []).filter((e) => `extra:${e.id}` !== key);
    SEL.delete(`${pickId(pick)}${SEP}${key}`);
    return;
  }
  if (pick.attached) pick.attached.delete(key);
  pick.keep.delete(key);
  if (pick.attachedTo) delete pick.attachedTo[key];
  if (pick.attachedAt) delete pick.attachedAt[key];
  if (pick.xp) delete pick.xp[key];
  if (pick.swapFrom) delete pick.swapFrom[key];
  SEL.delete(`${pickId(pick)}${SEP}${key}`);
  if (!pick.owned && !keptLeaves(pick)) NEW.picks = NEW.picks.filter((p) => p !== pick);
  // Sem anexo nenhum sobrando, a escolha volta a ser desenhada por conta propria.
  else if (!pick.attached || !pick.attached.size) delete pick.attachedHost;
}
// Sob que formacao uma maquina anexada e desenhada: a dela (`attachedAt`), ou a da escolha inteira.
const hostOf = (pick, key) => (pick.attachedAt && pick.attachedAt[key]) || pick.attachedHost || null;

// O no que o jogador clicou pode ser o fantasma — e ai quem se larga e o original, na escolha dele.
function detachOf(pick, node) {
  return node.ghost
    ? { pick: NEW.picks.find((p) => p.formation.file === node.ghostOf), key: node.ghostKey }
    : { pick, key: node.key };
}

// ------------------------------------------------------------------------ ON MAP / OFF MAP
//
// O jogo pergunta, ao comprar um morteiro ou um obus, se ele fica no mapa ou fora dele: fora, e
// chamado por menu e demora a calibrar; dentro, responde rapido e pode ser visto e morto. A tela
// nao tinha a pergunta.
//
// E ela nao se responde escrevendo um byte — a bandeira nunca foi achada no arquivo. Se responde
// TROCANDO DE COPIA: a biblioteca tem nove pecas nas duas formas, em fontes diferentes, e a copia
// do outro jeito ja vem com o que quer que faca a diferenca. O servidor diz quais sao (`deploymentTwins`).
let TWINS = null;
let twinsComing = false;
function twinMenu() {
  if (TWINS || twinsComing) return TWINS;
  twinsComing = true;
  api('GET', `/api/catalog/deployment?armies=${(NEW.armies || ['US', 'UKR']).join(',')}`)
    .then((r) => { TWINS = r.twins || {}; renderPicks(); })
    .catch((e) => { TWINS = {}; falhaVisivel(`Could not load the on-map/off-map deployment options: ${e.message}. The force can still be bought; reload to get the options back.`); })
    .finally(() => { twinsComing = false; });
  return null;
}

// A peca do jogador e uma das nove? E, se e, para que lado ela pode ir.
function deploymentOf(pick, node) {
  if (!node || node.isFormation || node.owned) return null;
  const t = twinMenu();
  if (!t) return null;
  const alvo = detachOf(pick, node);
  if (!alvo.pick) return null;
  const par = t[`${alvo.pick.formation.nation}|${node.name}`];
  if (!par) return null;
  if (!alvo.pick.keep.has(alvo.key)) return null;   // ainda nao foi tomada: nao ha o que trocar
  return { off: !!node.offMap, livre: !!planoDeTroca(alvo, node, par) };
}

// COMO IR PARA O OUTRO LADO, ou `null` quando nao da. Sao dois caminhos, e a ordem importa: voltar
// pelo mesmo lugar de onde veio vem primeiro. Sem isso um morteiro organico que foi para fora e
// voltou nao voltava para o batalhao dele — virava um grupinho solto com o mesmo nome, e quem so
// quis desfazer ficava com uma forca diferente da que tinha.
function planoDeTroca(alvo, node, par) {
  const volta = (alvo.pick.swapFrom || {})[alvo.key];
  const dono = volta ? NEW.picks.find((p) => p.formation.file === volta.file) : null;
  if (volta && dono && !dono.keep.has(volta.key)) return { volta, dono };
  const copia = copiaLivre(node.offMap ? par.on : par.off);
  return copia ? { copia } : null;
}

async function setDeployment(pick, node) {
  if (!deploymentOf(pick, node)) return;
  const alvo = detachOf(pick, node);
  const par = TWINS[`${alvo.pick.formation.nation}|${node.name}`];
  const plano = planoDeTroca(alvo, node, par);
  if (!plano) {
    alert(`The library has no ${node.name} left ${node.offMap ? 'on the map' : 'off the map'} — every copy of it is already in your force.`);
    return;
  }

  // Onde ela estava pendurada, para a nova ficar no mesmo lugar do desenho.
  const paiChave = alvo.key.includes('.') ? alvo.key.slice(0, alvo.key.lastIndexOf('.')) : null;
  let pai = null;
  const acha = (n) => { if (n.key === paiChave) pai = n; (n.children || []).forEach(acha); };
  alvo.pick.tree.roots.forEach(acha);
  const casa = hostOf(alvo.pick, alvo.key);
  const hospede = casa
    ? { pick: NEW.picks.find((p) => p.formation.file === casa.file), key: casa.key }
    : null;
  let anfitriao = pai ? { pick: alvo.pick, node: pai } : null;
  if (hospede && hospede.pick) {
    let n = null;
    const busca = (x) => { if (x.key === hospede.key) n = x; (x.children || []).forEach(busca); };
    hospede.pick.tree.roots.forEach(busca);
    if (n) anfitriao = { pick: hospede.pick, node: n };
  }
  if (!anfitriao) anfitriao = { pick: alvo.pick, node: alvo.pick.tree.roots[0] };

  // O bilhete de volta, tirado ANTES de largar a peca: para onde ela volta, e como ela estava —
  // comprada avulsa, pendurada em que formacao, dentro de que grafico. Sem o rotulo e o hospedeiro
  // a peca voltava sem lugar no desenho: reaparecia como um grafico solto, com o nome certo e nada
  // dizendo de quem ela era.
  const eraAnexo = !!(alvo.pick.attached && alvo.pick.attached.has(alvo.key));
  const origem = {
    file: alvo.pick.formation.file,
    key: alvo.key,
    avulso: eraAnexo,
    para: (alvo.pick.attachedTo || {})[alvo.key] || null,
    host: casa ? { ...casa } : null,
  };
  if (eraAnexo) dropAttached(alvo.pick, alvo.key);
  else { alvo.pick.keep.delete(alvo.key); if (alvo.pick.swapFrom) delete alvo.pick.swapFrom[alvo.key]; }

  // Voltando pelo caminho de onde veio: retoma a folha original em vez de caçar uma copia nova.
  if (plano.volta) {
    const d = plano.dono;
    d.keep.add(plano.volta.key);
    if (plano.volta.avulso) {
      d.attached = d.attached || new Set();
      d.attached.add(plano.volta.key);
      if (plano.volta.para) { d.attachedTo = d.attachedTo || {}; d.attachedTo[plano.volta.key] = plano.volta.para; }
      if (plano.volta.host) {
        if (!d.attachedHost) d.attachedHost = { ...plano.volta.host };
        d.attachedAt = d.attachedAt || {};
        d.attachedAt[plano.volta.key] = { ...plano.volta.host };
      }
    }
    renderPicks();
    reprice();
    return;
  }
  const posto = await attachVehicle({ name: node.name, copies: [plano.copia] }, anfitriao, { copia: plano.copia });
  if (!posto) return;
  posto.pick.swapFrom = posto.pick.swapFrom || {};
  posto.pick.swapFrom[posto.key] = origem;
}

// The pricing pass is debounced: every tick of a checkbox would otherwise be a round trip.
let repriceTimer = null;

// The force is read as a chart and nothing else. The list was a second way of saying the same
// thing, with its own checkbox and its own idea of what a click means, and the author dropped it.
$('#campaign').classList.add('chart');

// THE ATTACHED VEHICLE IS DRAWN WHERE IT WAS BOUGHT FOR, not in a chart of its own.
//
// It cannot BE there in the file — grafting a record into a formation's branch is the one thing
// that reliably crashes the game (FORMATO section 56) — so it lives in its own pick, is priced and
// composed like any other, and the chart borrows it: a ghost child under the formation it was
// bought for, in blue, with no buttons of its own. Everything that walks the force for money or
// modifiers skips ghosts, because the real node is in the other pick and would be counted twice.
function hangGhosts() {
  const donos = new Map(NEW.picks.map((p) => [p.formation.file, p]));
  for (const p of NEW.picks) {
    const limpa = (n) => { n.children = (n.children || []).filter((c) => !c.ghost); n.children.forEach(limpa); };
    p.tree.roots.forEach(limpa);
  }
  for (const p of NEW.picks) {
    if (!p.attachedHost) continue;
    for (const key of p.attached || []) {
      // Cada maquina sob a formacao para a qual ELA foi comprada (`attachedAt`); o hospedeiro da
      // escolha inteira fica para o que foi anexado antes de isso existir.
      const onde = hostOf(p, key);
      const host = donos.get(onde.file);
      if (!host) continue;
      let alvo = null;
      const acha = (n) => { if (n.key === onde.key) alvo = n; (n.children || []).forEach(acha); };
      host.tree.roots.forEach(acha);
      if (!alvo) continue;
      let real = null;
      const busca = (n) => { if (n.key === key) real = n; (n.children || []).forEach(busca); };
      p.tree.roots.forEach(busca);
      if (!real) continue;
      alvo.children = alvo.children || [];
      // `ghostKey` guarda a chave REAL. Sem ela o desenho e um beco sem saida: a chave do fantasma
      // e inventada para nao colidir com a do hospedeiro, e quem clica nele precisa chegar de volta
      // a unidade de verdade, na escolha que a possui.
      alvo.children.push({ ...real, children: [], ghost: true, ghostOf: p.formation.file, ghostKey: key, key: `ghost:${p.formation.file}:${key}` });
    }
  }
  // THE EXTRAS (E51): a vehicle bought into a formation that is still being bought is drawn under
  // it as a ghost too — it has no node of its own in any tree until the forge synthesizes it —
  // and everything that skips ghosts skips it. `ghostOf`/`ghostKey` point back at the pick and
  // the extra, which is what the drop button needs.
  for (const p of NEW.picks) {
    for (const e of p.extras || []) {
      let alvo = null;
      const acha = (n) => { if (n.key === e.key) alvo = n; (n.children || []).forEach(acha); };
      p.tree.roots.forEach(acha);
      if (!alvo) continue;
      alvo.children = alvo.children || [];
      alvo.children.push({
        key: `extra:${e.id}`, name: e.tipo, isFormation: false, offMap: false, type: e.type, role: e.role,
        experience: 'Regular', price: e.price, children: [],
        ghost: true, extra: true, ghostOf: p.formation.file, ghostKey: `extra:${e.id}`,
      });
    }
  }
}

function renderPicks() {
  const box = $(NEW.el.picks);
  // a vista em lista (25/10) guarda a rolagem dela e a da pagina entre um redesenho e outro
  const lista = forceViewPref() === 'list';
  const rolagemLista = box.querySelector('.force-list-scroll')?.scrollTop || 0;
  const pagina = window.scrollY;
  box.replaceChildren();
  hangGhosts();
  box.append(viewSwitch(renderPicks));
  if (lista) {
    renderForceList(box, modoEdicao());
    const sc = box.querySelector('.force-list-scroll'); if (sc) sc.scrollTop = rolagemLista;
    if (window.scrollY !== pagina) window.scrollTo(window.scrollX, pagina);
  } else NEW.picks.forEach((pick, i) => {
    // A pick that exists only to carry an attached machine is drawn inside its host, never twice.
    if (pick.attachedHost && NEW.picks.some((p) => p.formation.file === pick.attachedHost.file)) return;
    pick.implied = impliedKeys(pick);
    const card = el('div', { class: 'pick' + (pick.owned ? ' owned' : '') },
      el('div', { class: 'top' },
        el('strong', {}, pick.formation.name),
        pick.formation.sf ? el('span', { class: 'flag sf' }, 'SPECIAL FORCES') : null,
        pick.owned ? el('span', { class: 'flag' }, 'yours') : null,
        pick.copy ? el('span', { class: 'flag' }, `copy ${pick.copy}`) : null,
        el('span', { class: 'price', id: 'price-' + i }, '…'),
        pick.owned ? null
          : el('button', { class: 'linky', onclick: () => { NEW.picks = NEW.picks.filter((p) => p !== pick); renderPicks(); } }, 'remove')));
    card.append(renderCanvas(pick, renderPicks, (n) => (n.ghost ? (n.price || 0) : n.owned ? 0 : unitPrice(pick, n)), {
      onRemove: pick.owned ? null : () => { NEW.picks = NEW.picks.filter((p) => p !== pick); renderPicks(); },
      hurt: NEW.hurt, onHeal: NEW.onHeal, lost: NEW.lost, outOf: NEW.outOf, force: forceApi(pick),
      // so a Special Forces abre os homens: no quartermaster pelo que o save diz, na criacao pelo kit
      men: pick.fixed || (pick.formation && pick.formation.sf) ? (NEW.men || KIT_MEN) : null,
    }));
    box.append(card);
  });
  // One panel, moved into whichever screen is open — two elements with one id would be two bugs.
  // Maximised, the chart takes a panel of its own into its footer and this one steps aside.
  // The campaign screen throws its own DOM away on every redraw, and the rail goes with it if it
  // was living inside. Rebuilt when that happens, so the panel never disappears for good.
  const rail = $('#mods') || el('aside', { id: 'mods' });
  const grade = box.closest('.two');
  if (grade && rail.parentElement !== grade) grade.append(rail);
  const maxed = NEW.picks.some((p) => p.max);
  rail.hidden = lista || maxed || !NEW.picks.length;   // na lista os Modifiers vem debaixo dela (25/10)
  if (grade) grade.classList.toggle('with-mods', !rail.hidden);
  rail.replaceChildren(rail.hidden ? '' : renderModifiers());

  drawLibrary();
  clearTimeout(repriceTimer);
  repriceTimer = setTimeout(reprice, 60);
}

// ------------------------------------------------------------------ a forca em lista (25/10)
//
// A VISTA EM LISTA (autor, 25/10): a mesma forca do org chart, linha a linha, como no editor de cenarios do jogo. Um
// switch "Org Chart | List" em "Your force", lembrado neste computador para toda tela da forca (criacao, Raise, loja
// entre batalhas, kit-out, vista so leitura). A lista nao tem ideia propria do que um clique faz: o botao de tomar, o
// on/off map e a coluna de homens sao os do bloco (`pane.parts`, canvas.js), e a selecao e o mesmo SEL do grafico —
// entao Modifiers, stand down, venda e anexo funcionam iguais. Ctrl soma uma linha; shift pega o intervalo.
const FORCE_VIEW_KEY = 'cmbsdc.forceView';
let FORCE_VIEW_MEM = null;   // sem localStorage (janela privada), vale ate recarregar
function forceViewPref() {
  if (FORCE_VIEW_MEM) return FORCE_VIEW_MEM;
  try { return localStorage.getItem(FORCE_VIEW_KEY) === 'list' ? 'list' : 'chart'; } catch { return 'chart'; }
}
function viewSwitch(redraw) {
  const atual = forceViewPref();
  return el('div', { class: 'view-switch', title: 'How your force is drawn — remembered on this computer, for every screen' },
    ...[['chart', 'Org Chart'], ['list', 'List']].map(([v, rot]) => el('button', {
      class: atual === v ? 'on' : '',
      onclick: () => { if (atual === v) return; FORCE_VIEW_MEM = v; try { localStorage.setItem(FORCE_VIEW_KEY, v); } catch { /* fica na memoria */ } redraw(); },
    }, rot)));
}

// O MODO de quem desenha a lista: o Quartermaster (edita, com o SEL do grafico) ou a vista so leitura (selecao local).
function modoEdicao() {
  const precoDe = (pick, n) => (n.ghost ? (n.price || 0) : n.owned ? 0 : unitPrice(pick, n));
  return {
    readOnly: false,
    picks: NEW.picks.filter((pick) => !(pick.attachedHost && NEW.picks.some((p) => p.formation.file === pick.attachedHost.file))),
    redraw: renderPicks,
    isSel: (pick, n) => SEL.has(selId(pick, n)),
    click: (pick, n, aditivo) => forceApi(pick).click(n, aditivo),
    selectRange: (itens, aditivo) => { if (!aditivo) SEL = new Set(); for (const { pick, node } of itens) SEL.add(selId(pick, node)); renderPicks(); },
    pane: (pick) => renderCanvas(pick, renderPicks, (n) => precoDe(pick, n), {
      hurt: NEW.hurt, onHeal: NEW.onHeal, lost: NEW.lost, outOf: NEW.outOf, force: forceApi(pick),
      men: pick.fixed || (pick.formation && pick.formation.sf) ? (NEW.men || KIT_MEN) : null,
    }),
    price: precoDe,
    level: (pick, n) => xpOf(pick, n),
    name: (pick, n) => nameOf(pick, n),
    hurt: NEW.hurt, onHeal: NEW.onHeal, lost: NEW.lost, outOf: NEW.outOf,
    removable: (pick) => !pick.owned,
    remove: (pick) => { NEW.picks = NEW.picks.filter((p) => p !== pick); renderPicks(); },
    priceId: (pick) => 'price-' + NEW.picks.indexOf(pick),
  };
}
let RO_SEL = new Set();
function modoLeitura(picks, redraw) {
  return {
    readOnly: true, picks, redraw,
    isSel: (pick, n) => RO_SEL.has(selId(pick, n)),
    click: (pick, n, aditivo) => {
      const id = selId(pick, n);
      if (aditivo) { if (RO_SEL.has(id)) RO_SEL.delete(id); else RO_SEL.add(id); } else RO_SEL = new Set(RO_SEL.size === 1 && RO_SEL.has(id) ? [] : [id]);
      redraw();
    },
    selectRange: (itens, aditivo) => { if (!aditivo) RO_SEL = new Set(); for (const { pick, node } of itens) RO_SEL.add(selId(pick, node)); redraw(); },
    pane: (pick) => renderCanvas(pick, redraw, (n) => n.price || 0, { readOnly: true }),
    price: (pick, n) => n.price || 0,
    level: (pick, n) => n.experience || null,
    name: (pick, n) => n.name,
    removable: () => false, priceId: () => null,
  };
}

let LIST_ANCHOR = null;   // a ultima linha clicada sem shift: o comeco do intervalo
function renderForceList(box, modo) {
  const linhas = [];
  const corpo = el('tbody');
  for (const pick of modo.picks) {
    pick.open = pick.open || new Set();
    if (!modo.readOnly) pick.implied = impliedKeys(pick);
    pick.max = false;   // maximizar e coisa do grafico
    const parts = modo.pane(pick).parts || {};
    const pid = modo.priceId(pick);
    corpo.append(el('tr', { class: 'row-pick' }, el('td', { colspan: 4 },
      el('strong', {}, pick.formation.name),
      pick.formation.sf ? el('span', { class: 'flag sf' }, 'SPECIAL FORCES') : null,
      pick.owned ? el('span', { class: 'flag' }, 'yours') : null,
      pick.copy ? el('span', { class: 'flag' }, `copy ${pick.copy}`) : null,
      pid ? el('span', { class: 'price', id: pid }, '…') : null,
      modo.removable(pick) ? el('button', { class: 'linky', onclick: () => modo.remove(pick) }, 'remove') : null)));
    const anda = (n, fundo) => {
      linhas.push({ pick, node: n });
      corpo.append(linhaDaLista(pick, n, fundo, linhas.length - 1, modo, parts, linhas));
      if (parts.menColumn && pick.men && pick.men.has(n.key)) {
        const col = parts.menColumn(n);
        if (col) corpo.append(el('tr', { class: 'men-row' }, el('td', { colspan: 4 }, el('div', { class: 'men-wrap', style: `margin-left:${34 + fundo * 18}px` }, col))));
      }
      if (n.isFormation && pick.open.has(n.key)) n.children.forEach((c) => anda(c, fundo + 1));
    };
    pick.tree.roots.forEach((r) => anda(r, 0));
  }
  const tabela = el('table', { class: 'force-list' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', { class: 'lunits' }, 'Units'), el('th', { class: 'lcost' }, 'Cost'), el('th', {}, ''))), corpo);
  box.append(el('div', { class: 'force-list-scroll' }, tabela));
  if (!modo.picks.length) box.append(el('p', { class: 'hint' }, 'Nothing in the force yet — pick formations from the library above.'));
  const itens = selecionados(modo);
  box.append(el('div', { class: 'list-foot' + (modo.readOnly ? ' ro' : '') },
    modo.readOnly ? null : renderModifiers(),
    renderSelectionCard(itens, modo)));
}

// O CUSTO NA LISTA (autor, 29/10): a unidade pelo mesmo preco do org chart (experiencia, anexo); a que ja e sua cobra 0 e
// mostra o preco de tabela apagado. O grupo: o que cobra pelo que esta tomado / o grupo inteiro, como a coluna Units.
const precoTabela = (pick, n, modo) => (n.owned ? (n.price || 0) : modo.price(pick, n) || 0);
function custoDaLinha(pick, n, modo, folhas) {
  if (!n.isFormation) {
    if (n.owned && !modo.readOnly) return el('td', { class: 'lcost' }, el('span', { class: 'own', title: 'Already yours — not charged' }, `${n.price || 0} cr`));
    return el('td', { class: 'lcost' }, `${modo.price(pick, n) || 0} cr`);
  }
  const tomada = (x) => modo.readOnly || x.owned || x.ghost || pick.keep.has(x.key);
  const sel = folhas.filter(tomada).reduce((a, x) => a + (x.owned && !modo.readOnly ? 0 : modo.price(pick, x) || 0), 0);
  const total = folhas.reduce((a, x) => a + precoTabela(pick, x, modo), 0);
  return el('td', { class: 'lcost', title: modo.readOnly ? 'What the formation is worth' : `${sel} cr for what is taken (units already yours are not charged) / ${total} cr for the whole formation` },
    modo.readOnly ? `${total} cr` : `${sel} / ${total} cr`);
}

function linhaDaLista(pick, n, fundo, idx, modo, parts, linhas) {
  const on = pick.keep.has(n.key);
  const folhas = n.isFormation ? leavesOf(n) : [n];
  const tomadas = folhas.filter((x) => x.owned || x.ghost || pick.keep.has(x.key)).length;
  const fora = !n.isFormation && modo.outOf ? modo.outOf(n) : null;
  const perdido = !n.isFormation && modo.lost ? modo.lost(n) : null;
  const ferida = !n.isFormation && modo.hurt ? modo.hurt(n) : null;
  const ativa = n.isFormation ? tomadas > 0 || !!(pick.implied && pick.implied.has(n.key)) : (on || n.owned || n.ghost);
  const cls = ['frow', n.isFormation ? 'form' : 'unit'];
  if (!ativa) cls.push('off');
  if (modo.isSel(pick, n)) cls.push('sel');
  if (fora) cls.push(...fora.cls.split(' '));
  if (n.sold) cls.push('sold');
  const chip = (t, title, c = '') => el('span', { class: 'lchip ' + c, title }, t);
  const chips = [];
  if (n.isFormation) chips.push(chip('formation', 'A formation heading: everything under it comes with it', 'kind'));
  if (n.offMap) chips.push(chip('off-map', 'Fires from off the map: called by menu, cannot be seen or hit'));
  if (n.extra || n.singleOwned) chips.push(chip('single vehicle', 'Bought as a single vehicle for this formation', 'att'));
  else if (n.ghost || (pick.attached && pick.attached.has(n.key))) chips.push(chip('attached', 'Bought from the library and attached here', 'att'));
  if (fora) chips.push(chip(fora.label.toLowerCase(), 'Out of the next battle', 'warn'));
  if (perdido) chips.push(chip(perdido.bought ? 'replacement bought' : 'destroyed', perdido.bought ? 'Rebuilt in its slot for the next battle' : 'Destroyed: replace it in Vehicles and guns', perdido.bought ? 'ok' : 'bad'));
  if (ferida && ferida.down.length) chips.push(chip(`${ferida.down.length} down`, 'Men down in the last battle', 'bad'));
  if (!n.isFormation) { const lv = modo.level(pick, n); if (lv) chips.push(chip(lv, 'Experience', 'xp')); }
  const temFilhos = n.isFormation && n.children.length;
  const aberto = temFilhos && pick.open.has(n.key);
  const toggle = temFilhos
    ? el('button', { class: 'ltog', title: aberto ? 'Fold' : 'Open', onclick: (ev) => { ev.stopPropagation(); aberto ? pick.open.delete(n.key) : pick.open.add(n.key); modo.redraw(); } }, aberto ? '▾' : '▸')
    : el('span', { class: 'ltog none' });
  const nome = el('td', { class: 'lname', style: `padding-left:${6 + fundo * 18}px` }, toggle, el('span', { class: 'lnm' }, modo.name(pick, n)), ...chips);
  const unidades = el('td', { class: 'lunits' }, n.isFormation ? `${tomadas} / ${folhas.length}` : `${ativa ? 1 : 0} / 1`);
  const custo = custoDaLinha(pick, n, modo, folhas);
  const acoes = el('td', { class: 'lacts' });
  const a = parts.actionButton ? parts.actionButton(n) : null; if (a) acoes.append(a);
  const d = parts.deployButton ? parts.deployButton(n) : null; if (d) acoes.append(d);
  const m = parts.menOf ? parts.menOf(n) : null;
  if (m) {
    const homensAbertos = !!(pick.men && pick.men.has(n.key));
    acoes.append(el('button', {
      class: 'blk-btn men' + (homensAbertos ? ' on' : ''),
      title: m.readOnly ? 'The slots of this unit and the weapon the factory gives each one' : 'The soldiers, with the weapon and the item of each',
      onclick: (ev) => { ev.stopPropagation(); pick.men = pick.men || new Set(); if (homensAbertos) { pick.men.delete(n.key); pick.armsOpen = null; pick.kitOpen = null; } else pick.men.add(n.key); modo.redraw(); },
    }, homensAbertos ? '− men' : `▾ men (${m.men.length})`));
  }
  if (ferida && ferida.down.length && modo.onHeal) {
    const todos = ferida.chosen === ferida.down.length;
    acoes.append(el('button', { class: 'blk-btn heal' + (todos ? ' on' : ''), title: 'Bring this unit back to full strength for the next battle', onclick: (ev) => { ev.stopPropagation(); modo.onHeal(n); } },
      todos ? `✓ ${ferida.down.length} replaced` : `✚ ${ferida.down.length} men · ${ferida.cost} cr`));
  }
  const tr = el('tr', { class: cls.join(' ') }, nome, unidades, custo, acoes);
  tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button, select, a, .man-menu')) return;
    const aditivo = ev.ctrlKey || ev.metaKey;
    if (ev.shiftKey && LIST_ANCHOR) {
      const i = linhas.findIndex((x) => x.pick === LIST_ANCHOR.pick && x.node.key === LIST_ANCHOR.key);
      if (i >= 0) {
        const [de, ate] = i < idx ? [i, idx] : [idx, i];
        document.getSelection()?.removeAllRanges();
        modo.selectRange(linhas.slice(de, ate + 1), aditivo);
        return;
      }
    }
    LIST_ANCHOR = { pick, key: n.key };
    modo.click(pick, n, aditivo);
  });
  return tr;
}

// O que esta selecionado, aberto na lista ou nao.
function selecionados(modo) {
  const out = [];
  for (const pick of modo.picks) {
    const anda = (n) => { if (modo.isSel(pick, n)) out.push({ pick, node: n }); n.children.forEach(anda); };
    pick.tree.roots.forEach(anda);
  }
  return out;
}
function trilhaDe(pick, alvo) {
  const out = [];
  const anda = (n, cima) => { if (n === alvo) { out.push(...cima); return true; } return n.children.some((c) => anda(c, [...cima, n.name])); };
  pick.tree.roots.some((r) => anda(r, [pick.formation.name === r.name ? null : pick.formation.name].filter(Boolean)));
  return out;
}

// O PAINEL DA UNIDADE (autor, 25/10: "informacoes da unidade que nao aparecem no div de modifiers"): o que ela e (papel,
// exercito, homens e armas de fabrica), o que ela vale, o estado dela na forca e, se ja e sua, o que ela ja viveu.
function renderSelectionCard(itens, modo) {
  const box = el('div', { class: 'unit-card' });
  const S = CAMPAIGN && NEW && CAMPAIGN.slug === NEW.slug ? CAMPAIGN : (modo.readOnly ? CAMPAIGN : (CAMPAIGN || null));
  const fmt = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'));
  const linha = (rot, val, cls = '') => (val === null || val === undefined || val === '' ? null : el('div', { class: 'uc-row ' + cls }, el('span', {}, rot), el('b', {}, String(val))));
  const armasTxt = (w) => (w && Object.keys(w).length ? Object.entries(w).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c}× ${k}`).join(', ') : null);
  const unidadeDe = (n) => (S && n.coreId !== null && n.coreId !== undefined ? (S.units || []).find((u) => u.coreId === n.coreId) : null);
  if (!itens.length) {
    box.append(el('div', { class: 'uc-head' }, el('strong', {}, 'Unit')),
      el('p', { class: 'hint' }, 'Click a row to see the unit. Ctrl-click adds a row; shift-click takes every row in between.'));
    return box;
  }
  const estadoDe = (pick, n) => {
    if (n.sold) return 'sold';
    const p = modo.lost ? modo.lost(n) : null;
    if (p) return p.bought ? 'destroyed — replacement bought' : 'destroyed';
    const f = modo.outOf ? modo.outOf(n) : null;
    if (f) return f.label.toLowerCase();
    if (n.extra) return 'single vehicle, attached';
    if (n.ghost) return 'attached';
    const h = modo.hurt ? modo.hurt(n) : null;
    if (n.owned) return h && h.down.length ? `in the field · ${h.down.length} men down` : 'in the field';
    if (pick.owned) return pick.keep.has(n.key) ? 'bought from the arsenal' : 'dormant in the arsenal';
    return pick.keep.has(n.key) ? 'taken' : 'not taken';
  };
  if (itens.length === 1 && !itens[0].node.isFormation) {
    const { pick, node: n } = itens[0];
    const u = unidadeDe(n);
    const att = u && S.attrs ? S.attrs[n.coreId] : null;
    const rec = u && S.record ? S.record[n.coreId] : null;
    const limpas = u && S.cleanBattles ? S.cleanBattles[n.coreId] : null;
    const passo = STATUS.rules.progression?.leadership?.cleanBattlesPerStep || 2;
    const nome = modo.name(pick, n);
    box.append(el('div', { class: 'uc-head' }, el('strong', {}, nome), el('span', { class: 'hint' }, estadoDe(pick, n))),
      el('div', { class: 'uc-trail' }, trilhaDe(pick, n).join(' › ') || pick.formation.name),
      el('div', { class: 'uc-grid' },
        linha('Army', pick.formation.nation || (u && u.nation)),
        linha('Role', `${n.role || (u && u.role) || '—'}${n.offMap ? ' · off-map' : ''}`),
        nome !== n.name ? linha('Equipment', `swapped from ${n.name}`) : null,
        linha('Men (TO&E)', n.men ?? (n.men === null ? 'no factory data' : null)),
        linha('Factory weapons', armasTxt(n.weapons)),
        linha('Experience', modo.level(pick, n) || n.experience || '—'),
        linha('Motivation', att && att.motivacao ? att.motivacao : u ? '—' : null),
        linha('Leadership', u ? (u.leadership ?? (att && att.lideranca) ?? '—') : 'drawn when paid'),
        u ? linha('Price', `${fmt(u.price)} cr paid`) : linha('Price', `${fmt(modo.price(pick, n))} cr`),
        rec ? linha('Record', `${rec.battles || 0} battle${rec.battles === 1 ? '' : 's'} · ${rec.wins || 0} won`) : null,
        limpas !== null && limpas !== undefined ? linha('Clean battles', `${limpas} of ${passo}`) : null,
        u && u.single ? linha('Bought', 'as a single vehicle') : null));
    return box;
  }
  const unidades = [];
  const vistos = new Set();
  for (const { pick, node } of itens) for (const l of (node.isFormation ? leavesOf(node) : [node])) {
    const id = selId(pick, l); if (vistos.has(id)) continue; vistos.add(id); unidades.push({ pick, node: l });
  }
  const tomadas = unidades.filter(({ pick, node }) => node.owned || node.ghost || pick.keep.has(node.key));
  const emCampo = unidades.filter(({ node }) => node.owned).length;
  const preco = tomadas.reduce((a, { pick, node }) => a + (node.owned ? 0 : modo.price(pick, node)), 0);
  const homens = tomadas.reduce((a, { node }) => a + (node.men || 0), 0);
  const fora = unidades.filter(({ node }) => node.offMap).length;
  const xp = {}; for (const { pick, node } of tomadas) { const lv = modo.level(pick, node) || node.experience; if (lv) xp[lv] = (xp[lv] || 0) + 1; }
  const armas = {}; for (const { node } of tomadas) for (const [k, c] of Object.entries(node.weapons || {})) armas[k] = (armas[k] || 0) + c;
  const titulo = itens.length === 1 ? modo.name(itens[0].pick, itens[0].node) : `${itens.length} rows selected`;
  box.append(el('div', { class: 'uc-head' }, el('strong', {}, titulo), el('span', { class: 'hint' }, itens.length === 1 ? 'formation' : `${new Set(itens.map((x) => x.pick)).size} formation${new Set(itens.map((x) => x.pick)).size === 1 ? '' : 's'}`)),
    itens.length === 1 ? el('div', { class: 'uc-trail' }, trilhaDe(itens[0].pick, itens[0].node).join(' › ') || itens[0].pick.formation.name) : null,
    el('div', { class: 'uc-grid' },
      linha('Units taken', `${tomadas.length} / ${unidades.length}`),
      emCampo ? linha('In the field', emCampo) : null,
      fora ? linha('Off-map', fora) : null,
      linha('Men (TO&E)', homens || null),
      linha('Factory weapons', armasTxt(Object.fromEntries(Object.entries(armas).sort((a, b) => b[1] - a[1]).slice(0, 6)))),
      linha('Experience', Object.entries(xp).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${c} ${k}`).join(' · ') || null),
      linha('Price of what is new', `${fmt(preco)} cr`)));
  return box;
}

// A maximised chart hides the budget panel behind it, so the budget is repeated on the chart.
// Filled here because pricing is the only place that knows the number.
function showCredits(left) {
  for (const n of document.querySelectorAll('.canvas-credits')) {
    n.textContent = `${left} cr`;
    n.classList.toggle('no', left < 0);
  }
}

let repriceSeq = 0;
async function reprice() {
  if (!NEW) return;
  const budget = $(NEW.el.budget);
  const available = NEW.creditsAvailable();
  if (!NEW.picks.length) {
    budget.replaceChildren(el('div', { class: 'line' }, el('span', {}, NEW.label), el('b', {}, available + ' cr')));
    showCredits(available);
    ++repriceSeq;
    NEW.priceError = null;
    NEW.priced = [];
    $(NEW.el.create).disabled = !NEW.allowEmpty;
    if (NEW.onPriced) NEW.onPriced({ total: 0, units: 0, onMap: 0, left: available, picks: [] });
    return;
  }
  // Formations the player already owns are priced here, by the difference; the ones he is about
  // to recruit are priced by the server, which also says whether their units can be tracked at all.
  //
  // A COTACAO QUE FALHA TEM DE APARECER (03/10). O autor recrutou o Batalhao de Tanques 31
  // (28.820 cr) e o "Committed" ficou parado em 3.210: esta funcao roda num setTimeout, e um erro
  // aqui virava uma rejeicao que ninguem via — `NEW.priced` ficava com a conta de antes e o rodape
  // somava sem o batalhao. Agora a falha fica em `NEW.priceError`, o painel diz qual foi, o rodape
  // trava o Apply e o erro vai para o log do servidor. E a resposta que chega depois de outra
  // cotacao ja ter comecado e descartada: so a ultima vale.
  const seq = ++repriceSeq;
  const NOW = NEW;
  const fresh = NEW.picks.map((p, i) => ({ p, i })).filter((x) => !x.p.owned);
  let pricedFresh = [];
  try {
    if (fresh.length) {
      ({ picks: pricedFresh } = await api('POST', '/api/price', {
        nation: (NEW.armies || ['US'])[0],
        ...(NEW.slug ? { slug: NEW.slug } : {}),
        picks: fresh.map((x) => pickPayload(x.p)),
      }));
    }
  } catch (e) {
    if (seq !== repriceSeq || NOW !== NEW) return;
    NEW.priceError = `${e.message}${e.id ? ` (error ${e.id})` : ''}`;
    reportClientError('reprice', e);
    budget.replaceChildren(el('div', { class: 'banner bad' }, `Could not price the formations you are recruiting: ${NEW.priceError}. Nothing can be bought until this is fixed — the totals on this screen leave them out.`));
    $(NEW.el.create).disabled = true;
    if (NEW.onPriced) NEW.onPriced({ error: NEW.priceError });
    return;
  }
  if (seq !== repriceSeq || NOW !== NEW) return;
  NEW.priceError = null;

  let total = 0, units = 0, onMap = 0;
  const uncovered = [];
  const vazias = [];   // 29/10: a formacao chega sem nada marcado; vazia, nao se envia
  const picks = [];
  NEW.picks.forEach((p, i) => {
    const tag = document.getElementById('price-' + i);
    if (p.owned) {
      const a = addedTo(p);
      total += a.cost; units += a.units; onMap += a.onMap;
      picks.push({ owned: true, index: p.index, coreIds: a.ids, xp: a.xp, price: a.cost, units: a.units });
      if (tag) tag.textContent = a.units ? `+${a.units} units · ${a.cost} cr` : 'nothing added';
      return;
    }
    const k = fresh.findIndex((x) => x.i === i);
    const q = pricedFresh[k];
    if (!q) return;
    if (escolhaVazia(p)) vazias.push(nomeDaEscolha(p));
    total += q.price || 0; units += q.units; onMap += q.onMapUnits;
    picks.push({ ...q, owned: false });
    if (tag) tag.textContent = `${q.price} cr · ${q.units} units`;
    for (const u of q.uncovered || []) uncovered.push(`${u.name} (${p.formation.name})`);
  });
  const left = available - total;
  NEW.priced = picks;
  showCredits(left);
  budget.replaceChildren(
    el('div', { class: 'line' }, el('span', {}, NEW.forceLabel || 'Force'), el('span', {}, `${units} units, ${onMap} on the map`)),
    ...(NEW.fieldBase ? [el('div', { class: 'line' }, el('span', {}, 'In the field next battle'), el('span', {}, `${NEW.fieldBase + units} units`))] : []),
    el('div', { class: 'line' }, el('span', {}, 'Cost'), el('span', {}, total + ' cr')),
    el('div', { class: 'line' }, el('span', {}, 'Credits left'), el('b', { class: left < 0 ? 'no' : '' }, left + ' cr')));
  $(NEW.el.create).disabled = left < 0 || uncovered.length > 0 || vazias.length > 0 || (NEW.needsOnMap && onMap === 0) || (NEW.ready ? !NEW.ready() : false);
  if (vazias.length) budget.append(el('div', { class: 'banner bad empty-pick' }, avisoVazias(vazias)));
  if (NEW.needsOnMap && onMap === 0 && !vazias.length) budget.append(el('div', { class: 'banner bad' }, 'Every force needs at least one unit that sets foot on the map.'));
  // O TETO DE UNIDADES EM CAMPO (E125): o jogo da Out of memory com ~1.000 unidades da forca em campo.
  {
    const cap = STATUS.rules.fieldCap || {}; const emCampo = (NEW.fieldBase || 0) + units;
    if (cap.max && emCampo > cap.max) { budget.append(el('div', { class: 'banner bad' }, `${emCampo} units in the field: the game runs out of memory above about ${cap.max}. Leave some of it out.`)); $(NEW.el.create).disabled = true; }
    else if (cap.warn && emCampo > cap.warn) budget.append(el('div', { class: 'banner' }, `${emCampo} units in the field — close to what the game can load (it crashed at 1,035 and ran out of memory at 1,285).`));
  }
  if (uncovered.length) {
    // A unit with no roster template cannot be tracked between battles, and a campaign whose
    // roster does not cover every core unit crashes the game on load.
    budget.append(el('div', { class: 'banner bad' },
      'These units have no line in the campaign roster, so this formation cannot be used: '
      + [...new Set(uncovered)].join(', ') + '. Pruning them away does not help — the game keeps them in the file as absent units.'));
  }
  if (NEW.onPriced) NEW.onPriced({ total, units, onMap, left, picks });
}

$('#new-campaign').addEventListener('click', startNew);

// --------------------------------------------------------------------------------------- job

// UM JOB QUE FALHA TEM SAIDA (E177): "← Back" volta a tela de onde ele partiu, relida do servidor. Um poll que cai (o
// servidor parou, a rede) e falha tambem, com a mensagem — antes a tela ficava muda.
function falhaDoJob(msg) {
  const b = $('#job-error');
  b.hidden = false;
  b.textContent = msg;
  $('#job-back').hidden = false;
  $('#job .spinner').hidden = true;
  return Object.assign(new Error(msg), { handled: true });
}
$('#job-back-btn').addEventListener('click', () => render({ ...(VIEW || { screen: 'home' }), reload: true }));

// O CHECKLIST DO JOB (08/11, autor: "a leitura/escrita fica ali carregando sem dar nenhum feedback; outros usuarios podem
// achar que e erro e fecharem o app"): cada etapa com o estado dela — feita (e quanto levou), rodando, por vir, falhou —
// e o tempo total no topo, com o aviso de nao fechar o app. Jobs antigos, sem estado por etapa, saem como antes.
const segundos = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : `${Math.max(0, Math.round(ms / 1000))} s`);
// as linhas do checklist de um job (a tela cheia #job e o acompanhamento dentro de uma aba usam as mesmas)
function etapasItens(job) {
  return job.steps.map((s) => {
    const estado = s.state || 'done';
    const marca = { done: '✓', running: '', pending: '○', failed: '✗' }[estado] ?? '';
    const tempo = estado === 'done' && Number.isFinite(s.ms) ? segundos(s.ms) : estado === 'running' && s.t ? segundos(Date.now() - Date.parse(s.t)) : '';
    return el('li', { class: `step-${estado}` },
      el('span', { class: 'step-mark' }, estado === 'running' ? el('span', { class: 'spinner small' }) : marca),
      el('span', { class: 'step-label' }, s.step),
      tempo ? el('span', { class: 'step-time' }, tempo) : null);
  });
}
function desenharEtapas(job) {
  const total = Date.now() - Date.parse(job.startedAt || new Date().toISOString());
  const rodando = job.state === 'running';
  $('#job-elapsed').textContent = rodando ? `Elapsed ${segundos(total)} — this can take a minute or two. Keep the app open until it finishes.` : '';
  $('#job-steps').replaceChildren(...etapasItens(job));
}

// O JOB ACOMPANHADO DENTRO DA ABA (14/11, autor: a aba Outcome ficava um minuto em "Reading the campaign..."): o mesmo poll
// de watchJob, mas o checklist e o tempo aparecem em `alvo`, sem trocar para a tela cheia. Devolve o resultado do job.
async function acompanharNaTela(jobId, alvo, titulo) {
  const tempo = el('p', { class: 'hint' }), lista = el('ol', { class: 'steps checklist' });
  alvo.replaceChildren(el('p', {}, titulo), lista, tempo);
  let falhas = 0;
  for (;;) {
    let job;
    try { job = await api('GET', '/api/jobs/' + jobId); falhas = 0; } catch (e) {
      if (/unknown job/.test(e.message)) throw new Error('the app was restarted while this was being read — open the tab again');
      if (++falhas < 3) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw e;
    }
    if (!alvo.isConnected) return null;   // a aba foi trocada: ninguem mais olha
    lista.replaceChildren(...etapasItens(job));
    tempo.textContent = job.state === 'running' ? `Elapsed ${segundos(Date.now() - Date.parse(job.startedAt))}` : '';
    if (job.state === 'done') return job.result;
    if (job.state === 'failed') throw new Error(job.error.message);
    await new Promise((r) => setTimeout(r, 700));
  }
}

let falhasDoPoll = 0;
let ACOMPANHANDO = null;   // o job que esta pagina ja acompanha (29/10)
async function watchJob(id, title) {
  falhasDoPoll = 0;
  $('#job-title').textContent = title;
  $('#job-steps').replaceChildren();
  $('#job-error').hidden = true;
  $('#job-back').hidden = true;
  $('#job .spinner').hidden = false;
  show('job');
  for (;;) {
    let job;
    // (29/10, bateria de interrupcoes) um poll que falha nao encerra de cara: a rede ou o servidor podem soluçar. Tres
    // seguidos sim. "unknown job" e o servidor que reiniciou: o job morreu com ele, e a mensagem diz o que fazer.
    try { job = await api('GET', '/api/jobs/' + id); falhasDoPoll = 0; } catch (e) {
      if (/unknown job/.test(e.message)) throw falhaDoJob('The app was closed or restarted while this was running, so it stopped half way. Go back to the campaign and do it again — anything it left half done has been put back.');
      if (++falhasDoPoll < 3) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw falhaDoJob(`Could not follow the job: ${e.message}. If the app's window was closed, start it again and reopen the campaign.`);
    }
    desenharEtapas(job);
    if (job.state === 'done') return job.result;
    if (job.state === 'failed') throw falhaDoJob(job.error.message);
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ------------------------------------------------------------------------------------ navegacao (E177)
//
// A NAVEGACAO E O HISTORICO DO NAVEGADOR (autor, 11/10: "o botao de voltar deve sempre retornar a tela anterior; para a
// lista de campanhas ha o Campaigns do topo"). Cada tela e uma VISTA — { screen, slug, tab, sub } — guardada no hash
// (#home, #setup, #params, #new, #campaign/<slug>/<aba>[/<sub-aba>]). `go` empilha uma vista nova, o "← Back" da barra
// e o Voltar do navegador desempilham, e F5 reabre a vista do hash. `render` desenha uma vista sem mexer no historico.
let VIEW = null;
const ABAS_VALIDAS = new Set(['menu', 'path', 'quartermaster', 'hq', 'now', 'intel']);
const SUBS_VALIDAS = new Set(['history', 'personnel', 'vehicles', 'kills', 'parameters']);
function hashOf(v) {
  if (v.screen !== 'campaign') return '#' + v.screen;
  return `#campaign/${encodeURIComponent(v.slug)}/${v.tab || 'menu'}${v.tab === 'hq' && v.sub ? '/' + v.sub : ''}`;
}
function viewOfHash(h) {
  const p = String(h || '').replace(/^#/, '').split('/');
  if (p[0] === 'campaign' && p[1]) {
    const tab = ABAS_VALIDAS.has(p[2]) ? p[2] : 'menu';
    return { screen: 'campaign', slug: decodeURIComponent(p[1]), tab, ...(tab === 'hq' && SUBS_VALIDAS.has(p[3]) ? { sub: p[3] } : {}) };
  }
  return ['start', 'home', 'setup', 'system', 'params', 'about', 'rules'].includes(p[0]) ? { screen: p[0] } : null;
}
// ------------------------------------------------------------------------------- as regras (25/10)
//
// A PAGINA DAS REGRAS (autor, 25/10): o menu inicial ganha "Rules", entre Campaign e About. Os numeros vem de
// STATUS.rules (o rules.json inteiro): o que mudar nas regras muda aqui, sem reescrever a pagina. Uma regra ausente
// vira "—", nunca quebra a tela.
function renderRules() {
  const R = (STATUS && STATUS.rules) || {};
  const box = $('#rules-body');
  const n = (v, d = '—') => (v === null || v === undefined || Number.isNaN(v) ? d : typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
  const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '—');
  const x = (v) => (typeof v === 'number' ? `×${String(v).replace(/\.0+$/, '')}` : '—');
  const p = (...k) => el('p', {}, ...k);
  const b = (t) => el('b', {}, t);
  const tabela = (cab, linhas) => el('table', { class: 'grid' },
    el('tr', {}, ...cab.map((c) => el('th', {}, c))),
    ...linhas.map((l) => el('tr', {}, ...l.map((c) => el('td', {}, c === null || c === undefined ? '—' : String(c))))));
  const tiers = R.tiers || [];
  const pres = R.difficulty?.presets || [];
  const ops = (R.abilities?.list || []).filter((a) => !a.retired && a.effect?.minutes);
  const intel = R.abilities?.enemyIntel?.levels || [];
  const camp = R.abilities?.campaign?.list || [];
  const w = R.reward?.weights || {};
  const rep = R.reward?.replacement || {};
  const par = STATUS?.playerLadder || [];
  const mults = STATUS?.presetMultipliers || [];
  const somaTier = (t) => Object.values(t?.budgets || {}).reduce((a, v) => a + (v || 0), 0);
  const saltos = tiers.slice(1).map((t, i) => somaTier(t) / (somaTier(tiers[i]) || 1)).filter(Number.isFinite);
  const promo = R.progression?.promotion?.battles || {};
  const lid = R.progression?.leadership || {};
  const S = R.score || {};
  const ew = R.ew?.counter || {};
  const pesos = R.path?.enemyWeights || [];
  const leve = pesos.find((q) => q.id === 'light'), pesado = pesos.find((q) => q.id === 'heavy');
  const shift = R.defense?.profileShift || {};
  const meetF = R.maps?.kindBudgetFactor?.Meet;
  const sfOpts = (R.formations?.specialForcesPriceOptions || []).map((v) => (v ? `${v} cr` : 'free')).join(' or ');
  const ranks = S.ranks || [];
  box.replaceChildren(
    el('h2', {}, 'Rules'),
    p('A Combat Mission: Black Sea campaign that is never the same twice. You raise a force, choose your road through a tree of battles, fight each one in the game and bring the save back here: the app reads what happened, pays you, lets you rebuild, and builds the next battle around what is left of your force.'),

    el('h3', {}, 'The campaign'),
    p(`A campaign is ${n(R.battlesToWin)} battles in ${tiers.length} tiers. Each tier is harder than the last: the enemy is bigger and better trained, and the clock is longer.`),
    tabela(['Tier', 'Battles', 'Enemy experience', 'Base clock'], tiers.map((t) => [t.tier, t.battles.join(', '), t.experience, t.duration ? `${t.duration}′` : null])),
    p(`You win the campaign by fighting the ${n(R.battlesToWin)}th battle. You lose it when you suffer one defeat more than you are allowed: the number is chosen when the campaign is raised (${(R.defeatsAllowedOptions || []).join(', ')}; ${n(R.defeatsAllowed)} by default). A draw is not a defeat.`),
    p('The difficulty presets set every parameter at once; any other combination is Custom.'),
    tabela(['Preset', 'Your armies', 'Enemy', 'Force ratio', 'Enemy in battle 1', 'Defeats', 'Rescue chance', 'Operational points', 'Special forces', 'Score'],
      pres.map((q) => [q.name, (q.armies || []).join(' + '), q.enemySide === 'US' ? 'US + UKR' : q.enemySide, `${q.ratio} : 1`, `${n(Math.round((R.startingCredits || 0) / q.ratio))} cr`, q.defeats, pct(q.rescueChance), q.opPoints, (q.specialForcesPrice ?? R.formations?.specialForcesPrice) ? `${n(q.specialForcesPrice ?? R.formations?.specialForcesPrice)} cr` : 'free', x(mults.find((m) => m.name === q.name)?.multiplier)])),

    el('h3', {}, 'The Battle Path'),
    p(`The campaign is a tree: row n is battle n, with ${n(R.path?.rowWidth?.[0])} to ${n(R.path?.rowWidth?.[1])} battles on each row. After each battle you choose the next one among those that follow it. Every node shows how heavy the enemy is — a lighter enemy (budget ${x(leve?.budget)}) caps the replacement cover at ${x(leve?.mult)}, a heavier one (budget ${x(pesado?.budget)}) at ${x(pesado?.mult)} —, the enemy's electronic warfare, the H-hour, the date and the weather. About ${pct(R.path?.meetShare)} of the nodes are Meeting Engagements. The map and the enemy stay hidden until you scout them.`),
    p(b('Operational points'), ` are what scouting and support cost. You start with ${n(R.path?.startingPointsDefault)} (${n(Math.min(...(R.path?.startingPointsOptions || [0])))} to ${n(Math.max(...(R.path?.startingPointsOptions || [0])))}, chosen at creation) and each node pays 0 to ${n(R.path?.balance?.maxOps)} more when its battle is read without a defeat. They cannot be bought with credits.`),
    tabela(['What', 'Where', 'Cost'], [
      ['Reveal the map of a battle that follows yours', 'Battle Path', `${n(R.path?.reveal?.map)} pt`],
      ['Reveal enemy formations and units (with experience) of the battle being prepared', 'Intel', `${n(R.path?.reveal?.full)} pts`],
      ['Counter the enemy electronic warfare', 'Battle Path', Object.entries(ew).map(([k, v]) => `${k} ${v}`).join(' · ') + ' pts'],
      ...ops.map((a) => [a.name, 'Intel', `${n(a.ops)} pt${a.ops === 1 ? '' : 's'}`]),
      ['Intel strength (enemy contacts marked at setup)', 'Intel', intel.map((l) => `${l.strength}%: ${l.ops}`).join(' · ') + ' pts'],
      ['Change the time of day', 'Intel', '1 pt'],
      ...camp.map((a) => [a.name, 'Quartermaster / Intel', `${n(a.ops)} pt — the rest of the campaign`]),
    ]),

    el('h3', {}, 'The enemy'),
    p(`In an ordinary battle the enemy defends. It is bought from the game's own formation library with the money of its tier, split by role (squads, teams, carriers, tanks, off-map support). Inside a tier each battle is ${x(R.defense?.battleGrowth)} the one before it, and the first battle of a tier is ${saltos.map((v) => `×${v.toFixed(1)}`).join(', then ')} the first of the previous one. The map moves the money: on an urban map ${pct(Math.abs(shift.urbano || 0))} of the vehicle money goes to the infantry, on an open map ${pct(Math.abs(shift.aberto || 0))} of the infantry money goes to the vehicles.`),
    p(b('The enemy ladder'), ` — what your force is worth in each battle if it loses nothing (your ladder): ${par.map((v) => n(v)).join(' · ')} credits. In an ordinary battle the enemy's budget is that ÷ your force ratio, before the node's weight and the map move it. It does not look at your force, only at the ratio.`),
    p(b('Meeting Engagement:'), ` both sides attack, at 1 : 1 whatever the difficulty. The enemy budget is your rung (${x(meetF)} the tier's), never less than what your force in the field is worth, and never more than ${x(R.meet?.playerFloor?.ceiling)} the tier's.`),

    el('h3', {}, 'Credits'),
    p(`You start with ${n(R.startingCredits)} cr at every difficulty, and every difficulty pays the same. The `, b('force ratio'), ` you choose at creation is the difficulty: it sizes the enemy of an ordinary battle, and a force that loses nothing stays at that ratio to it for the whole campaign. After every battle the debrief pays three lines:`),
    tabela(['Line', 'What it pays'], [
      ['Command allotment', 'the next battle\'s rung of your ladder − this battle\'s — whatever happened. Nothing after the last battle.'],
      ['Replacement cover', `the Quartermaster's bill for what the battle cost you (lost machines at ${R.replacement?.vehicleExperience || 'Green'} price, fallen men at ${n(R.replacement?.creditsPerMan)} cr), up to a cap of ${pct(rep.capShare)} × this battle's rung of your ladder (× the node's weight), × the battle score`],
      ['Unused-cover bonus', `${pct(rep.unusedBonus)} of the part of the cap you did not need, × the battle score — the only way to grow beyond your ladder, and slowly`],
    ]),
    p(`The `, b('battle score'), ` (0 to 100%) weighs the objectives you hold at the end (${w.objectives}), the enemy you knocked out (${w.attrition}) and the force you brought home (${w.survival}, times how much you engaged — holding fire on the first turn earns nothing). Losses above the cap, or a low score, leave you below your ratio until you win it back.`),

    el('h3', {}, 'The Quartermaster'),
    p(`Between battles you spend. You buy formations from the library, whole or in part (${n(R.formations?.availabilityDefault)} copy of each by default), and single vehicles attached to them (bought ${R.singleVehicles?.experience || 'Regular'}). A unit's experience is chosen when it is bought, and the price follows it (${Object.entries(R.units?.experienceFactor || {}).map(([k, v]) => `${k} ${x(v)}`).join(', ')}). Leadership is drawn when the unit is paid for.`),
    p(b('Replacements:'), ` a fallen man costs ${n(R.replacement?.creditsPerMan)} cr to replace; the lightly wounded come back for free, and part of the fallen are rescued (the rescue chance chosen at creation). A destroyed vehicle comes back in its own slot, ${R.replacement?.vehicleExperience || 'Green'}, with the crew that survived, for its price; an immobilized one is repaired for free.`),
    p(b('Selling:'), ' only a whole formation pays its price back; a single unit or part of a formation leaves for nothing.'),
    p(b('The refit:'), ` between battles everything goes back to the factory — ammunition, launchers, smoke. Nothing from a battle carries over except the men and the machines themselves. A force can field up to ${n(R.fieldCap?.max)} units.`),

    el('h3', {}, 'Special Forces'),
    p(`At most ${n(R.formations?.maxSpecialForces)} special forces formation${R.formations?.maxSpecialForces === 1 ? '' : 's'} per campaign, at a fixed price (${sfOpts || '—'}, chosen at creation), every man ${R.formations?.specialForcesExperience || 'Veteran'}. They take no attached vehicle. They are the only soldiers whose weapon you can change, and each can carry one extra item (a launcher, demolition charges, a laser designator, night vision…).`),
    p(`Bought, they go through the `, b('kit-out'), `: a ${n(R.formations?.kitOut?.duration)}-minute battle of their own before the next one, where the game names the men so the Quartermaster can arm them. Nothing in the kit-out counts. The Black Market opens the weapons and kit of the other armies to them.`),

    el('h3', {}, 'Progression'),
    p(`Experience is earned by fighting. A unit that takes the field counts the battle, and a victory counts ${n(R.progression?.promotion?.victoryWorth)} battles. The next level costs:`),
    tabela(['From', 'Battles to the next level'], Object.entries(promo).map(([k, v]) => [k, v])),
    p(`Leadership rises one step for every ${n(lid.cleanBattlesPerStep)} battles a unit comes through without losses — nobody wounded or killed, its vehicle not destroyed —, up to ${lid.max || '+2'}. The clean battles add up: a battle with losses does not reset the count.`),

    el('h3', {}, 'Victory and defeat'),
    p('The level of a battle comes from the points of both sides, V = (A + 10) / (B + 10), and from the share of its own objectives the winner took:'),
    tabela(['Level', 'V at least', 'Objectives at least'], [...(R.victory?.levels || []).map((l) => [l.level, l.ratio, l.share ? pct(l.share) : '—']), ['Draw', 'below that', '—']]),
    p('A defeat at any level spends one of your allowed defeats.'),

    el('h3', {}, 'The final score'),
    p('When the campaign ends — completed or lost — it gets a final score and a rank:'),
    tabela(['Part', 'Worth'], [
      ['Battles', `${n(S.perLevel)} per level point (Total Defeat 0 … Draw 4 … Total Victory 8)`],
      ['Credits left', 'one point each'],
      ['Force preserved', `${x(S.forceShare)} the price of the units still in the field`],
      ['Casualty ratio', `enemy men lost ÷ yours, up to ${n(S.ratioCap)}, × ${n(S.perRatio)}`],
      ['Defeats', `−${n(S.perDefeat)} each`],
    ]),
    p(`The sum is multiplied by the difficulty the campaign was raised with: the armies you play, the defeats allowed, the rescue chance, the operational points at the start, the special forces price (free takes ${Math.abs(S.difficulty?.specialForces?.[0] ?? 0)} off) and the force ratio (${mults.map((m) => `${m.name} ${x(m.multiplier)}`).join(' · ')}).`),
    p(`Ranks: ${ranks.map((r) => `${r.rank} from ${n(r.min)}`).join(' · ')}. A lost campaign is always rank D, whatever its score. Finished campaigns go to the Hall of Fame on the Campaigns page.`),
  );
}

const mesmaTela = (a, b) => !!a && !!b && a.screen === b.screen && a.slug === b.slug && a.tab === b.tab;

// SAIR COM COMPRA NAO APLICADA (05/10, QA r2 A6): as compras de formacao e de dormentes do Quartermaster sao refeitas a
// cada abertura da loja; sair por qualquer caminho (aba, migalha, cabecalho, Back) pergunta antes de perde-las.
function podeSair(destino) {
  if (!VIEW || VIEW.screen !== 'campaign' || VIEW.tab !== 'quartermaster' || mesmaTela(VIEW, destino) || !SHOP_PENDING) return true;
  // so a LOJA tem o que perder (resultado lido, antes do Apply); o Quartermaster de so leitura nao pergunta (11/10)
  if (!CAMPAIGN || CAMPAIGN.stage !== 'result' || ultima(CAMPAIGN)) { SHOP_PENDING = null; return true; }
  const n = SHOP_PENDING();
  return !n || confirm(`You have ${n} purchase${n > 1 ? 's' : ''} of formations or arsenal units on this screen that are not applied yet. Leaving the Quartermaster drops them (the replacements, vehicles, weapons, training and sales you marked are kept). Leave?`);
}

async function go(v, { replace = false, topo = true } = {}) {
  if (!replace && !podeSair(v)) return;
  const depth = replace ? (VIEW?.depth ?? 0) : (VIEW ? (VIEW.depth ?? 0) + 1 : 0);
  const { reload, ...guardada } = v;
  history[replace ? 'replaceState' : 'pushState']({ ...guardada, depth }, '', hashOf(v));
  await render({ ...v, depth }, { topo: topo && !replace });
}

window.addEventListener('popstate', (e) => {
  const v = e.state || viewOfHash(location.hash) || { screen: 'start' };
  // recusou sair: a vista de onde ele tentou sair volta ao topo do historico
  if (!podeSair(v)) { history.pushState({ ...VIEW }, '', hashOf(VIEW)); return; }
  render(v, { topo: true });
});

async function render(v, { topo = false } = {}) {
  const anterior = VIEW;
  VIEW = { ...v };
  delete VIEW.reload;
  try {
    if (v.screen === 'start') show('start');
    else if (v.screen === 'about') show('about');
    else if (v.screen === 'rules') { renderRules(); show('rules'); }
    else if (v.screen === 'home') { await loadStatus(); renderHome(); }
    else if (v.screen === 'setup') { await loadStatus(); renderSetup(); }
    else if (v.screen === 'system') await renderSystem();
    // a nova campanha so existe enquanto a cesta existe: voltar a ela depois de criada (ou cancelada) leva a lista
    else if (v.screen === 'params') { if (!PARAMS) return go({ screen: 'home' }, { replace: true }); show('params'); }
    else if (v.screen === 'campaign') {
      const outra = !CAMPAIGN || CAMPAIGN.slug !== v.slug;
      if (outra || v.reload) {
        try { CAMPAIGN = await api('GET', '/api/campaigns/' + encodeURIComponent(v.slug)); } catch (e) {
          falhaVisivel(`Could not open the campaign ${v.slug}: ${e.message}.`, () => render(v));
          return go({ screen: 'home' }, { replace: true });
        }
        // O JOB QUE AINDA RODA (29/10): a pagina recarregada (F5) ou reaberta no meio de uma montagem volta a acompanha-la,
        // em vez de desenhar a tela de antes dela
        if (CAMPAIGN.activeJob && ACOMPANHANDO !== CAMPAIGN.activeJob.id) {
          const j = CAMPAIGN.activeJob; ACOMPANHANDO = j.id;
          try { await watchJob(j.id, `${j.label[0].toUpperCase()}${j.label.slice(1)} — still running`); } catch (e) { if (!e.handled) alert(e.message); return; } finally { ACOMPANHANDO = null; }
          CAMPAIGN = await api('GET', '/api/campaigns/' + encodeURIComponent(v.slug));
        }
      }
      // o que e de uma campanha nao passa para a outra
      if (outra) { FORCE_TAB = 'history'; PATH_SEL = null; PATH_MAX = false; PATH_VIEW = null; SHOP_DRAFT = null; }
      TAB = v.tab || 'menu';
      if (v.tab === 'hq' && v.sub) FORCE_TAB = v.sub;
      renderCampaign(CAMPAIGN);
      // uma aba fechada (Intel antes do Apply, por exemplo) caiu no menu: a URL diz isso
      if (TAB !== (v.tab || 'menu')) { VIEW.tab = TAB; history.replaceState({ ...VIEW }, '', hashOf(VIEW)); }
    }
  } catch (e) {
    falhaVisivel(`The app server did not answer: ${e.message}.`, () => render(v));
  } finally {
    drawNavbar();
  }
  // sub-aba do Headquarters nao rola a tela (ele estava lendo a tabela); o resto chega pelo topo
  if (topo && !(anterior && mesmaTela(anterior, VIEW) && VIEW.tab === 'hq')) aoTopo();
}

// A BARRA: "← Back" quando ha uma tela anterior no app, e as migalhas de onde se esta (cada uma leva la).
const NOMES_ABA = { menu: null, path: 'Battle Path', quartermaster: 'Quartermaster', hq: 'Headquarters', now: 'Battle', intel: 'Intel' };
const NOMES_SUB = { history: 'Battle history', personnel: 'Personnel', vehicles: 'Vehicles', kills: 'Kills' };
function drawNavbar() {
  const bar = $('#navbar');
  if (!VIEW) { bar.replaceChildren(); return; }
  const segs = [];
  const seg = (nome, destino) => segs.push({ nome, destino });
  if (VIEW.screen === 'home') seg('Campaigns');
  else if (VIEW.screen === 'about') seg('About');
  else if (VIEW.screen === 'rules') seg('Rules');
  else if (VIEW.screen === 'setup') seg('Setup');
  else if (VIEW.screen === 'system') seg('System check');
  else if (VIEW.screen === 'params') {
    seg('Campaigns', { screen: 'home' });
    seg('New campaign');
  } else if (VIEW.screen === 'campaign') {
    const base = { screen: 'campaign', slug: VIEW.slug };
    seg('Campaigns', { screen: 'home' });
    const nome = CAMPAIGN && CAMPAIGN.slug === VIEW.slug ? CAMPAIGN.name : VIEW.slug;
    seg(nome, VIEW.tab && VIEW.tab !== 'menu' ? { ...base, tab: 'menu' } : null);
    if (NOMES_ABA[VIEW.tab]) seg(VIEW.tab === 'now' && CAMPAIGN?.stage === 'over' ? 'Outcome' : NOMES_ABA[VIEW.tab], VIEW.tab === 'hq' && VIEW.sub ? { ...base, tab: 'hq', sub: 'history' } : null);
    if (VIEW.tab === 'hq' && VIEW.sub && VIEW.sub !== 'history') seg(NOMES_SUB[VIEW.sub]);
  }
  const voltar = (VIEW.depth ?? 0) > 0;
  bar.replaceChildren(
    el('button', { class: 'linky nav-back', ...(voltar ? {} : { disabled: 'disabled', title: 'Nothing to go back to' }), onclick: () => history.back() }, '← Back'),
    el('span', { class: 'nav-trail' }, segs.flatMap((x, i) => [
      i ? el('span', { class: 'nav-sep' }, '›') : null,
      x.destino && i < segs.length - 1 ? el('button', { class: 'linky nav-seg', onclick: () => go(x.destino) }, x.nome) : el('span', { class: 'nav-seg' + (i === segs.length - 1 ? ' here' : '') }, x.nome),
    ])));
}

// ---------------------------------------------------------------------------------- campaign

// abrir uma campanha cai no menu dos cinco pôsteres (E176), relida do servidor
function openCampaign(slug) { return go({ screen: 'campaign', slug, tab: 'menu', reload: true }); }

// What the battle just paid (a escada, 30/10: the command allotment, the replacement cover and the unused-cover bonus).
// The server works it out (`incomeFor`) when the result is read and again when a vehicle mark changes, and the header,
// the debrief and the quartermaster all read that same object, so they can never disagree.
function incomeOf(s) {
  if (s.pending?.result?.kitOut) return null;   // o kit-out nao conta (19/10)
  return s.pending?.result?.income || null;
}
const paidOf = (s) => incomeOf(s)?.total ?? 0;
// The sum behind "this battle paid", for the mouse-over (01/11, author): the same fields the debrief table reads.
function contaDoPago(inc) {
  const n = (x) => Math.round(x || 0).toLocaleString('en-US');
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const st = inc.step || {}, cv = inc.cover || {}, bo = inc.bonus || {};
  const nm = cv.machines?.length || 0;
  const peso = cv.bandMult && cv.bandMult !== 1 ? ` × ${cv.bandMult} (${cv.band} enemy)` : '';
  return [
    `This battle paid ${n(inc.total)} cr`,
    st.campaignOver
      ? `Command allotment ${n(st.credits)} cr — no next battle to equip for`
      : `Command allotment ${n(st.credits)} cr = battle ${st.battle}'s rung ${n(st.to)} − this one's ${n(st.from)} (paid whatever happened)`,
    `Replacement cover ${n(cv.credits)} cr = covered ${n(cv.covered)} × battle score ${pct(cv.score)}`,
    `   covered = the bill ${n(cv.bill)} (${nm} machine${nm === 1 ? '' : 's'} ${n(cv.machinesCost)} cr + ${cv.men?.toBuy || 0} men × ${n(cv.men?.perMan)} cr), up to the cap ${n(cv.cap)}`,
    `   cap ${n(cv.cap)} = ${pct(cv.capShare)} × your rung ${n(cv.rung)}${peso}`,
    `Unused-cover bonus ${n(bo.credits)} cr = ${pct(bo.share)} × unused cap ${n(bo.unused)} × battle score ${pct(bo.score)}`,
    `Total ${n(st.credits)} + ${n(cv.credits)} + ${n(bo.credits)} = ${n(inc.total)} cr`,
  ].join('\n');
}

// O KIT-OUT DA SPECIAL FORCES (19/10): 'pending' (por montar, no brief), 'play' (montado), 'result' (lido) ou null. A
// mesma conta de `campaign.kitOutStage`.
function kitDe(s) {
  if (s.stage === 'play' && s.current?.kitOut) return 'play';
  if (s.stage === 'result' && s.pending?.result?.kitOut) return 'result';
  if (s.stage === 'brief' && s.next?.kitOut === 'pending') return 'pending';
  return null;
}

function renderCampaign(s) {
  CAMPAIGN = s;
  $('#log-slug').textContent = s.slug;
  $('#camp-head').replaceChildren(
    el('h2', {}, s.name, el('span', { class: 'dim' }, ` · ${s.nation} vs ${s.enemy}`)),
    (() => {
      // With a result waiting, "credits" alone is a lie by omission: the battle has already been
      // paid, and what the player can actually spend is the two numbers added up.
      const inc = s.stage === 'result' ? incomeOf(s) : null;
      const paid = inc?.total ?? 0;
      const kit = kitDe(s);
      return el('div', { class: 'stat' },
        el('div', {}, el('b', {}, s.battleNumber), el('span', {}, kit ? `battle · kit-out ${kit === 'pending' ? 'waiting' : kit === 'play' ? 'built' : 'read'}` : 'battle')),
        el('div', {}, el('b', {}, s.credits), el('span', {}, 'credits')),
        s.coreFile ? el('div', { title: 'What your force is worth at table prices: every unit in it now, not counting the destroyed and the sold' },
          el('b', {}, `${valorDaForca(s).toLocaleString('en-US')} cr`), el('span', {}, 'force value')) : null,
        paid ? el('div', { title: contaDoPago(inc) }, el('b', { class: 'ok', 'data-paid': paid }, '+' + paid), el('span', {}, 'this battle paid')) : null,
        s.stage === 'result' && !ultima(s) && !kit ? el('div', {}, el('b', {}, s.credits + paid), el('span', {}, 'to spend')) : null,
        s.stage === 'over' && s.score ? el('div', {}, el('b', { class: 'ok' }, `${s.score.rank ? s.score.rank + ' · ' : ''}${s.score.total.toLocaleString('en-US')}`), el('span', {}, s.score.rank ? 'rank · score' : 'score')) : null,
        el('div', {}, el('b', {}, s.defeatsUnlimited ? '∞' : s.defeatsLeft), el('span', {}, 'defeats left')),
        s.path ? el('div', {}, el('b', {}, s.ops ?? 0), el('span', {}, 'operational points')) : null,
        el('div', {}, el('b', {}, s.coreFile ? (s.coreUnits ?? '?') : '—'), el('span', {}, s.coreFile ? 'core units' : 'no force yet')));
    })());

  desenharAbas(s);
  show('campaign');
  drawNavbar();
}

// O MENU DA CAMPANHA (autor, 11/10/2026, E176): cinco telas lado a lado, cada uma com o seu pôster, e navegacao livre
// entre elas. Battle Path (o caminho), Quartermaster (a forca; com um resultado, a compra e o Apply), Headquarters
// (historico, pessoal, veiculos, abates), Battle (a batalha montada; com um resultado, o debrief dela) e Intel (o tempo
// comprado para a batalha montada). As imagens sao as do lado do JOGADOR: inimigo russo -> _us, americano -> _rus.
// `TAB` e a tela aberta; 'menu' e a tela dos pôsteres. O id 'now' ficou para a Battle (era a primeira aba).
// O VALOR DA FORCA (autor, 30/10): o preco de tabela de cada unidade que esta na forca agora — presente, nem destruida
// nem vendida —, no cabecalho da campanha ao lado dos creditos.
function valorDaForca(s) {
  const fora = new Set([...(s.lost || []), ...(s.sold || []).map((x) => x.coreId)]);
  return Math.round((s.units || []).filter((u) => u.present && !fora.has(u.coreId)).reduce((a, u) => a + (u.price || 0), 0));
}
const ladoDaArte = (s) => (s.enemySide === 'RU' || (!s.enemySide && s.enemy === 'RU') ? 'us' : 'rus');
const habilitada = { ok: true };
const fechada = (why) => ({ ok: false, why });
function abasDe(s) {
  const lado = ladoDaArte(s);
  const ult = s.stage === 'result' && ultima(s);
  const r = s.pending?.result;
  const escolhido = s.path?.chosen ? s.path.nodes.find((x) => x.id === s.path.chosen) : null;
  // MISSAO > QUARTERMASTER > INTEL > BATTLE (18/10, autor): a batalha so e gerada no fim do Intel (estagio 'brief').
  const brief = s.stage === 'brief';
  // e a campanha nasce sem forca: ela e comprada no Quartermaster da batalha 1, depois do caminho
  const semForca = !s.coreFile;
  const levantar = brief && semForca;
  // O KIT-OUT (19/10): pendente, a aba Battle o oferece e o Intel continua aberto para a batalha que espera; montado ou
  // lido, o Intel espera, a Battle mostra o kit-out e o Quartermaster abre so para armas e itens
  const kit = kitDe(s);
  const kitVivo = kit === 'play' || kit === 'result';
  return [
    { id: 'hq', nome: 'Headquarters', art: `hq_${lado}`, desenha: renderHQ, enabled: habilitada, sub: `${s.history.length} battle${s.history.length === 1 ? '' : 's'} fought` },
    {
      id: 'path', nome: 'Battle Path', art: 'scout', desenha: renderPath, enabled: habilitada,
      sub: !s.path ? 'raised before the path'
        : s.stage === 'choose' ? (escolhido ? `battle 1${kindTail(escolhido.kind, ': ')} — start it here` : 'choose your first battle')
          : s.stage === 'result' && !ult && !kit ? (escolhido ? `next: battle ${escolhido.row}${kindTail(escolhido.kind, ', ')}` : 'choose the next battle')
            : `${s.ops ?? 0} operational point${s.ops === 1 ? '' : 's'}`,
      chama: !!(s.path && (s.stage === 'choose' || (s.stage === 'result' && !ult && !escolhido && !kit))),
    },
    {
      id: 'quartermaster', nome: 'Quartermaster', art: `quarter_${lado}`, desenha: s.stage === 'result' && !ult ? renderShop : levantar ? renderRaise : renderForceView,
      enabled: s.stage === 'over' ? fechada('the campaign is over') : s.stage === 'choose' && semForca ? fechada('choose the first battle on the battle path first') : habilitada,
      sub: kit === 'result' ? 'special forces: weapons and items' : s.stage === 'result' && !ult ? `${s.credits + paidOf(s)} cr to spend` : levantar ? `raise your force · ${s.credits} cr` : `${s.coreUnits ?? '?'} core units`,
      chama: kit === 'result' || (s.stage === 'result' && !ult && (!s.path || !!escolhido)) || levantar,
    },
    {
      id: 'intel', nome: 'Intel', art: `intel_${lado}`, desenha: renderIntel,
      enabled: kitVivo ? fechada('finish the kit-out first — Intel is for the battle after it') : (brief && !semForca) || s.stage === 'play' ? habilitada : fechada(s.stage === 'over' ? 'the campaign is over' : s.stage === 'choose' ? 'choose the first battle on the battle path first' : levantar ? 'raise your force in the Quartermaster first' : 'apply your forces for the next battle first'),
      // sem legenda quando aberta (autor, 16/10); antes da montagem, chama
      sub: kitVivo ? 'after the kit-out' : levantar ? 'after the Quartermaster' : kit === 'pending' ? `battle ${s.next?.n}, after the kit-out` : brief ? `prepare battle ${s.next?.n}` : s.stage === 'play' ? '' : 'after the Apply',
      chama: brief && !semForca && !kit,
    },
    {
      id: 'now', nome: s.stage === 'over' ? 'Outcome' : 'Battle', art: 'personel', desenha: kit === 'pending' ? renderKitOutPending : s.stage === 'play' ? renderPlay : s.stage === 'result' ? renderResult : renderOver,
      enabled: s.stage === 'choose' ? fechada('choose the first battle on the battle path first') : levantar ? fechada('raise your force in the Quartermaster first') : kit === 'pending' ? habilitada : brief ? fechada('prepare the battle in Intel first') : habilitada,
      sub: kit === 'pending' ? 'kit out the special forces' : kit === 'play' ? 'the kit-out is waiting' : kit === 'result' ? 'kit-out read' : s.stage === 'play' ? `battle ${s.battleNumber} is waiting` : brief ? 'after Intel' : s.stage === 'result' ? `debrief of battle ${r?.battle}` : (`${s.outcome === 'lost' ? 'campaign lost' : 'campaign completed'}${s.score ? ` · ${s.score.rank ? 'rank ' + s.score.rank + ' · ' : ''}${s.score.total.toLocaleString('en-US')}` : ''}`),
      chama: s.stage === 'play' || ult || kit === 'pending',
    },
  ];
}

// HEADQUARTERS: o que ja aconteceu, em quatro abas. O historico vem primeiro (autor, 11/10); o resto e a Forca de antes.
let FORCE_TAB = 'history';
function renderHQ(s, body) {
  const subs = [
    { id: 'history', nome: 'Battle history', desenha: (st, b) => (st.history.length ? renderHistoryTab(st, b) : b.append(el('p', { class: 'hint' }, 'No battle has been fought yet.'))) },
    { id: 'personnel', nome: 'Personnel', desenha: renderPersonnel },
    { id: 'vehicles', nome: 'Vehicles', desenha: renderVehicles },
    { id: 'kills', nome: 'Kills', desenha: renderKills },
    { id: 'parameters', nome: 'Campaign Parameters', desenha: renderParameters },
  ];
  if (!subs.some((x) => x.id === FORCE_TAB)) FORCE_TAB = 'history';
  const painel = el('div');
  // Trocar de sub-aba redesenha a tela inteira (`desenharAbas`), que e o mesmo caminho da faixa de cima — e, ao
  // contrario de `setTab`, ele nao joga a pagina para o topo.
  body.append(el('div', { class: 'tabs sub' }, subs.map((x) => el('button', {
    class: 'tab' + (x.id === FORCE_TAB ? ' on' : ''),
    onclick: () => go({ screen: 'campaign', slug: s.slug, tab: 'hq', sub: x.id }, { topo: false }),
  }, x.nome))), painel);
  subs.find((x) => x.id === FORCE_TAB).desenha(s, painel);
}

// OS PARAMETROS DA CAMPANHA (06/11, autor): sub-aba do Headquarters, so leitura — o que foi escolhido na criacao e vale
// a campanha inteira. O multiplicador do placar e a razao de forca vem do servidor (GET da campanha).
function renderParameters(s, box) {
  const R = STATUS.rules || {};
  const num = (v) => Number(v).toLocaleString('en-US');
  const razao = s.forceRatioUsed ?? s.forceRatio;
  const inicial = s.ledgerBase ?? R.startingCredits;
  const derrotas = s.defeatsUnlimited ? 'unlimited' : s.defeatsAllowed;
  const sf = s.specialForcesPrice ?? R.formations?.specialForcesPrice;
  const pontos = s.path?.startingPoints;
  const linhas = [
    ['Difficulty', s.difficulty || '—'],
    ['Your armies', (s.armies || [s.nation]).map(armyLabel).join(' + ')],
    ['Enemy', s.enemySide ? SIDE_LABELS[s.enemySide]?.label || s.enemySide : armyLabel(s.enemy)],
    ['Force ratio', razao != null ? `${razao} : 1${inicial && razao ? ` — enemy ${num(Math.round(inicial / razao))} cr in battle 1` : ''}` : '—'],
    ['Defeats allowed', derrotas == null ? '—' : `${defeatsWord(derrotas)}${s.defeatsUnlimited || s.defeatsLeft == null ? '' : ` · ${Math.max(0, s.defeatsLeft)} left`}`],
    ['Rescue chance', typeof s.rescueChance === 'number' ? `${Math.round(s.rescueChance * 100)}%` : '—'],
    ['Operational points at the start', pontos != null ? `${pontos} point${pontos === 1 ? '' : 's'}` : '—'],
    ['Special forces price', sf == null ? '—' : sf === 0 ? 'Free' : `${num(sf)} cr`],
    ['Starting credits', inicial != null ? `${num(inicial)} cr` : '—'],
    ['Battles to win', String(s.rulesUsed?.battlesToWin ?? R.battlesToWin ?? '—')],
    ['Score multiplier', s.scoreMultiplier != null ? `×${s.scoreMultiplier}` : '—'],
    ['Raised on', s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
  ];
  box.append(
    el('table', { class: 'grid' }, el('tr', {}, el('th', {}, 'Parameter'), el('th', {}, 'Value')),
      ...linhas.map(([k, v]) => el('tr', {}, el('td', {}, k), el('td', {}, v)))),
    el('p', { class: 'hint' }, 'Chosen when the campaign was raised; they hold for the whole campaign.'),
  );
}

let TAB = 'menu';
// O QUE A LOJA AINDA NAO APLICOU (05/10/2026, QA r2 A6). As marcas simples (homens, veiculos, armas, habilidades, treino,
// vendas) vivem em SHOP_DRAFT e sobrevivem a troca de aba; as compras de formacao e de dormentes sao refeitas a cada
// abertura da loja, entao sair com elas pede confirmacao em vez de perde-las calado. `SHOP_PENDING` e posto pela loja.
let SHOP_DRAFT = null;
let SHOP_PENDING = null;
function setTab(s, id) {
  const alvo = abasDe(s).find((a) => a.id === id);
  if (alvo && !alvo.enabled.ok) return;
  return go({ screen: 'campaign', slug: s.slug, tab: id, ...(id === 'hq' ? { sub: FORCE_TAB } : {}) });
}

const posterImg = (a) => el('img', { src: `art/${a.art}.jpg`, alt: '' });

// OS CINCO PÔSTERES. Desabilitado fica apagado, com o motivo na legenda e no title.
function renderMenu(s, body) {
  const abas = abasDe(s);
  body.append(el('div', { class: 'posters' }, abas.map((a) => el('button', {
    class: 'poster' + (a.enabled.ok ? '' : ' off') + (a.chama && a.enabled.ok ? ' calls' : ''),
    ...(a.enabled.ok ? {} : { disabled: 'disabled', title: a.enabled.why }),
    onclick: () => setTab(s, a.id),
  }, el('div', { class: 'poster-frame' }, posterImg(a)),
  el('div', { class: 'poster-caption' }, el('b', {}, a.nome), el('span', {}, a.enabled.ok ? a.sub : a.enabled.why))))));
}

function desenharAbas(s) {
  const abas = abasDe(s);
  const atual = abas.find((a) => a.id === TAB && a.enabled.ok);
  if (!atual) TAB = 'menu';
  const body = $('#camp-body');
  if (TAB === 'menu') { body.replaceChildren(); renderMenu(s, body); return; }
  // a faixa: os cinco pôsteres em miniatura e a volta ao menu, no topo de toda tela
  body.replaceChildren(el('div', { class: 'tabs posters-strip' },
    el('button', { class: 'tab strip-menu', onclick: () => setTab(s, 'menu') }, '☰ Menu'),
    abas.map((a) => el('button', {
      class: 'tab strip-item' + (a.id === TAB ? ' on' : '') + (a.enabled.ok ? '' : ' off') + (a.chama && a.enabled.ok && a.id !== TAB ? ' calls' : ''),
      ...(a.enabled.ok ? {} : { disabled: 'disabled', title: a.enabled.why }),
      onclick: () => setTab(s, a.id),
    }, posterImg(a), el('span', {}, a.nome),
    // o pôster inteiro, que cresce da miniatura quando o mouse passa (autor, 11/10): o mesmo do menu
    el('div', { class: 'strip-pop' + (a.enabled.ok ? '' : ' off') + (a.chama && a.enabled.ok ? ' calls' : ''), 'aria-hidden': 'true' },
      el('div', { class: 'poster-frame' }, posterImg(a)),
      el('div', { class: 'poster-caption' }, el('b', {}, a.nome), el('span', {}, a.enabled.ok ? a.sub : a.enabled.why)))))));
  const painel = el('div', { class: 'tab-body' });
  body.append(painel);
  atual.desenha(s, painel);
}

// ------------------------------------------------------------------------- o caminho de batalhas (E176)
//
// A ARVORE, de baixo (o Start, batalha 1) para cima (a batalha 12): uma linha por batalha, as faixas do fundo sao os
// tiers. A rota jogada e o no atual em latao; os nos que seguem o atual sao os unicos que se revelam e se escolhem.
// Os segredos (mapa, inimigo) so aparecem no que o servidor mandou revelado — a pagina nunca os tem antes.
let PATH_SEL = null;
// 18/10 (autor): os nos cresceram para caber todos os modificadores — os chips em duas linhas (economia; condicoes)
const PATH_COL_W = 208, PATH_ROW_H = 126, PATH_NODE_W = 184, PATH_NODE_H = 102, PATH_PAD = 18, PATH_LABEL_W = 132;
// a largura do painel de detalhe que flutua a direita do quadro, mais a margem: o recenter centra o no fora dele
const PATH_DETAIL_W = 360;
const revealCostOf = (what, rv) => {
  const c = (STATUS.rules.path && STATUS.rules.path.reveal) || { map: 1, full: 2 };
  if (what === 'map') return rv.map ? 0 : c.map;
  return rv.full ? 0 : c.full;
};
// A BATALHA QUE ESPERA (24/10): o no dela esta na rota, e o no da rota vem inteiro no estado. Ate ser lutada, a tela so
// mostra o inimigo que foi pago (na Intel); depois de lida, tudo.
const inimigoEscondido = (s, n) => !!s.path && n.id === s.path.at && (s.stage === 'brief' || s.stage === 'play') && !((n.revealed || {}).paid || {}).full;
const multLabel = (m) => (m === 1 || m == null ? 'standard replacement cover' : `${m > 1 ? '+' : '−'}${Math.round(Math.abs(m - 1) * 100)}% replacement cover`);

function renderPath(s, body) {
  if (!s.path) {
    body.append(el('h3', {}, 'Battle path'), el('p', { class: 'hint' }, 'This campaign was raised before the battle path existed: its battles come one after the other, each drawn when the one before is applied.'));
    return;
  }
  const P = s.path;
  const byId = new Map(P.nodes.map((n) => [n.id, n]));
  const atual = byId.get(P.at);
  const filhos = new Set(s.stage === 'over' ? [] : atual?.edges || []);
  const rota = new Set(P.route);
  const podeEscolher = s.stage === 'choose' || (s.stage === 'result' && !ultima(s));
  if (!PATH_SEL || !byId.has(PATH_SEL)) PATH_SEL = P.chosen || [...filhos][0] || P.at;
  const rows = P.rows || 12, cols = P.columns || 4;
  // linhas 0 (o Start) a `rows`
  const W = PATH_LABEL_W + cols * PATH_COL_W + PATH_PAD * 2, H = (rows + 1) * PATH_ROW_H + PATH_PAD * 2;
  const pos = (n) => ({ x: PATH_LABEL_W + PATH_PAD + n.col * PATH_COL_W + (PATH_COL_W - PATH_NODE_W) / 2, y: PATH_PAD + (rows - n.row) * PATH_ROW_H + (PATH_ROW_H - PATH_NODE_H) / 2 });

  const head = el('div', { class: 'path-head' },
    el('h3', {}, 'Battle path'),
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, s.ops ?? 0), el('span', {}, 'operational points')),
      el('div', {}, el('b', {}, `${P.route.length - 1} / ${rows}`), el('span', {}, 'battles on the road')),
      P.chosen ? el('div', {}, el('b', { class: 'ok' }, `B${byId.get(P.chosen).row}`), el('span', {}, 'chosen next')) : null),
    el('p', { class: 'hint' }, s.stage === 'choose'
      ? (P.chosen ? 'Your first battle is chosen. Start the campaign from its panel — you can still change it until then.' : 'Choose your first battle among the ones on the first row (dashed). Scout them first if you have points.')
      : podeEscolher
      ? (P.chosen ? 'The next battle is chosen. You can still change it until you apply at the quartermaster.' : 'Choose the next battle among the ones that follow yours (dashed). Scout them first if you have points.')
      : s.stage === 'play' ? 'Your current battle is in brass. The ones that follow it can be scouted now; you choose after the battle is read.' : 'The road you took.'));

  // o desenho: faixas de tier, arestas em SVG, nos em HTML por cima
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'path-svg'); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const tiers = (STATUS.rules.tiers || []);
  tiers.forEach((t, i) => {
    const r0 = Math.min(...t.battles), r1 = Math.max(...t.battles);
    const y = PATH_PAD + (rows - r1) * PATH_ROW_H;
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('x', 0); rect.setAttribute('y', y); rect.setAttribute('width', W); rect.setAttribute('height', (r1 - r0 + 1) * PATH_ROW_H);
    rect.setAttribute('class', 'path-band' + (i % 2 ? ' alt' : ''));
    svg.append(rect);
  });
  for (const n of P.nodes) {
    for (const e of n.edges) {
      const m = byId.get(e); if (!m) continue;
      const a = pos(n), b = pos(m);
      const x1 = a.x + PATH_NODE_W / 2, y1 = a.y, x2 = b.x + PATH_NODE_W / 2, y2 = b.y + PATH_NODE_H;
      const p = document.createElementNS(svg.namespaceURI, 'path');
      const mid = (y1 + y2) / 2;
      p.setAttribute('d', `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`);
      const naRota = rota.has(n.id) && rota.has(e) && P.route.indexOf(e) === P.route.indexOf(n.id) + 1;
      const proxima = n.id === P.at && filhos.has(e);
      p.setAttribute('class', 'path-edge' + (naRota ? ' route' : proxima ? (e === P.chosen ? ' chosen' : ' next') : ''));
      svg.append(p);
    }
  }
  const camada = el('div', { class: 'path-world', style: `width:${W}px;height:${H}px` }, svg);
  tiers.forEach((t) => {
    const r1 = Math.max(...t.battles);
    camada.append(el('div', { class: 'path-tier', style: `top:${PATH_PAD + (rows - r1) * PATH_ROW_H + 6}px;left:8px;width:${PATH_LABEL_W - 16}px` },
      el('b', {}, `Tier ${t.tier}`), el('span', {}, `battles ${Math.min(...t.battles)}–${Math.max(...t.battles)}`), el('span', {}, `${t.duration}′ · ${t.experience}`)));
  });
  for (const n of P.nodes) {
    const p = pos(n);
    const cls = ['path-node'];
    if (rota.has(n.id)) cls.push('played');
    if (n.id === P.at) cls.push('current');
    if (filhos.has(n.id)) cls.push('next');
    if (n.id === P.chosen) cls.push('chosen');
    if (n.id === PATH_SEL) cls.push('sel');
    const rv = n.revealed || {};
    const mapa = n.map ? `${n.map.name.replace(/\s*\(.*$/, '')}${n.map.profile ? ' · ' + profileWord(n.map.profile) : ''}` : (rota.has(n.id) ? '' : 'map ?');
    const inimigo = inimigoEscondido(s, n) ? 'enemy ?' : n.enemy && n.enemy.units != null ? `${n.enemy.units} units${n.band ? ' · ' + n.band : ''}` : n.enemy ? `${n.enemy.formations.length} formation${n.enemy.formations.length === 1 ? '' : 's'}` : (rota.has(n.id) ? '' : 'enemy ?');
    camada.append(el('button', {
      class: cls.join(' '), style: `left:${p.x}px;top:${p.y}px;width:${PATH_NODE_W}px;height:${PATH_NODE_H}px`,
      title: `Battle ${n.row}${kindTail(n.kind, ' · ')}`,
      onclick: () => { PATH_SEL = n.id; desenharAbas(s); },
    },
    el('div', { class: 'pn-top' }, el('b', {}, n.id === 'start' ? 'Start' : `B${n.row}`), el('span', {}, n.id === 'start' ? '' : kindLabel(n.kind) || 'Attack')),
    // linha 1, a economia: o que a batalha paga
    el('div', { class: 'pn-chips' },
      // 18/10: o peso do inimigo; 30/10 (a escada): o multiplicador age so no teto da cobertura de reposicao
      n.rewardMult && n.rewardMult !== 1 ? el('span', { class: 'chip ' + (n.rewardMult > 1 ? 'ok' : 'no'), title: n.rewardMult > 1 ? 'Heavier enemy, bigger replacement-cover cap' : 'Lighter enemy, smaller replacement-cover cap' }, `${n.rewardMult > 1 ? '+' : '−'}${Math.round(Math.abs(n.rewardMult - 1) * 100)}% cover · ${n.rewardMult > 1 ? 'heavy' : 'light'}`) : null,
      n.ops ? el('span', { class: 'chip ops' }, `★${n.ops}`) : null),
    // linha 2, as condicoes da batalha
    el('div', { class: 'pn-chips' },
      // a guerra eletronica do inimigo e publica (17/10); riscada quando o counter foi pago
      n.ew && n.ew !== 'None' ? el('span', { class: 'chip ew' + (n.ewCountered ? ' countered' : ''), title: n.ewCountered ? 'Enemy EW countered' : 'Enemy electronic warfare' }, `EW ${n.ew}`) : null,
      // a hora da batalha (17/10), sempre visivel
      n.time ? el('span', { class: `chip time ${n.time.period}`, title: `H-hour ${horaDe(n.time)} — ${n.time.name}${n.date ? ` · ${n.date.label}` : ''}` }, `${ICONE_PERIODO[n.time.period] || ''}${horaDe(n.time)}`) : null,
      // o clima (17/10): so quando nao e o dia claro de verao, para o cartao nao encher
      n.weather && n.weather.id !== 'clear' ? el('span', { class: 'chip weather', title: n.weather.label }, ICONE_CLIMA[n.weather.id] || '☁') : null),
    el('div', { class: 'pn-secret' + (rv.map || rota.has(n.id) ? '' : ' hidden-secret') }, mapa),
    el('div', { class: 'pn-secret' + (n.enemy ? '' : ' hidden-secret') }, inimigo)));
  }

  // A NAVEGACAO DO ORGANOGRAMA (autor, 11/10): arrastar move, a roda aproxima, "recenter" volta ao no atual. A vista fica
  // guardada por campanha, entao clicar num no (que redesenha a tela) nao perde o lugar. O painel do no flutua no quadro.
  const det = el('div', { class: 'path-detail' });
  pathDetail(s, det, byId.get(PATH_SEL), { filhos, rota, podeEscolher });
  camada.classList.add('canvas-world');
  const pane = el('div', { class: 'path-pane canvas-pane' + (PATH_MAX ? ' max' : '') }, camada, det);
  const atualNo = byId.get(P.at);
  const centrar = () => {
    const z = 1, a = pos(atualNo);
    // o no atual no meio da area livre a esquerda do painel de detalhe, para ele e os filhos nao ficarem atras do painel
    const livre = Math.max(PATH_NODE_W * 2, pane.clientWidth - PATH_DETAIL_W);
    return { slug: s.slug + '#' + P.at, z, x: Math.round(livre / 2 - (a.x + PATH_NODE_W / 2) * z), y: Math.round(pane.clientHeight * 0.62 - a.y * z) };
  };
  const aplicar = () => { camada.style.transform = `translate(${PATH_VIEW.x}px, ${PATH_VIEW.y}px) scale(${PATH_VIEW.z})`; };
  // maximizar: o quadro toma a janela inteira, como o organograma; Esc volta (autor, 11/10)
  const alternar = () => { PATH_MAX = !PATH_MAX; PATH_VIEW = null; desenharAbas(s); };
  pane.append(el('div', { class: 'canvas-tools' },
    el('button', { class: 'tool-btn', title: PATH_MAX ? 'Back to the page (Esc)' : 'Fill the window', onclick: alternar }, PATH_MAX ? '⤡ minimize' : '⤢ maximize'),
    el('button', { class: 'tool-btn', title: 'Back to your current battle', onclick: () => { PATH_VIEW = centrar(); aplicar(); } }, '⤾ recenter')));
  if (PATH_ESC) document.removeEventListener('keydown', PATH_ESC);
  PATH_ESC = (e) => { if (e.key === 'Escape' && PATH_MAX && document.body.contains(pane)) alternar(); };
  document.addEventListener('keydown', PATH_ESC);
  let drag = null;
  pane.addEventListener('mousedown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest('.path-node, .path-detail, .canvas-tools')) return;
    drag = { x: e.clientX - PATH_VIEW.x, y: e.clientY - PATH_VIEW.y };
    pane.classList.add('grabbing');
    e.preventDefault();
  });
  pane.addEventListener('mousemove', (e) => { if (!drag) return; PATH_VIEW.x = e.clientX - drag.x; PATH_VIEW.y = e.clientY - drag.y; aplicar(); });
  const parar = () => { drag = null; pane.classList.remove('grabbing'); };
  pane.addEventListener('mouseup', parar);
  pane.addEventListener('mouseleave', parar);
  pane.addEventListener('wheel', (e) => {
    if (e.target.closest('.path-detail')) return;      // o painel rola o proprio texto
    e.preventDefault();
    const r = pane.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.round(Math.min(1.6, Math.max(0.4, PATH_VIEW.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) * 100) / 100;
    // aproxima em torno do cursor
    PATH_VIEW.x = mx - ((mx - PATH_VIEW.x) * z) / PATH_VIEW.z; PATH_VIEW.y = my - ((my - PATH_VIEW.y) * z) / PATH_VIEW.z; PATH_VIEW.z = z;
    aplicar();
  }, { passive: false });
  body.append(head, pane);
  // a rolagem do painel guardada por escolher/revelar/counter (24/10), so para o mesmo no
  if (PATH_DETAIL_SCROLL) {
    const r = PATH_DETAIL_SCROLL; PATH_DETAIL_SCROLL = null;
    if (r.sel === PATH_SEL) { det.scrollTop = r.top; if (window.scrollY !== r.y) window.scrollTo(window.scrollX, r.y); }
  }
  requestAnimationFrame(() => { if (!PATH_VIEW || PATH_VIEW.slug !== s.slug + '#' + P.at) PATH_VIEW = centrar(); aplicar(); });
}
let PATH_VIEW = null;
let PATH_MAX = false, PATH_ESC = null;

// A HORA DA BATALHA (17/10): o periodo e a hora cheia sorteados no no
const ICONE_PERIODO = { dawn: '◐ ', day: '☀ ', dusk: '◑ ', night: '☾ ' };
const horaDe = (t) => `${String(t.hour).padStart(2, '0')}:00`;
// O CLIMA (17/10): um icone por perfil de rules.battle.weather
const ICONE_CLIMA = { clear: '☀', 'heat-haze': '🌡', 'hot-dry': '🔥', 'thick-haze': '🌫', overcast: '☁', 'light-rain': '🌦', 'heavy-rain': '🌧', storm: '⛈', mist: '🌫', fog: '🌁', 'dense-fog': '🌁' };

// O BALANCO DO NO (18/10): a conta de beneficios e dificuldades, para o autor calibrar e o jogador pesar a escolha.
function balancoDoNo(n) {
  const B = (STATUS.rules.path || {}).balance;
  if (!B || !B.on || !n.balance || n.id === 'start') return el('span');
  const ramos = Math.max(0, (n.edges || []).length - 1);
  const ruins = (B.badLight || {})[n.kind === 'Meet' ? 'Meet' : 'defense'] || [];
  const bom = [ramos ? `${ramos + 1} branches` : null, n.ops ? `${n.ops} point${n.ops === 1 ? '' : 's'}` : null, n.band === 'light' ? 'lighter enemy' : null].filter(Boolean);
  const ruim = [n.band === 'heavy' ? 'heavier enemy' : null, n.ew && n.ew !== 'None' ? `EW ${n.ew}` : null,
    n.time && ruins.includes(n.time.period) ? String(n.time.name || n.time.period).toLowerCase() : null,
    n.weather && (B.extremeTemps || []).includes(n.weather.temp) ? 'extreme temperature' : null].filter(Boolean);
  return el('p', { class: 'hint' }, `Balance: ${n.balance.benefits} benefit${n.balance.benefits === 1 ? '' : 's'}${bom.length ? ` (${bom.join(', ')})` : ''} · ${n.balance.difficulties} difficult${n.balance.difficulties === 1 ? 'y' : 'ies'}${ruim.length ? ` (${ruim.join(', ')})` : ''}`);
}

function pathDetail(s, box, n, { filhos, rota, podeEscolher }) {
  if (!n) return;
  const tier = (STATUS.rules.tiers || []).find((t) => t.battles.includes(n.row)) || {};
  const rv = n.revealed || {};
  const historico = (s.history || []).find((h) => h.node === n.id);
  const jogavel = filhos.has(n.id);
  const pontos = s.ops ?? 0;
  const botaoRevelar = (what, rotulo) => {
    const custo = revealCostOf(what, rv);
    if (!custo) return null;
    const falta = custo > pontos;
    return el('button', {
      ...(falta ? { disabled: 'disabled', title: `Needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${pontos}` } : {}),
      onclick: () => revealOnPath(s, n, what, rotulo, custo),
    }, `${rotulo} · ${custo} pt${custo === 1 ? '' : 's'}`);
  };
  box.append(
    el('h3', {}, n.id === 'start' ? 'Start — the road begins here' : `Battle ${n.row}${kindTail(n.kind, ' — ')}`),
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, `T${tier.tier ?? '?'}`), el('span', {}, `${tier.duration ?? '?'}′ base · ${tier.experience || ''}`)),
      el('div', {}, el('b', { class: n.rewardMult > 1 ? 'ok' : n.rewardMult < 1 ? 'no' : '' }, n.rewardMult && n.rewardMult !== 1 ? `${n.rewardMult > 1 ? '+' : '−'}${Math.round(Math.abs(n.rewardMult - 1) * 100)}%` : '—'), el('span', {}, n.band === 'heavy' ? `heavier enemy, ${multLabel(n.rewardMult)}` : n.band === 'light' ? `lighter enemy, ${multLabel(n.rewardMult)}` : multLabel(n.rewardMult))),
      el('div', {}, el('b', { class: n.ops ? 'ok' : '' }, n.ops || 0), el('span', {}, 'operational points paid'))),
    balancoDoNo(n),
    historico ? el('p', { class: 'hint' }, `Fought: ${historico.level}${historico.map ? ' on ' + historico.map : ''}.`) : el('span'),
    rota.has(n.id) && n.id === s.path.at && !historico ? el('p', { class: 'hint' }, s.stage === 'play' ? 'This is the battle waiting to be played.' : 'This is the battle just fought.') : el('span'));

  box.append(el('h4', {}, 'Battlefield'));
  if (n.map) {
    box.append(el('p', {}, el('b', {}, n.map.name), el('br'), el('span', { class: 'hint' }, `${profileWord(n.map.profile)} · ${n.map.width}×${n.map.height} m · ${n.map.area} km² · map tier ${n.map.tier}`)),
      mapThumb(s, n.id, n.map.name));
  } else box.append(el('p', { class: 'hint' }, 'Unknown.'));
  if (n.time || n.date) {
    box.append(el('p', {},
      n.date ? el('span', {}, 'Date: ', el('b', {}, n.date.label), n.time ? ' · ' : '') : null,
      n.time ? el('span', {}, 'H-hour: ', el('b', {}, `${ICONE_PERIODO[n.time.period] || ''}${horaDe(n.time)}`), el('span', { class: 'hint' }, ` — ${String(n.time.name).toLowerCase()}`)) : null));
  }
  if (n.weather) box.append(el('p', {}, 'Weather: ', el('b', {}, `${ICONE_CLIMA[n.weather.id] || ''} ${n.weather.name}`), el('span', { class: 'hint' }, ` — ${n.weather.label}`)));

  box.append(el('h4', {}, 'Enemy'));
  // 24/10 (autor): a batalha que espera (brief/play) esta na rota e o estado a traz inteira; sem pagar na Intel, a tela nao a mostra
  if (inimigoEscondido(s, n)) box.append(el('p', { class: 'hint' }, s.stage === 'brief' ? 'Unknown — reveal it in Intel (2 operational points), before the battle is prepared.' : 'Unknown.'));
  else if (n.enemy) {
    box.append(el('p', {}, ...n.enemy.formations.map((f, i) => el('span', {}, `${i ? ' · ' : ''}${f.n > 1 ? f.n + ' × ' : ''}${f.name}`))));
    if (n.enemy.units != null) {
      box.append(
        el('p', {}, el('b', {}, `${n.enemy.units} units`), ` (${n.enemy.offMap} off-map) · ${n.enemy.experience}`),
        el('p', { class: 'hint' }, (n.enemy.kept || []).map((k) => `${k.n} × ${k.name}`).join('  ·  ')));
    }
  } else box.append(el('p', { class: 'hint' }, 'Unknown.'));
  // A GUERRA ELETRONICA DO INIMIGO (17/10): sempre visivel; o counter anula e custa o nivel
  const ewCfg = STATUS.rules.ew || {};
  if (ewCfg.on && n.id !== 'start') {
    box.append(el('p', {}, 'Electronic warfare: ', n.ew && n.ew !== 'None'
      ? el('b', { class: n.ewCountered ? 'ok' : 'no' }, n.ewCountered ? `${n.ew} — countered` : n.ew)
      : el('span', { class: 'hint' }, 'none')));
  }
  const botaoCounter = () => {
    if (!ewCfg.on || !n.ew || n.ew === 'None' || n.ewCountered) return null;
    const custo = (ewCfg.counter || {})[n.ew] || 0;
    const falta = custo > pontos;
    return el('button', {
      ...(falta ? { disabled: 'disabled', title: `Needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${pontos}` } : {}),
      onclick: () => counterOnPath(s, n, custo),
    }, `Counter the enemy EW · ${custo} pt${custo === 1 ? '' : 's'}`);
  };

  if (jogavel) {
    // 24/10 (autor): no caminho so o mapa; o inimigo inteiro se revela na Intel, pela batalha escolhida
    const acoes = [botaoRevelar('map', 'Reveal the map'), botaoCounter()].filter(Boolean);
    if (acoes.length) box.append(el('div', { class: 'path-actions' }, acoes));
    if (podeEscolher) {
      box.append(el('p', {}, s.path.chosen === n.id
        ? (s.stage === 'choose'
          ? el('span', {}, el('b', { class: 'ok' }, '✓ Chosen. '), el('button', { class: 'primary', onclick: () => startOnPath(s) }, 'Start the campaign with battle 1 →'))
          : el('span', {}, el('b', { class: 'ok' }, '✓ Chosen. '), el('button', { class: 'primary', onclick: () => setTab(s, 'quartermaster') }, 'Go to the quartermaster →')))
        : el('button', { class: 'primary', onclick: () => chooseOnPath(s, n) }, `Choose battle ${n.row}`)));
    } else if (s.stage === 'play') box.append(el('p', { class: 'hint' }, 'You choose the next battle once this one is read.'));
  } else if (!rota.has(n.id) && s.stage !== 'over') {
    box.append(el('p', { class: 'hint' }, 'Only the battles that follow yours can be scouted or chosen.'));
  }
}

async function revealOnPath(s, n, what, rotulo, custo) {
  if (!confirm(`${rotulo} of battle ${n.row} for ${custo} operational point${custo === 1 ? '' : 's'}?\n\nWhat is revealed stays revealed, even if a battle is undone.`)) return;
  try {
    const st = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/path/reveal`, { node: n.id, what });
    guardarRolagemDoNo();
    renderCampaign(st);
  } catch (e) { alert(e.message); }
}

async function counterOnPath(s, n, custo) {
  if (!confirm(`Counter the enemy electronic warfare (${n.ew}) of battle ${n.row} for ${custo} operational point${custo === 1 ? '' : 's'}?\n\nThe battle is built without it. The counter stays, even if a battle is undone.`)) return;
  try {
    const st = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/path/counter`, { node: n.id });
    guardarRolagemDoNo();
    renderCampaign(st);
  } catch (e) { alert(e.message); }
}

// A BATALHA 1 (E176): montada so agora, com o .cam; a Battle abre com os passos para joga-la.
async function startOnPath(s) {
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/path/start`);
    const st = await watchJob(job, 'Starting the campaign');
    await loadStatus();
    CAMPAIGN = st;
    await go({ screen: 'campaign', slug: s.slug, tab: st.stage === 'brief' ? (st.coreFile ? 'intel' : 'quartermaster') : 'now' });
  } catch (e) { if (!e.handled) alert(e.message); }
}

// A ROLAGEM DO PAINEL DO NO (autor, 24/10): escolher, revelar e o counter redesenham a aba e o painel nascia no topo.
// Guardada antes do redesenho e devolvida por `renderPath` se o no selecionado for o mesmo (clicar outro no abre no topo).
let PATH_DETAIL_SCROLL = null;
const guardarRolagemDoNo = () => { PATH_DETAIL_SCROLL = { sel: PATH_SEL, top: document.querySelector('.path-detail')?.scrollTop || 0, y: window.scrollY }; };

async function chooseOnPath(s, n) {
  try {
    const st = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/path/choose`, { node: n.id });
    guardarRolagemDoNo();
    renderCampaign(st);
  } catch (e) { alert(e.message); }
}

// ------------------------------------------------------------------------- o mapa (E178)
//
// A IMAGEM DO CAMPO DE BATALHA, de cima, norte para cima: o terreno e, por cima, as zonas de setup (vermelho = a sua,
// azul = a do defensor). A pagina pede pelo no (ou 'current', a batalha montada) e o servidor so entrega o de um no
// revelado ou jogado: o nome do mapa nao e o que da acesso a imagem.
// O endereco muda quando o mapa muda (11/10): 'current' e o mesmo nome para toda batalha montada, e o navegador guarda a
// imagem — a batalha 4 mostrava o mapa da 3. A versao e o mapa da batalha montada (ou o do no) e a hora em que foi montada.
const mapVersion = (s, which) => {
  if (which === 'current') return `${s.current?.n ?? ''}-${s.current?.map?.file ?? ''}-${s.current?.generatedAt ?? ''}`;
  const no = (s.path?.nodes || []).find((x) => x.id === which);
  return no?.map?.name || which;
};
const mapUrl = (s, which, layer) => `/api/campaigns/${encodeURIComponent(s.slug)}/map/${encodeURIComponent(which)}/${layer}.png?v=${encodeURIComponent(mapVersion(s, which))}`;
function mapThumb(s, which, nome, { side = false } = {}) {
  const fig = el('button', { class: 'map-thumb' + (side ? ' side' : ''), title: 'Open the map', onclick: () => openMapView(s, which, nome) },
    el('img', { src: mapUrl(s, which, 'terrain'), alt: '', loading: 'lazy' }),
    el('img', { class: 'zones', src: mapUrl(s, which, 'zones'), alt: '', loading: 'lazy' }),
    el('span', { class: 'map-thumb-hint' }, '⤢ open the map'));
  fig.querySelector('img').addEventListener('error', () => fig.replaceChildren(el('span', { class: 'hint' }, 'No picture of this map.')));
  return fig;
}
let MAPVIEW = null;
function closeMapView() { if (MAPVIEW) { MAPVIEW.hidden = true; MAPVIEW.replaceChildren(); } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && MAPVIEW && !MAPVIEW.hidden) closeMapView(); });
function openMapView(s, which, nome) {
  const host = MAPVIEW || (MAPVIEW = document.body.appendChild(el('div', { id: 'mapview', class: 'viewer mapview' })));
  // 'fit' cabe o mapa inteiro na janela (o padrao); os numeros sao multiplos do tamanho natural, 4 m por pixel
  let zoom = 'fit', zonas = true;
  const terreno = el('img', { src: mapUrl(s, which, 'terrain'), alt: '' });
  const camada = el('img', { class: 'zones', src: mapUrl(s, which, 'zones'), alt: '' });
  const pilha = el('div', { class: 'mapview-stack' }, terreno, camada);
  const aplicar = () => {
    const w = terreno.naturalWidth || 0, h = terreno.naturalHeight || 0;
    const area = host.querySelector('.mapview-area');
    const cabe = area && w && h ? Math.min((area.clientWidth - 36) / w, (area.clientHeight - 36) / h) : 1;
    if (w) for (const i of [terreno, camada]) i.style.width = `${Math.round(w * (zoom === 'fit' ? cabe : zoom))}px`;
    camada.hidden = !zonas;
  };
  terreno.addEventListener('load', aplicar);
  const sel = el('select', { onchange: (e) => { zoom = e.target.value === 'fit' ? 'fit' : Number(e.target.value); aplicar(); } },
    ['fit', 1, 2, 3, 4].map((z) => el('option', { value: z, ...(z === zoom ? { selected: 'selected' } : {}) }, z === 'fit' ? 'fit the window' : `${z}×`)));
  const cb = el('input', { type: 'checkbox', checked: 'checked', onchange: (e) => { zonas = e.target.checked; aplicar(); } });
  host.hidden = false;
  host.replaceChildren(
    el('div', { class: 'viewer-head' },
      el('strong', {}, nome || 'The battlefield'),
      el('span', { class: 'hint' }, 'north is up · 1× = 4 m per pixel · ', el('span', { class: 'legend red' }, 'your setup zone'), ' · ', el('span', { class: 'legend blue' }, 'the defender\'s')),
      el('label', { class: 'row' }, 'Zoom ', sel),
      el('label', { class: 'row' }, cb, ' setup zones'),
      el('button', { class: 'linky', onclick: closeMapView }, '✕ close')),
    el('div', { class: 'mapview-area' }, pilha));
  aplicar();
}

// ------------------------------------------------------------------------- intel (E176)
//
// O TEMPO COMPRADO para a batalha ja montada: a batalha e remontada (mesmo mapa, mesmo inimigo) com o relogio novo, e
// o app entrega um save novo. Mostra o degrau que o editor oferece de verdade, que pode ser menos que o pago.
function snapClock(base, extra) {
  const allowed = STATUS.rules.duration.allowed;
  const querido = Math.min(base + extra, allowed[allowed.length - 1]);
  return allowed.reduce((best, v) => (Math.abs(v - querido) < Math.abs(best - querido) ? v : best), allowed[0]);
}

// A BATALHA QUE O INTEL ATENDE (18/10): a montada (play) ou a que vai ser gerada (brief), esta descrita pela previa do
// servidor e pelo que ja foi comprado para ela.
function intelCurrent(s) {
  if (s.stage !== 'brief' || !s.next) return s.current;
  const p = s.next.preview || {}; const n = s.next.n;
  const ap = ((s.abilities || {}).applied || []).filter((a) => a.battle === n);
  const lista = ((STATUS.rules.abilities || {}).list) || [];
  const minutos = ap.reduce((a, x) => a + (((lista.find((l) => l.id === x.id) || {}).effect || {}).minutes || 0), 0);
  const base = p.clockBase ?? null;
  const duration = base == null ? null : snapClock(base, minutos);
  const niveis = ((STATUS.rules.ew || {}).levels) || ['None', 'Light', 'Medium', 'Strong'];
  const own = ap.filter((a) => a.id === 'own-ew').reduce((m, a) => (niveis.indexOf(a.level) > niveis.indexOf(m) ? a.level : m), 'None');
  const luz = ap.filter((a) => a.id === 'relight').at(-1);
  return {
    n, brief: true, map: p.map, duration, clock: { base, extra: duration == null ? 0 : duration - base },
    time: luz ? { period: luz.period, name: luz.name, daylight: luz.daylight, hour: luz.hour, minutes: luz.minutes } : p.time, date: p.date, weather: p.weather,
    ew: { enemy: p.ew?.enemy || 'None', countered: !!p.ew?.countered, own },
    intelStrength: ap.filter((a) => a.id === 'enemy-intel').reduce((m, a) => Math.max(m, a.strength || 0), 0),
  };
}
const REBUILD_OR_BRIEF = (c, oQue) => (c.brief ? `Bought for battle ${c.n}: it is built with ${oQue}.` : `Buying rebuilds this battle with ${oQue} — same map, same enemy — and hands you a new save to load.`);

function renderIntel(s, body) {
  const c = intelCurrent(s);
  const lista = (((STATUS.rules.abilities || {}).list) || []).filter((a) => !a.retired && a.effect && a.effect.minutes && !a.effect.noRefit);
  const aplicadas = ((s.abilities || {}).applied || []).filter((a) => a.battle === c.n && a.id !== 'enemy-intel' && a.id !== 'own-ew' && a.id !== 'relight');
  const conta = (id) => aplicadas.filter((a) => a.id === id).length;
  const base = (c.clock && c.clock.base) || c.duration;
  const semBase = base == null;
  const jaComprado = aplicadas.reduce((a, x) => a + (((lista.find((l) => l.id === x.id) || {}).effect || {}).minutes || 0), 0);
  // O PREPARO NO TOPO (autor, 24/10): gerar a batalha, uma vez, com tudo o que for comprado nesta pagina (ou voltar atras)
  const preparo = !c.brief ? [] : s.next?.kitOut === 'pending'
    // a Special Forces recem-comprada passa pelo kit-out antes (19/10); o que se compra aqui fica para a batalha
    ? [el('div', { class: 'prepare-bar' },
      el('button', { class: 'primary', onclick: () => setTab(s, 'now') }, 'Kit out the special forces first →'),
      undoButton(s)),
    el('p', { class: 'hint' }, `Battle ${c.n} waits for the kit-out of your new special forces (Battle tab). What you buy here is kept for battle ${c.n}.`)]
    : [el('div', { class: 'prepare-bar' },
      el('button', { class: 'primary', onclick: () => prepareUI(s) }, `Prepare battle ${c.n} →`),
      undoButton(s)),
    el('p', { class: 'hint' }, 'The battle is built once, with everything bought on this page. You can still buy map abilities afterwards, but then the battle is rebuilt.')];
  body.append(
    el('h3', {}, c.brief ? `Intel — battle ${c.n} (not built yet)` : `Intel — battle ${c.n}`),
    ...(c.brief ? [el('p', { class: 'hint' }, `${c.map ? `${c.map.name}${kindTail(c.map.kind, ', ')}` : 'The map'}${c.date ? ` · ${c.date.label}` : ''}${c.time ? ` · H-hour ${horaDe(c.time)}` : ''}${c.weather ? ` · ${c.weather.name}` : ''}${c.ew.enemy !== 'None' ? ` · enemy EW ${c.ew.enemy}${c.ew.countered ? ' (countered)' : ''}` : ''}. Buy what you need below, then prepare the battle.`)] : []),
    ...preparo,
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, semBase ? '?' : c.duration + '′'), el('span', {}, 'on the clock')),
      el('div', {}, el('b', {}, semBase ? '?' : base + '′'), el('span', {}, 'the tier gives')),
      el('div', {}, el('b', {}, s.credits), el('span', {}, 'credits')),
      el('div', {}, el('b', {}, s.ops || 0), el('span', {}, 'operational points'))),
    // AS DUAS FAMILIAS (18/10, autor): as de MAPA mexem nesta batalha e a remontam; as de CAMPANHA valem dali em diante
    el('h3', { class: 'ability-group' }, 'Map Operational Abilities'),
    ...enemyReveal(s, c),
    el('h4', {}, 'Extra time'),
    el('div', { class: 'list intel-list' }, lista.map((a) => {
      const teto = a.maxStacks ?? 1;
      const tem = conta(a.id);
      const depois = semBase ? null : snapClock(base, jaComprado + a.effect.minutes);
      const nada = !semBase && depois <= c.duration;
      // 18/10 (autor): pago com pontos operacionais
      const pts = a.ops || 0;
      const caro = pts > (s.ops || 0);
      const motivo = tem >= teto ? `already bought ${tem} of ${teto}` : nada ? `the clock is already at ${c.duration}′ — the editor offers nothing longer` : caro ? `costs ${pts} operational point${pts === 1 ? '' : 's'}, you have ${s.ops || 0}` : '';
      return el('div', { class: 'item' + (tem ? ' on' : '') },
        el('span', {}, a.name, el('span', { class: 'sub' }, nada ? 'nothing more to add' : semBase ? `+${a.effect.minutes}′${tem ? ` · bought ${tem}/${teto}` : ''}` : `${c.duration}′ → ${depois}′${depois - c.duration !== a.effect.minutes ? ` (the editor's nearest step to +${a.effect.minutes}′)` : ''}${tem ? ` · bought ${tem}/${teto}` : ''}`)),
        el('button', { ...(motivo ? { disabled: 'disabled', title: motivo } : {}), onclick: () => buyIntel(s, a, depois, c) }, `buy · ${pts} pt${pts === 1 ? '' : 's'}`));
    })),
    el('p', { class: 'hint' }, c.brief ? REBUILD_OR_BRIEF(c, 'the longer clock') : 'Buying rebuilds this battle with the new clock — same map, same enemy — and hands you a new save to load. If you already started playing it, load the new save instead.'));
  renderEnemyIntel(s, body);
  renderOwnEW(s, body);
  renderRelight(s, body);
  renderCampaignAbilities(s, body);
}

// O INIMIGO INTEIRO, SO NA INTEL (autor, 24/10): 2 pontos operacionais pela batalha escolhida, antes de ela ser montada
// (o briefing so traz a inteligencia paga antes). No caminho sobrou so o mapa.
function enemyReveal(s, c) {
  if (!c.brief || !s.path || !s.next?.node) return [];
  const n = (s.path.nodes || []).find((x) => x.id === s.next.node);
  if (!n) return [];
  const pago = (n.revealed || {}).paid || {};
  if (pago.full && n.enemy && n.enemy.units != null) {
    return [el('h4', {}, 'Enemy composition'),
      el('p', {}, ...n.enemy.formations.map((f, i) => el('span', {}, `${i ? ' · ' : ''}${f.n > 1 ? f.n + ' × ' : ''}${f.name}`))),
      el('p', {}, el('b', {}, `${n.enemy.units} units`), ` (${n.enemy.offMap} off-map) · ${n.enemy.experience}`),
      el('p', { class: 'hint' }, (n.enemy.kept || []).map((k) => `${k.n} × ${k.name}`).join('  ·  '))];
  }
  const custo = revealCostOf('full', pago);
  const pontos = s.ops || 0;
  const motivo = custo > pontos ? `needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${pontos}` : '';
  return [el('h4', {}, 'Enemy composition'),
    el('div', { class: 'list intel-list' }, el('div', { class: 'item' },
      el('span', {}, 'Reveal enemy formations and units', el('span', { class: 'sub' }, `formations, units and experience of battle ${c.n}`)),
      el('button', { ...(motivo ? { disabled: 'disabled', title: motivo } : {}), onclick: () => revealOnPath(s, n, 'full', 'Reveal enemy formations and units', custo) }, `buy · ${custo} pt${custo === 1 ? '' : 's'}`))),
    el('p', { class: 'hint' }, `Bought for battle ${c.n}: the briefing names the enemy and the Battle tab lists every unit.`)];
}

async function prepareUI(s) {
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/prepare`);
    const st = await watchJob(job, `Building battle ${s.next?.n}`);
    await loadStatus();
    CAMPAIGN = st;
    await go({ screen: 'campaign', slug: s.slug, tab: 'now' });
  } catch (e) { if (!e.handled) alert(e.message); }
}

// AS HABILIDADES DE CAMPANHA (18/10): compradas uma vez com pontos operacionais, valem para o resto da campanha; aparecem
// na aba Intel e no quartermaster. Nada e remontado.
function renderCampaignAbilities(s, body) {
  const cfg = ((STATUS.rules.abilities || {}).campaign) || {};
  if (cfg.on === false || !(cfg.list || []).length) return;
  // num bloco proprio: no Raise a compra redesenha so ele (buyCampaignAbilityUI), sem perder a cesta
  const w = el('div', { class: 'campaign-abilities' }); body.append(w);
  fillCampaignAbilities(s, w, cfg);
}
function fillCampaignAbilities(s, body, cfg) {
  const ops = s.ops || 0;
  const tem = new Set(s.campaignAbilities || []);
  body.append(
    el('h3', { class: 'ability-group' }, 'Campaign Operational Abilities'),
    el('div', { class: 'list intel-list' }, cfg.list.map((a) => {
      const custo = a.ops ?? 1;
      const minha = tem.has(a.id);
      const motivo = minha ? 'already yours' : s.stage === 'over' ? 'the campaign is over' : custo > ops ? `needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${ops}` : '';
      return el('div', { class: 'item' + (minha ? ' on' : '') },
        el('span', {}, a.name, el('span', { class: 'sub' }, a.desc || '')),
        el('button', { ...(motivo ? { disabled: 'disabled', title: motivo } : {}), onclick: () => buyCampaignAbilityUI(s, a, custo) }, minha ? 'owned' : `buy · ${custo} pt${custo === 1 ? '' : 's'}`));
    })),
    el('p', { class: 'hint' }, `Bought once, for the rest of the campaign. Nothing is rebuilt. You have ${ops} operational point${ops === 1 ? '' : 's'}.`));
}

async function buyCampaignAbilityUI(s, a, custo) {
  // no Raise (24/10) a compra nao redesenha a tela: a cesta da forca so existe na pagina. Na loja o redesenho fica (o
  // catalogo de armas muda com o Black Market) e as formacoes ainda nao aplicadas saem dela: o jogador e avisado.
  const noRaise = !!(NEW && NEW.el === RAISE_ELS && document.querySelector('#raise-library'));
  const naCesta = !noRaise && SHOP_PENDING ? SHOP_PENDING() : 0;
  if (!confirm(`${a.name} for ${custo} operational point${custo === 1 ? '' : 's'}?

${a.desc || ''}
It lasts for the rest of the campaign.${naCesta ? `

The page is redrawn: the ${naCesta} unit${naCesta === 1 ? '' : 's'} and formation${naCesta === 1 ? '' : 's'} in your basket have to be picked again.` : ''}`)) return;
  try {
    const st = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/campaign-abilities`, { id: a.id });
    if (!noRaise) { renderCampaign(st); return; }
    s.ops = st.ops; s.campaignAbilities = st.campaignAbilities; CAMPAIGN = Object.assign(CAMPAIGN || {}, { ops: st.ops, campaignAbilities: st.campaignAbilities });
    document.querySelectorAll('#camp-head .stat > div, #camp-body .stat > div').forEach((d) => { if (d.querySelector('span')?.textContent === 'operational points') d.querySelector('b').textContent = st.ops ?? 0; });
    const w = document.querySelector('.campaign-abilities');
    if (w) { w.replaceChildren(); fillCampaignAbilities(s, w, ((STATUS.rules.abilities || {}).campaign) || {}); }
  } catch (e) { alert(e.message); }
}

// A TROCA DE LUZ (17/10): 1 ponto operacional; o jogador escolhe o periodo e a hora e sorteada dentro dele.
function renderRelight(s, body) {
  const T = ((STATUS.rules.battle || {}).timeOfDay) || {};
  if (!T.on) return;
  const c = intelCurrent(s);
  const custo = T.relightOps ?? 1;
  const ops = s.ops || 0;
  const agora = c.time ? `${ICONE_PERIODO[c.time.period] || ''}${horaDe(c.time)} — ${String(c.time.name).toLowerCase()}` : 'the hour of the map';
  body.append(
    el('h4', {}, 'Lighting (in the game)'),
    el('p', { class: 'hint' }, `This battle starts at ${agora}${c.date ? `, ${c.date.label}` : ''}. Pick another time of day: the hour falls at random inside it.`),
    el('div', { class: 'list intel-list' }, (T.periods || []).map((p) => {
      const atual = c.time && c.time.period === p.id;
      const motivo = atual ? 'this is the current light' : custo > ops ? `needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${ops}` : '';
      const de = p.hours[0], ate = p.hours[p.hours.length - 1];
      return el('div', { class: 'item' + (atual ? ' on' : '') },
        el('span', {}, `${ICONE_PERIODO[p.id] || ''}${p.name}`, el('span', { class: 'sub' }, `${String(de).padStart(2, '0')}:00–${String(ate).padStart(2, '0')}:00`)),
        el('button', { ...(motivo ? { disabled: 'disabled', title: motivo } : {}), onclick: () => buyRelightUI(s, p, custo) }, atual ? 'now' : `change · ${custo} pt${custo === 1 ? '' : 's'}`));
    })),
    el('p', { class: 'hint' }, c.brief ? REBUILD_OR_BRIEF(c, 'the new light') : 'Changing rebuilds this battle with the new light — same map, same enemy — and hands you a new save to load.'));
}

// O QUE A COMPRA DO INTEL FAZ (18/10): antes do Prepare (brief) nao ha batalha montada — s.current e nulo, e ler o numero
// dele derrubava o botao. A batalha e a do Intel (intelCurrent).
function efeitoDaCompra(s) {
  const c = intelCurrent(s);
  return { n: c.n, texto: c.brief ? `Battle ${c.n} will be built with it.` : `Battle ${c.n} is rebuilt and the app hands you a new save to load.` };
}

async function buyRelightUI(s, p, custo) {
  const e = efeitoDaCompra(s);
  if (!confirm(`Move battle ${e.n} to ${String(p.name).toLowerCase()} for ${custo} operational point${custo === 1 ? '' : 's'}?\n\nThe hour falls at random between ${p.hours[0]}:00 and ${p.hours[p.hours.length - 1]}:00. ${e.texto}`)) return;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/light`, { period: p.id });
    const st = await watchJob(job, 'Rebuilding the battle with the new light');
    await loadStatus();
    renderCampaign(st);
  } catch (e) { if (!e.handled) alert(e.message); }
}

// A GUERRA ELETRONICA PROPRIA (17/10): Red EW do cenario, pago em pontos operacionais; subir paga a diferenca. O EW do
// inimigo desta batalha aparece aqui so para leitura — o counter se compra no caminho, antes de montar.
function renderOwnEW(s, body) {
  const cfg = STATUS.rules.ew || {};
  if (!cfg.on) return;
  const c = intelCurrent(s);
  const g = c.ew || {};
  const niveis = cfg.levels || ['None', 'Light', 'Medium', 'Strong'];
  const atual = g.own || 'None';
  const pago = (cfg.own || {})[atual] || 0;
  const ops = s.ops || 0;
  const inimigo = !g.enemy || g.enemy === 'None' ? 'The enemy has no electronic warfare in this battle.'
    : g.countered ? `The enemy electronic warfare (${g.enemy}) was countered on the battle path.`
    : `The enemy brings electronic warfare: ${g.enemy}.`;
  body.append(
    el('h4', {}, 'Your electronic warfare (in the game)'),
    el('p', { class: 'hint' }, `${inimigo} ${atual === 'None' ? 'You have none.' : `Yours: ${atual}.`}`),
    el('div', { class: 'list intel-list' }, Object.entries(cfg.own || {}).map(([nivel, preco]) => {
      const tem = niveis.indexOf(nivel) <= niveis.indexOf(atual);
      const custo = preco - pago;
      const motivo = tem ? 'already bought' : custo > ops ? `needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${ops}` : '';
      return el('div', { class: 'item' + (tem ? ' on' : '') },
        el('span', {}, `Electronic warfare ${nivel}`, el('span', { class: 'sub' }, `${preco} pt${preco === 1 ? '' : 's'}${pago && !tem ? ` · +${custo} from ${atual}` : ''}`)),
        el('button', { ...(motivo ? { disabled: 'disabled', title: motivo } : {}), onclick: () => buyOwnEWUI(s, nivel, custo) }, tem ? 'bought' : `buy · ${custo} pt${custo === 1 ? '' : 's'}`));
    })),
    el('p', { class: 'hint' }, REBUILD_OR_BRIEF(c, 'your electronic warfare')));
}

async function buyOwnEWUI(s, nivel, custo) {
  if (!confirm(`Electronic warfare ${nivel} for ${custo} operational point${custo === 1 ? '' : 's'}?\n\n${efeitoDaCompra(s).texto}`)) return;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/ew`, { level: nivel });
    const st = await watchJob(job, 'Rebuilding the battle with your electronic warfare');
    await loadStatus();
    renderCampaign(st);
  } catch (e) { if (!e.handled) alert(e.message); }
}

// O INTEL INIMIGO DO JOGO (17/10): Early Intel do cenario para o lado do jogador, pago em pontos operacionais. O jogo marca
// no mapa, no setup, os contatos inimigos que a forca do intel revela. Subir de nivel paga a diferenca.
function renderEnemyIntel(s, body) {
  const cfg = ((STATUS.rules.abilities || {}).enemyIntel) || {};
  if (!cfg.on) return;
  const c = intelCurrent(s);
  const atual = c.intelStrength || 0;
  const pago = ((cfg.levels || []).find((l) => l.strength === atual) || {}).ops || 0;
  const ops = s.ops || 0;
  body.append(
    el('h4', {}, 'Enemy intelligence (in the game)'),
    el('p', { class: 'hint' }, atual ? `This battle has enemy intelligence at ${atual} %: the game marks enemy contacts on your map at setup.` : 'No enemy intelligence for this battle: you see the enemy only when your men do.'),
    el('div', { class: 'list intel-list' }, (cfg.levels || []).map((l) => {
      const custo = l.ops - pago;
      const motivo = l.strength <= atual ? 'already bought' : custo > ops ? `needs ${custo} operational point${custo === 1 ? '' : 's'}; you have ${ops}` : '';
      return el('div', { class: 'item' + (l.strength <= atual ? ' on' : '') },
        el('span', {}, `Intel strength ${l.strength} %`, el('span', { class: 'sub' }, `${l.ops} pt${l.ops === 1 ? '' : 's'}${pago && l.strength > atual ? ` · +${custo} from ${atual} %` : ''}`)),
        el('button', { ...(motivo ? { disabled: 'disabled', title: motivo } : {}), onclick: () => buyEnemyIntelUI(s, l, custo) }, l.strength <= atual ? 'bought' : `buy · ${custo} pt${custo === 1 ? '' : 's'}`));
    })),
    el('p', { class: 'hint' }, `${REBUILD_OR_BRIEF(c, 'the new intelligence')} Operational points come from the battles on your path.`));
}

async function buyEnemyIntelUI(s, l, custo) {
  if (!confirm(`Enemy intelligence at ${l.strength} % for ${custo} operational point${custo === 1 ? '' : 's'}?\n\n${efeitoDaCompra(s).texto}`)) return;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/intel`, { strength: l.strength });
    const st = await watchJob(job, 'Rebuilding the battle with the new intelligence');
    await loadStatus();
    renderCampaign(st);
  } catch (e) { if (!e.handled) alert(e.message); }
}

async function buyIntel(s, a, depois, c = intelCurrent(s)) {
  const pts = a.ops || 0;
  const efeito = c.brief ? `Battle ${c.n} will be built with ${depois} minutes.` : `Battle ${c.n} is rebuilt with ${depois} minutes and the app hands you a new save to load.`;
  if (!confirm(`${a.name} for ${pts} operational point${pts === 1 ? '' : 's'}?\n\n${efeito}`)) return;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/abilities`, { abilities: [a.id] });
    const st = await watchJob(job, 'Rebuilding the battle with the new clock');
    await loadStatus();
    renderCampaign(st);
  } catch (e) { if (!e.handled) alert(e.message); }
}

// ------------------------------------------------------------------------- a forca, so leitura (E176)
// O Quartermaster enquanto a batalha espera: a forca como ela vai a campo, sem comprar nada.
// O QUARTERMASTER DA BATALHA 1 (18/10, autor): a campanha nasceu sem forca e a batalha 1 ja foi escolhida no caminho. A
// mesma biblioteca e a mesma cesta da criacao, com os creditos da campanha; "Raise the force" cunha a forca e leva ao Intel.
async function renderRaise(s, body) {
  SHOP_PENDING = null;
  const pv = s.next?.preview;
  // A BARRA DA BOLSA (autor, 30/10): a mesma do quartermaster entre batalhas — o que ha, o que a cesta ja pede, o que
  // sobra e o Reset —, grudada no topo, e o saldo fixo no canto (`purse-hud`, escrito por `showCredits`). Quem a desenha
  // e o `reprice`, pelo `onPriced`, com a conta da cesta inteira.
  const purse = el('div', { class: 'purse-bar' });
  const drawPurse = (total, left) => {
    const algo = !!(NEW && NEW.picks && NEW.picks.length);
    showCredits(left);   // o saldo do canto, tambem quando a cesta esvazia
    purse.replaceChildren(
      el('span', { class: 'cell' }, 'To spend', el('b', {}, `${s.credits} cr`)),
      el('span', { class: 'cell' }, 'Committed', el('b', {}, `${total} cr`)),
      el('span', { class: 'cell left' }, 'Left', el('b', { class: left < 0 ? 'no' : '' }, `${left} cr`)),
      el('span', { class: 'grow' }, el('button', {
        class: 'linky', ...(algo ? {} : { disabled: 'disabled' }),
        title: algo ? 'Empty the basket: every formation added on this screen comes out' : 'Nothing has been added yet',
        onclick: () => { if (!NEW || !confirm('Take every formation out of the basket?')) return; NEW.picks = []; SEL = new Set(); renderPicks(); },
      }, '↺ Reset')));
  };
  drawPurse(0, s.credits);
  body.append(
    el('h3', {}, 'Quartermaster — raise your force'),
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, s.credits), el('span', {}, 'credits')),
      el('div', {}, el('b', {}, s.ops || 0), el('span', {}, 'operational points'))),
    purse,
    el('div', { class: 'purse-hud' }, el('span', { class: 'hud-label' }, 'Credits left'), el('b', { class: 'canvas-credits' }, `${s.credits} cr`)),
    el('p', { class: 'hint' }, `Battle 1${pv?.map?.name ? ` is ${pv.map.name}${kindTail(pv.map.kind, ', ')}` : ' is chosen'}. Pick the formations of your force from the library. What you leave out can be bought here between battles.`),
    el('div', { id: 'raise-library', class: 'libtable' }),
    el('div', { class: 'two' },
      el('div', {},
        el('h3', {}, 'Your force'),
        el('div', { id: 'raise-picks' }),
        el('div', { id: 'raise-budget', class: 'budget' }),
        el('p', {},
          el('button', { id: 'raise-create', class: 'primary', disabled: 'disabled', onclick: () => raiseForceUI(s) }, 'Raise the force'), ' ',
          el('button', { class: 'linky', onclick: () => undoBattle(s) }, '↶ Undo — back to the battle path')),
        el('div', { id: 'raise-error', class: 'banner bad', hidden: 'hidden' }))));
  // as habilidades de campanha (o Black Market) ja na criacao da forca (autor, 24/10)
  renderCampaignAbilities(s, body);
  NEW = {
    armies: s.armies || ['US', 'UKR'], picks: [], el: RAISE_ELS, slug: s.slug,
    creditsAvailable: () => s.credits,
    needsOnMap: true,
    label: 'Credits',
    forceLabel: 'Force',
    onPriced: ({ total, left }) => drawPurse(total, left),
  };
  VEHICLES = null;                     // o menu de avulsos e por biblioteca
  TWINS = null;                        // as pecas que tem os dois jeitos tambem
  GUNS = null;                         // e os canhoes das baterias
  try {
    await loadFormations();
    renderPicks();
  } catch (e) {
    const c = $('#raise-error');
    c.hidden = false;
    c.textContent = `Could not read the formation library: ${e.message}${e.id ? ` (error ${e.id})` : ''}`;
  }
}

async function raiseForceUI(s) {
  const c = $('#raise-error');
  if (c) c.hidden = true;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/force`, { picks: NEW.picks.map(pickPayload) });
    const st = await watchJob(job, 'Raising the force');
    NEW = null;
    await loadStatus();
    CAMPAIGN = st;
    // com a SF comprada, o proximo passo e o kit-out, na aba Battle (21/10, autor)
    await go({ screen: 'campaign', slug: s.slug, tab: st.next?.kitOut === 'pending' ? 'now' : 'intel' });
  } catch (e) {
    if (e.handled) return;
    alert(e.message + (e.id ? ` (error ${e.id})` : ''));
  }
}

async function renderForceView(s, body) {
  SHOP_PENDING = null;   // aqui nada se compra: nada a perder ao sair

  const emCampo = (s.units || []).filter((u) => u.present).length;
  body.append(
    el('h3', {}, 'Quartermaster — your force'),
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, emCampo), el('span', {}, 'in the field')),
      el('div', {}, el('b', {}, s.coreUnits ?? '?'), el('span', {}, 'core units')),
      el('div', {}, el('b', {}, s.credits), el('span', {}, 'credits')),
      el('div', {}, el('b', {}, s.ops || 0), el('span', {}, 'operational points'))),
    el('p', { class: 'hint' }, s.stage === 'over' ? 'The campaign is over.' : s.stage === 'choose' ? 'Choose battle 1 on the battle path; your force is raised here after that.' : s.stage === 'brief' && s.next?.n === 1 ? 'Your force for battle 1. Replacements and purchases open here after your first battle; to change this force, undo back to the battle path.' : s.stage === 'brief' ? 'Applied. Next: Intel, where the battle is prepared.' : 'Replacements, purchases and training open here when the result of this battle is read.'));
  renderCampaignAbilities(s, body);
  const alvo = el('div', {}, el('p', { class: 'hint' }, 'Reading the force…'));
  body.append(alvo);
  let picks;
  try { picks = await ownedPicksOf(s); } catch (e) { alvo.replaceChildren(el('div', { class: 'banner bad' }, e.message)); return; }
  // o switch Org Chart | List tambem aqui (25/10): a lista so leitura abre o painel da unidade
  RO_SEL = new Set();
  const desenharVista = () => {
    alvo.replaceChildren(viewSwitch(desenharVista));
    if (forceViewPref() === 'list') { renderForceList(alvo, modoLeitura(picks, desenharVista)); return; }
    for (const pick of picks) {
      pick.view = pick.view || { x: 0, y: 0, z: 0.8 };
      const card = el('div', { class: 'card force-card' }, el('h4', {}, pick.formation.name, pick.copy ? ` #${pick.copy}` : ''));
      const desenhar = () => card.replaceChildren(card.firstChild, renderCanvas(pick, desenhar, (n) => n.price || 0, { readOnly: true }));
      desenhar();
      alvo.append(card);
    }
  };
  desenharVista();
}

// ------------------------------------------------------------------------- 3. o historico
function renderHistoryTab(s, body) {
  // O DEBRIEF NA PROPRIA LINHA (autor, 11/10): cada batalha tem o seu botao; o debrief abre logo abaixo da tabela, a
  // linha aberta fica marcada e o botao dela vira "Hide".
  const { alvo, abrir } = debriefBelow(s);
  const tabela = renderHistory(s, { onDebrief: abrir }).lastChild;
  body.append(el('h3', {}, 'Battle history'), tabela, alvo);
}

// O debrief de uma batalha do historico aberto num quadro (`alvo`) abaixo da tabela: um por vez, o botao da linha
// aberta vira "Hide". Usado pela aba History e, desde 06/11, pela tela de fim. `h` precisa de n, map, kind e node.
function debriefBelow(s) {
  const alvo = el('div', { class: 'history-debrief' });
  let aberta = null;
  const fechar = () => { if (aberta) { aberta.linha.classList.remove('on'); aberta.botao.textContent = 'Debrief'; } aberta = null; alvo.replaceChildren(); };
  const abrir = async (h, linha, botao) => {
    if (aberta && aberta.n === h.n) { fechar(); return; }
    fechar();
    aberta = { n: h.n, linha, botao };
    linha.classList.add('on');
    botao.textContent = 'Hide';
    alvo.replaceChildren(el('p', { class: 'hint' }, 'Reading…'));
    try {
      const r = await api('GET', `/api/campaigns/${encodeURIComponent(s.slug)}/battles/${h.n}`);
      if (!aberta || aberta.n !== h.n) return;
      alvo.replaceChildren();
      renderDebrief(s, alvo, r, h.map ? { nome: h.map, kind: h.kind, which: h.node && (s.path?.route || []).includes(h.node) ? h.node : null } : null);
      alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      alvo.replaceChildren(el('div', { class: 'banner bad' }, `Battle ${h.n}: ${e.message}`));
    }
  };
  return { alvo, abrir };
}

// ------------------------------------------------------------------------- 4. o pessoal
async function renderPersonnel(s, body) {
  body.append(el('h3', {}, 'Personnel'));
  const alvo = el('div', {}, el('p', { class: 'hint' }, 'Reading the campaign save…'));
  body.append(alvo);
  let d;
  try { d = await personnelOf(s); } catch (e) {
    alvo.replaceChildren(el('div', { class: 'banner bad' }, e.message));
    return;
  }
  if (!d.soldiers.length) {
    alvo.replaceChildren(el('p', { class: 'hint' }, d.note || 'No men in the roster yet.'));
    return;
  }
  const t = d.totals;
  alvo.replaceChildren(
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, t.men), el('span', {}, 'men')),
      el('div', {}, el('b', { class: 'ok' }, t.fit), el('span', {}, 'fit')),
      el('div', {}, el('b', {}, t.wounded), el('span', {}, 'wounded')),
      el('div', {}, el('b', { class: t.down ? 'no' : '' }, t.down), el('span', {}, 'down')),
      el('div', {}, el('b', {}, t.units), el('span', {}, 'units with men')),
      el('div', {}, el('b', {}, t.leaders), el('span', {}, 'leading'))),
    el('p', { class: 'hint' }, 'Read from the campaign save, man by man. Experience and motivation belong to the UNIT in Combat Mission, not to the soldier — a squad is Veteran, not the rifleman in it — so each row shows his squad\'s. Who leads is the game\'s own mark: when a squad is shattered it sits on whoever is still standing.'),
    sortableTable(
      [
        { key: 'name', label: 'soldier' },
        { key: 'nation', label: 'army' },
        { key: 'leads', label: 'leads' },
        { key: 'state', label: 'state' },
        { key: 'carrying', label: 'carrying', cls: 'dim' },
        { key: 'also', label: 'also carrying', cls: 'dim' },
        { key: 'unit', label: 'unit' },
        { key: 'formation', label: 'formation', cls: 'dim' },
        { key: 'experience', label: 'experience' },
        { key: 'motivation', label: 'motivation' },
        { key: 'leadership', label: 'leadership' },
        { key: 'clean', label: 'clean battles', num: true },
      ],
      d.soldiers.map((x) => ({
        name: x.name,
        nation: x.nation || '',
        leads: x.leads === 'squad' ? 'squad leader' : x.leads === 'team' ? 'team leader' : '',
        state: x.state,
        carrying: x.carrying,
        also: [x.alsoCarrying, x.demo ? `demo ×${x.demo}` : null, x.laser ? 'laser' : null].filter(Boolean).join(' · '),
        unit: x.unit,
        formation: x.formation,
        experience: x.experience || '',
        motivation: x.motivation || '',
        leadership: x.leadership ?? '',
        clean: x.inTheField ? (x.cleanBattles ?? 0) : '',
      })),
      { sort: 'unit', page: 25 }));

  // WHAT WAS JUST BOUGHT HAS NO MEN YET. The game names them the first time the unit takes the
  // field, so a purchase shows up here as a unit with a strength and no soldiers — not as nothing.
  const espera = d.waiting || [];
  if (espera.length) {
    alvo.append(
      el('h3', {}, `Waiting for their first battle (${espera.length} unit${espera.length > 1 ? 's' : ''}, ${d.totals.waitingMen} men)`),
      el('p', { class: 'hint' }, 'These are in your force and in the campaign file, with an empty roster line: Combat Mission names the men when the unit first deploys. The strength is what the unit fields at full strength, and after the next battle they are in the table above, by name.'),
      sortableTable(
        [
          { key: 'unit', label: 'unit' },
          { key: 'men', label: 'men at full strength', num: true },
          { key: 'nation', label: 'army' },
          { key: 'formation', label: 'formation', cls: 'dim' },
          { key: 'experience', label: 'experience' },
          { key: 'leadership', label: 'leadership' },
        ],
        espera.map((x) => ({
          unit: x.unit,
          men: x.expected ?? 0,
          nation: x.nation || '',
          formation: x.formation,
          experience: x.experience || '',
          leadership: x.leadership ?? '',
        })),
        { sort: 'unit', page: 15 }));
  }
}

// THE SCOREBOARD. What the game shows on the last turn of a battle as "Total Campaign Victories",
// read from the same save as the men: enemy casualties and vehicles knocked out, unit by unit.
async function renderKills(s, body) {
  body.append(el('h3', {}, 'Kills'));
  const alvo = el('div', {}, el('p', { class: 'hint' }, 'Reading the campaign save…'));
  body.append(alvo);
  let d;
  try { d = await personnelOf(s); } catch (e) {
    alvo.replaceChildren(el('div', { class: 'banner bad' }, e.message));
    return;
  }
  const k = d.kills;
  if (!k || !k.units.length) {
    alvo.replaceChildren(el('p', { class: 'hint' }, k && k.error ? `Could not read the scoreboard: ${k.error}` : 'Nobody has scored yet — the count starts with the first battle.'));
    return;
  }
  const t = k.totals;
  alvo.replaceChildren(
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, t.men), el('span', {}, 'enemy casualties')),
      el('div', {}, el('b', {}, t.vehicles), el('span', {}, 'vehicles knocked out')),
      el('div', {}, el('b', {}, k.units.length), el('span', {}, 'units that scored'))),
    el('p', { class: 'hint' }, `The campaign total the game keeps for every unit — the "Total Campaign Victories" on the last turn of a battle. These are credited kills: the after-action report counts every enemy loss${t.aarKilled != null ? ` (${t.aarKilled} dead, ${t.aarVehicles} vehicles so far)` : ''}, including the ones nobody gets the credit for.${k.unread.length ? ` Not read this time: ${k.unread.join(', ')}.` : ''}`),
    sortableTable(
      [
        { key: 'unit', label: 'unit' },
        { key: 'men', label: 'casualties', num: true },
        { key: 'veh', label: 'vehicles', num: true },
        { key: 'which', label: 'knocked out', cls: 'dim' },
        { key: 'formation', label: 'formation', cls: 'dim' },
      ],
      k.units.map((u) => ({
        unit: u.unit + (u.present ? '' : ' (out of the force)'),
        men: u.men,
        veh: u.vehicles.reduce((a, v) => a + v.count, 0),
        which: u.vehicles.map((v) => (v.count > 1 ? `${v.name} ×${v.count}` : v.name)).join(', '),
        formation: u.formation,
      })),
      { sort: 'men', dir: -1, page: 25 }));
}

// THE MACHINES, one row each. Everything the state already knows — what it is, where it sits, what
// the save said happened to it — in the grain the men's table cannot show. A vehicle is the type
// table's own answer (tab 5) plus the roles the quartermaster treats as machines and the trucks it
// does not, so a gun HMMWV the role guesser calls `mg` is not left out.
function renderVehicles(s, body) {
  const R = (STATUS.rules && STATUS.rules.replacement) || {};
  const papeis = new Set(R.machineRoles || []);
  const fora = R.machineExcludes ? new RegExp(R.machineExcludes, 'i') : null;
  const ehVeiculo = (u) => ((u.type || [])[1] === 5 || papeis.has(u.role) || u.role === 'truck')
    && !(fora && fora.test(String(u.name || '')));
  const marcas = s.vehicles || {};
  const perdidos = new Set(s.lost || []);
  const frota = (s.units || []).filter(ehVeiculo);
  body.append(el('h3', {}, 'Vehicles'));
  if (!frota.length) { body.append(el('p', { class: 'hint' }, 'No machines in this force.')); return; }
  const emCampo = frota.filter((u) => u.present);
  const estadoDe = (u) => (perdidos.has(u.coreId) ? 'destroyed' : marcas[u.coreId] || (u.present ? '' : ''));
  body.append(
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, emCampo.length), el('span', {}, 'in the force')),
      el('div', {}, el('b', { class: 'no' }, frota.filter((u) => estadoDe(u) === 'destroyed').length), el('span', {}, 'destroyed')),
      el('div', {}, el('b', {}, frota.filter((u) => estadoDe(u) === 'immobilized').length), el('span', {}, 'immobilized')),
      el('div', {}, el('b', {}, frota.length - emCampo.length), el('span', {}, 'dormant'))),
    el('p', { class: 'hint' }, 'What the campaign owns that rolls or shoots from a mount. The state is what the last save said about it — a destroyed one does not take the field again and is replaced at the quartermaster, except the trucks, which come back with a formation. A dormant machine is one the force is not fielding: ticking it in the quartermaster brings it back.'),
    sortableTable(
      [
        { key: 'unit', label: 'machine' },
        { key: 'state', label: 'state' },
        { key: 'formation', label: 'formation', cls: 'dim' },
        { key: 'experience', label: 'experience' },
        { key: 'leadership', label: 'leadership' },
        { key: 'nation', label: 'army' },
        { key: 'price', label: 'price', num: true },
        { key: 'carries', label: 'carries for the infantry', cls: 'dim' },
      ],
      // dormant machines stay out of the table (10/10): the ones in the force, and the destroyed ones
      frota.filter((u) => u.present || estadoDe(u) === 'destroyed').map((u) => ({
        unit: u.name,
        state: estadoDe(u) || 'intact',
        formation: u.formation || '',
        experience: u.experience || '',
        leadership: u.present ? (s.attrs?.[u.coreId]?.lideranca ?? u.leadership ?? '') : '',
        nation: u.nation || s.nation || '',
        price: u.price || 0,
        carries: (LAUNCHERS.slug === s.slug && LAUNCHERS.vehicles[u.coreId]) || '',
      })),
      { sort: 'unit', page: 25 }));
  // OS LANCADORES (02/10): lidos do save na hora, entao a tabela aparece antes e e redesenhada quando
  // eles chegam.
  if (LAUNCHERS.slug !== s.slug) {
    api('GET', `/api/campaigns/${encodeURIComponent(s.slug)}/launchers`)
      .then((r) => { LAUNCHERS = { slug: s.slug, vehicles: r.vehicles || {} }; if (FORCE_TAB === 'vehicles') desenharAbas(s); })
      .catch(() => { LAUNCHERS = { slug: s.slug, vehicles: {} }; });
  }
}
let LAUNCHERS = { slug: null, vehicles: {} };

// PARA ONDE O UNDO VOLTA (19/10): a batalha montada depois de um kit-out volta ao quartel-mestre dele; o resto, ao da
// batalha anterior, ou a escolha da primeira.
function undoButton(s) {
  const n = s.current?.n ?? s.next?.n;
  const posKit = s.stage === 'brief' ? s.next?.kitOut === 'done' : !!s.current?.afterKitOut;
  if (posKit) return el('button', { onclick: () => undoBattle(s) }, '↶ Undo — back to the kit-out quartermaster');
  if (s.history.length) return el('button', { onclick: () => undoBattle(s) }, `↶ Undo — back to the quartermaster of battle ${n - 1}`);
  if (s.path && n === 1) return el('button', { onclick: () => undoBattle(s) }, '↶ Undo — back to choosing the first battle');
  return null;
}

// O KIT-OUT POR MONTAR (19/10, autor): a SF acabou de ser comprada e os homens dela ainda nao existem no jogo.
function renderKitOutPending(s, body) {
  const n = s.next.n;
  body.append(
    el('h3', {}, `Kit-out — before battle ${n}`),
    el('p', {}, 'Combat Mission creates the soldiers of a unit only when it first takes the field, and only a soldier who exists can be given another weapon or an item. Your new special forces get a kit-out first: a short battle on the smallest map that holds them, with nobody else of yours on it.'),
    el('ol', { class: 'steps-play' }, [
      'Prepare the kit-out below.',
      'Play it: deploy, then open the menu and choose Cease Fire. If the enemy does not accept, let the clock run out.',
      'Click through the debriefing until the game saves at the transition, then come back here and look for that save.',
      'In the Quartermaster, give the special forces their weapons and items, and Apply.',
      `Then battle ${n} is prepared in Intel, as usual.`,
    ].map((t) => el('li', {}, t))),
    el('p', { class: 'hint good' }, 'Nothing in the kit-out counts: no credits, no defeat, no battle on the record, no map used up, no operational point. Anyone hurt and every round spent come back for free.'),
    el('div', { class: 'prepare-bar' },
      el('button', { class: 'primary', onclick: () => prepareKitOutUI(s) }, 'Prepare the kit-out →'),
      el('button', { onclick: () => skipKitOutUI(s) }, 'Skip it — keep the factory kit'),
      undoButton(s)));
}

async function prepareKitOutUI(s) {
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/kitout/prepare`);
    const st = await watchJob(job, 'Building the kit-out');
    await loadStatus();
    CAMPAIGN = st;
    await go({ screen: 'campaign', slug: s.slug, tab: 'now' });
  } catch (e) { if (!e.handled) alert(e.message); }
}

async function skipKitOutUI(s) {
  if (!confirm('Skip the kit-out?\n\nThe special forces go into battle with the factory weapons and kit of their slots, and can be re-equipped after that battle.')) return;
  try {
    const st = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/kitout/skip`);
    await loadStatus();
    CAMPAIGN = st;
    await go({ screen: 'campaign', slug: s.slug, tab: 'intel' });
  } catch (e) { if (!e.handled) alert(e.message); }
}

// O KIT-OUT MONTADO: os passos do cessar-fogo, a procura do save, o rebuild e o undo.
function renderKitOutPlay(s, body) {
  const c = s.current;
  body.append(
    el('h3', {}, `Kit-out before battle ${c.n} — ${c.map.name}`),
    mapThumb(s, 'current', c.map.name, { side: true }),
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, (c.specialForces || []).length), el('span', {}, 'special forces units')),
      el('div', {}, el('b', {}, c.duration + '′'), el('span', {}, 'time limit')),
      el('div', {}, el('b', {}, s.next?.n ?? c.n), el('span', {}, 'battle waiting after it'))),
    el('p', { class: 'hint good' }, 'Nothing here counts. Deploy and cease fire: the game names your special forces soldiers at the transition, and that is all this is for.'));
  const passos = c.playFrom.kind === 'campaign'
    ? ['Start Combat Mission Black Sea.', `Campaign → pick “${c.playFrom.label}” → Fight.`]
    : ['Start Combat Mission Black Sea.', `Saved Games & PBEM → load “${c.playFrom.label}”.`];
  body.append(el('ol', { class: 'steps-play' }, [...passos,
    'Deploy (or not), then open the menu → Cease Fire → Yes. If the enemy does not accept, let the clock run out.',
    'Click through the debriefing until the game saves at the transition.',
    'Come back here and look for that save.'].map((t) => el('li', {}, t))));
  body.append(el('div', { class: 'file' }, c.playFrom.file));
  const scanBox = el('div');
  body.append(el('p', {},
    el('button', { class: 'primary', onclick: () => scan(s, scanBox) }, 'Look for the save'), ' ',
    el('button', { onclick: () => regenerate(s, false) }, 'Rebuild the kit-out file'), ' ',
    undoButton(s)));
  body.append(scanBox);
}

// O KIT-OUT LIDO: quem foi nomeado, o que volta de graca, e a loja.
function renderKitOutResult(s, body) {
  const r = s.pending.result;
  body.append(
    el('h3', {}, `Kit-out before battle ${r.battle} — read`),
    el('div', { class: 'stat' },
      el('div', {}, el('b', { class: r.named ? 'ok' : 'no' }, r.named ?? 0), el('span', {}, 'special forces soldiers named')),
      el('div', {}, el('b', {}, r.totals?.casualties ?? 0), el('span', {}, 'hurt — back for free')),
      (r.kitWrecks || []).length ? el('div', {}, el('b', {}, r.kitWrecks.length), el('span', {}, 'machines lost — back for free')) : null),
    r.named
      ? el('p', { class: 'hint good' }, 'The soldiers exist now. Give them their weapons and items in the Quartermaster; everything else of the shop opens after the battle.')
      : el('div', { class: 'banner bad' }, 'No special forces soldier came out of this save named — the unit may not have taken the field. Undo the kit-out and play it again, or apply it as it is and keep the factory kit.'),
    el('p', {}, el('button', { class: 'primary', onclick: () => setTab(s, 'quartermaster') }, 'Go to the quartermaster →')));
}

function renderPlay(s, body) {
  const c = s.current;
  // (29/10) uma batalha "montada" sem a ficha dela: o processo morreu no meio; refazer a monta de novo
  if (!c) { body.append(el('div', { class: 'banner bad' }, 'This battle is marked as built but its record is missing — the app was probably closed while it was being built. Use Undo, or prepare it again from Intel.')); return; }
  if (c.kitOut) return renderKitOutPlay(s, body);
  body.append(
    el('h3', {}, `Battle ${c.n} — ${c.map.name}${kindTail(c.map.kind, ' · ')}`),
    mapThumb(s, 'current', c.map.name, { side: true }),
    el('div', { class: 'stat' },
      el('div', {}, el('b', {}, `${c.map.width}×${c.map.height}`), el('span', {}, `${c.map.area} km², ${profileWord(c.map.profile)}`)),
      el('div', {}, el('b', {}, c.duration + '′'), el('span', {}, c.clock && c.clock.extra ? `time limit · ${c.clock.base}′ + ${c.clock.extra}′ bought` : 'time limit')),
      // num caminho a forca inimiga e segredo ate a composicao inteira ser revelada (E176)
      !s.path || c.intel ? el('div', {}, el('b', {}, c.defense.units), el('span', {}, 'enemy units')) : el('div', {}, el('b', {}, '?'), el('span', {}, 'enemy units')),
      el('div', {}, el('b', {}, 'T' + c.map.tier), el('span', {}, 'tier')),
      c.time || c.date ? el('div', {}, el('b', {}, c.time ? horaDe(c.time) : c.date.label), el('span', {}, c.time ? `H-hour · ${String(c.time.name).toLowerCase()}${c.date ? ` · ${c.date.day} ${c.date.label.split(' ')[1].slice(0, 3)}` : ''}` : 'date')) : null,
      c.weather ? el('div', { title: c.weather.label }, el('b', {}, `${ICONE_CLIMA[c.weather.id] || ''}`), el('span', {}, c.weather.name)) : null,
      // a guerra eletronica dos dois lados (17/10), so quando ha alguma
      c.ew && (c.ew.enemy !== 'None' || c.ew.own !== 'None')
        ? el('div', {}, el('b', { class: c.ew.enemy !== 'None' && !c.ew.countered ? 'no' : '' }, c.ew.enemy !== 'None' && !c.ew.countered ? c.ew.enemy : 'none'), el('span', {}, `enemy EW${c.ew.countered ? ' (countered)' : ''}${c.ew.own !== 'None' ? ` · yours ${c.ew.own}` : ''}`))
        : null));

  // O QUE FOI COMPRADO PARA ESTA BATALHA (plano 2). O relogio ja aparece no painel de cima; aqui
  // fica o resto, e o aviso de que o "push on" trocou a municao pelo tempo.
  if ((c.abilities || []).length) {
    const lista = ((STATUS.rules.abilities || {}).list) || [];
    const nomes = c.abilities.map((id) => (lista.find((a) => a.id === id) || {}).name || id);
    body.append(el('p', { class: 'hint good' }, `Bought for this battle: ${nomes.join(' · ')}.${c.noRefit ? ' Your men did not rearm and did not rest — the clock came instead of the ammunition.' : ''}`));
  }

  // INTELIGENCIA: a ordem de batalha do inimigo antes de entrar, quando ela foi paga. O app sempre
  // soube (ele montou a defesa); o que a habilidade compra e ver isto agora em vez de no debrief.
  if (c.intel && (c.enemyUnits || []).length) {
    const inimigo = c.enemyUnits;
    const conta = new Map();
    for (const u of inimigo) { const k = u.name.replace(/ #\d+$/, ''); conta.set(k, (conta.get(k) || 0) + 1); }
    body.append(
      el('h3', {}, `Intelligence: what is waiting for you (${inimigo.length} units, ${inimigo.filter((u) => u.offMap).length} off-map)`),
      el('p', { class: 'hint' }, [...conta].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n, q]) => `${q} × ${n}`).join('  ·  ')),
      enemyBill(c.defense, inimigo, { cost: false }));
  }

  const steps = c.playFrom.kind === 'campaign'
    ? ['Start Combat Mission Black Sea.',
       `Campaign → pick “${c.playFrom.label}” → Fight. The campaign already knows which side is yours, so no side is asked for.`,
       'Play the battle to the AAR screen. Click “End” and save the game.',
       'Come back here and load the save in “Look for the save” button.']
    : ['Start Combat Mission Black Sea.',
       `Saved Games & PBEM → load “${c.playFrom.label}”.`,
       'Play the battle to the AAR screen. Click “End” and save the game.',
       'Come back here and load the save in “Look for the save” button.'];
  body.append(el('ol', { class: 'steps-play' }, steps.map((t) => el('li', {}, t))));
  body.append(el('div', { class: 'file' }, c.playFrom.file));

  const scanBox = el('div');
  body.append(el('p', {},
    el('button', { class: 'primary', onclick: () => scan(s, scanBox) }, 'Look for the save'), ' ',
    // 19/10 (autor): refazer nao sorteia nada (mapa e inimigo sao do no, o resto da semente) — e conserto do arquivo
    el('button', { onclick: () => regenerate(s, false) }, 'Rebuild the battle file'), ' ',
    // num caminho o mapa e do no escolhido (E176)
    s.path ? null : el('button', { onclick: () => regenerate(s, true) }, 'and on another map'), ' ',
    undoButton(s)));
  body.append(scanBox);
}

// UNDO (E176): de volta ao quartel-mestre da batalha anterior, como estava antes do Apply. Vale ate o resultado desta
// batalha ser lido, mesmo depois de jogada; as revelacoes do caminho e os pontos operacionais nao voltam.
async function undoBattle(s) {
  const n = s.current?.n ?? s.next?.n;
  const posKit = s.stage === 'brief' ? s.next?.kitOut === 'done' : !!s.current?.afterKitOut;
  const doKit = !!(s.current?.kitOut || s.next?.kitOut === 'pending');
  if (posKit) {
    if (!confirm(`Undo battle ${n} and go back to the quartermaster of the kit-out?\n\nThe weapons and items chosen there are undone and their credits come back, and so does time bought in Intel for battle ${n} after the kit-out. The save the app wrote for battle ${n} is deleted. The kit-out itself stays played.`)) return;
  } else if (doKit && n !== 1) {
    if (!confirm(`Undo the kit-out and go back to the quartermaster of battle ${n - 1}?\n\nEverything bought there is undone — the special forces included — and its credits come back. The kit-out the app wrote is deleted; if you already played it, the save the game wrote stays on disk but can never be read.\n\nWhat you scouted on the battle path stays scouted, and operational points spent stay spent.`)) return;
  } else if (n === 1) {
    if (!confirm('Go back to choosing the first battle?\n\nThe force you raised is dropped and its credits come back, and the battle and the campaign file the app wrote, if any, are deleted. What you scouted stays scouted, and points spent stay spent.')) return;
  } else if (!confirm(`Undo battle ${n} and go back to the quartermaster of battle ${n - 1}?

`
    + `Everything bought, replaced or sold at that quartermaster is undone and its credits come back, and so does time bought in Intel for battle ${n}. `
    + `The save the app wrote for battle ${n} is deleted; if you already played it, the save the game wrote stays on disk but can never be read as a result.

`
    + 'What you scouted on the battle path stays scouted, and operational points spent stay spent.')) return;
  try {
    const state = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/undo`);
    await loadStatus();
    CAMPAIGN = state;
    await go({ screen: 'campaign', slug: s.slug, tab: state.stage === 'choose' ? 'path' : 'quartermaster' });
  } catch (e) { alert(e.message); }
}

async function regenerate(s, newMap) {
  const aviso = newMap ? `Build battle ${s.current.n} again on a different map?`
    : s.current.kitOut ? `Rebuild the kit-out file?\n\nThe same kit-out — use it if the game cannot load it.`
      : `Rebuild the file of battle ${s.current.n}?\n\nSame map, same enemy — use it if the game cannot load the battle.`;
  if (!confirm(`${aviso}\n\nThis will replace the original battle files.`)) return;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/regenerate`, { newMap });
    renderCampaign(await watchJob(job, 'Building the battle again'));
  } catch (e) {
    if (!e.handled) alert(e.message);
  }
}

// WHY THE WRONG SAVE IS WORTH A SCREEN OF ITS OWN. Applying a result rewrites the roster and builds
// the next battle on top of it, and there is no way back from that. The server now says of every
// candidate whether it is the end of THIS battle; only those get a button, and the others are shown
// with the reason instead of being hidden — a file that vanished from the list teaches nothing.
const SAVE_REASONS = {
  'in-battle': 'made while the battle was still running',
  prepared: 'the file the app prepared for you',
  'other-battle': 'from another battle of this campaign',
  'already-read': 'already read into this campaign',
  'not-a-save': 'not readable as a save',
  discarded: 'from a battle that was undone',
};

async function scan(s, box) {
  box.replaceChildren(el('p', { class: 'hint' }, 'Reading Saved Games…'));
  let saves, overwritten = [];
  try { ({ saves, overwritten = [] } = await api('GET', `/api/campaigns/${encodeURIComponent(s.slug)}/saves`)); } catch (e) {
    box.replaceChildren(el('div', { class: 'banner bad' }, `Could not read Saved Games: ${e.message}. `, el('button', { class: 'linky', onclick: () => scan(s, box) }, 'Try again')));
    return;
  }
  box.replaceChildren();
  const prontos = saves.filter((x) => x.kind === 'ready');
  const recusados = saves.filter((x) => x.kind !== 'ready');

  if (!prontos.length) {
    // 25/10 (UKR): o save desta batalha gravado com o nome de um ja lido nao aparece na lista — o jogo escreveu por cima
    for (const o of overwritten) {
      const novo = o.name.replace(/\.bts$/i, '') + ` B${s.current?.n}.bts`;
      box.append(el('div', { class: 'banner bad' },
        el('b', {}, `"${o.name}" was written again after battle ${s.current?.n} was built. `),
        `The app already read that file${o.readAs ? ` as the result of battle ${o.readAs}` : ''}, so it skips that name. If you saved the end of battle ${s.current?.n} with the same name, rename the file in Saved Games — for example to "${novo}" — and look again.`));
    }
    box.append(el('div', { class: 'banner' }, recusados.length
      ? `No save of the END of battle ${s.current?.n} was found yet — ${recusados.length} other save${recusados.length > 1 ? 's' : ''} of this campaign ${recusados.length > 1 ? 'are' : 'is'} there, listed below with the reason. Play the battle through the debriefing until the game returns to the campaign screen, then look again.`
      : 'No save of this campaign was found yet. Play the battle to the end, then look again.'));
  } else {
    box.append(el('h3', {}, prontos.length === 1 ? `The save of battle ${s.current?.n}` : `Saves that could be the end of battle ${s.current?.n}`));
    for (const sv of prontos) {
      box.append(el('div', { class: 'card' },
        el('h4', {}, sv.name),
        el('div', { class: 'meta' }, `${(sv.bytes / 1048576).toFixed(1)} MB · ${new Date(sv.mtime).toLocaleString()} · embeds ${sv.embedded.join(', ')}`),
        el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: async () => {
          box.replaceChildren(el('p', { class: 'hint' }, 'Reading the roster and the after-action report…'));
          try {
            const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/read/start`, { savePath: sv.file });
            renderCampaign(await watchJob(job, `Reading battle ${s.current?.n}`));
            aoTopo();
          } catch (e) {
            // a falha dentro do job ja aparece na tela do job, com o "← Back"; aqui so o erro de antes dele comecar
            if (e.handled) return;
            box.replaceChildren(el('div', { class: 'banner bad' }, `${sv.name}: ${e.message}${e.id ? ` (error ${e.id})` : ''}`));
            box.append(el('p', {}, el('button', { onclick: () => scan(s, box) }, 'Look again')));
          }
        } }, 'Read this one'))));
    }
  }

  if (recusados.length) {
    const porTipo = new Map();
    for (const x of recusados) { if (!porTipo.has(x.kind)) porTipo.set(x.kind, []); porTipo.get(x.kind).push(x); }
    box.append(el('details', { class: 'refused' },
      el('summary', {}, `${recusados.length} other save${recusados.length > 1 ? 's' : ''} of this campaign, which the app will not read`),
      [...porTipo].map(([kind, lista]) => el('div', { class: 'refused-group' },
        el('strong', {}, SAVE_REASONS[kind] || kind),
        el('p', { class: 'hint' }, lista[0].why || ''),
        el('ul', {}, lista.map((x) => el('li', {},
          x.name,
          x.fromBattle ? el('span', { class: 'dim' }, ` — battle ${x.fromBattle}`) : null)))))));
  }
}

// A ULTIMA BATALHA (05/10/2026, E143): a 12a, ou a derrota que nao deixa outra. A mesma conta do servidor (`acabaAqui`,
// antes de a derrota ser descontada); o resultado lido ja traz o estipendio marcado `campaignOver`.
function ultima(s) {
  if (s.stage !== 'result' || !s.pending?.result) return false;
  const r = s.pending.result;
  if (r.kitOut) return false;   // o kit-out nunca e a ultima: a batalha dele ainda espera
  return !!r.income?.step?.campaignOver || r.battle >= STATUS.rules.battlesToWin || (!s.defeatsUnlimited && s.defeatsLeft - (r.verdict?.won === false ? 1 : 0) < 0);
}

async function finish(s) {
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/finish`);
    const state = await watchJob(job, 'Closing the campaign');
    await loadStatus();
    CAMPAIGN = state;
    await go({ screen: 'campaign', slug: s.slug, tab: 'now' });
  } catch (e) {
    if (!e.handled) alert(e.message);
  }
}

function renderResult(s, body) {
  if (s.pending.result.kitOut) return renderKitOutResult(s, body);
  renderDebrief(s, body, s.pending.result, s.current?.map ? { nome: s.current.map.name, kind: s.current.map.kind, which: 'current' } : null);
  if (ultima(s)) {
    const r = s.pending.result;
    const perdeu = !s.defeatsUnlimited && s.defeatsLeft - (r.verdict?.won === false ? 1 : 0) < 0;
    body.append(
      el('div', { class: 'banner ' + (perdeu ? 'bad' : 'good') }, perdeu
        ? `That was a defeat with none left to spare: the campaign ends at battle ${r.battle}. The battle is recorded and the campaign closes with its score.`
        : `That was the last battle of the campaign. There is nothing more to buy or replace: the reward is paid, the battle is recorded and the campaign closes with its score.`),
      el('p', {}, el('button', { class: 'primary', onclick: () => finish(s) }, 'Finish the campaign')));
    return;
  }
  // num caminho, a proxima batalha se escolhe antes da compra (E176)
  const falta = s.path && !s.path.chosen;
  body.append(el('p', {},
    falta ? el('button', { class: 'primary', onclick: () => setTab(s, 'path') }, 'Choose the next battle on the path →')
      : el('button', { class: 'primary', onclick: () => setTab(s, 'quartermaster') }, 'Go to the quartermaster →')));
}

// O debrief de UMA batalha — a que acabou de ser lida ou uma do historico. As duas tem a mesma
// forma no disco (`battles/NN/result.json`), entao a tela e a mesma.
// `mapa` (autor, 16/10): { nome, kind, which } — o mapa da batalha, com a foto quando `which` diz de onde ela vem
// ('current' no debrief da batalha recem-jogada, o no do caminho no historico); sem `which`, so o nome.
function renderDebrief(s, body, r, mapa = null) {
  const v = r.verdict;
  body.append(
    el('h3', {}, `Battle ${r.battle} — ${v.level}`),
    ...(mapa?.nome ? [mapa.which ? mapThumb(s, mapa.which, mapa.nome, { side: true }) : el('span'),
      el('p', { class: 'map-line' }, el('b', {}, 'Map: '), mapa.nome, kindTail(mapa.kind, ' · '))] : []),
    el('div', { class: 'stat' },
      el('div', {}, el('b', { class: v.won === true ? 'ok' : v.won === false ? 'no' : '' }, v.level), el('span', {}, 'result')),
      el('div', {}, el('b', {}, `${r.aar.player?.pontos ?? 0} – ${r.aar.enemy?.pontos ?? 0}`), el('span', {}, 'points')),
      el('div', {}, el('b', {}, r.totals.casualties), el('span', {}, 'your casualties')),
      el('div', {}, el('b', {}, r.totals.alive), el('span', {}, 'still standing'))));

  // WHAT IT PAYS, AND WHY (a escada, 30/10; 01/11 the player's ladder). Three lines, each with its sum: the command
  // allotment (how much your ladder climbs to the next battle, whatever happened), the replacement cover (the bill for what was
  // lost, up to a cap, times the battle score) and the bonus on the part of the cap that was not needed. The number here
  // is the number the quartermaster spends.
  const inc = r.income;
  if (inc) {
    const pct = (x) => `${Math.round((x || 0) * 100)}%`;
    const c = inc.counts || {}, st = inc.step || {}, cv = inc.cover || {}, bo = inc.bonus || {}, w = inc.weights || {};
    const soma = (w.objectives || 0) + (w.attrition || 0) + (w.survival || 0) || 1;
    const somou = (peso, fracao) => pct(((peso || 0) * (fracao || 0)) / soma);
    const nm = cv.machines?.length || 0;
    const cr = (x) => Math.round(x || 0).toLocaleString('en-US');
    const peso = cv.bandMult && cv.bandMult !== 1 ? ` × ${cv.bandMult} ${cv.band} enemy` : '';
    // 07/11 (autor): quatro colunas iguais para as tres linhas — o que e (frase fixa), o montante (a conta), a taxa
    // (onde a nota da batalha entra) e o que paga. A tabela da nota vem antes, porque a coluna da taxa a usa.
    const conta = (...linhas) => el('td', { class: 'income-amount' }, ...linhas.map((l) => el('div', {}, l)));
    const linhaPaga = (id, nome, oque, montante, taxa, paga) => el('tr', { 'data-income': id, 'data-cr': paga },
      el('td', {}, el('b', {}, nome)), el('td', {}, oque), montante, el('td', {}, taxa), el('td', {}, `${cr(paga)} cr`));
    const pagamento = [el('h3', { 'data-income': 'total', 'data-cr': inc.total, title: contaDoPago(inc) }, `This battle pays ${cr(inc.total)} cr`),
      el('table', { class: 'grid income' },
        el('tr', {}, ...['', 'what it is', 'amount', '× rate', 'pays'].map((h) => el('th', {}, h))),
        linhaPaga('step', 'Command allotment',
          st.campaignOver ? 'there is no next battle to equip for' : 'the next rung of your ladder minus this one\'s, win or lose',
          st.campaignOver ? conta('—') : conta(`${cr(st.to)} (battle ${st.battle}) − ${cr(st.from)} (battle ${st.battle - 1})`, `= ${cr(st.credits)}`),
          st.campaignOver ? '—' : 'paid in full', st.credits),
        linhaPaga('cover', 'Replacement cover', 'what you lost, up to a cap',
          conta(`bill ${cr(cv.bill)} (${nm} machine${nm === 1 ? '' : 's'} ${cr(cv.machinesCost)} + ${cv.men?.toBuy || 0} men × ${cr(cv.men?.perMan)})`,
            `cap ${cr(cv.cap)} (${pct(cv.capShare)} of rung ${cr(cv.rung)}${peso})`,
            cv.bill > cv.cap ? `covered ${cr(cv.covered)} of ${cr(cv.bill)}` : `covered ${cr(cv.covered)}`),
          `battle score ${pct(cv.score)}`, cv.credits),
        linhaPaga('bonus', 'Unused-cover bonus', 'a share of the cap you did not need',
          conta(`${cr(cv.cap)} − ${cr(cv.covered)} = ${cr(bo.unused)}`),
          `${pct(bo.share)} × score ${pct(bo.score)} = ${Math.round((bo.share || 0) * (bo.score || 0) * 1000) / 10}%`, bo.credits))];
    body.append(
      el('h3', {}, `Battle score ${pct(inc.score)}`),
      // 07/11 (autor): o mesmo padrao do pagamento — o que mede, o que ele fez, a fatia, o peso como fatia da nota (os pesos
      // da regra somam 1,1; aqui eles somam 100%) e o que soma; o engagement aparece na conta da fatia da forca.
      el('table', { class: 'grid income' },
        el('tr', {}, ...['', 'what it measures', 'you did', 'share', '× weight', 'adds'].map((h) => el('th', {}, h))),
        el('tr', {}, el('td', {}, el('b', {}, 'Objectives held')), el('td', {}, 'map objectives you hold at the end'),
          conta(`${c.points} of ${c.available} points`),
          el('td', {}, pct(inc.shares.objectives)), el('td', {}, pct((w.objectives || 0) / soma)), el('td', {}, somou(w.objectives, inc.shares.objectives))),
        el('tr', {}, el('td', {}, el('b', {}, 'Enemy knocked out')), el('td', {}, 'the enemy force you put out of action'),
          conta(`${c.enemyMenLost} of ${c.enemyMen} men`, `${c.enemyVehLost} of ${c.enemyVeh} machines`),
          el('td', {}, pct(inc.shares.attrition)), el('td', {}, pct((w.attrition || 0) / soma)), el('td', {}, somou(w.attrition, inc.shares.attrition))),
        el('tr', {}, el('td', {}, el('b', {}, 'Force brought home')), el('td', {}, 'your force still standing, times how much you engaged'),
          conta(`${c.alive} of ${c.fielded} men`, `${c.ownVeh - c.ownVehLost} of ${c.ownVeh} machines`, `engaged ${pct(inc.shares.engagement)}`),
          el('td', {}, inc.shares.engagement < 1 ? `${pct(inc.shares.survival)} × ${pct(inc.shares.engagement)} = ${pct(inc.shares.survival * inc.shares.engagement)}` : pct(inc.shares.survival)),
          el('td', {}, pct((w.survival || 0) / soma)), el('td', {}, somou(w.survival, inc.shares.survival * inc.shares.engagement))),
        el('tr', {}, el('td', { colspan: 5 }), el('td', {}, el('b', {}, `= ${pct(inc.score)}`)))),
      ...pagamento);
  }

  const aar = (side, label) => el('tr', {},
    el('td', {}, label),
    el('td', {}, side?.mortos ?? '?'), el('td', {}, side?.feridos ?? '?'), el('td', {}, side?.desaparecidos ?? '?'),
    el('td', {}, side?.tanques ?? '?'), el('td', {}, side?.blindados ?? '?'), el('td', {}, side?.outrosVeiculos ?? '?'),
    el('td', {}, side?.pontos ?? '?'));
  body.append(el('h3', {}, 'After-action report'), el('table', { class: 'grid' },
    el('tr', {}, ...['', 'killed', 'wounded', 'missing', 'tanks', 'armour', 'vehicles', 'points'].map((h) => el('th', {}, h))),
    aar(r.aar.player, 'You'), aar(r.aar.enemy, 'Enemy')));

  // What he faced. The app built this force, so its order of battle is known exactly — read from
  // the delivered .btt, not from the plan. Its LOSSES are only the totals above: the game keeps a
  // roster for the player's core force and for nothing else.
  // An old debrief (Battle history) brings its own enemy, from that battle's spec; the debrief of the result being
  // spent is the current battle's (QA r2 S6: battle 3 showed the 121 units of battle 12).
  const daBatalha = Array.isArray(r.enemyUnits);
  const enemy = (daBatalha ? r.enemyUnits : s.current?.enemyUnits) || [];
  if (enemy.length) {
    const def = (daBatalha ? r.defense : s.current?.defense) || {};
    body.append(
      el('h3', {}, `What you faced (${enemy.length} units, ${enemy.filter((u) => u.offMap).length} off-map)`),
      enemyBill(def, enemy),
      // ONE ROW PER KIND, not per copy. The `#3` the file hangs on each copy says nothing here, and
      // the formation it sat in is the defense's own tree, which the player never sees and cannot
      // act on — what he wants to read is "nine rifle squads, Green". Off-map goes in the name
      // because it is part of what the thing IS: a battery that never came on the map.
      sortableTable(
        [{ key: 'unit', label: 'unit' }, { key: 'quantity', label: 'quantity', num: true }, { key: 'xp', label: 'experience' }],
        // A experiencia e a da unidade no arquivo entregue; as campanhas abertas antes de o forjador
        // gravar esse campo nao a tem, e ai vale a do plano — que e a mesma para toda a defesa.
        [...enemy.reduce((m, u) => {
          const unit = u.name.replace(/ #\d+$/, '') + (u.offMap ? ' · off-map' : '');
          const xp = u.experience || def.experience || '';
          const k = `${unit}|${xp}`;
          const row = m.get(k) || { unit, quantity: 0, xp };
          row.quantity++; m.set(k, row);
          return m;
        }, new Map()).values()],
        { sort: 'quantity', dir: -1, page: 10 }));
  }

  // WHAT THE BATTLE TAUGHT. Worked out when the save was read, against the force as it fought —
  // shown here before anything is spent, and written unchanged when the player applies it.
  const gainById = new Map((r.progression?.gains || []).map((g) => [g.coreId, g]));
  const proms = r.progression?.promotions || [];
  if (proms.length) {
    body.append(
      el('h3', {}, `What the battle taught (${proms.length} unit${proms.length === 1 ? '' : 's'} changed)`),
      el('p', { class: 'hint' }, 'A unit that took the field counts one battle at its current level, and a victory counts as two. It goes up when it reaches what the level costs — a Regular needs 4, so four draws, two victories, or any mix — and the tally resets on promotion. Nothing is ever demoted: losing men is punishment enough.'),
      el('ul', { class: 'proms' }, proms.map((p) => el('li', {},
        el('b', {}, p.name),
        p.formation ? el('span', { class: 'dim' }, ` · ${p.formation}`) : null,
        p.to !== p.from ? el('span', { class: 'promo' }, `${p.from} → ${p.to}`) : null,
        p.motivationTo !== p.motivationFrom ? el('span', { class: 'dim' }, `motivation ${p.motivationFrom} → ${p.motivationTo}`) : null))));
  }

  // LEADERSHIP (18/10): two battles without losses, counted across the campaign, buy one step.
  const lidById = new Map((r.leadership?.gains || []).map((g) => [g.coreId, g]));
  const lidProms = r.leadership?.promotions || [];
  if (lidProms.length) {
    body.append(
      el('h3', {}, `Leaders who earned their stripes (${lidProms.length} unit${lidProms.length === 1 ? '' : 's'})`),
      el('p', { class: 'hint' }, 'A unit gains one step of leadership for every two battles it comes through without losses: nobody wounded or killed, and its vehicle not destroyed. The battles add up across the campaign; a bad one does not wipe the count. The top is +2.'),
      el('ul', { class: 'proms' }, lidProms.map((p) => el('li', {},
        el('b', {}, p.name),
        p.formation ? el('span', { class: 'dim' }, ` · ${p.formation}`) : null,
        el('span', { class: 'promo' }, `leadership ${p.from} → ${p.to}`)))));
  }

  // Who each core id actually is comes from the force file, kept in the campaign state.
  const byId = new Map((s.units || []).map((u) => [u.coreId, u]));
  // SO AS COMPRADAS (autor, 29/10): o roster do save traz as dormentes do arsenal. `r.present` = quem estava comprado
  // nesta batalha; num resultado antigo, quem teve homens no save ou e off-map e esta comprado agora.
  const compradas = Array.isArray(r.present) ? new Set(r.present)
    : new Set(r.units.filter((u) => u.instantiated > 0 || ((r.offMap || []).includes(u.coreId) && byId.get(u.coreId)?.present)).map((u) => u.coreId));
  const rows = r.units.filter((u) => compradas.has(u.coreId)).map((u) => {
    const d = byId.get(u.coreId) || {};
    const g = gainById.get(u.coreId);
    return {
      unit: d.name || `core ${u.coreId}`,
      formation: d.formation || '',
      fought: u.instantiated > 0,
      men: u.instantiated || u.nominal,
      alive: u.alive,
      casualties: u.casualties,
      // Quanto falta para o proximo nivel, nas duas contagens (E50); vazio para quem nao lutou e
      // para o Elite, que nao tem degrau acima.
      toNext: (() => {
        if (!g) return '';
        const n = g.record?.needs;
        if (!n) return g.experience === 'Elite' ? 'top' : '';
        const c = g.record.after;
        if (c.battles === 0 && c.wins === 0) return 'promoted';
        return `${g.record.points} of ${n.battles}${c.wins ? ` (${c.battles} battle${c.battles === 1 ? '' : 's'}, ${c.wins} won)` : ''}`;
      })(),
      level: g ? (g.experience !== d.experience ? `${d.experience} → ${g.experience}` : g.experience) : (d.experience || ''),
      leadership: (() => {
        const l = lidById.get(u.coreId);
        if (!l) return '';
        return l.to !== l.from ? `${l.from} → ${l.to}` : `${l.to}`;
      })(),
      // AS BATALHAS LIMPAS NA COLUNA DELAS (autor, 25/10): quantas sem perdas a unidade acumulou para o proximo degrau, e
      // se esta somou
      clean: (() => {
        const l = lidById.get(u.coreId);
        if (!l) return '';
        const passo = STATUS.rules.progression?.leadership?.cleanBattlesPerStep || 2;
        return `${l.after} of ${passo}${l.clean ? ' · +1' : ''}`;
      })(),
      fell: u.soldiers.filter((x) => !x.alive).map((x) => x.name).join(', ') || (u.instantiated ? '' : 'not on the field'),
    };
  });
  const hurt = rows.filter((x) => x.casualties > 0).length;
  body.append(el('h3', {}, `Your units (${rows.length}; ${hurt} took losses)`));
  body.append(sortableTable(
    [
      { key: 'unit', label: 'unit' },
      { key: 'formation', label: 'formation', cls: 'dim' },
      { key: 'men', label: 'men', num: true },
      { key: 'alive', label: 'alive', num: true },
      { key: 'casualties', label: 'casualties', num: true },
      { key: 'toNext', label: 'to next level', cls: 'dim' },
      { key: 'level', label: 'experience' },
      { key: 'leadership', label: 'leadership' },
      { key: 'clean', label: 'clean battles' },
      { key: 'fell', label: 'who fell', cls: 'dim' },
    ],
    rows, { sort: 'casualties', dir: -1, page: 10 }));

}

// THE QUARTERMASTER: everything the player spends on, in one place, after the debrief and before
// the next battle is built. Three kinds of spending, all proven at byte level:
//   replacing  — a casualty goes back on his feet: his state byte in the campaign roster is
//                  flipped inside the save the app hands back (FORMATO 111.13).
//   arsenal      — a unit already in the force file, switched off, is switched on (FORMATO 111.21).
//   recruiting   — a formation that was never in the campaign joins it: the force is rebuilt with
//                  it at the end, which leaves every existing core id where it was, and the save's
//                  roster grows a line for each new unit (FORMATO 112.8, proven in game by E14A).
// The side and the enemy library were settled when the campaign was raised, so they are not asked
// again here.
async function renderShop(s, body) {
  const r = s.pending.result;
  // A LOJA DO KIT-OUT (19/10): so armas e itens da Special Forces; nada pago, ninguem a repor (tudo volta de graca), sem
  // biblioteca, arsenal, venda ou treino — o resto abre depois da batalha
  const kitOut = !!r.kitOut;
  const v = r.verdict;
  const rules = STATUS.rules;
  const per = rules.replacement.creditsPerMan;
  // A TRIPULACAO VAI COM A MAQUINA, e por isso nao entra nesta lista. Quem guarnece um BMP ou um
  // Stryker e parte dele: a maquina reposta chega com tripulacao nova, e a que voltou traz a sua de
  // volta de graca, como o conserto. Cobrar o homem aqui era cobrar duas vezes — o autor viu o
  // BMP-2 #2 com "2 of 3 down" na lista de reposicoes. A lista de maquinas e a das regras, a mesma
  // que o servidor usa ao aplicar, entao a tela nao promete o que a escrita nao faz.
  // Papel E nome (E82): a equipe de Stinger tem papel de maquina e e uma dupla a pe. Mesmo teste do
  // servidor (`campaign.isMachine`), pela mesma regra, para os dois nunca discordarem.
  const MACHINES = new Set(rules.replacement.machineRoles || ['apc', 'ifv', 'tank', 'afv', 'artillery', 'drone']);
  const FORA_MAQUINA = rules.replacement.machineExcludes ? new RegExp(rules.replacement.machineExcludes, 'i') : null;
  // todo veiculo e maquina (22/10): o papel, o nome (`vehicleNames`) ou a aba 5 da tabela de tipos — o mesmo `isMachine`
  const NOME_VEICULO = rules.replacement.vehicleNames ? new RegExp(rules.replacement.vehicleNames, 'i') : null;
  const ehMaquina = (u) => !!u && u.role !== 'air' && (MACHINES.has(u.role) || !!(NOME_VEICULO && NOME_VEICULO.test(String(u.name || ''))) || (Array.isArray(u.type) && Number(u.type[1]) === 5))
    && !(FORA_MAQUINA && FORA_MAQUINA.test(String(u.name || '')));
  const offMap = new Set(r.offMap || []);
  // Sem `present`: tripulacao e tripulacao esteja a maquina em campo ou nao (o mesmo teste do
  // servidor, `campaign.machineCrew`). Com ele, o morto do BMP queimado e ja reposto voltava a
  // lista de homens a comprar em toda batalha seguinte (autor, 27/09).
  const maquinaIds = new Set((s.units || []).filter((u) => ehMaquina(u) && !offMap.has(u.coreId)).map((u) => u.coreId));
  const tripulacao = (r.casualtiesToBuy || []).filter((c) => maquinaIds.has(c.coreId));
  const men = (r.casualtiesToBuy || []).filter((c) => !maquinaIds.has(c.coreId));
  const inc = incomeOf(s) || { total: 0, step: { credits: 0 }, cover: { credits: 0, bill: 0, cap: 0 }, bonus: { credits: 0 } };
  const chaveRascunho = `${s.slug}#${r.battle}#${s.pending.savePath || ''}`;
  if (!SHOP_DRAFT || SHOP_DRAFT.key !== chaveRascunho) SHOP_DRAFT = { key: chaveRascunho, men: new Set(), wheels: new Set(), arms: new Map(), kit: new Map(), abilities: [], train: new Set(), selling: new Map() };
  const chosenMen = SHOP_DRAFT.men;
  // no kit-out a bolsa e so o que a campanha tem (quoteKitOut cota contra state.credits)
  const available = kitOut ? s.credits : s.credits + inc.total;
  // a proxima batalha escolhida no caminho (E176): o Apply espera por ela
  const proxima = s.path && s.path.chosen ? s.path.nodes.find((x) => x.id === s.path.chosen) : null;
  const semEscolha = !kitOut && !!(s.path && !s.path.chosen);
  SELLING = SHOP_DRAFT.selling;
  const saleRefund = () => [...SELLING.values()].reduce((a, x) => a + x, 0);

  body.replaceChildren();
  body.append(kitOut
    ? el('h3', {}, `Quartermaster — special forces kit-out, before battle ${r.battle}`, el('span', { class: 'purse' }, el('b', {}, `${available} cr to spend`)))
    : el('h3', {}, `Quartermaster — before battle ${r.battle + 1}${proxima ? ` — ${proxima.map ? proxima.map.name : 'battlefield unknown'}${kindTail(proxima.kind, ', ')}` : ''}`,
      el('span', { class: 'purse' }, `${s.credits} kept + ${inc.step.credits} allotted + ${inc.cover.credits} cover${inc.bonus.credits ? ` + ${inc.bonus.credits} bonus` : ''} = `, el('b', {}, `${available} cr to spend`))));
  if (kitOut) {
    body.append(el('p', { class: 'hint good' }, `Open the special forces below and give each man his weapon and item, and buy the rest of your force from the library — the credits left are what you have for weapons and items. Anyone hurt in the kit-out and every round spent come back for free. Replacements, sales and training open after battle ${r.battle}.`));
  }

  // O QUE SOBRA, ENQUANTO ELE COMPRA. O cabeçalho diz o que havia e sai de cena na primeira rolada
  // de tela; esta barra gruda no topo e carrega o número que importa entre uma compra e a seguinte.
  // Ao lado dele, o Reset — porque a tela é longa e desfazer clicando de volta em vinte caixas não
  // é desfazer.
  const purse = el('div', { class: 'purse-bar' });
  body.append(purse);

  // E O SALDO QUE NAO SAI DA TELA. A barra acima gruda no topo, mas esta tela e longa e o grafico
  // sozinho ocupa 72% da altura: no meio de uma compra o numero sai do campo de visao e o autor
  // pediu ele de volta, fixo, como o do grafico maximizado. Leva a classe `canvas-credits`, que
  // `showCredits` procura, e quem o escreve nesta tela e `drawTail` — a mesma linha que escreve a
  // barra de cima, com a mesma conta. Ja foi o `reprice` quem o escrevia, e ai os dois discordavam:
  // o `reprice` so conhece as unidades e as reposicoes, entao um treinamento marcado aparecia na
  // barra e nao no canto.
  body.append(el('div', { class: 'purse-hud' },
    el('span', { class: 'hud-label' }, 'Credits left'),
    el('b', { class: 'canvas-credits' }, '…')));

  // The lightly wounded are not on the list below and never cost a credit: they are the same men,
  // scratched, and the refit hands them back on their feet with their weapon (FORMATO 116).
  if (!kitOut && r.scratched && STATUS.rules.replacement.healLightWounds !== false) {
    body.append(el('p', { class: 'hint' },
      `${r.scratched} lightly wounded ${r.scratched === 1 ? 'man is' : 'men are'} back on ${r.scratched === 1 ? 'his' : 'their'} feet for free — the refit patches them up. Below are the men who are gone and need replacing.`));
  }

  // Every man who is down, filed under the unit he belongs to. This is what lets a squad be put
  // back together in one click instead of nine, and what puts the aid cross on its block.
  const downByCore = new Map();
  // A result read before the app knew how to attribute a casualty has no core id on it; those
  // men are grouped on their own rather than dropped, so an old pending result still works.
  for (const c of men) {
    const k = c.coreId === undefined ? null : c.coreId;
    if (!downByCore.has(k)) downByCore.set(k, []);
    downByCore.get(k).push(c);
  }
  const unitById = new Map((s.units || []).map((x) => [x.coreId, x]));
  const nameOfUnit = (id) => (unitById.get(id) ? unitById.get(id).name : id === null || id === undefined ? 'unknown unit' : 'core ' + id);

  const hurt = (node) => {
    if (!node || node.isFormation || node.coreId === null || node.coreId === undefined) return null;
    const down = downByCore.get(node.coreId);
    if (!down || !down.length) return null;
    const chosen = down.filter((c) => chosenMen.has(c.index)).length;
    return { down, chosen, cost: (down.length - chosen) * per, strength: down[0].unitStrength ?? '?' };
  };
  // What the chart needs to know about a machine that was destroyed: that it was, and what a new
  // one costs. Marking happens in the list below — the chart only ever reports it.
  const lostSet = new Set(s.lost || []);
  const survivedSet = new Set(s.survived || []);
  // O que aconteceu com cada maquina, na lingua do jogo: destruida, imobilizada, inteira. A
  // "abandonada" (knocked out) virou destruida no E91 — o save nao as separa. A imobilizada volta de
  // graca.
  // Lido a cada desenho, e não capturado uma vez: marcar uma máquina responde no servidor e a
  // resposta traz o mapa inteiro de volta, então uma cópia feita na abertura da tela envelhece no
  // primeiro clique — o preço e o ✓ ficavam mostrando o estado anterior.
  // Uma marca "knocked_out" de antes do E91 aparece e custa como destroyed.
  const estadoDe = (id) => { const m = (s.vehicles || {})[id]; return m === 'knocked_out' ? 'destroyed' : m; };
  const FRACAO = (STATUS.rules.replacement && STATUS.rules.replacement.vehicle) || { destroyed: 1, immobilized: 0 };
  // A NEW MACHINE COMES GREEN (E57): the replacement is priced at the level it arrives with, not
  // at the level the library rolled for the one that burnt — a Crack Bradley cost twice its
  // Veteran twins to replace, and what came back was whatever the dormant twin happened to be.
  // Same scale as `unitPrice`; the server is the authority at Apply (`vehicleCost`).
  const VEH_XP = STATUS.rules.replacement && STATUS.rules.replacement.vehicleExperience;
  const XPF = (STATUS.rules.units && STATUS.rules.units.experienceFactor) || {};
  // o preco de um novo vem do servidor (`s.vehicleBase`, 11/10); a conta local fica so para um servidor antigo
  const precoNovo = (u) => (s.vehicleBase && s.vehicleBase[u.coreId] != null) ? s.vehicleBase[u.coreId] : (VEH_XP && u.experience && XPF[VEH_XP] && XPF[u.experience]) ? Math.round((u.price || 0) * XPF[VEH_XP] / XPF[u.experience]) : (u.price || 0);
  const custoDe = (u) => Math.round(precoNovo(u) * (FRACAO[estadoDe(u.coreId)] ?? 0));
  const lostOf = (node) => {
    if (!node || node.isFormation || !lostSet.has(node.coreId)) return null;
    const u = unitById.get(node.coreId);
    // `bought`: a reposicao dele ja esta paga neste rascunho. O tique mora em Vehicles and guns e a
    // consequencia — esta maquina volta na proxima batalha — pertence ao organograma, que e onde o
    // jogador olha a forca (autor, 27/09).
    // The wreck itself comes back in its slot (28/09), so there is always something to buy.
    return { price: u ? precoNovo(u) : null, spare: !!u, bought: chosenWheels.has(node.coreId) };
  };

  const onHeal = (node) => {
    const down = downByCore.get(node.coreId) || [];
    const whole = down.every((c) => chosenMen.has(c.index));
    for (const c of down) { if (whole) chosenMen.delete(c.index); else chosenMen.add(c.index); }
    redraw();
    renderPicks();
  };

  const box = el('div');      // the men, redrawn on every tick
  const wheels = el('div');   // the machines that did not come back
  const guns = el('div');     // the weapon each man carries, and the change (plano 1 fase C)
  const ops = el('div');      // abilities bought for the next battle, and training (planos 2 e 3)
  const picker = el('div');   // the force and the library, one selector
  const tail = el('div');     // the bill

  // WHERE THE PAGE WAS. Ticking one man rebuilds his whole block — the counts, the "replace all"
  // buttons and the bill all change with it — and a rebuilt block is a NEW list element, scrolled
  // to the top, on a page that jumps with it. Replacing the tenth man of a squad meant scrolling
  // back down every single time. So the scroll of the inner list (`.list` is 340px with a bar of
  // its own), the scroll of the page and the focused control are put back after the redraw. The
  // control is found again by its position, which is stable: ticking a man reorders nothing.
  const keepPlace = (alvo, rebuild) => {
    const antes = alvo.querySelector('.list');
    const rolagem = antes ? antes.scrollTop : 0;
    const pagina = window.scrollY;
    const focaveis = [...alvo.querySelectorAll('input, button, select')];
    const foco = focaveis.indexOf(document.activeElement);
    const saida = rebuild();
    const agora = alvo.querySelector('.list');
    if (agora) agora.scrollTop = rolagem;
    if (foco >= 0) {
      const nova = alvo.querySelectorAll('input, button, select')[foco];
      if (nova) nova.focus({ preventScroll: true });
    }
    if (window.scrollY !== pagina) window.scrollTo(window.scrollX, pagina);
    return saida;
  };

  // A MACHINE HAS NO SHOP OF ITS OWN UNTIL NOW. The game's own way of sending a replacement is the
  // campaign's REFIT percentage, and the app keeps it at zero so that replacements are bought —
  // which worked for men, who had this screen, and left a lost vehicle with no way back at all.
  // `MACHINES` vem das regras e e montado la em cima, junto com a tripulacao.
  const chosenWheels = SHOP_DRAFT.wheels;
  // Off-map units are left out on purpose: artillery, drones and mortars firing from behind the
  // line are never reached by the enemy, so there is nothing to replace. They only ever need
  // ammunition, and that comes back on its own. (`offMap` e montado la em cima, com a tripulacao.)
  const fleet = (s.units || []).filter((u) => u.present && ehMaquina(u) && !offMap.has(u.coreId));
  const offMapFleet = (s.units || []).filter((u) => u.present && offMap.has(u.coreId));
  const wheelCost = () => [...chosenWheels].reduce((a, id) => { const u = fleet.find((x) => x.coreId === id); return a + (u ? custoDe(u) : 0); }, 0);
  const lostMachines = (() => {
    const a = r.aar?.player || {};
    return (a.tanques || 0) + (a.blindados || 0) + (a.outrosVeiculos || 0) + (a.aeronaves || 0);
  })();

  const menCost = () => chosenMen.size * per;
  const priced = () => (NEW && NEW.priced) || [];
  const boughtIds = () => priced().filter((p) => p.owned).flatMap((p) => p.coreIds || []);
  // os veiculos anexados a formacoes que ja sao dele (30/10), ainda nao aplicados
  const anexosPendentes = () => (NEW && NEW.picks ? NEW.picks : []).filter((p) => p.owned).reduce((x, p) => x + (p.extras || []).length, 0);
  // The level chosen for each unit bought from the arsenal, by core id (E53).
  const boughtXp = () => Object.assign({}, ...priced().filter((p) => p.owned).map((p) => p.xp || {}));
  const recruits = () => (NEW && NEW.picks ? NEW.picks.filter((p) => !p.owned) : []);
  SHOP_PENDING = () => recruits().length + boughtIds().length + anexosPendentes();
  const gearCost = () => priced().reduce((a, p) => a + (p.price || 0), 0);

  // AS ARMAS DOS HOMENS (plano 1 fase C). O servidor manda, por unidade, quem carrega o que e o
  // menu do exercito daquela unidade; aqui so se escolhe. O preco e o da classe da arma nova, e
  // vem do servidor junto com o menu, para a tela e a cobranca nunca discordarem.
  const chosenArms = SHOP_DRAFT.arms;     // indice do homem -> arma escolhida
  const armsMenu = (r.gear && r.gear.catalog) || {};
  // A REGRA MANDA, e nao so o que veio no resultado: um resultado lido ANTES de a funcionalidade ser
  // desligada ainda carrega o inventario dentro dele, e sem este teste a secao reapareceria sozinha
  // na tela de quem ja tinha uma batalha aplicada.
  const armsUnits = (STATUS.rules.gear?.enabled === false && !(r.gear && r.gear.specialForcesOnly) ? [] : ((r.gear && r.gear.units) || []))
    .filter((u) => u.men.some((m) => m.canChange));
  const armsMan = (i) => { for (const u of armsUnits) { const m = u.men.find((x) => x.index === Number(i)); if (m) return { unit: u, man: m }; } return null; };
  const armsOption = (u, weapon) => (armsMenu[u.nation] || []).find((x) => x.weapon === weapon) || null;
  const armsCost = () => [...chosenArms.entries()].reduce((a, [i, w]) => { const h = armsMan(i); const o = h && armsOption(h.unit, w); return a + (o ? o.price : 0); }, 0);
  const armsPayload = () => [...chosenArms.entries()].map(([index, weapon]) => ({ index: Number(index), weapon }));
  // O ITEM DE INVENTARIO (05/10, E145): um por soldado, do catalogo do exercito dele. Map indice -> id (null = largar o
  // comprado). Mesmo escopo e mesma leitura da arma; o servidor recusa o que nao fecha e a cotacao cobra.
  const chosenKit = SHOP_DRAFT.kit;
  const kitMenu = (r.gear && r.gear.kitCatalog) || {};
  const kitOption = (u, id) => (kitMenu[u.nation] || []).find((x) => x.id === id) || null;
  const kitCost = () => [...chosenKit.entries()].reduce((a, [i, id]) => { const h = armsMan(i); const o = h && id && kitOption(h.unit, id); return a + (o ? o.price : 0); }, 0);
  const kitPayload = () => [...chosenKit.entries()].map(([index, item]) => ({ index: Number(index), item }));
  // O ORG CHART DAS SPECIAL FORCES (28/09): o bloco de cada unidade abre os homens dela, e cada homem
  // o menu de armas. Os homens vem do save (`r.gear.units`, por core id); a unidade que ainda nao
  // lutou mostra o kit de fabrica. A escolha e a mesma `chosenArms` de sempre, e o rodape cobra.
  const armsByCore = new Map(((r.gear && r.gear.units) || []).map((u) => [u.coreId, u]));
  const shopMen = {
    of: (n) => {
      const u = n.coreId !== null && n.coreId !== undefined ? armsByCore.get(n.coreId) : null;
      if (u) return { nation: u.nation, men: u.men, note: null, readOnly: false };
      const kit = kitMen(n);
      if (kit) return { ...kit, ...(n.owned ? { note: 'No soldiers in this save yet — read after its first battle.', hint: 'No soldier records in this save for this unit — its men are read after the battle they fight.' } : {}) };
      return null;
    },
    menu: (nation) => armsMenu[nation] || [],
    chosen: (index) => chosenArms.get(index) || null,
    choose: (index, weapon) => { if (weapon) chosenArms.set(index, weapon); else chosenArms.delete(index); drawArms(); drawTail(); },
    // a recarga (18/10) so onde a unidade tem o lancador: de fabrica, comprado, ou escolhido agora
    kitMenu: (nation, homens = null) => (kitMenu[nation] || []).filter((x) => x.kind !== 'reload' || !homens
      || homens.some((h) => h.second === x.launcher || h.weapon === x.launcher || h.kit === x.launcher || chosenKit.get(h.index) === x.launcher)),
    kitChosen: (index) => (chosenKit.has(index) ? chosenKit.get(index) : undefined),
    // id: o item; null: largar o comprado; undefined: desfazer a escolha
    chooseKit: (index, id) => { if (id === undefined) chosenKit.delete(index); else chosenKit.set(index, id); drawArms(); drawTail(); },
    count: () => chosenArms.size + chosenKit.size,
    reset: () => { chosenArms.clear(); chosenKit.clear(); drawArms(); drawTail(); },
  };

  // HABILIDADES OPERACIONAIS (plano 2) e TREINO (plano 3). As duas sao compras para a batalha
  // SEGUINTE, no mesmo orcamento de tudo o mais. O menu de habilidades vem das regras; o do treino
  // vem do servidor, calculado pela mesma funcao que cobra.
  // AS HABILIDADES SAIRAM DA LOJA (E176): o tempo se compra na tela Intel, sobre a batalha ja montada; o resto aposentou.
  const abilityMenu = [];
  const jaPendentes = ((s.abilities || {}).pending || []).map((a) => a.id);
  const chosenAbilities = SHOP_DRAFT.abilities; // ids, com repeticao ate o maxStacks
  const abilityCount = (id) => chosenAbilities.filter((x) => x === id).length + jaPendentes.filter((x) => x === id).length;
  const abilityCost = () => chosenAbilities.reduce((a, id) => a + ((abilityMenu.find((x) => x.id === id) || {}).price || 0), 0);
  const trainMenu = (STATUS.rules.progression?.training?.on === false) ? [] : (r.training || []);
  const chosenTrain = SHOP_DRAFT.train;
  const trainCost = () => [...chosenTrain].reduce((a, id) => a + ((trainMenu.find((x) => x.coreId === id) || {}).price || 0), 0);
  const abilityWhat = (a) => {
    const e = a.effect || {};
    const partes = [];
    if (e.minutes) partes.push(`+${e.minutes} min on the clock`);
    if (e.noRefit) partes.push('no resupply and no rest');
    if (e.intel) partes.push('the enemy order of battle up front');
    if (e.defenseBudget) partes.push(`the defense gets ${Math.round(Math.abs(e.defenseBudget) * 100)}% less to spend`);
    return partes.join(' · ');
  };

  const drawOps = () => keepPlace(ops, () => {
    if (!abilityMenu.length && !trainMenu.length) { ops.replaceChildren(); return; }
    const filhos = [];
    if (abilityMenu.length) {
      filhos.push(
        el('h3', {}, `Operational abilities for battle ${r.battle + 1}`),
        el('div', { class: 'list' }, abilityMenu.map((a) => {
          const tem = abilityCount(a.id);
          const teto = a.maxStacks ?? 1;
          const cheio = tem >= teto;
          return el('div', { class: 'item' + (tem ? ' on' : '') },
            el('span', {}, a.name, el('span', { class: 'sub' }, abilityWhat(a))),
            el('span', { class: 'row' },
              tem ? el('button', { class: 'linky', onclick: () => { const k = chosenAbilities.lastIndexOf(a.id); if (k >= 0) chosenAbilities.splice(k, 1); drawOps(); drawTail(); } }, `− ${tem}${teto > 1 ? '/' + teto : ''}`) : el('span'),
              el('button', { ...(cheio ? { disabled: 'disabled' } : {}), onclick: () => { chosenAbilities.push(a.id); drawOps(); drawTail(); } }, `buy · ${a.price} cr`)));
        })));
    }
    if (trainMenu.length) {
      const teto = (STATUS.rules.progression && STATUS.rules.progression.training || {}).maxLevel || 'Veteran';
      filhos.push(
        el('h3', {}, 'Training'),
        el('div', { class: 'list' }, trainMenu.map((t) => {
          const on = chosenTrain.has(t.coreId);
          const cb = el('input', { type: 'checkbox', ...(on ? { checked: 'checked' } : {}) });
          cb.addEventListener('change', () => { cb.checked ? chosenTrain.add(t.coreId) : chosenTrain.delete(t.coreId); drawOps(); drawTail(); });
          return el('div', { class: 'item' + (on ? ' on' : '') },
            el('label', { class: 'row' }, cb, el('span', {}, t.name, el('span', { class: 'sub' }, `${t.from} → ${t.to}`)),
              el('span', { class: 'price' }, ` ${t.price} cr`)));
        })));
    }
    ops.replaceChildren(...filhos);
  });

  // AS ARMAS AGORA SE ESCOLHEM NO CHART (28/09): aqui fica so o aviso de onde, e o que ja foi escolhido.
  const drawArms = () => keepPlace(guns, () => {
    if (!armsUnits.length) { guns.replaceChildren(); return; }
    const trocas = chosenArms.size;
    guns.replaceChildren(
      el('h3', {}, r.gear && r.gear.specialForcesOnly ? 'Special forces — weapons and kit' : 'Weapons'),
      el('p', {}, el('span', { class: 'hint' }, `${trocas} weapon change${trocas === 1 ? '' : 's'} · ${armsCost()} cr · ${chosenKit.size} item${chosenKit.size === 1 ? '' : 's'} · ${kitCost()} cr`)));
  });

  // WHAT THE SAVE SAYS ABOUT THE REST OF THE MOTOR POOL. The quartermaster stocks machines, and a
  // truck is not one of them — but the save names it all the same, and a burnt Ural should not be
  // news the player never gets. So it is listed here as a casualty and nothing else: no tick, no
  // price, no bill. A truck comes back the way it was bought, with its formation (autor, 27/09).
  const baixasSemLoja = () => ((r.vehicles && r.vehicles.notListed) || []);

  // AS DUAS FROTAS (22/10, autor): os veiculos das formacoes e os comprados avulsos (attachment), cada um com a sua lista;
  // todos com reposicao na vaga.
  const secoesDaFrota = (linha) => {
    const daFormacao = fleet.filter((u) => !u.single), avulsos = fleet.filter((u) => u.single);
    return [
      daFormacao.length && avulsos.length ? el('h4', {}, 'Vehicles of your formations') : null,
      daFormacao.length ? el('div', { class: 'fleet' }, ...daFormacao.map(linha)) : null,
      avulsos.length ? el('h4', {}, 'Attached vehicles') : null,
      avulsos.length ? el('div', { class: 'fleet' }, ...avulsos.map(linha)) : null,
    ].filter(Boolean);
  };
  const drawWheels = () => keepPlace(wheels, () => {
    if (!fleet.length && !baixasSemLoja().length) { wheels.replaceChildren(); return; }
    wheels.replaceChildren(
      el('h3', {}, 'Vehicles and guns'),
      // With no machine in the force the paragraph below would talk about a list that is not there;
      // the casualties the quartermaster does not stock have their own line further down.
      !fleet.length ? el('span') : el('p', { class: 'hint' },
        // E90: the save names the machines, and the marks below come from it. The old text — "the
        // save does not say which" — stays for a result read before the app could tell.
        (r.vehicles && Object.keys(r.vehicles.marks || {}).length)
          ? `Battle ${r.battle}: the save says what happened to each machine that fought, and it is marked below — ${['destroyed', 'immobilized', 'survived'].map((k) => [k, Object.values(r.vehicles.marks).filter((x) => x === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${k === 'survived' ? 'intact' : k}`).join(', ')}${lostMachines ? ` (the report counts ${lostMachines} lost)` : ''}. Tick a destroyed one to buy the replacement; untick it if the credits are short and it stays destroyed until you can afford it.`
          : lostMachines
          ? `Battle ${r.battle} cost you ${lostMachines} machine${lostMachines > 1 ? 's' : ''} — the report counts them but the save does not name them. Damage short of a wreck is repaired between battles, for nothing.`
          : `Nothing of yours was reported destroyed in this battle. ${lostSet.size ? `${lostSet.size} machine${lostSet.size > 1 ? 's' : ''} lost earlier ${lostSet.size > 1 ? 'are' : 'is'} still waiting for a replacement. ` : ''}Damage short of a wreck is repaired between battles, for nothing.`),
      // IMOBILIZADO NO FIM (30/09): o jogo o deu como perdido na transicao; o ultimo turno diz que nao.
      (r.vehicles && (r.vehicles.writtenOff || []).length)
        ? el('p', { class: 'hint good' }, `${r.vehicles.writtenOff.map((x) => `${x.name}${x.crew && x.crew.length ? ` (${x.crew.join(', ')})` : ''}`).join('; ')}: immobilized at the end of the battle. The game wrote ${r.vehicles.writtenOff.length > 1 ? 'them' : 'it'} off as destroyed, but the last turn save shows ${r.vehicles.writtenOff.length > 1 ? 'them' : 'it'} immobilized, so ${r.vehicles.writtenOff.length > 1 ? 'they are' : 'it is'} marked immobilized and ${r.vehicles.writtenOff.length > 1 ? 'come' : 'comes'} back in ${r.vehicles.writtenOff.length > 1 ? 'their' : 'its'} own slot, for nothing.`)
        : el('span'),
      ...secoesDaFrota((u) => {
        const spare = true;   // the machine itself is rebuilt: no twin needed
        const gone = lostSet.has(u.coreId);
        const on = chosenWheels.has(u.coreId);
        // ONE TICK IS THE WHOLE GESTURE: this machine did not come back, replace it. Saying so and
        // paying for it are the same thought, and the author asked why they were two clicks.
        //
        // They are still two FACTS, and that matters when the credits are short: unticking cancels
        // the purchase and the machine stays marked as destroyed — in the chart and on this list —
        // until there is money for it.
        //
        // AND THERE IS A THIRD ANSWER: survived. With seven of eleven gone it is fewer clicks to
        // name the four that came through — and saying so is worth as much as the other answer,
        // because it is the second half of the ground truth the app needs before it can ever read
        // destruction out of the save on its own.
        const alive = survivedSet.has(u.coreId);
        const pelotao = (u.formation || '').split('/').map((x) => x.trim()).filter(Boolean).pop();
        // O ESTADO VEM DO SAVE (autor, 16/10): a tela so informa o que aconteceu; nao ha mais como trocar a marca.
        const estado = estadoDe(u.coreId) || 'unknown';
        const rotulo = { destroyed: 'destroyed', immobilized: 'immobilized', survived: 'intact', unknown: 'not reported' }[estado] || estado;
        const explica = {
          destroyed: 'Destroyed or abandoned — it does not come back. A new machine costs what a new machine costs.',
          immobilized: 'It could not move at the end. Not a loss: the game repairs it between battles and it takes the field again, for nothing.',
          survived: 'It came through.',
          unknown: 'The save did not report this machine.',
        }[estado] || '';

        const custo = custoDe(u);
        return el('div', { class: `fleet-row ${estado}` + (on ? ' on' : '') },
          el('span', { class: 'marks' }, el('span', { class: 'mark on', title: explica }, rotulo)),
          el('span', { class: 'nm' }, u.name, pelotao ? el('span', { class: 'where' }, pelotao) : null),
          custo > 0
            ? el('label', { class: 'pr buy' },
              el('input', {
                type: 'checkbox', ...(on ? { checked: 'checked' } : {}), ...(spare ? {} : { disabled: 'disabled' }),
                onchange: (e) => { if (e.target.checked) chosenWheels.add(u.coreId); else chosenWheels.delete(u.coreId); drawWheels(); drawTail(); renderPicks(); },
              }),
              spare ? `replace for ${custo} cr` : 'no spare in the arsenal')
            : el('span', { class: 'pr' }, {
              immobilized: 'repaired between battles, free',   // E91: pelo proprio jogo (a troca por gemeo do E62 esta desligada)
              survived: 'came through',
              unknown: `${precoNovo(u)} cr if destroyed${VEH_XP ? ` (comes ${VEH_XP})` : ''}`,
            }[estado] || ''));
      }),
      offMapFleet.length
        ? el('p', { class: 'hint' }, `${offMapFleet.map((u) => u.name).join(', ')}: fires from off the map, where nothing can reach it. Never lost, and every round goes back to its factory load before the next battle, smoke included.`)
        : el('span'),
      // E90/E100: the save also names the trucks and the gun HMMWVs, which the quartermaster does
      // not stock. They are listed as casualties — the game will not field a wreck again, so the
      // player has to know — and there is nothing to tick: a new one comes with its formation.
      baixasSemLoja().length
        ? el('p', { class: 'hint' }, `The save also reports these, and there is nothing to buy here.`)
        : el('span'),
      baixasSemLoja().length
        ? el('div', { class: 'fleet' }, ...baixasSemLoja().map((x) => el('div', { class: `fleet-row ro ${x.status}` },
          el('span', { class: 'marks' }, el('span', { class: 'mark on' }, x.status)),
          el('span', { class: 'nm' }, x.name),
          el('span', { class: 'pr' }, x.status === 'destroyed' ? 'gone — not replaced here' : 'repaired between battles, free'))))
        : el('span'));
  });

  // O QUE ESTA TELA MUDOU, separado em duas naturezas. As caixas marcadas são rascunho e vivem só
  // no navegador; marcar uma máquina e tirar uma unidade de campo já gravaram no estado, porque o
  // chart tem de responder no mesmo clique. O Reset precisa saber a diferença: o primeiro grupo se
  // desfaz redesenhando, o segundo tem de voltar no servidor.
  const alterado = () => {
    const snap = s.shopSnapshot || null;
    const antes = (snap && snap.vehicles) || {};
    const agora = s.vehicles || {};
    const marcas = snap ? [...new Set([...Object.keys(antes), ...Object.keys(agora)])].filter((id) => antes[id] !== agora[id]).length : 0;
    const foraAntes = new Set((snap && snap.standDown) || []);
    const foraAgora = new Set(s.standDown || []);
    const fora = snap ? [...new Set([...foraAntes, ...foraAgora])].filter((id) => foraAntes.has(id) !== foraAgora.has(id)).length : 0;
    const fielding = boughtIds().length + anexosPendentes();
    const recrutando = recruits().length;
    return {
      marcas, fora, fielding, recrutando, men: chosenMen.size, wheels: chosenWheels.size, vendendo: SELLING.size,
      noServidor: marcas + fora > 0,
      alguma: !!(marcas || fora || fielding || recrutando || chosenMen.size || chosenWheels.size || SELLING.size),
      podeVoltar: !!snap,
    };
  };

  const reset = async () => {
    const c = alterado();
    if (!c.alguma) return;
    const linhas = [
      c.men ? `${c.men} replacement${c.men > 1 ? 's' : ''} unticked` : null,
      c.wheels ? `${c.wheels} vehicle replacement${c.wheels > 1 ? 's' : ''} unticked` : null,
      c.fielding ? `${c.fielding} unit${c.fielding > 1 ? 's' : ''} taken back out of the next battle` : null,
      c.recrutando ? `${c.recrutando} formation${c.recrutando > 1 ? 's' : ''} dropped from the shopping list` : null,
      c.vendendo ? `${c.vendendo} unit${c.vendendo > 1 ? 's' : ''} no longer for sale` : null,
      c.marcas ? `${c.marcas} vehicle mark${c.marcas > 1 ? 's' : ''} undone` : null,
      c.fora ? `${c.fora} unit${c.fora > 1 ? 's' : ''} put back the way ${c.fora > 1 ? 'they were' : 'it was'}` : null,
    ].filter(Boolean);
    const aviso = c.noServidor && !c.podeVoltar
      ? '\n\nThe marks made on this screen cannot be undone: this result was read by an older build of the app, which kept no starting point.'
      : '';
    if (!confirm(`Reset the quartermaster?\n\n${linhas.map((x) => '  · ' + x).join('\n')}\n\nThis puts the screen back to how it was when the result of battle ${r.battle} landed. Nothing from an earlier battle is touched, and nothing has been applied yet.${aviso}`)) return;
    try {
      if (c.noServidor && c.podeVoltar) {
        const st = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/shop/reset`);
        SHOP_DRAFT = null;
        CAMPAIGN = st;
        renderCampaign(st);
        aoTopo();
        return;
      }
      SHOP_DRAFT = null;
      renderCampaign(s);           // só rascunho: redesenhar já é desfazer
      aoTopo();
    } catch (e) { if (!e.handled) alert(e.message); }
  };

  const drawPurse = (cost, left, semPreco = null) => {
    const c = alterado();
    const botao = el('button', { class: 'linky', ...(c.alguma ? {} : { disabled: 'disabled' }), onclick: reset }, '↺ Reset');
    botao.title = c.alguma
      ? `Put this screen back to how it was when the result of battle ${r.battle} landed`
      : 'Nothing has been changed on this screen yet';
    purse.replaceChildren(
      el('span', { class: 'cell' }, 'To spend', el('b', {}, `${available} cr`)),
      el('span', { class: 'cell' }, 'Committed', el('b', semPreco ? { class: 'no', title: `Recruits not priced: ${semPreco}` } : {}, `${cost} cr${semPreco ? ' + ?' : ''}`)),
      el('span', { class: 'cell left' }, 'Left', el('b', { class: left < 0 ? 'no' : '' }, `${left} cr`)),
      el('span', { class: 'grow' },
        el('span', { class: 'undo' }, c.noServidor ? `${c.marcas + c.fora} change${c.marcas + c.fora > 1 ? 's' : ''} already written` : ''),
        botao));
  };

  // Uma formacao recrutada sem cotacao nao entra na soma — entao o Apply nao pode sair (03/10).
  const unpriced = () => (NEW && NEW.priceError ? NEW.priceError
    : recruits().length !== priced().filter((p) => !p.owned).length ? 'pricing…' : null);

  // O CORPO DO APPLY, num lugar so: o botao manda este e a cotacao (05/10) pergunta com este.
  const applyBody = () => ({
    replaceIndices: [...chosenMen], replaceVehicles: [...chosenWheels], purchaseCoreIds: boughtIds(),
    buyFormations: recruits().map((p) => ({
      source: p.formation.file, nation: p.formation.nation, points: p.formation.points, keep: [...p.keep], xp: p.xp, extras: p.formation.sf ? [] : extrasPayload(p), swaps: p.formation.sf ? [] : p.swaps || [], sf: !!p.formation.sf,
    })),
    purchaseXp: boughtXp(), gear: armsPayload(), kit: kitPayload(), abilities: [...chosenAbilities], train: [...chosenTrain], sell: [...SELLING.keys()],
    attachOwned: (NEW && NEW.picks ? NEW.picks : []).filter((p) => p.owned).flatMap((p) => (p.extras || []).map((e) => ({ pick: p.index, key: e.key, tipo: e.tipo, type: e.type }))),
  });

  // A COTACAO DO SERVIDOR (05/10/2026). A conta desta tela e da pagina; a que o Apply cobra e a do servidor. Depois de
  // cada redesenho, com um respiro, a pagina pergunta ao servidor quanto ele cobraria por exatamente este corpo: uma
  // recusa aparece aqui e trava o Apply ANTES do clique, e um numero diferente do da tela vai para a bolsa.
  let cotacaoSeq = 0, cotacaoTimer = null;
  const pedirCotacao = (cost, botao, linha) => {
    clearTimeout(cotacaoTimer);
    cotacaoTimer = setTimeout(async () => {
      const seq = ++cotacaoSeq;
      let q;
      try { q = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/quote`, applyBody()); } catch { return; }
      if (seq !== cotacaoSeq || !linha.isConnected) return;
      if (!q.ok) {
        botao.disabled = true; botao.title = q.refusal;
        linha.replaceChildren(el('div', { class: 'banner bad' }, `Apply would be refused: ${q.refusal}`));
        return;
      }
      // AS LINHAS DO ROSTER (08/11, autor: a compra de 15 linhas recusada com 4 sobrando): o que sobra, antes da recusa
      const ro = q.quote.roster;
      const linhasEl = ro && ro.max ? el('div', { class: 'banner' + (ro.lines + ro.newLines >= ro.max - 1 ? ' warn' : '') },
        `Roster lines: ${ro.lines} of ${ro.max} used (${Math.max(0, ro.max - ro.lines)} left; the game reads the first ${ro.visible || ro.max}). `,
        ro.newLines ? `This purchase adds ${ro.newLines}: ${ro.formations.map((f) => `${f.name} ${f.lines}`).join(', ')}. ` : '',
        ro.trimmed ? 'A unit takes a line once it is in the field; the ones left in reserve stay out of the battle file and the roster until you pay for them.' : 'Every unit of a formation takes a line, kept or not, and a line is never given back.') : null;
      if (q.quote.spend !== cost) {
        drawPurse(q.quote.spend, q.quote.left);
        showCredits(q.quote.left);
        if (q.quote.left < 0) { botao.disabled = true; botao.title = 'Over budget at the server\'s prices'; }
        linha.replaceChildren(...[el('div', { class: 'banner' }, `The server prices this at ${q.quote.spend} cr (this screen added up ${cost} cr). Apply charges the server's number.`), linhasEl].filter(Boolean));
      } else linha.replaceChildren(...[linhasEl].filter(Boolean));
    }, 300);
  };

  const drawTail = () => {
    const fielding = boughtIds().length;
    const cost = menCost() + gearCost() + wheelCost() + armsCost() + kitCost() + abilityCost() + trainCost();
    const left = available + saleRefund() - cost;
    const semPreco = unpriced();
    drawPurse(cost, left, semPreco);
    // E o saldo fixo do canto leva o MESMO numero, daqui. Antes ele vinha do `reprice`, que so
    // conhece as unidades e as reposicoes: treinar um Abrams por 450 cr mexia na barra de cima e
    // deixava o canto parado, dois numeros diferentes na mesma tela. Quem sabe a conta inteira e
    // esta funcao, que roda a cada clique — as caixas de treino, arma, habilidade e veiculo todas
    // passam por ela.
    showCredits(left);
    const linhaDoServidor = el('div');
    const vazias = recruits().filter(escolhaVazia).map(nomeDaEscolha);   // 29/10: a formacao chega vazia
    const botao = el('button', {
      class: 'primary', ...(cost > available + saleRefund() || semPreco || semEscolha || vazias.length ? { disabled: 'disabled' } : {}),
      // a disabled Apply says why (QA I4)
      title: semEscolha ? 'Choose the next battle on the battle path first' : vazias.length ? avisoVazias(vazias) : semPreco ? 'Some formations are not priced yet' : cost > available + saleRefund() ? `Over budget by ${cost - available - saleRefund()} cr` : '',
      onclick: () => apply(s, applyBody()),
    }, kitOut ? `Apply and go on to battle ${r.battle}` : `Apply and prepare battle ${r.battle + 1}`);
    if (!semPreco && !semEscolha) pedirCotacao(cost, botao, linhaDoServidor);
    if (kitOut) {
      tail.replaceChildren(
        el('div', { class: 'budget' },
          el('div', { class: 'line' }, el('span', {}, 'Credits now'), el('span', {}, s.credits + ' cr')),
          el('div', { class: 'line' }, el('span', {}, `Re-arming ${chosenArms.size} soldier${chosenArms.size === 1 ? '' : 's'}`), el('span', {}, armsCost() + ' cr')),
          el('div', { class: 'line' }, el('span', {}, `Kitting ${chosenKit.size} soldier${chosenKit.size === 1 ? '' : 's'}`), el('span', {}, kitCost() + ' cr')),
          el('div', { class: 'line' }, el('span', {}, `Fielding ${fielding} units you already own`), el('span', {}, priced().filter((p) => p.owned).reduce((a, p) => a + (p.price || 0), 0) + ' cr')),
          el('div', { class: 'line' }, el('span', {}, `Recruiting ${recruits().length} formations`), semPreco
            ? el('b', { class: 'no' }, semPreco === 'pricing…' ? semPreco : 'not priced')
            : el('span', {}, priced().filter((p) => !p.owned).reduce((a, p) => a + (p.price || 0), 0) + ' cr')),
          semPreco && semPreco !== 'pricing…' ? el('div', { class: 'banner bad' }, `The formations you are recruiting could not be priced: ${semPreco}. Apply is off until this clears.`) : null,
          el('div', { class: 'line' }, el('span', {}, 'Everyone hurt and every round spent in the kit-out'), el('span', { class: 'ok' }, 'free')),
          el('div', { class: 'line' }, el('span', {}, 'Left after spending'), el('b', { class: left < 0 ? 'no' : '' }, left + ' cr'))),
        linhaDoServidor, vazias.length ? el('div', { class: 'banner bad empty-pick' }, avisoVazias(vazias)) : null, botao);
      return;
    }
    tail.replaceChildren(
      el('div', { class: 'budget' },
        el('div', { class: 'line' }, el('span', {}, 'Credits now'), el('span', {}, s.credits + ' cr')),
        el('div', { class: 'line' }, el('span', {}, `Command allotment for battle ${r.battle + 1}`), el('span', {}, inc.step.credits + ' cr')),
        el('div', { class: 'line' }, el('span', {}, `Replacement cover (bill ${inc.cover.bill} cr, cap ${inc.cover.cap} cr)`), el('span', {}, inc.cover.credits + ' cr')),
        inc.bonus.credits ? el('div', { class: 'line' }, el('span', {}, 'Unused-cover bonus'), el('span', {}, inc.bonus.credits + ' cr')) : null,
        el('div', { class: 'line' }, el('span', {}, `Replacing ${chosenMen.size} men`), el('span', {}, menCost() + ' cr')),
        el('div', { class: 'line' }, el('span', {}, `Replacing ${chosenWheels.size} vehicles`), el('span', {}, wheelCost() + ' cr')),
        chosenArms.size ? el('div', { class: 'line' }, el('span', {}, `Re-arming ${chosenArms.size} soldier${chosenArms.size === 1 ? '' : 's'}`), el('span', {}, armsCost() + ' cr')) : null,
        chosenKit.size ? el('div', { class: 'line' }, el('span', {}, `Kitting ${chosenKit.size} soldier${chosenKit.size === 1 ? '' : 's'}`), el('span', {}, kitCost() + ' cr')) : null,
        chosenAbilities.length ? el('div', { class: 'line' }, el('span', {}, `${chosenAbilities.length} operational abilit${chosenAbilities.length === 1 ? 'y' : 'ies'}`), el('span', {}, abilityCost() + ' cr')) : null,
        chosenTrain.size ? el('div', { class: 'line' }, el('span', {}, `Training ${chosenTrain.size} unit${chosenTrain.size === 1 ? '' : 's'}`), el('span', {}, trainCost() + ' cr')) : null,
        SELLING.size ? el('div', { class: 'line' }, el('span', {}, `Selling ${SELLING.size} unit${SELLING.size === 1 ? '' : 's'}`), el('span', { class: 'ok' }, saleRefund() ? `+${saleRefund()} cr` : 'no refund')) : null,
        el('div', { class: 'line' }, el('span', {}, `Fielding ${fielding} units you already own`), el('span', {}, priced().filter((p) => p.owned).reduce((a, p) => a + (p.price || 0), 0) + ' cr')),
        el('div', { class: 'line' }, el('span', {}, `Recruiting ${recruits().length} formations`), semPreco
          ? el('b', { class: 'no' }, semPreco === 'pricing…' ? semPreco : 'not priced')
          : el('span', {}, priced().filter((p) => !p.owned).reduce((a, p) => a + (p.price || 0), 0) + ' cr')),
        semPreco && semPreco !== 'pricing…' ? el('div', { class: 'banner bad' }, `The formations you are recruiting could not be priced: ${semPreco}. The totals leave them out, so Apply is off until this clears — reload the page, and if it stays, send the diagnostics.`) : null,
        el('div', { class: 'line' }, el('span', {}, 'Left after spending'), el('b', { class: left < 0 ? 'no' : '' }, left + ' cr'))),
      linhaDoServidor,
      vazias.length ? el('div', { class: 'banner bad empty-pick' }, avisoVazias(vazias)) : null,
      semEscolha ? el('div', { class: 'banner' }, 'The next battle is not chosen yet. ', el('button', { class: 'linky', onclick: () => setTab(s, 'path') }, 'Choose it on the battle path →')) : null,
      botao);
  };

  const redraw = () => keepPlace(box, () => {
    const byUnit = [...downByCore.entries()].sort((a, b) => b[1].length - a[1].length);
    box.replaceChildren(
      el('h3', {}, 'Replacements'),
      el('div', { class: 'stat' },
        el('div', {}, el('b', {}, men.length), el('span', {}, 'men down')),
        el('div', {}, el('b', {}, byUnit.length), el('span', {}, 'units')),
        el('div', {}, el('b', {}, `${per} cr`), el('span', {}, 'per man')),
        tripulacao.length ? el('div', {}, el('b', {}, tripulacao.length), el('span', {}, 'crew, free')) : null),
      el('p', { class: 'hint' }, 'A replaced man comes back armed, with full ammunition. Lightly wounded heal for free.'),
      (r.rescued || []).length
        ? el('p', { class: 'hint good' }, `${r.rescued.length} wounded ${r.rescued.length > 1 ? 'men were' : 'man was'} carried off the field and made it back — ${r.rescued.length > 1 ? 'they rejoin' : 'he rejoins'} their squads for nothing, and ${r.rescued.length > 1 ? 'are' : 'is'} already off the list below.`)
        : el('span'),
      el('p', {},
        el('button', { onclick: () => { men.forEach((c) => chosenMen.add(c.index)); redraw(); renderPicks(); } }, `Replace all — ${men.length * per} cr`), ' ',
        el('button', { onclick: () => { chosenMen.clear(); redraw(); renderPicks(); } }, 'Select none'), ' ',
        el('span', { class: 'hint' }, `${chosenMen.size} chosen · ${chosenMen.size * per} cr`)),
      el('div', { class: 'list' }, byUnit.map(([coreId, list]) => {
        const chosen = list.filter((c) => chosenMen.has(c.index)).length;
        const head = el('div', { class: 'item unit-head' },
          el('span', {}, nameOfUnit(coreId),
            // the formations above it, so sibling squads can be told apart (10/10)
            unitById.get(coreId)?.formation ? el('span', { class: 'unit-path' }, unitById.get(coreId).formation.split(' / ').join(' › ')) : null),
          el('button', {
            class: 'linky',
            onclick: () => { const whole = chosen === list.length; for (const c of list) { if (whole) chosenMen.delete(c.index); else chosenMen.add(c.index); } redraw(); renderPicks(); },
          }, chosen === list.length ? `✓ all ${list.length} replaced` : `✚ replace all ${list.length} · ${(list.length - chosen) * per} cr`),
          el('span', { class: 'sub' }, `${list.length} of ${list[0].unitStrength ?? '?'} down`));
        const rows = list.map((c) => {
          const cb = el('input', { type: 'checkbox', ...(chosenMen.has(c.index) ? { checked: 'checked' } : {}) });
          cb.addEventListener('change', () => { cb.checked ? chosenMen.add(c.index) : chosenMen.delete(c.index); redraw(); renderPicks(); });
          return el('div', { class: 'item' },
            el('label', { class: 'row' }, cb, el('span', {}, c.name), el('span', { class: 'price' }, ` ${per} cr`)),
            el('span', { class: 'sub' }, c.state === 3 ? 'dead' : 'down'));
        });
        return [head, ...rows];
      }).flat()));
    drawTail();
  });

  // ONE selector for the whole force. The formations already owned are picks like any other, with
  // the units in the field ticked and locked; ticking a dormant one costs its price and switches it
  // on. Formations from the library are added the same way and join the campaign for good.
  picker.append(
    el('h3', {}, 'Your force and the library'),
    el('div', { id: 'shop-library', class: 'libtable' }),
    el('div', { class: 'two' },
      el('div', {}, el('div', { id: 'shop-picks' }))),
    el('div', { id: 'shop-budget', class: 'budget', hidden: 'hidden' }),
    el('button', { id: 'shop-create', hidden: 'hidden' }));

  NEW = {
    // A biblioteca desta campanha e a que ele escolheu quando a levantou.
    armies: s.armies || ['US', 'UKR'],
    picks: [],
    slug: s.slug,
    el: { library: '#shop-library', picks: '#shop-picks', budget: '#shop-budget', create: '#shop-create' },
    libSort: { key: 'price', dir: -1 },          // the quartermaster's library opens by cost, dearest first (10/10)
    creditsAvailable: () => available - menCost() - wheelCost(),
    needsOnMap: false,
    allowEmpty: true,
    label: 'Credits',
    forceLabel: 'Joining the next battle',
    // quem ja esta em campo, para o teto de unidades (E125)
    fieldBase: (s.units || []).filter((u) => u.present && !(s.standDown || []).includes(u.coreId)).length,
    onPriced: () => drawTail(),
    // no kit-out ninguem se repoe a mao: tudo volta de graca
    hurt: kitOut ? () => null : hurt,
    onHeal,
    lost: kitOut ? () => null : lostOf,
    // Quem esta fora de campo: o bloco continua no chart, apagado, porque a unidade continua sendo
    // dele e volta com um clique.
    outOf: (node) => {
      if (!node || node.isFormation || node.coreId === null || node.coreId === undefined) return null;
      if (node.sold) return { label: 'SOLD', cls: 'stood-down sold' };
      if (SELLING.has(node.coreId)) {
        const v = SELLING.get(node.coreId);
        return { label: `FOR SALE · ${v ? '+' + v + ' cr' : 'no refund'}`, cls: 'selling' };
      }
      return (s.standDown || []).includes(node.coreId) ? { label: 'OUT OF THE FORCE', cls: 'stood-down' } : null;
    },
    // Marcar a venda desmarca o que ela tornaria sem sentido: repor homem, treinar, trocar arma. No kit-out nao ha venda.
    onSell: kitOut ? null : (ids, vender) => {
      for (const id of ids) {
        if (!vender) { SELLING.delete(id); continue; }
        SELLING.set(id, 0);
        for (const c of men) if (c.coreId === id) chosenMen.delete(c.index);
        chosenTrain.delete(id);
        const u = armsByCore.get(id);
        for (const m of (u && u.men) || []) chosenArms.delete(m.index);
      }
      recalcularVenda();
      redraw();
      drawOps();
      renderPicks();
      drawTail();
    },
    men: shopMen,
  };

  // as habilidades de campanha tambem no kit-out (24/10): o Black Market abre as armas dos outros exercitos para a SF
  const campanha = el('div'); renderCampaignAbilities(s, campanha);
  if (kitOut) {
    // as armas e itens da SF, a forca e a biblioteca (21/10: a compra tambem se faz aqui) e a conta
    body.append(guns, campanha, picker, tail);
    drawArms();
    drawTail();
  } else {
    body.append(box, wheels, guns, ops, campanha, picker, tail);
    drawWheels();
    drawArms();
    drawOps();
    redraw();
  }

  // O ponto de partida do Reset. O normal é ele já existir — é tirado quando o save é lido — e esta
  // chamada só cobre um resultado que veio de uma versão anterior do app. Fora do caminho do
  // desenho de propósito: a tela não deve esperar uma ida ao servidor para aparecer.
  if (!s.shopSnapshot) {
    api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/shop/open`)
      .then((st) => { s.shopSnapshot = st.shopSnapshot; drawTail(); })
      .catch(() => { /* sem retrato o Reset ainda desfaz o rascunho, e o aviso diz o resto */ });
  }

  try {
    for (const p of await ownedPicksOf(s)) NEW.picks.push(p);
    await loadFormations();
    renderPicks();
  } catch (e) {
    picker.append(el('div', { class: 'banner bad' }, `Could not read the formation library: ${e.message}${e.id ? ` (error ${e.id})` : ''}`));
  }
}

// The formations he already has, as picks (the quartermaster draws them to buy into; the force view at play draws them
// read-only). A leaf carries the core id it maps to and whether it is already in the field, which is the whole difference
// between this and the creation screen.
async function ownedPicksOf(s) {
  const out = [];
  const unitByKey = new Map((s.units || []).map((u) => [u.key, u]));
  const foraDeCampo = new Set(s.standDown || []);
  const vendidasJa = new Set((s.sold || []).map((x) => x.coreId));
  for (let i = 0; i < (s.picks || []).length; i++) {
    const p = s.picks[i];
    const tree = await api('GET', `/api/catalog/tree?source=${encodeURIComponent(p.source)}&nation=${p.nation || s.nation}${p.sf ? '&sf=1' : ''}&slug=${encodeURIComponent(s.slug)}`);
    // SO A UNIDADE ENTRA NO CONJUNTO. A formacao nao: ela aparece como cabecalho tracejado
    // quando ha algo dela em campo, que e o que `impliedKeys` calcula. Marcar toda formacao aqui
    // mostrava o batalhao inteiro como "in" — o autor selecionou UM pelotao e a tela dizia que
    // ele tinha nove companhias.
    const keep = new Set();
    const mark = (n) => {
      if (n.isFormation) { n.children.forEach(mark); return; }
      const u = unitByKey.get(String(i) + n.key.slice(n.key.indexOf('.')));
      n.coreId = u ? u.coreId : null;
      // A UNIDADE QUE ELE TEM E A DO ESTADO, NAO A DA BIBLIOTECA (03/10). A arvore vem da fonte
      // sem as trocas de equipamento do recrutamento: o Tank 31 recrutado com T-90AM (APS) aparecia
      // como T-72B3 a 900 cr, o servidor cobrava 1.170 por tanque, e o Apply era recusado com
      // "spending 33513 but only 30951". Nome, tipo, experiencia e preco saem do estado — os mesmos
      // que `purchasePrice` usa para cobrar.
      if (u) {
        if (u.name) n.name = u.name;
        if (u.type) n.type = u.type;
        if (u.experience) n.experience = u.experience;
        if (u.price != null) n.price = u.price;
      }
      // Tirada de campo continua sendo dele (28/09): antes `owned` era so `present`, o bloco
      // oferecia "+ take" e o Apply cobrava de novo por uma unidade que `standDown` mantinha fora.
      n.owned = !!(u && (u.present || foraDeCampo.has(u.coreId)));
      n.sold = !!(u && vendidasJa.has(u.coreId));
      if (n.owned) keep.add(n.key);
    };
    tree.roots.forEach(mark);
    // OS AVULSOS QUE ELE JA TEM (25/11, relato de um jogador): a arvore vem da fonte da biblioteca, e o veiculo anexado
    // (na criacao ou depois, `attachOwned`) nao existe nela — e um filho a mais da formacao, chave max + 1. Sem isto ele
    // sumia da lista depois do Raise, embora estivesse no estado e na batalha. Pendurado sob a formacao dele, como o
    // ultimo filho, que e onde o forge o escreveu.
    const resto = (k) => (k.includes('.') ? k.slice(k.indexOf('.')) : '');
    const porResto = new Map();
    const indexar = (n) => { porResto.set(resto(n.key), n); (n.children || []).forEach(indexar); };
    tree.roots.forEach(indexar);
    for (const u of s.units || []) {
      if (!u.key || !u.key.startsWith(`${i}.`) || porResto.has(resto(u.key))) continue;
      const pai = porResto.get(resto(u.key).replace(/\.\d+$/, ''));
      if (!pai || !pai.isFormation) continue;
      const no = {
        key: `${pai.key}.${u.key.split('.').pop()}`, name: u.name, isFormation: false, offMap: !!u.offMap, type: u.type,
        role: u.role, experience: u.experience, price: u.price, children: [], coreId: u.coreId, singleOwned: true,
        owned: !!(u.present || foraDeCampo.has(u.coreId)), sold: vendidasJa.has(u.coreId),
      };
      pai.children = [...(pai.children || []), no];
      porResto.set(resto(no.key), no);
      if (no.owned) keep.add(no.key);
    }
    // A special forces pick shows only its piece, and nothing of it is for sale (autor, 27/09).
    const arvore = p.sf ? sfTree(tree, new Set(p.keep || [])) : tree;
    out.push({
      formation: { file: p.source, name: p.sf ? (p.sfName || p.source) : p.source.replace(/\.btt$/, ''), nation: p.nation || s.nation, points: p.points, sf: !!p.sf },
      tree: arvore, keep, open: new Set(arvore.roots.map((x) => x.key)), owned: true, index: i, fixed: !!p.sf, sold: !!p.sold,
      ...(s.picks.slice(0, i).some((q) => q.source === p.source && !!q.sf === !!p.sf) ? { uid: `${p.source}#${i}`, copy: s.picks.slice(0, i + 1).filter((q) => q.source === p.source && !!q.sf === !!p.sf).length } : {}),
    });
  }
  return out;
}

// O QUE A DEFESA CUSTOU, E COM QUE TROPA. Os dois numeros que o autor pediu ao lado da ordem de
// batalha: os creditos que o inimigo gastou e o nivel de experiencia das unidades.
//
// O custo e o do PLANEJADOR (`defense.cost`) — a mesma base da recompensa, e nao a soma dos precos
// de tabela das unidades entregues, que da outro numero (4104 contra 4380 na batalha 5 da EASY2): o
// planejador compra em LOTES, o transporte vai junto com a esquadra e o QG de comando vem de graca,
// entao somar a lista de novo conta as partes com outra regra. Um numero so, o que manda no bolso.
//
// A experiencia vem de cada unidade do ARQUIVO ENTREGUE (`enemyUnits[].experience`), nao do plano:
// e o que esta no .btt que o jogo carregou. Diz "all Regular" quando so ha um nivel e conta um por
// um quando ha mistura.
//
// `cost:false` e para a tela de inteligencia, que ja traz a linha "…, Regular quality, 4380 of 4389
// credits spent" logo acima: la so vale a pena falar da tropa quando ela NAO e toda do mesmo nivel.
function enemyBill(def = {}, units = [], { cost = true } = {}) {
  const bits = [];
  if (cost && def.cost != null) {
    bits.push(el('b', {}, `${def.cost} cr`), ' spent by the defense');
    if (def.budget != null) bits.push(` of a ${def.budget} cr budget`);
  }
  const niveis = new Map();
  for (const u of units) if (u.experience) niveis.set(u.experience, (niveis.get(u.experience) || 0) + 1);
  const virgula = () => (bits.length ? ' · ' : '');
  if (niveis.size > 1) bits.push(`${virgula()}${[...niveis].sort((a, b) => b[1] - a[1]).map(([n, q]) => `${q} ${n}`).join(', ')}`);
  else if (!cost) { /* um nivel so, e a linha de cima ja o disse */ }
  else if (niveis.size === 1) bits.push(`${virgula()}all ${[...niveis.keys()][0]}`);
  else if (def.experience) bits.push(`${virgula()}raised as ${def.experience}`);
  // Texto vazio, nao `null`: isto vai direto para `body.append(...)`, que escreveria "null" na tela.
  return bits.length ? el('p', { class: 'hint' }, ...bits) : '';
}

// A table whose headers sort and which shows `page` rows at a time.
function sortableTable(cols, rows, { sort, dir = 1, page = 10 } = {}) {
  const box = el('div');
  let key = sort || cols[0].key, order = dir, shown = page;
  const draw = () => {
    const sorted = [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return c * order;
    });
    const t = el('table', { class: 'grid' });
    t.append(el('tr', {}, ...cols.map((c) => {
      if (c.sortable === false) return el('th', {}, c.label);
      const th = el('th', { class: 'sortable' }, c.label + (key === c.key ? (order > 0 ? ' ▲' : ' ▼') : ''));
      th.addEventListener('click', () => { if (key === c.key) order = -order; else { key = c.key; order = c.num ? -1 : 1; } draw(); });
      return th;
    })));
    // `render(row, tr)` (06/11): a coluna desenha o seu proprio no (um botao, por exemplo)
    for (const row of sorted.slice(0, shown)) {
      const tr = el('tr');
      tr.append(...cols.map((c) => el('td', { class: c.cls || '' }, c.render ? c.render(row, tr) : String(row[c.key] ?? ''))));
      t.append(tr);
    }
    box.replaceChildren(t);
    if (sorted.length > shown) {
      box.append(el('p', {},
        el('button', { onclick: () => { shown += page; draw(); } }, `See more (${sorted.length - shown} left)`), ' ',
        el('button', { class: 'linky', onclick: () => { shown = sorted.length; draw(); } }, 'show all')));
    } else if (rows.length > page) {
      box.append(el('p', {}, el('button', { class: 'linky', onclick: () => { shown = page; draw(); } }, 'show fewer')));
    }
  };
  draw();
  return box;
}

// O CORPO INTEIRO DA COTACAO vai para o Apply (11/10/2026): a lista de argumentos deixava o `kit` de fora — a cotacao
// cobrava os itens das SF e o Apply os descartava.
async function apply(s, body) {
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/apply`, body);
    const state = await watchJob(job, 'Applying the result');
    await loadStatus();
    CAMPAIGN = state;
    // o que a loja tinha marcado foi aplicado: nada mais a perder, e a guarda de saida nao pode perguntar (11/10: ela
    // perguntava "4 purchases not applied" logo depois do Apply que as aplicou)
    SHOP_PENDING = null;
    SHOP_DRAFT = null;
    // com uma SF recem-comprada o proximo passo e o kit-out, na aba Battle (21/10, autor); senao o Intel
    await go({ screen: 'campaign', slug: s.slug, tab: state.stage === 'brief' && state.next?.kitOut !== 'pending' ? 'intel' : 'now' });
  } catch (e) {
    if (!e.handled) alert(e.message);
  }
}

// A TELA DE FIM (05/10/2026, E143; autor: "uma apresentacao estatistica das batalhas, baixas sofridas/infligidas e um
// score"). Tudo vem de GET /summary: o historico, o AAR de cada battles/NN/result.json, o inimigo de cada spec.json.
async function renderOver(s, body) {
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  // (14/11) a leitura e um job com uma linha por batalha, acompanhado aqui; a segunda visita vem do cache do servidor
  const lendo = el('div', {});
  body.append(lendo);
  let d;
  try {
    const { job } = await api('POST', `/api/campaigns/${encodeURIComponent(s.slug)}/summary`);
    d = await acompanharNaTela(job, lendo, 'Reading the campaign — each battle\'s save is opened for its kills and leaders:');
    if (!d) return;
  } catch (e) {
    body.replaceChildren(el('div', { class: 'banner bad' }, `Could not read the campaign summary: ${e.message}. `, el('button', { class: 'linky', onclick: () => { body.replaceChildren(); renderOver(s, body); } }, 'Try again')));
    return;
  }
  body.replaceChildren();
  const T = d.totals, sc = d.score, perdeu = d.outcome === 'lost';
  const conta = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const men = (a) => (a ? a.mortos + a.feridos + a.desaparecidos : null);
  const veh = (a) => (a ? a.tanques + a.blindados + a.outrosVeiculos + a.aeronaves : null);

  // a. O HEROI (autor, 25/10): o pôster da campanha encerrada — rank, placar com a conta por partes, a tira das batalhas
  //    e os numeros-chave. As estatisticas de sempre ficam abaixo.
  const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '?');
  const H = d.highlights || {};
  const partes = sc.parts || [
    { id: 'battles', label: 'battles', value: sc.fromLevels, detail: `${sc.levels} level points × ${fmt(sc.perLevel)}` },
    { id: 'credits', label: 'credits left', value: sc.credits, detail: '' }];
  const estatisticas = el('div', { class: 'over-stats' });
  body.append(el('div', { class: 'over-hero' + (perdeu ? ' lost' : ''), style: `background-image: linear-gradient(90deg, rgba(0,0,0,.86), rgba(0,0,0,.62) 60%, rgba(0,0,0,.35)), url(art/${d.art || 'home.jpg'})` },
    el('div', { class: 'over-head' },
      el('div', { class: 'over-kicker' }, perdeu ? `Campaign lost at battle ${d.battles.length}` : 'Campaign completed'),
      el('h2', {}, d.name),
      el('div', { class: 'over-sub' }, `${d.nation} vs ${d.enemy}${d.difficulty ? ` · ${d.difficulty}` : ''} · ${dia(d.createdAt)} → ${dia(d.finishedAt)}`)),
    el('div', { class: 'over-main' },
      el('div', { class: 'over-rank rank-' + (d.rank || 'D') }, el('b', {}, d.rank || '—'), el('span', {}, 'rank')),
      el('div', { class: 'over-score' }, el('b', {}, fmt(sc.total)), el('span', {}, 'final score'),
        sc.multiplier && sc.multiplier !== 1 ? el('em', {}, `${fmt(sc.subtotal)} × ${sc.multiplier} difficulty`) : null),
      el('div', { class: 'over-parts' }, ...partes.map((p) => el('div', { class: p.value < 0 ? 'neg' : '' },
        el('span', {}, p.label, p.detail ? el('i', {}, p.detail) : null), el('b', {}, (p.value > 0 ? '+' : '') + fmt(p.value)))))),
    el('div', { class: 'over-strip' }, ...Array.from({ length: d.battlesToWin || 12 }, (_, i) => {
      const b = d.battles[i];
      return el('span', { class: 'over-cell' + (!b ? ' empty' : b.won === false ? ' lost' : b.won === true ? ' won' : ' draw'), title: b ? `Battle ${b.n} · ${b.map || ''} · ${b.level}` : `Battle ${i + 1} — not fought` },
        el('b', {}, `B${i + 1}`), el('span', {}, b ? '■'.repeat(b.levelPoints) + '□'.repeat(8 - b.levelPoints) : ''));
    })),
    el('div', { class: 'over-keys' },
      el('div', {}, el('b', {}, `${T.wins}–${T.draws}–${T.defeats}`), el('span', {}, 'won · drawn · lost')),
      el('div', {}, el('b', {}, fmt(T.enemyMen)), el('span', {}, 'enemy men lost')),
      el('div', {}, el('b', {}, fmt(T.youMen)), el('span', {}, 'your men lost')),
      el('div', {}, el('b', {}, fmt(T.youVehicles)), el('span', {}, 'your vehicles lost')),
      H.best ? el('div', {}, el('b', {}, `B${H.best.n}`), el('span', {}, `best: ${H.best.level}`)) : null),
    el('div', { class: 'over-actions' },
      el('button', { class: 'primary', onclick: () => estatisticas.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Full statistics ↓'),
      el('button', { onclick: () => go({ screen: 'home' }) }, 'Campaigns'),
      el('button', { class: 'linky', onclick: startNew }, '+ New campaign'))),
    estatisticas,
    el('div', { class: 'banner ' + (perdeu ? 'bad' : 'good') }, perdeu
      ? `Campaign lost at battle ${d.battles.length}: ${conta(T.wins, 'win')}, ${conta(T.draws, 'draw')}, ${conta(T.defeats, 'defeat')}.`
      : `Campaign completed: ${conta(T.wins, 'win')}, ${conta(T.draws, 'draw')} and ${conta(T.defeats, 'defeat')} in ${d.battles.length} battles.`));

  // b. O CARROSSEL DAS BATALHAS (14/11, autor): um cartao por batalha com o mapa tatico do briefing, o veredito escrito na
  //    frente (Victory / Draw / Defeat) e os kills e as perdas. Clicar abre o visor do terreno. Substituiu as barras.
  const veredito = (b) => (b.won === true ? ['won', 'Victory'] : b.won === false ? ['lost', 'Defeat'] : ['draw', 'Draw']);
  const conta2 = (a) => (a ? `${fmt(men(a))} men · ${fmt(veh(a))} vehicle${veh(a) === 1 ? '' : 's'}` : '—');
  const track = el('div', { class: 'reel-track', tabindex: '0' }, ...d.battles.map((b) => {
    const [cls, palavra] = veredito(b);
    const fundo = el('div', { class: 'reel-art' });
    if (b.node) {
      const img = el('img', { src: mapUrl(s, b.node, 'tactical'), alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.remove());
      fundo.append(img);
    }
    const card = el('figure', { class: `reel-card ${cls}`, title: b.node ? 'Open the map' : '' },
      fundo,
      el('div', { class: 'reel-head' }, el('b', {}, `B${b.n}`), el('span', {}, b.map || '')),
      el('div', { class: 'reel-stamp' }, el('b', {}, palavra), el('span', {}, b.level || '')),
      el('div', { class: 'reel-nums' },
        el('span', {}, el('i', {}, 'Kills'), ' ', conta2(b.enemy)),
        el('span', {}, el('i', {}, 'Losses'), ' ', conta2(b.you))));
    if (b.node) card.addEventListener('click', () => openMapView(s, b.node, b.map ? `Battle ${b.n} — ${b.map}` : `Battle ${b.n}`));
    return card;
  }));
  const rolar = (dir) => { const c = track.querySelector('.reel-card'); track.scrollBy({ left: dir * ((c ? c.getBoundingClientRect().width : 400) + 12), behavior: 'smooth' }); };
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); rolar(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); rolar(-1); } });
  body.append(el('h3', {}, 'Battle by battle'),
    el('div', { class: 'battle-reel' },
      d.battles.length > 1 ? el('button', { class: 'reel-nav prev', title: 'Previous battle', onclick: () => rolar(-1) }, '‹') : null,
      track,
      d.battles.length > 1 ? el('button', { class: 'reel-nav next', title: 'Next battle', onclick: () => rolar(1) }, '›') : null));

  // 06/11 (autor): sem a coluna dos pontos de vitoria; o botao abre o debrief da batalha logo abaixo da tabela
  const debrief = debriefBelow(s);
  body.append(sortableTable([
    { key: 'n', label: '#', num: true }, { key: 'map', label: 'map' }, { key: 'level', label: 'result' },
    { key: 'youMen', label: 'your men lost', num: true }, { key: 'youVeh', label: 'your vehicles lost', num: true },
    { key: 'enMen', label: 'enemy men lost', num: true }, { key: 'enVeh', label: 'enemy vehicles lost', num: true },
    { key: 'faced', label: 'enemy units', num: true }, { key: 'income', label: 'paid', num: true },
    { key: 'replaced', label: 'men replaced', num: true }, { key: 'bought', label: 'units bought', num: true },
    { key: 'debrief', label: '', sortable: false, cls: 'debrief-cell', render: (row, tr) => {
      const botao = el('button', { class: 'linky debrief-btn', title: `Show the debrief of battle ${row.n} below` }, 'Debrief');
      botao.addEventListener('click', () => debrief.abrir(row.h, tr, botao));
      return botao;
    } },
  ], d.battles.map((b) => ({
    n: b.n, map: `${b.map || '—'}${kindTail(b.kind, ' · ')}`, level: b.level,
    youMen: men(b.you), youVeh: veh(b.you), enMen: men(b.enemy), enVeh: veh(b.enemy), faced: b.enemyUnits, income: b.income, replaced: b.replaced, bought: b.bought,
    h: { n: b.n, map: b.map, kind: b.kind, node: b.node },
  })), { sort: 'n', dir: 1, page: 20 }), debrief.alvo);

  // c. os totais, lado a lado
  const linha = (rot, a, b) => el('tr', {}, el('td', {}, rot), el('td', {}, fmt(a)), el('td', {}, fmt(b)));
  body.append(el('h3', {}, 'Campaign losses'),
    el('table', { class: 'grid totals' },
      el('tr', {}, el('th', {}, ''), el('th', {}, 'you'), el('th', {}, 'the enemy')),
      linha('KIA', T.you.mortos, T.enemy.mortos), linha('WIA', T.you.feridos, T.enemy.feridos), linha('MIA', T.you.desaparecidos, T.enemy.desaparecidos),
      linha('tanks', T.you.tanques, T.enemy.tanques), linha('armour', T.you.blindados, T.enemy.blindados), linha('other vehicles', T.you.outrosVeiculos, T.enemy.outrosVeiculos), linha('aircraft', T.you.aeronaves, T.enemy.aeronaves),
      linha('men lost', T.youMen, T.enemyMen), linha('vehicles lost', T.youVehicles, T.enemyVehicles)),
    el('p', {},
      `${fmt(T.menReplaced)} men replaced, ${fmt(T.unitsBought)} units bought, ${fmt(T.unitsSold)} sold; ${fmt(T.youVehicles)} vehicles destroyed, ${fmt(T.wrecksReplaced)} of them replaced. `,
      `${fmt(T.creditsEarned)} credits earned in allotments, replacement cover and bonuses, ${fmt(T.creditsLeft)} left at the end.`));

  // d. AS MENCOES HONROSAS (autor, 06/11), no lugar de "The force at the end": as categorias de src/honours.mjs, cada
  //    unidade com o veiculo, o lider, a formacao, a batalha em que entrou, os kills e o que ganhou.
  const M = d.mentions || { categories: [] };
  const passo = (g) => (g.from == null || g.to == null ? '—' : g.from === g.to ? String(g.to) : `${g.from} → ${g.to}`);
  const EXTRA = { losses: 'losses taken', tankKills: 'tanks' };
  const mencao = (c) => {
    const temVeiculo = c.rows.some((r) => r.machine);
    const cab = ['#', 'unit', ...(temVeiculo ? ['vehicle'] : []), 'leader', 'formation', 'sub-formation', 'battle hired', 'battle died', 'battles', 'kills', 'vehicle kills', 'leadership', 'veterancy', ...(EXTRA[c.metric] ? [EXTRA[c.metric]] : [])];
    return el('div', { class: 'mention' },
      el('h4', {}, c.title, c.sub ? el('span', { class: 'dim' }, ` · ${c.sub}`) : null),
      el('p', { class: 'hint' }, c.rule.charAt(0).toUpperCase() + c.rule.slice(1) + '.'),
      el('table', { class: 'grid' }, el('tr', {}, ...cab.map((h) => el('th', {}, h))),
        ...c.rows.map((r, i) => el('tr', {},
          el('td', {}, i + 1), el('td', {}, r.name), ...(temVeiculo ? [el('td', {}, r.vehicle || '—', r.lives > 1 ? el('span', { class: 'dim' }, ` · life ${r.life} of ${r.lives}`) : null)] : []),
          el('td', {}, r.leader || '—'), el('td', {}, r.formation || '—'), el('td', {}, r.subFormation || '—'),
          el('td', {}, r.hired ? `B${r.hired}` : '—'), el('td', { class: r.died ? 'no' : '' }, r.died ? `B${r.died}` : '—'), el('td', {}, r.battles), el('td', {}, fmt(r.kills)), el('td', {}, fmt(r.vehicleKills)),
          el('td', {}, passo(r.leadership)), el('td', {}, passo(r.experience)),
          ...(EXTRA[c.metric] ? [el('td', {}, fmt(r.value))] : [])))));
  };
  body.append(el('h3', {}, 'Honourable mentions'),
    M.killsKnown ? null : el('p', { class: 'hint' }, 'No save of the campaign could be read, so the kills are unknown and only the lists that do not need them are shown.'),
    ...(M.categories.length ? M.categories.map(mencao) : [el('p', {}, 'Nobody earned a mention: no unit fought a battle that was read.')]),
    el('p', {}, el('button', { class: 'primary', onclick: startNew }, '+ New campaign')));
}

// `onDebrief(h, linha, botao)` (11/10): um botao "Debrief" na propria linha de cada batalha.
function renderHistory(s, { onDebrief = null } = {}) {
  const cab = ['#', 'map', 'result', 'points', 'casualties', 'paid', ...(onDebrief ? [''] : [])];
  const t = el('table', { class: 'grid history' }, el('tr', {}, ...cab.map((h) => el('th', {}, h))));
  for (const h of s.history) {
    const linha = el('tr', { 'data-battle': h.n },
      el('td', {}, h.n), el('td', {}, h.map || '?'),
      el('td', { class: h.won === true ? 'ok' : h.won === false ? 'no' : '' }, h.level),
      el('td', {}, `${h.points.player} – ${h.points.enemy}`),
      el('td', {}, h.casualties), el('td', {}, (h.income ?? h.reward ?? 0) + ' cr'));
    if (onDebrief) {
      const botao = el('button', { class: 'linky debrief-btn', title: `Show the debrief of battle ${h.n} below` }, 'Debrief');
      botao.addEventListener('click', () => onDebrief(h, linha, botao));
      linha.append(el('td', { class: 'debrief-cell' }, botao));
    }
    t.append(linha);
  }
  return el('div', {}, el('h3', {}, 'History'), t);
}

// ---------------------------------------------------------------------------------- log view

// The drawer starts shut on every load and stays shut until asked for — it covers most of the
// screen, so it is never what the app opens with, not even if it was open last time.
const drawerOpen = (open) => {
  $('#log-drawer').hidden = !open;
  if (open) refreshLog();
};
$('#log-toggle').addEventListener('click', () => drawerOpen($('#log-drawer').hidden));
$('#log-close').addEventListener('click', () => drawerOpen(false));
$('#log-refresh').addEventListener('click', refreshLog);
$('#log-download').addEventListener('click', async () => {
  if (!CAMPAIGN) return alert('Open a campaign first.');
  const r = await api('POST', `/api/campaigns/${encodeURIComponent(CAMPAIGN.slug)}/diagnostics`, {});
  alert('Diagnostics written to:\n' + r.file + '\n\nSend that file when something goes wrong.');
});

async function refreshLog() {
  const body = $('#log-body');
  if (!CAMPAIGN) { body.textContent = 'Open a campaign to see its log.'; return; }
  const { events } = await api('GET', `/api/campaigns/${encodeURIComponent(CAMPAIGN.slug)}/log?n=300`);
  body.textContent = events.map((e) => {
    const { t, seq, run, type, ...rest } = e;
    return `${t.slice(11, 19)} ${String(seq).padStart(4)} ${type}\n    ${JSON.stringify(rest)}`;
  }).join('\n');
  body.scrollTop = body.scrollHeight;
}

// --------------------------------------------------------------------------------- text size

// Every size on this page is in pixels — including the chart, whose blocks are laid out by
// arithmetic in canvas.js — so the only way to enlarge the text without two sets of numbers
// drifting apart is to scale the page itself. `zoom` on the root does that and reflows, the way
// the browser's own zoom does, which keeps the chart's maths and its drawing in step.
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6];
let zoomAt = ZOOM_STEPS.indexOf(1);
try {
  const saved = ZOOM_STEPS.indexOf(Number(localStorage.getItem('cmbsdc.zoom')));
  if (saved >= 0) zoomAt = saved;
} catch { /* private window */ }

function applyZoom() {
  const z = ZOOM_STEPS[zoomAt];
  document.documentElement.style.zoom = z;
  $('#font-down').disabled = zoomAt === 0;
  $('#font-up').disabled = zoomAt === ZOOM_STEPS.length - 1;
  $('#font-down').title = `Smaller text (now ${Math.round(z * 100)}%)`;
  $('#font-up').title = `Larger text (now ${Math.round(z * 100)}%)`;
  try { localStorage.setItem('cmbsdc.zoom', String(z)); } catch { /* private window */ }
}
$('#font-down').addEventListener('click', () => { if (zoomAt > 0) { zoomAt--; applyZoom(); } });
$('#font-up').addEventListener('click', () => { if (zoomAt < ZOOM_STEPS.length - 1) { zoomAt++; applyZoom(); } });
applyZoom();

// --------------------------------------------------------------------------------- bootstrap

for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => go({ screen: b.dataset.go }));
$('#title-home').addEventListener('click', () => go({ screen: 'start' }));

// A HOME (E176): o menu da esquerda. Campaign abre a lista de campanhas; Quit fecha o servidor (com uma montagem
// rodando ele recusa, e a mensagem diz por que).
$('#go-campaign').addEventListener('click', () => go({ screen: 'home' }));
$('#go-rules').addEventListener('click', () => go({ screen: 'rules' }));
$('#go-about').addEventListener('click', () => go({ screen: 'about' }));
$('#go-youtube').addEventListener('click', () => window.open('https://www.youtube.com/@andreartsstudio', '_blank', 'noopener'));
$('#go-quit').addEventListener('click', async () => {
  if (!confirm('Quit the app? The server stops; start it again with CMBS Roguelike.exe.')) return;
  try { await api('POST', '/api/quit'); } catch (e) { alert(e.message); return; }
  show('closed');
});

(async () => {
  $('#log-drawer').hidden = true;
  try { localStorage.removeItem('cmbsdc.log'); } catch { /* private window */ }
  try { await loadStatus(); } catch (e) { falhaVisivel(`The app server did not answer: ${e.message}. Is it running?`); return; }
  // With no game folder there is nothing to open and nothing to create, so the app opens where the
  // one question it cannot answer for itself is asked.
  // a tela da URL (F5 reabre onde se estava); sem ela, a home — ou o Setup, se nao ha pasta do jogo
  // a checagem do sistema (29/10) vem antes de tudo na primeira vez, e sempre que a ultima achou uma falha
  const pedida = viewOfHash(location.hash);
  const checar = STATUS.firstRun || STATUS.systemCheck?.ok === false;
  await go(checar ? { screen: 'system' } : STATUS.settings.gameFilesOk === false ? { screen: 'setup' } : pedida || { screen: 'start' }, { replace: true });
})();
