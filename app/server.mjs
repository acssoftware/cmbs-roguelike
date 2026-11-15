// The whole back end: a local HTTP server with no dependencies. It serves the page from `web/`
// and a small JSON API. It listens on 127.0.0.1 only — this is a single-player tool on one
// machine, there is nothing to authenticate.
//
// Every request gets an id, and that id is in the log next to whatever the request did. When the
// page shows "error 3f2a", that string finds the failure, its stack and the steps that led to it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { PORT, WEB_DIR, REPO_DIR, checkEnvironment, current as currentSettings, save as saveSettings, paths, detect as detectGameFiles, validate as validateGameFiles, DISCOVERY, USER_DIR, SETTINGS_FILE, PORTABLE } from './src/settings.mjs';
import { APP_VERSION } from './src/pacote.mjs';
import { GAME_FOLDER_IN_USE } from './src/re.mjs';
import { consoleTrace, RUN_ID } from './src/trace.mjs';
import { readPersonnel, readLaunchers } from './src/personnel.mjs';
import { factoryKit } from './src/gear.mjs';
import { libraryForArmies, armiesOf, formationTree, roleOf, priceUnit, singleVehicles, deploymentTwins, equipmentMenu, gunTwins, SIDES, ARMIES, specialForcesTree } from './src/catalog.mjs';
import * as jobs from './src/jobs.mjs';
import * as campaign from './src/campaign.mjs';
import { checarEGuardar } from './src/sistema.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// The page is re-read from disk on every request; this file is not — node loads it once, when the
// process starts. So a page fresh from git can be talking to a server from an hour ago, and the
// symptom is a field that is simply missing from a response. Raise this number whenever the API
// gains or changes a field the page depends on: the page compares it and says what to restart.
const API_LEVEL = 21;
const STARTED_AT = new Date().toISOString();

const send = (res, code, body, headers = {}) => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 1);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 4e6) reject(new Error('body too large')); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error('invalid JSON body: ' + e.message)); } });
  req.on('error', reject);
});

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

// UMA FILA POR CAMPANHA (29/10, bateria da economia, E7): tudo o que grava o estado de uma campanha roda um de cada vez.
// Sem ela um Apply com recruta (que espera o enxerto da forca) gravava por cima do que um standdown, um undo ou uma leitura
// tinham gravado no meio. As rotas POST/DELETE de /api/campaigns/<slug>/... (menos a cotacao, que so le) entram na fila, e
// os jobs delas tambem: o segundo pedido espera o primeiro terminar e entao ve o estado que ele deixou.
const filas = new Map();
function naFila(slug, fn) {
  const antes = filas.get(slug) || Promise.resolve();
  // (29/10, bateria de interrupcoes) antes de cada operacao, o que um processo morto deixou pela metade nesta campanha
  // e desfeito (`recuperarInterrompido`); a fila garante que nenhum job dela esta rodando agora
  const vez = antes.catch(() => {}).then(() => { try { campaign.recuperarInterrompido(slug); } catch { /* slug que nao e campanha: a rota recusa */ } return fn(); });
  const fim = vez.catch(() => {});
  filas.set(slug, fim);
  fim.then(() => { if (filas.get(slug) === fim) filas.delete(slug); });
  return vez;
}
const slugDaRota = (method, pathname) => {
  if (method !== 'POST' && method !== 'DELETE') return null;
  const m = pathname.match(/^\/api\/campaigns\/([^/]+)(\/.*)?$/);
  if (!m || m[2] === '/quote') return null;
  return decodeURIComponent(m[1]);
};

// ------------------------------------------------------------------------------------ routes

