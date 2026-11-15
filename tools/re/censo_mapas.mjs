// O CENSO DOS MAPAS DE QUICK BATTLE, DE UM TIPO, NUMA FERRAMENTA SO.
//
// `research/mapas_assault.json` foi montado em cinco passadas de scratch (d21, d23, d24, d25,
// capacidade_zonas) e nunca teve um gerador de verdade. O autor pediu Probe e Attack alem de
// Assault (12/09: "probe e mais facil, attack e medio e assault e mais dificil"), e refazer as
// cinco passadas a mao para cada tipo era pedir para errar. Aqui esta tudo o que o app le do censo
// (`spec/dados.md` secao 5; `spec/dominio.md` secao 4), calculado do arquivo:
//
//   W, H, area (km2)            do nome do arquivo ("(688 X 736)"), em metros
//   constr, constrPorHa         construcoes lidas do mapa (mapa.lerMapa)
//   folPct, estPct              % de tiles com foliage e com estrada (mapa.lerGrade)
//   perfil                      urbano se constr/ha >= 3; aberto se <= 0,5 e foliage <= 25%; senao misto
//   tier                        pela area: < 0,5 | < 1 | < 2 | < 4 | o resto  (dominio.md secao 4)
//   familia                     o nome sem o numero e sem "-Damaged" — a variante conta como o mesmo mapa
//   zonaAzul/zonaVermelho       tiles pintados de setup por lado; orientacao = quem tem a area grande
//   capX/capFolgadaX            quantas unidades cabem na zona (tile a tile, e no degrau folgado)
//   planoAzul/planoVermelho     slot do primeiro plano de IA usado (so informacao, 111.30)
//   usavel                      os dois lados tem zona de setup
//   transplante                 uma batalha gerada sobre o mapa preserva o mapa byte a byte (112.5)
//   serve                       usavel && transplante && orientacao azul-defende (o jogador ataca)
//
// E copia cada mapa para `assets/qb_<tipo>/`, que e de onde o app gera (settings.paths.maps).
//
//   node tools/re/censo_mapas.mjs Attack          escreve research/mapas_attack.json
//   node tools/re/censo_mapas.mjs Probe --so-ler  nao copia nem grava, so imprime
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { lerMapa, lerGrade } from './mapa.mjs';
import { pintura, interior } from './zonas.mjs';
import { gruposUsados } from './ia.mjs';
import { planoServe, mapaServe } from './gerar_batalha.mjs';
import { ler } from './transplante.mjs';
import { mapSelection, meetSelection, meetAdjusted, mapKey, packName } from '../../app/src/catalog.mjs';
import { trocarLados, unificarSetup } from './trocar_lados.mjs';
import { cabecalho } from './lados.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { ler as lerTipo } from './tipo_batalha.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const G = (process.env.CMBS_GAME_FILES || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files').replace(/[\\/]*$/, '') + '/';
const QB = G + 'Quick Battle Maps/';
const TIPO = process.argv[2] || 'Attack';   // 23/10: o app so usa a versao Attack de cada mapa
const SO_LER = process.argv.includes('--so-ler');
const DEST = path.join(RAIZ, 'assets', `qb_${TIPO.toLowerCase()}`);
const CENSO = path.join(RAIZ, 'research', `mapas_${TIPO.toLowerCase()}.json`);
const fwd = (p) => String(p).split('\\').join('/');

// O gerador do app, importado por ultimo: ele le a pasta do jogo na carga.
const RE = await import(`file:///${fwd(RAIZ)}/app/src/re.mjs`);
const LIB = path.join(RAIZ, 'assets/lib');
const DEFESA = fwd(path.join(LIB, 'RU - Section (Supply).btt'));
const ATAQUE = fwd(path.join(LIB, 'US - Section (Supply).btt'));

// MEET (05/10, E146): os Meeting Engagement se reconhecem pelo byte de tipo (0x03), nao pelo nome — seis deles se chamam
// "...m.btt". Os outros tipos continuam pelo nome.
const ENCONTRO = /^meet/i.test(TIPO);
const ehMeet = (f) => { try { return lerTipo(QB + f).nome === 'Meeting Engagement'; } catch { return false; } };
const arquivos = fs.readdirSync(QB).filter((f) => /\.btt$/i.test(f) && (ENCONTRO ? ehMeet(f) : new RegExp(`\\b${TIPO}\\b`, 'i').test(f))).sort();
console.log(`${arquivos.length} mapas ${TIPO} em ${QB}`);
if (!SO_LER) fs.mkdirSync(DEST, { recursive: true });

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SELECAO = /^meet/i.test(TIPO) ? meetSelection() : mapSelection();
// mapas do pacote com plano de IA autoral (app/data/planos_ia.json): o censo nao os recopia por cima
const AJUSTADOS = /^meet/i.test(TIPO) ? meetAdjusted() : new Map();
const OPS = { trocarLados, unificarSetup };
const AUTORAIS = new Set(Object.keys(JSON.parse(fs.readFileSync(new URL('../../app/data/planos_ia.json', import.meta.url), 'utf8')).mapas));
const tierDe = (area) => (area < 0.5 ? 1 : area < 1 ? 2 : area < 2 ? 3 : area < 4 ? 4 : 5);
const cabem = (tiles, passo) => { let n = 0; for (const [x, y] of tiles) if (!(x % passo) && !(y % passo)) n++; return n; };
// mf = onde o mapa acaba (o marcador): o transplante nao pode move-lo (E146, Hills-Open-Water 255 Meet)
const resumo = (f) => { const m = lerMapa(f); let mf = null; try { mf = abrirCompleto(f).m; } catch { /* */ } return { W: m.W, H: m.H, OX: m.OX, OY: m.OY, c: m.construcoes.length, g: m.gridStart, fg: m.fimGrade, ia: m.iaConfere, mf }; };
const tmpOut = path.join(os.tmpdir(), `censo_${TIPO}_${process.pid}.btt`);
const real = console.log;

const mapas = [];
for (const [i, f] of arquivos.entries()) {
  const origem = QB + f;
  const bytes = fs.readFileSync(origem);
  const destino = path.join(DEST, packName(f));   // o pacote leva o sufixo ' CMBSRL' (catalog.packName)
  // so os mapas da selecao do autor (app/data/mapas.json) vao para o pacote; o censo mede todos
  if (!SO_LER && SELECAO.has(mapKey(f)) && !AUTORAIS.has(`${path.basename(DEST)}/${packName(f)}`)) {
    // pacote ajustado (mapas.json > meet.pacoteAjustado, 17/10): o pacote leva a copia com as ops aplicadas em ordem
    // (trocarLados, unificarSetup); o sha do censo continua o do original
    let alvo = bytes;
    const aj = AJUSTADOS.get(mapKey(f));
    if (aj) {
      let atual = origem; const tmps = [];
      for (const [k, op] of (aj.ops || []).entries()) { if (!OPS[op]) throw new Error(`op desconhecida no pacoteAjustado: ${op}`); const t = path.join(os.tmpdir(), `censo_aj_${process.pid}_${k}.btt`); OPS[op](atual, t); tmps.push(t); atual = t; }
      alvo = fs.readFileSync(atual); for (const t of tmps) fs.rmSync(t, { force: true });
    }
    if (!fs.existsSync(destino) || sha(fs.readFileSync(destino)) !== sha(alvo)) fs.writeFileSync(destino, alvo);
  }
  const m = { f, tipo: TIPO, sha256: sha(bytes) };
  const dim = /\((\d+)\s*X\s*(\d+)\)/i.exec(f);
  try {
    const mapa = lerMapa(origem);
    m.W = dim ? +dim[1] : mapa.W * 8; m.H = dim ? +dim[2] : mapa.H * 8;
    m.area = Math.round(m.W * m.H / 1e6 * 100) / 100;
    m.constr = mapa.construcoes.length;
    m.constrPorHa = Math.round(m.constr / (m.area * 100) * 10) / 10;
    let fol = 0, est = 0;
    try { const g = lerGrade(mapa); for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) { const t = g.tile(x, y); if (t.foliageFlag) fol++; if (t.estrada) est++; } m.folPct = Math.round(100 * fol / (g.W * g.H)); m.estPct = Math.round(100 * est / (g.W * g.H)); } catch { m.folPct = null; m.estPct = null; }
    if (m.constr === 0) { m.perfil = /City|Town/i.test(f) ? 'urbano' : /Open|Rough|Hills|Forest/i.test(f) ? 'aberto' : 'misto'; m.perfilOrigem = 'nome'; }
    else m.perfil = m.constrPorHa >= 3 ? 'urbano' : (m.constrPorHa <= 0.5 && (m.folPct ?? 100) <= 25) ? 'aberto' : 'misto';
    m.tier = tierDe(m.area);
    m.familia = (() => { const r = /^(.*?\(\d+\s*X\s*\d+\))/.exec(f); return (r ? r[1] : f).replace(/-Damaged/i, '').replace(/\s+/g, ' ').trim(); })();
    m.iaConfere = mapa.iaConfere;
  } catch (e) { m.erro = `mapa: ${e.message.slice(0, 60)}`; }
  try { const g = gruposUsados(origem); m.gruposAzul = g.azul ? g.azul.grupos.length : null; } catch { m.gruposAzul = null; }
  const ps = planoServe(origem); m.planoAzul = ps.azul ?? null; m.planoVermelho = ps.vermelho ?? null; m.planoUm = ps.serve === true;
  const ms = mapaServe(origem); m.desc = ms.desc ?? null;
  try { m.atalhos = ler(origem).atalhos.length; } catch { m.atalhos = null; }
  try {
    const z = pintura(origem);
    const cruA = (z.azul || []).flatMap((l) => l.tiles), cruV = (z.vermelho || []).flatMap((l) => l.tiles);
    m.zonaAzul = interior(cruA).length; m.zonaVermelho = interior(cruV).length;
    m.capAzul = cabem(cruA, 1); m.capVermelho = cabem(cruV, 1);
    m.capFolgadaAzul = cabem(interior(cruA, 2, 1), 2); m.capFolgadaVermelho = cabem(interior(cruV, 2, 1), 2);
    m.orientacao = !m.zonaAzul || !m.zonaVermelho ? 'incompleta' : m.zonaAzul > m.zonaVermelho ? 'azul-defende' : 'vermelho-defende';
    m.usavel = m.capAzul > 0 && m.capVermelho > 0;
    m.motivo = m.usavel ? null : (!m.capAzul ? 'zona de setup azul sem tiles' : 'zona de setup vermelha sem tiles');
  } catch (e) { m.orientacao = 'ilegivel'; m.usavel = false; m.motivo = `zonas: ${e.message.slice(0, 50)}`; }
  // O TRANSPLANTE: uma batalha pequena gerada sobre o mapa, e o mapa lido de volta igual.
  if (m.usavel && !m.erro) {
    console.log = () => {};
    try {
      const antes = resumo(origem);
      await RE.generateBattle({ mapa: fwd(origem), duracao: 45, ataque: ENCONTRO ? 'Meeting Engagement' : TIPO, gruposAuto: true, nacaoAzul: RE.NATION_CODE.RU, nacaoVermelho: RE.NATION_CODE.US, defensor: [{ formacao: DEFESA }], atacante: [{ formacao: ATAQUE }] }, tmpOut);
      const depois = resumo(tmpOut);
      m.transplante = JSON.stringify(antes) === JSON.stringify(depois) && RE.checkForce(tmpOut).ok;
      if (!m.transplante) m.transplanteDelta = { antes, depois };
    } catch (e) { m.transplante = false; m.transplanteErro = e.message.slice(0, 80); }
    console.log = real;
  } else m.transplante = null;
  // num encontro ninguem defende: serve quando os dois lados tem zona e o transplante preserva o mapa
  // num encontro ninguem defende, e as zonas Tiny sao faixas de 3 tiles (interior erodido = 0, tiles crus > 0): serve
  // quando os dois lados tem tile de setup e o transplante preserva o mapa
  m.serve = !!m.usavel && m.transplante === true && (ENCONTRO ? true : m.orientacao === 'azul-defende');
  mapas.push(m);
  console.log(`${String(i + 1).padStart(3)}/${arquivos.length} ${f.padEnd(52)} t${m.tier ?? '?'} ${String(m.perfil ?? '?').padEnd(6)} ${m.orientacao ?? '?'}${m.transplante === false ? ' TRANSPLANTE FALHA' : ''}${m.serve ? '  SERVE' : ''}`);
}
try { fs.unlinkSync(tmpOut); } catch { /* nada */ }

