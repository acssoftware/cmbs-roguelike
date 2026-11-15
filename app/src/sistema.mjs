// A CHECAGEM DO SISTEMA (29/10/2026, autor: "um script no app que verifica se todas as pastas do jogo existem no
// computador do jogador para o pleno funcionamento do app; o ideal e que rode na instalacao ou na primeira execucao").
// Roda na primeira vez que a pagina abre (a tela System check) e sob pedido no Setup; o resultado fica em
// settings.json (na pasta de dados, settings.mjs USER_DIR) > systemCheck, e a tela so volta sozinha se a ultima checagem achou uma falha.
//
// Cada item: { id, titulo, estado: 'ok' | 'aviso' | 'falha', detalhe, conserto }. Falha = o app nao funciona assim;
// aviso = funciona, mas o jogador deve saber (versao do jogo abaixo da testada, pasta que o app criou).
// Nada aqui apaga ou move nada: a unica escrita e um arquivo de teste, criado e apagado, e as pastas Campaigns e
// Saved Games quando faltam (o jogo as cria sozinho mais tarde, e o app precisa delas antes).
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, ASSETS_DIR, DATA_DIR, RESEARCH_DIR, USER_DIR, PORTABLE, paths, validate, current, save } from './settings.mjs';
import { TABELAS_DO_APP, NODE_MINIMO } from './pacote.mjs';
import { bmpIntegro } from '../../tools/re/bmp_integro.mjs';

const lerJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const item = (id, titulo, estado, detalhe, conserto = '') => ({ id, titulo, estado, detalhe, conserto });