// CODIGO VELHO EM MEMORIA. O node carrega os modulos uma vez; corrigir um arquivo e continuar
// jogando na mesma janela roda a versao ANTIGA, sem aviso nenhum. Foi o que aconteceu com o
// relogio (E25): a correcao estava no disco, o servidor estava de pe desde antes dela, e o autor
// criou duas campanhas achando que a correcao nao tinha funcionado. O handshake de API_LEVEL nao
// pega isto — ele compara a PAGINA com o servidor, e aqui os dois estavam velhos juntos.
// Pelo CONTEUDO, nao pela data: um `git checkout` ou um `touch` mexe na data sem mudar uma linha,
// e uma tarja que grita por isso vira ruido que se aprende a ignorar — que e o contrario do que ela
// serve. O retrato e tirado uma vez, quando o processo sobe.
const FONTES = ['app/src', 'app/data', 'tools/re'];
function retratoDasFontes() {
  const out = new Map();
  const anda = (dir) => {
    let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) { if (it.name !== 'scratch' && it.name !== 'node_modules') anda(p); continue; }
      if (!/\.(mjs|json)$/.test(it.name)) continue;
      try { out.set(path.relative(REPO_DIR, p), crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')); } catch { /* sumiu no meio */ }
    }
  };
  for (const d of FONTES) anda(path.join(REPO_DIR, d));
  return out;
}
const FONTES_AO_SUBIR = retratoDasFontes();
function fonteMudada() {
  const agora = retratoDasFontes();
  for (const [f, h] of agora) if (FONTES_AO_SUBIR.get(f) !== h) return { file: f, why: FONTES_AO_SUBIR.has(f) ? 'changed' : 'is new' };
  for (const f of FONTES_AO_SUBIR.keys()) if (!agora.has(f)) return { file: f, why: 'was deleted' };
  return null;
}

route('GET', /^\/api\/status$/, async () => ({
  api: API_LEVEL,
  // the app version and where its data lives (14/11: the package for the community)
  version: APP_VERSION,
  dataDir: USER_DIR,
  settingsFile: SETTINGS_FILE,
  portable: PORTABLE,
  run: RUN_ID,
  startedAt: STARTED_AT,
  // Verdadeiro quando ha arquivo no disco mais novo que este processo: o que esta rodando nao e o
  // que esta escrito, e so reiniciar resolve.
  stale: fonteMudada(),
  settings: currentSettings(),
  gameFolderUsedByLibrary: GAME_FOLDER_IN_USE,
  environment: checkEnvironment(),
  // a checagem do sistema (29/10): firstRun = nunca rodou neste computador; a pagina abre a tela System check
  firstRun: !currentSettings().systemCheck,
  systemCheck: currentSettings().systemCheck,
  campaigns: campaign.listCampaigns(),
  rules: campaign.rules(),
  // a escada (30/10): os degraus do inimigo, os do jogador (01/11) e o multiplicador de cada preset, para a pagina Rules
  ladder: campaign.ladder(),
  playerLadder: campaign.playerLadder(),
  presetMultipliers: campaign.presetMultipliers(),
}));

route('PUT', /^\/api\/settings$/, async (_m, body) => {
  // Say straight away whether the folder is a game folder, so a typo is caught here and not four
  // screens later when a battle fails to build.
  const check = body.gameFiles ? validateGameFiles(body.gameFiles) : null;
  const antes = currentSettings().gameFiles;
  const settings = saveSettings(body);
  // outra pasta do jogo, outra checagem: o que vale para a antiga nao diz nada da nova
  const systemCheck = settings.gameFiles !== antes ? checarEGuardar() : null;
  return {
    settings,
    systemCheck,
    check,
    restartRequired: true,
    note: 'the byte-level library reads the game folder once, when the server starts — restart it for a new folder to take effect',
  };
});

// A checagem do sistema (29/10, sistema.mjs): GET devolve a ultima com os itens (roda de novo, e barata: le pastas e
// confere arquivos), POST e o "Check again"; as duas guardam o resumo em settings.json > systemCheck.
route('GET', /^\/api\/system-check$/, async () => checarEGuardar());
route('POST', /^\/api\/system-check$/, async () => checarEGuardar());

// OPEN THE DATA FOLDER (14/11): Setup's button. POST, so the Origin guard applies; Windows only (explorer).
route('POST', /^\/api\/open-data-folder$/, async () => {
  if (process.platform !== 'win32') throw new Error('only on Windows');
  fs.mkdirSync(USER_DIR, { recursive: true });
  spawn('explorer.exe', [USER_DIR], { detached: true, stdio: 'ignore' }).unref();
  return { opened: USER_DIR };
});