const serve = mapas.filter((m) => m.serve);
const porTier = {}; for (const m of serve) porTier[m.tier] = (porTier[m.tier] || 0) + 1;
const porOr = {}; for (const m of mapas) porOr[m.orientacao] = (porOr[m.orientacao] || 0) + 1;
if (ENCONTRO) for (const m of mapas) if (m.orientacao === 'incompleta' && m.usavel) m.orientacao = 'faixas-estreitas';
console.log(`\n${TIPO}: ${mapas.length} mapas, servem ${serve.length} — por tier ${JSON.stringify(porTier)} — orientacao ${JSON.stringify(porOr)} — transplante falha em ${mapas.filter((m) => m.transplante === false).length}`);
if (!SO_LER) {
  fs.writeFileSync(CENSO, JSON.stringify({
    nota: `Censo dos ${mapas.length} mapas ${TIPO} de Quick Battle, gerado por tools/re/censo_mapas.mjs (12/09): area em km2 do nome do arquivo; constrPorHa e folPct do mapa lido; perfil e tier como em spec/dominio.md secao 4; zonaAzul/zonaVermelho = tiles de setup no interior (erosao 2x1), capX = tiles da zona inteira, capFolgadaX = degrau folgado; orientacao = quem tem a area grande (o jogador ataca no vermelho, entao serve exige azul-defende); transplante = a batalha gerada sobre o mapa preserva o mapa (112.5); serve = usavel && transplante && azul-defende.`,
    tipo: TIPO, mapas,
  }, null, 1) + '\n');
  console.log(`-> ${CENSO}  (mapas em ${DEST})`);
}