// a versao de um arquivo de patch, como numero comparavel: v217 -> 217, v100a -> 100
export function versaoDoJogo(raizDoJogo) {
  const dados = path.join(raizDoJogo, 'Data');
  if (!fs.existsSync(dados)) return null;
  let maior = null;
  for (const f of fs.readdirSync(dados)) {
    const m = f.match(/^black sea v(\d+)[a-z]?\.brz$/i);
    if (m && (maior == null || +m[1] > maior)) maior = +m[1];
  }
  return maior;
}
const versaoLegivel = (v) => `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;

function podeEscrever(dir) {
  const teste = path.join(dir, '.cmbsdc-write-test');
  try { fs.writeFileSync(teste, 'x'); fs.unlinkSync(teste); return null; } catch (e) { return e.code || e.message; }
}

// `gameFiles` e `regras` existem para o teste (uma pasta de jogo falsa); o app chama sem nada
export function checarSistema({ gameFiles = current().gameFiles, regras = lerJson(path.join(DATA_DIR, 'rules.json')) } = {}) {
  const itens = [];
  const p = paths(gameFiles);

  // --- a maquina
  itens.push(process.platform === 'win32'
    ? item('platform', 'Windows', 'ok', `${process.platform} ${process.arch}`)
    : item('platform', 'Windows', 'falha', `this is ${process.platform}`, 'Combat Mission and this app run on Windows only.'));
  const [ma, mi] = process.versions.node.split('.').map(Number);
  const portatil = path.resolve(process.execPath).toLowerCase().startsWith(path.join(APP_DIR, 'node').toLowerCase());
  const nodeOk = ma > NODE_MINIMO[0] || (ma === NODE_MINIMO[0] && mi >= NODE_MINIMO[1]);
  itens.push(nodeOk
    ? item('node', 'Node.js', 'ok', `v${process.versions.node}${portatil ? ' (the one in the package)' : ' (installed on this computer)'}`)
    : item('node', 'Node.js', 'falha', `v${process.versions.node}, needs ${NODE_MINIMO.join('.')} or newer`, 'Extract the package again (it carries its own Node in app/node), or install the current Node.js LTS from nodejs.org.'));
  // a pasta de dados (14/11): settings.json e as campanhas, fora da pasta do app (settings.mjs USER_DIR)
  let semDados = null;
  try { fs.mkdirSync(USER_DIR, { recursive: true }); semDados = podeEscrever(USER_DIR); } catch (e) { semDados = e.code || e.message; }
  itens.push(semDados
    ? item('data', 'Campaign folder', 'falha', `${USER_DIR}: ${semDados}`, 'The app keeps its settings and every campaign in this folder. Give your user write permission on it.')
    : item('data', 'Campaign folder', 'ok', `${USER_DIR}${PORTABLE ? ' (beside the app)' : ''}`));

  // --- o jogo
  const v = validate(gameFiles);
  if (!v.ok) {
    itens.push(item('game', 'Game folder', 'falha', `${gameFiles}: no Scenarios folder, this is not the game's Game Files folder`,
      'Open Setup and point the app to "Combat Mission Black Sea/Game Files" (Steam: right-click the game > Manage > Browse local files).'));
  } else {
    itens.push(item('game', 'Game folder', 'ok', gameFiles));
    // as que o app escreve e le; o jogo cria as duas na primeira vez que precisa, o app precisa antes
    const criadas = [];
    for (const [nome, dir] of [['Campaigns', p.campaigns], ['Saved Games', p.savedGames]]) {
      if (fs.existsSync(dir)) continue;
      try { fs.mkdirSync(dir, { recursive: true }); criadas.push(nome); } catch { /* a escrita abaixo diz por que */ }
    }
    if (criadas.length) itens.push(item('folders', 'Game subfolders', 'aviso', `${criadas.join(' and ')} did not exist; the app created ${criadas.length > 1 ? 'them' : 'it'}`, 'Nothing to do: the game uses the same folders.'));
    else itens.push(item('folders', 'Game subfolders', 'ok', 'Scenarios, Campaigns and Saved Games'));
    const semEscrita = [['Scenarios', p.scenarios], ['Campaigns', p.campaigns], ['Saved Games', p.savedGames]]
      .map(([nome, dir]) => [nome, fs.existsSync(dir) ? podeEscrever(dir) : 'missing']).filter(([, e]) => e);
    itens.push(semEscrita.length
      ? item('write', 'Write access', 'falha', semEscrita.map(([n, e]) => `${n}: ${e}`).join('; '),
        'The app writes battles and campaigns into the game folder. Give your user write permission on "Game Files" (Properties > Security), or install the game outside a protected folder.')
      : item('write', 'Write access', 'ok', 'the app can write battles and campaigns'));
    // a versao: o patch mais novo na pasta Data, na raiz do jogo (ao lado de Game Files)
    const testada = regras.game?.testedVersion;
    const ver = versaoDoJogo(path.dirname(gameFiles));
    if (ver == null) itens.push(item('version', 'Game version', 'aviso', 'could not read it (no "black sea vNNN.brz" in the Data folder)', `The app was tested on patch ${versaoLegivel(testada)}; keep the game up to date.`));
    else if (testada && ver < testada) itens.push(item('version', 'Game version', 'aviso', `patch ${versaoLegivel(ver)}; the app was tested on ${versaoLegivel(testada)}`, 'Update the game (Steam updates on its own; GOG / Battlefront: install the latest patch). The app goes on, but battles may not load.'));
    else itens.push(item('version', 'Game version', 'ok', `patch ${versaoLegivel(ver)}`));
  }

  // --- o pacote do app: tudo o que ele le existe e abre
  const falta = [];
  const btts = fs.existsSync(p.lib) ? fs.readdirSync(p.lib).filter((f) => f.toLowerCase().endsWith('.btt')).length : 0;
  if (!btts) falta.push(`formation library (${path.relative(path.dirname(APP_DIR), p.lib)})`);
  if (!fs.existsSync(p.campaignTemplate)) falta.push('campaign template');
  for (const f of ['rules.json', 'mapas.json', 'planos_ia.json']) { try { lerJson(path.join(DATA_DIR, f)); } catch { falta.push(`app/data/${f}`); } }
  for (const t of TABELAS_DO_APP) if (!fs.existsSync(path.join(RESEARCH_DIR, t))) falta.push(`research/${t}`);
  // os mapas da selecao do autor, um por um
  let mapas = 0;
  try {
    const sel = lerJson(path.join(DATA_DIR, 'mapas.json'));
    const nomes = [...Object.values(sel.tiers).flat().map((n) => ['qb_attack', n + ' Attack']), ...Object.values(sel.meet?.tiers || {}).flat().map((n) => ['qb_meet', n + ' Meet'])];
    for (const [pasta, n] of nomes) {
      const dir = path.join(ASSETS_DIR, pasta);
      const achou = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith(n) && f.toLowerCase().endsWith('.btt'));
      if (achou) mapas++; else falta.push(`map ${n}`);
    }
  } catch { /* mapas.json ja entrou na lista */ }
  if (!fs.existsSync(p.mapImages)) falta.push('map images (assets/map_images)');
  // a arte que vai para dentro dos arquivos do jogo: um BMP ruim e recusado na hora (campaign.mjs), aqui se diz cedo
  for (const [f, tam] of [['logo170.bmp', [170, 170]], ['logo224.bmp', [224, 224]]]) {
    const arq = path.join(p.artBriefing, f);
    const motivo = fs.existsSync(arq) ? bmpIntegro(fs.readFileSync(arq), tam) : 'missing';
    if (motivo) falta.push(`app/art/briefing/${f} (${motivo})`);
  }
  for (const n of [11, 13, 18]) for (const ext of ['json', 'png']) if (!fs.existsSync(path.join(p.artBriefing, `fonte_${n}.${ext}`))) falta.push(`app/art/briefing/fonte_${n}.${ext}`);
  itens.push(falta.length
    ? item('files', 'App files', 'falha', `missing or damaged: ${falta.slice(0, 6).join(', ')}${falta.length > 6 ? ` and ${falta.length - 6} more` : ''}`,
      'The package is incomplete. Extract the whole zip again into a new folder (do not copy only part of it).')
    : item('files', 'App files', 'ok', `${btts} formations, ${mapas} maps, ${TABELAS_DO_APP.length} data tables`));

  const falhas = itens.filter((i) => i.estado === 'falha').length;
  return { at: new Date().toISOString(), node: process.versions.node, ok: falhas === 0, falhas, avisos: itens.filter((i) => i.estado === 'aviso').length, itens };
}

// roda e guarda o resumo (os itens nao: mudam a cada vez, e a tela pede de novo)
export function checarEGuardar() {
  const r = checarSistema();
  save({ systemCheck: { at: r.at, ok: r.ok, falhas: r.falhas, avisos: r.avisos } });
  return r;
}