// The search, on demand: the setup screen offers it when the folder is wrong, and it reports what
// it looked at so "not found" is an answer, not a shrug.
route('POST', /^\/api\/detect$/, async () => {
  const found = detectGameFiles();
  consoleTrace.event('settings.detect', { looked: found.looked, valid: found.tried.length, found: found.found });
  return found;
});

// As regras de uma campanha (18/10): o preco das Special Forces e parametro dela. Sem campanha, a regra.
const regrasDe = (slug) => (slug ? campaign.rulesFor(campaign.loadState(slug)) : campaign.rules());

// A biblioteca do jogador e um conjunto de EXERCITOS, escolhido na tela de parametros.
route('GET', /^\/api\/catalog$/, async (_m, _b, url) => {
  const armies = armiesOf(url.searchParams.get('armies'));
  return { armies, sides: SIDES, list: ARMIES, formations: libraryForArmies(armies, { specialForces: true, rules: regrasDe(url.searchParams.get('slug')) }) };
});

// The single-vehicle menu: every machine the library can sell one of, deduped and priced.
route('GET', /^\/api\/catalog\/vehicles$/, async (_m, _b, url) => {
  const armies = armiesOf(url.searchParams.get('armies'));
  return { armies, vehicles: singleVehicles(armies, { rules: campaign.rules() }) };
});

// The mortars and guns the library carries BOTH on the map and off it, so the chart can offer the
// choice the game offers. Keyed "NATION|name" — the same tube is a different unit in each army.
route('GET', /^\/api\/catalog\/deployment$/, async (_m, _b, url) => {
  const armies = armiesOf(url.searchParams.get('armies'));
  return { armies, twins: deploymentTwins(armies, { rules: campaign.rules() }) };
});

// The tube of an off-map battery is another formation file (FORMATO 124), so the choice is offered
// as the list of twin files of each battery, keyed "NATION|name" like the deployment twins.
route('GET', /^\/api\/catalog\/guns$/, async (_m, _b, url) => {
  const armies = armiesOf(url.searchParams.get('armies'));
  return { armies, guns: gunTwins(armies, { rules: campaign.rules() }) };
});

route('GET', /^\/api\/catalog\/tree$/, async (_m, _b, url) => {
  const source = url.searchParams.get('source');
  if (!source) throw new Error('source is required');
  if (/[\\/]/.test(source)) throw new Error('source is a formation file name, not a path');
  const nation = url.searchParams.get('nation') || 'US';
  const tree = formationTree(source.endsWith('.btt') ? source : source + '.btt');
  // Priced here so the chart can show what a block costs without a round trip per block. The
  // cached tree is nation-agnostic, so the copy handed out is the one that carries the prices.
  const R = regrasDe(url.searchParams.get('slug'));
  // `sf=1` (28/09): a arvore de uma Special Forces leva o KIT DE FABRICA de cada unidade — as vagas e a
  // arma de cada uma —, que e o que a tela mostra na criacao, antes de os homens existirem.
  const fab = url.searchParams.get('sf') === '1' ? campaign.factoryTable() : null;
  // OS HOMENS E AS ARMAS DE FABRICA DE TODA UNIDADE (25/10, a vista em lista e o painel da unidade): as vagas do kit
  // de fabrica e a contagem por arma. `men: null` quando a tabela de fabrica nao conhece o tipo.
  const fabrica = fab || campaign.factoryTable();
  const homens = (n) => {
    const k = factoryKit(fabrica, nation, n.type);
    if (!k) return { men: null, weapons: null };
    const armas = {}; for (const v of k) { const nome = v.weaponName || v.weapon; if (nome) armas[nome] = (armas[nome] || 0) + 1; }
    return { men: k.length, weapons: armas };
  };
  const anotar = (n) => ({
    ...n,
    ...(n.isFormation ? {} : { role: roleOf(n.name, n.offMap, R), price: priceUnit(n, nation, R), ...homens(n), ...(fab ? { kit: factoryKit(fab, nation, n.type) } : {}) }),
    // a bateria organica (sem posicao) e fora do mapa no jogo (29/10): a tela a rotula e conta assim; papel e preco ficam
    // os de sempre, calculados acima com o que os bytes dizem
    ...(!n.isFormation && n.organic ? { offMap: true } : {}),
    children: n.children.map(anotar),
  });
  // The scale travels with the tree so the screen can price a change without a round trip — and
  // so does the equipment menu: what the editor's blocks would offer for every group in this tree.
  const out = {
    ...tree, nation, roots: tree.roots.map(anotar),
    experienceLevels: R.units.experienceLevels, experienceFactor: R.units.experienceFactor,
    equipment: equipmentMenu(tree, nation, R),
  };
  // special forces: flat price spread over the kept units, all at the rule's experience (10/10)
  return fab ? specialForcesTree(out, source.replace(/\.btt$/, ''), R) : out;
});

route('POST', /^\/api\/price$/, async (_m, body) => ({
  picks: campaign.priceOfPicks(body.picks || [], body.nation || 'US', regrasDe(body.slug)),
  trpPrice: campaign.rules().units.price.trp,
}));

route('POST', /^\/api\/campaigns$/, async (_m, body) => {
  // `harvest` (a colheita de fabrica, sem orcamento) e coisa das ferramentas, que chamam createCampaign direto; pela API
  // ele criava uma forca de qualquer tamanho (29/10, bateria da economia: -94.528 creditos)
  const { harvest: _colheita, ...corpo } = body || {};
  const job = jobs.start('create campaign', (note) => campaign.createCampaign(corpo, note));
  return { job: job.id };
});

route('GET', /^\/api\/jobs\/([a-f0-9]+)$/, async (m) => {
  const job = jobs.get(m[1]);
  if (!job) throw new Error('unknown job ' + m[1]);
  return job;
});

// `activeJob` (29/10): o job desta campanha ainda rodando — a pagina aberta (ou recarregada) no meio dele volta a acompanha-lo
route('GET', /^\/api\/campaigns\/([^/]+)$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const st0 = campaign.loadState(slug); const j = jobs.activeFor(slug);
  // 06/11 (aba Campaign Parameters): o multiplicador do placar e a razao de forca saem daqui, a tela nao refaz a conta
  const st = { ...st0, scoreMultiplier: campaign.difficultyMultiplier(st0), forceRatioUsed: campaign.ratioOf(st0) };
  return j ? { ...st, activeJob: { id: j.id, label: j.label } } : st;
});

route('GET', /^\/api\/campaigns\/([^/]+)\/saves$/, async (m) => ({ saves: campaign.scanForSave(decodeURIComponent(m[1])), overwritten: campaign.overwrittenSaves(decodeURIComponent(m[1])) }));

// QUEM SERVE NESTA CAMPANHA, homem a homem. Le o save de campanha na hora — sao 16 a 30 MB e alguns
// segundos, entao a tela so pede quando o jogador abre a aba.
route('GET', /^\/api\/campaigns\/([^/]+)\/launchers$/, async (m) => readLaunchers(campaign.loadState(decodeURIComponent(m[1]))));

route('GET', /^\/api\/campaigns\/([^/]+)\/personnel$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  return readPersonnel(campaign.loadState(slug));
});

// O debrief de uma batalha ja jogada: o app guarda o resultado de cada uma em battles/NN/result.json
// quando o save e lido, e a aba de historico o reabre sem tocar no jogo.
route('GET', /^\/api\/campaigns\/([^/]+)\/battles\/(\d+)$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const n = Number(m[2]);
  const f = path.join(campaign.dirOf(slug), 'battles', String(n).padStart(2, '0'), 'result.json');
  if (!fs.existsSync(f)) throw new Error(`battle ${n} of this campaign has no stored debrief`);
  // and what he faced IN THAT battle, from its own spec (QA r2 S6: an old debrief showed the current battle's enemy)
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const sp = path.join(path.dirname(f), 'spec.json');
  if (fs.existsSync(sp)) { try { const j = JSON.parse(fs.readFileSync(sp, 'utf8')); r.enemyUnits = j.enemyUnits || null; r.defense = j.defense || null; } catch { /* spec ilegivel: sem a secao */ } }
  if (!r.enemyUnits) r.enemyUnits = [];
  return r;
});

route('POST', /^\/api\/campaigns\/([^/]+)\/read$/, async (m, body) => {
  if (!body.savePath) throw new Error('savePath is required');
  return campaign.readSave(decodeURIComponent(m[1]), body.savePath);
});
// A MESMA LEITURA COMO JOB (08/11): a tela acompanha as etapas em vez de esperar parada. A rota acima fica para o QA e
// as ferramentas, que esperam o estado na resposta.
route('POST', /^\/api\/campaigns\/([^/]+)\/read\/start$/, async (m, body) => {
  if (!body.savePath || typeof body.savePath !== 'string') throw new Error('savePath is required');
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('read result', (note) => naFila(slug, () => campaign.readSaveWithSteps(slug, body.savePath, {}, note)), { slug });
  return { job: job.id };
});

// Marking a machine by hand is gone (autor, 16/10/2026): the app reads each machine's fate out of the save when the
// result is read (E90, FORMATO 110.11) and the quartermaster only reports it.

// O QUARTEL-MESTRE É UM RASCUNHO, com duas exceções que gravam na hora: marcar uma máquina e tirar
// uma unidade de campo. `open` garante o ponto de partida (o normal é ele já existir, tirado quando
// o save foi lido) e `reset` volta para ele — só essas duas coisas, e só as feitas nesta batalha.
route('POST', /^\/api\/campaigns\/([^/]+)\/shop\/open$/, async (m) => campaign.openShop(decodeURIComponent(m[1])));
route('POST', /^\/api\/campaigns\/([^/]+)\/shop\/reset$/, async (m) => campaign.resetShop(decodeURIComponent(m[1])));

// Tirar uma formação de campo, ou trazê-la de volta. Não vende nada: muda quem vai à próxima
// batalha, e a unidade continua com a linha dela no roster, que é o que o jogo exige.
route('POST', /^\/api\/campaigns\/([^/]+)\/standdown$/, async (m, body) => {
  return campaign.standDown(decodeURIComponent(m[1]), body.coreIds || body.coreId, body.out !== false);
});

// O CAMINHO DE BATALHAS (E176): revelar um no seguinte com pontos operacionais, e escolher a proxima batalha.
route('POST', /^\/api\/campaigns\/([^/]+)\/path\/reveal$/, async (m, body) => campaign.revealNode(decodeURIComponent(m[1]), body || {}));
route('POST', /^\/api\/campaigns\/([^/]+)\/path\/choose$/, async (m, body) => campaign.chooseNode(decodeURIComponent(m[1]), { node: body?.node ?? null }));
// A IMAGEM DO MAPA de um no revelado ou jogado, ou da batalha montada ('current'): terreno, zonas de setup (E178) ou o
// mapa tatico do briefing (14/11, o carrossel da aba Outcome)
route('GET', /^\/api\/campaigns\/([^/]+)\/map\/([^/]+)\/(terrain|zones|tactical)\.png$/, async (m) => ({
  raw: campaign.mapImage(decodeURIComponent(m[1]), decodeURIComponent(m[2]), m[3]), type: 'image/png',
}));
// a batalha 1 escolhida e montada, e o .cam escrito (E176: a campanha nasce esperando essa escolha)
route('POST', /^\/api\/campaigns\/([^/]+)\/path\/start$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('start campaign', (note) => naFila(slug, () => campaign.startCampaign(slug, note)), { slug });
  return { job: job.id };
});

// A FORCA DA BATALHA 1 (18/10, autor): a campanha nasce sem forca e ela e comprada no Quartermaster, depois do caminho.
route('POST', /^\/api\/campaigns\/([^/]+)\/force$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('raise force', (note) => naFila(slug, () => campaign.raiseForce(slug, body || {}, note)), { slug });
  return { job: job.id };
});

// UNDO (E176): da batalha montada de volta ao quartel-mestre da anterior. Rapido (copia e apaga), sem job.
route('POST', /^\/api\/campaigns\/([^/]+)\/undo$/, async (m) => campaign.undoBattle(decodeURIComponent(m[1])));

// INTEL (E176): tempo comprado para a batalha ja montada, que e remontada com o relogio novo.
route('POST', /^\/api\/campaigns\/([^/]+)\/abilities$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('buy ability', (note) => naFila(slug, () => campaign.buyAbility(slug, body || {}, note)), { slug });
  return { job: job.id };
});

// GERAR A BATALHA (18/10): depois do Intel, uma vez so (Missao > Quartermaster > Intel > Battle).
route('POST', /^\/api\/campaigns\/([^/]+)\/prepare$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('prepare battle', (note) => naFila(slug, () => campaign.prepareBattle(slug, note)), { slug });
  return { job: job.id };
});

// O KIT-OUT DA SPECIAL FORCES (19/10): montar a batalha de mentira antes da batalha que espera, ou dispensa-la.
route('POST', /^\/api\/campaigns\/([^/]+)\/kitout\/prepare$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('prepare kit-out', (note) => naFila(slug, () => campaign.prepareKitOut(slug, note)), { slug });
  return { job: job.id };
});
route('POST', /^\/api\/campaigns\/([^/]+)\/kitout\/skip$/, async (m) => campaign.skipKitOut(decodeURIComponent(m[1])));

// O INTEL INIMIGO DO JOGO (17/10): Early Intel comprado com pontos operacionais; a batalha e remontada.
route('POST', /^\/api\/campaigns\/([^/]+)\/intel$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('buy enemy intel', (note) => naFila(slug, () => campaign.buyEnemyIntel(slug, body || {}, note)), { slug });
  return { job: job.id };
});

// A GUERRA ELETRONICA (17/10): o counter do EW inimigo de um no do caminho (rapido, como revelar) e o EW proprio da
// batalha ja montada (job: a batalha e remontada).
route('POST', /^\/api\/campaigns\/([^/]+)\/path\/counter$/, async (m, body) => campaign.counterEW(decodeURIComponent(m[1]), body || {}));
route('POST', /^\/api\/campaigns\/([^/]+)\/ew$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('buy electronic warfare', (note) => naFila(slug, () => campaign.buyOwnEW(slug, body || {}, note)), { slug });
  return { job: job.id };
});

// A TROCA DE LUZ (17/10): o periodo escolhido, a hora sorteada nele; a batalha e remontada.
route('POST', /^\/api\/campaigns\/([^/]+)\/light$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('change the light', (note) => naFila(slug, () => campaign.buyRelight(slug, body || {}, note)), { slug });
  return { job: job.id };
});

// AS HABILIDADES DE CAMPANHA (18/10): compradas uma vez, nada e remontado (rapido, sem job).
route('POST', /^\/api\/campaigns\/([^/]+)\/campaign-abilities$/, async (m, body) => campaign.buyCampaignAbility(decodeURIComponent(m[1]), body || {}));

// QUIT (E176): a home fecha o app. Responde primeiro e sai logo depois; com uma montagem rodando, recusa.
route('POST', /^\/api\/quit$/, async () => {
  if (jobs.running()) throw new Error('a battle is still being built — wait for it to finish');
  setTimeout(() => { console.log('  closed from the page'); server.close(); process.exit(0); }, 400).unref();
  return { closing: true };
});

route('POST', /^\/api\/campaigns\/([^/]+)\/regenerate$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('regenerate battle', (note) => naFila(slug, () => campaign.regenerateBattle(slug, body, note)), { slug });
  return { job: job.id };
});

route('POST', /^\/api\/campaigns\/([^/]+)\/apply$/, async (m, body) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('apply result', (note) => naFila(slug, () => campaign.applyResult(slug, body, note)), { slug });
  return { job: job.id };
});

// THE QUOTE (05/10/2026): what Apply would charge for this body, priced by the server, without writing anything. A
// refusal is an answer, not a failure — it comes back as `{ ok: false, refusal }` and never as an api.error.
route('POST', /^\/api\/campaigns\/([^/]+)\/quote$/, async (m, body) => {
  const state = campaign.loadState(decodeURIComponent(m[1]));
  let q;
  try { q = campaign.quoteApply(state, body || {}); } catch (e) { return { ok: false, refusal: e.message }; }
  return {
    ok: true,
    quote: {
      income: { total: q.income.total, step: q.income.step.credits, cover: q.income.cover.credits, bonus: q.income.bonus.credits }, refund: q.salePlan.refund, available: q.available,
      replaceCost: q.replaceCost, purchaseCost: q.purchaseCost, recruitCost: q.recruitCost, machinesCost: q.machinesCost,
      gearCost: q.gearPlan.cost, kitCost: q.kitPlan.cost, abilityCost: q.abilityPlan.cost, trainCost: q.trainCost, spend: q.spend, left: q.available - q.spend,
      roster: q.roster || null,
      counts: { men: q.replaceIndices.length, vehicles: q.wrecks.length, units: q.buying.length, formations: q.recruits.length, weapons: q.gearPlan.changes.length, items: q.kitPlan.changes.length, abilities: q.abilityPlan.items.length, trained: q.trainPlan.length, sold: q.salePlan.units.length },
    },
  };
});

// O FIM DA CAMPANHA (05/10/2026, E143): fechar na ultima batalha e o resumo da campanha para a tela de placar.
route('POST', /^\/api\/campaigns\/([^/]+)\/finish$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('finish campaign', (note) => naFila(slug, () => campaign.finishCampaign(slug, note)), { slug });
  return { job: job.id };
});
route('GET', /^\/api\/campaigns\/([^/]+)\/summary$/, async (m) => campaign.campaignSummary(decodeURIComponent(m[1])));
// O RESUMO COM AS ETAPAS (14/11): um job, uma linha por batalha lida, acompanhado DENTRO da aba Outcome. Sem `slug` no job:
// e so leitura, e a pagina recarregada nao deve abrir a tela cheia do job por causa dele (jobs.activeFor).
route('POST', /^\/api\/campaigns\/([^/]+)\/summary$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const job = jobs.start('campaign summary', (note) => campaign.campaignSummaryWithSteps(slug, note));
  return { job: job.id };
});

route('GET', /^\/api\/campaigns\/([^/]+)\/log$/, async (m, _b, url) => ({
  // between 1 and 5000 events, 300 when the page asks for nothing sensible (QA r2 A15)
  events: campaign.traceOf(decodeURIComponent(m[1])).tail(Math.min(5000, Math.max(1, Math.floor(Number(url.searchParams.get('n'))) || 300))),
}));

// OS ERROS DA PAGINA (03/10). Um erro no navegador nao deixava rastro: a cotacao do batalhao que
// falhou para o autor so existia no console dele. Agora a pagina manda, e o erro vai para o log da
// campanha aberta (que entra no diagnostico) ou para o console do servidor quando nao ha campanha.
route('POST', /^\/api\/client-error$/, async (_m, body) => {
  const ev = { where: String(body.where || '').slice(0, 80), message: String(body.message || '').slice(0, 500), stack: String(body.stack || '').split('\n').slice(0, 8), page: String(body.page || '').slice(0, 80) };
  const slug = typeof body.slug === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(body.slug) && fs.existsSync(campaign.dirOf(body.slug)) ? body.slug : null;
  (slug ? campaign.traceOf(slug) : consoleTrace).event('page.error', ev);
  return { logged: slug || 'console' };
});

// POST, not GET: it writes a file. A GET with a side effect is the one request a foreign page can
// still fire, so it should never be the one that does something.
route('POST', /^\/api\/campaigns\/([^/]+)\/diagnostics$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const report = campaign.diagnostics(slug);
  const file = path.join(campaign.dirOf(slug), `diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 1));
  return { file, report };
});

// The app never deletes anything inside the game folder; only its own campaign folder goes.
route('DELETE', /^\/api\/campaigns\/([^/]+)$/, async (m) => {
  const slug = decodeURIComponent(m[1]);
  const dir = campaign.dirOf(slug);
  const state = campaign.loadState(slug);
  fs.rmSync(dir, { recursive: true, force: true });
  return { removed: dir, keptInGameFolder: [state.campaignFile].filter(Boolean) };
});

// ------------------------------------------------------------------------------------ server

// ANY PAGE YOU VISIT CAN TALK TO A SERVER ON YOUR OWN MACHINE. It cannot read the answer — the
// browser's same-origin rule stops that — but a plain GET goes through, and a GET that has a side
// effect would happen. So: a request that carries an `Origin` from anywhere other than this app is
// refused before it reaches a route. Requests from the app's own page carry our origin or none at
// all. This is not defence against someone already on the machine; it is defence against a tab.
const ORIGENS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const origemOk = (req) => {
  const o = req.headers.origin;
  return !o || ORIGENS.has(o);
};

const server = http.createServer(async (req, res) => {
  const reqId = crypto.randomBytes(2).toString('hex');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!origemOk(req)) {
        consoleTrace.event('api.foreignOrigin', { id: reqId, method: req.method, path: url.pathname, origin: req.headers.origin });
        return send(res, 403, { error: { message: 'this API only answers the page it serves', id: reqId } });
      }
      const hit = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!hit) return send(res, 404, { error: { message: `no route for ${req.method} ${url.pathname}`, id: reqId } });
      const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
      const slugFila = slugDaRota(req.method, url.pathname);
      const chama = () => hit.handler(url.pathname.match(hit.pattern), body, url);
      const out = await (slugFila ? naFila(slugFila, chama) : chama());
      // a route can answer with bytes of its own type (the map images, E178)
      if (out && out.raw) return send(res, 200, out.raw, { 'content-type': out.type, 'cache-control': 'private, max-age=3600' });
      return send(res, 200, out);
    }
    // static
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.join(WEB_DIR, rel);
    if (!file.startsWith(WEB_DIR) || !fs.existsSync(file)) return send(res, 404, { error: { message: 'not found', id: reqId } });
    // the posters of the campaign menu are redrawn on every screen change: images are cached, the page never is
    const imagem = (MIME[path.extname(file)] || '').startsWith('image/');
    return send(res, 200, fs.readFileSync(file), { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', ...(imagem ? { 'cache-control': 'public, max-age=86400' } : {}) });
  } catch (e) {
    consoleTrace.event('api.error', { id: reqId, method: req.method, path: url.pathname, message: e.message, stack: String(e.stack || '').split('\n').slice(0, 8) });
    // A missing file says which one, not where the disk keeps it (QA r2 A14); the full path stays in the log above.
    const message = e.code === 'ENOENT' ? `file not found: ${path.basename(String(e.path || ''))}` : e.message;
    return send(res, 500, { error: { message, id: reqId } });
  }
});

setInterval(() => jobs.forget(), 10 * 60 * 1000).unref();

// PORTA OCUPADA. Sem isto o node cospe um EADDRINUSE com pilha de rede e o terminal fecha — foi o
// que o autor viu quando eu tinha deixado uma copia minha rodando. A porta so pode estar ocupada
// por outra copia do proprio app, entao a mensagem diz isso e o que fazer. A primeira linha ("Port N is already in use.")
// e contrato com o lancador (app/launcher/Launcher.cs): ele a procura para saber que o app ja esta aberto.
server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') { console.error(e); process.exit(1); }
  console.error([
    '',
    `  Port ${PORT} is already in use.`,
    '',
    '  Another copy of this app is almost certainly running — look for the CMBS Roguelike icon in the',
    `  system tray (next to the clock), or open http://localhost:${PORT} and see if the app answers.`,
    '',
    `  Quit that one and start this again, or change "port" in ${SETTINGS_FILE} to ${PORT + 1}.`,
    '',
  ].join('\n'));
  process.exit(1);
});

// O APP QUE MORREU NO MEIO (29/10): ao subir, nada esta rodando — o que um processo morto deixou pela metade em cada
// campanha e desfeito, e a criacao interrompida (pasta sem estado, nada jogado) sai.
try { for (const r of campaign.recuperarTudo()) console.log(`  recovered ${r.slug}: ${r.done.join('; ')}`); } catch (e) { console.log(`  recovery skipped: ${e.message}`); }
server.listen(PORT, '127.0.0.1', () => {
  const p = paths();
  console.log(`CMBS Roguelike ${APP_VERSION} — run ${RUN_ID}`);
  console.log(`  game files : ${p.gameFiles}  (${DISCOVERY.source})`);
  if (!DISCOVERY.gameFiles) {
    console.log(`               NOT FOUND — looked in ${DISCOVERY.detection?.looked ?? 0} places. Open the page and set the folder on Setup.`);
  }
  console.log(`  maps       : ${p.maps}`);
  console.log(`  data       : ${USER_DIR}${PORTABLE ? '  (portable: beside the app)' : ''}`);
  // the LAST line, always: the launcher opens the window when it sees it, and the packager's proof waits for it
  console.log(`  open       : http://localhost:${PORT}`);
});
