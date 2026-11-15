// A BATERIA DE MEMORIA, FAMILIA M (05/10/2026; plano de 03/10, item 7 do autor). Um teto SEGURO de unidades para o
// app: o que pesa na memoria do jogo e onde ele falha, medido num processo NOVO por caso (a r1 media com o processo
// reaproveitado e herdava o pico da carga anterior).
//   node tools/re/bateria/memoria.mjs [--run m1]          -> research/bateria/<run>/{casos.json, offline.jsonl, cams/}
// Fases (cada caso = um .cam pronto, montado offline com o caminho do app, sem estado):
//   1 mapa:   uma forca pequena (RU, a menor formacao com gente no mapa) contra a defesa da b1 em 5 mapas
//   2 escada: forcas RU de formacoes inteiras de 700 a 1.300 unidades no mapa, no pior mapa (Huge Rough-Water-Town,
//             o dos OOM de 03/10), contra a defesa da b12 em esforco 2
//   3 eixos:  na referencia (~600 no mapa, mesmo mapa): inimigo b1 x b12; tanques (poucos homens por unidade);
//             dormentes (o resto das formacoes desligado); a referencia repetida (ruido)
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run', 'm1'); const SO_FASES = arg('--fases', '1,2,3').split(',').map(Number);
const DIR = path.join(L.DIR_BATERIA, RUN), CAMS = path.join(DIR, 'cams');
fs.mkdirSync(CAMS, { recursive: true });
// --pior: o mapa da escada e dos eixos (m1 usou o Rough-Water-Town, que nao carrega nem com 3 unidades: E139)
export const PIOR = arg('--pior', 'Huge Rough-Water-Town (3040 X 2000) 026r Assault.btt');
// --mapas selecao: o custo-base de cada mapa da selecao do autor (os Assault de app/data/mapas.json)
const MAPAS = arg('--mapas') === 'selecao' ? L.K.mapCensus().filter((m) => m.tipo === 'Assault').sort((a, b) => a.W * a.H - b.W * b.H || a.f.localeCompare(b.f)).map((m) => m.f) : ['Huge Rough-Water-Town (3040 X 2000) 026r Assault.btt', 'Huge Asintorf-Town (2400 X 2000) 091 Assault.btt', 'Podlypyky-Rough (1936 X 1808) 088 Assault.btt', 'Open-Hills (1248 X 1200) 314 Assault.btt', 'Small Village (554 X 848) 019r Assault.btt'];
const SEMENTE = 20261005;

// as formacoes RU, inteiras, com o que poem no mapa
const lib = L.K.libFormations('RU', { variants: true, rules: L.R }).filter((x) => !x.trp);
const inteira = (f) => ({ source: f.file, nation: 'RU', keep: L.todasAsChaves(L.K.formationTree(f.file)), xp: {} });
const formas = lib.map((f) => ({ f, p: L.C.priceOfPicks([inteira(f)], 'RU', L.R)[0] })).filter((x) => !x.p.uncovered.length && x.p.onMapUnits > 0);
const grandes = [...formas].sort((a, b) => b.p.onMapUnits - a.p.onMapUnits);
// acumula formacoes inteiras ate `alvo` (repete fontes quando acabam, como um jogador que compra duas vezes)
function pacote(alvo, lista = grandes) {
  const picks = []; let soma = 0;
  for (let volta = 0; soma < alvo * 0.97 && volta < 6; volta++) for (const x of lista) {
    if (soma >= alvo * 0.97) break;
    if (soma + x.p.onMapUnits > alvo * 1.04) continue;
    picks.push(inteira(x.f)); soma += x.p.onMapUnits;
  }
  return { picks, soma };
}
const menor = [...formas].filter((x) => x.p.onMapUnits >= 3).sort((a, b) => a.p.units - b.p.units)[0];
const tanques = formas.filter((x) => /Tank/i.test(x.f.name)).sort((a, b) => b.p.onMapUnits - a.p.onMapUnits);

const casos = [];
const novo = (fase, id, c) => { if (SO_FASES.includes(fase)) casos.push({ id, fase, ...c }); };
const base = { armies: ['RU'], enemySide: 'US', seed: SEMENTE };
MAPAS.forEach((m, k) => novo(1, `M${String(k + 1).padStart(2, '0')}`, { nome: `mapa: forca minima (${menor.p.onMapUnits} un) em ${m.replace(/ Assault\.btt$/, '')}`, montar: { ...base, picks: [inteira(menor.f)], battleNumber: 1, effort: 1, mapa: m } }));
// --escada 150,300,...: os degraus (m1: 700..1300); --tag: prefixo dos ids, para duas escadas na mesma rodada
const ESCADA = arg('--escada', '700,775,850,925,1000,1075,1150,1225,1300').split(',').map(Number); const TAG = arg('--tag', 'ML');
for (const alvo of ESCADA) { const p = pacote(alvo); novo(2, `${TAG}${alvo}`, { nome: `escada: ${p.soma} no mapa, b12 x2`, alvo, montar: { ...base, picks: p.picks, battleNumber: 12, effort: 2, mapa: PIOR } }); }
{
  const ref = pacote(600);
  novo(3, 'MXREF1', { nome: `referencia ${ref.soma} no mapa, b12 x2`, montar: { ...base, picks: ref.picks, battleNumber: 12, effort: 2, mapa: PIOR } });
  novo(3, 'MXREF2', { nome: 'referencia repetida (ruido)', montar: { ...base, picks: ref.picks, battleNumber: 12, effort: 2, mapa: PIOR } });
  novo(3, 'MXINI1', { nome: 'referencia contra a defesa da b1 x1', montar: { ...base, picks: ref.picks, battleNumber: 1, effort: 1, mapa: PIOR } });
  const t = pacote(600, tanques.length ? tanques : grandes);
  novo(3, 'MXTAN', { nome: `tanques: ${t.soma} no mapa (poucos homens por unidade), b12 x2`, montar: { ...base, picks: t.picks, battleNumber: 12, effort: 2, mapa: PIOR } });
  // dormentes: as maiores formacoes compradas com UMA subformacao so; o resto vira registro desligado
  const dorm = []; let noMapa = 0;
  for (const x of grandes) {
    if (noMapa >= 560) break;
    const tree = L.K.formationTree(x.f.file); const subs = L.nos(tree).filter((n) => n.isFormation && n.key.split('.').length === 2); if (!subs.length) continue;
    const keep = L.subarvore(tree, subs[0].key); const pr = L.C.priceOfPicks([{ source: x.f.file, nation: 'RU', keep, xp: {} }], 'RU', L.R)[0]; if (!pr.onMapUnits || pr.uncovered.length) continue;
    dorm.push({ source: x.f.file, nation: 'RU', keep, xp: {} }); noMapa += pr.onMapUnits;
  }
  novo(3, 'MXDOR', { nome: `dormentes: ~${noMapa} no mapa + o resto das formacoes desligado, b12 x2`, montar: { ...base, picks: dorm, battleNumber: 12, effort: 2, mapa: PIOR } });
}
fs.writeFileSync(path.join(DIR, 'casos.json'), JSON.stringify({ run: RUN, semente: SEMENTE, gerado: new Date().toISOString(), casos }, null, 1));

// montar e medir offline (retoma: o que ja esta no offline.jsonl nao e refeito)
const feitos = new Map(L.lerLinhas(path.join(DIR, 'offline.jsonl')).map((l) => [l.id, l]));
for (const c of casos) {
  if (feitos.has(c.id)) continue;
  const t0 = Date.now(); let linha;
  try {
    const m = await L.montar({ ...c.montar, slug: `A-BAT-${c.id}` });
    const cam = path.join(CAMS, `CMBSDC A-BAT-${c.id}.cam`); fs.copyFileSync(m.camOut, cam);
    const cb = L.conferirBtt(m.bttOut), cc = L.conferirCam(m.camOut, m.coreOut);
    linha = { id: c.id, veredito: m.naoPosicionada.length ? 'NAO-POSICIONADA' : L.veredito(cb, cc).veredito, mapa: m.mapa, noMapa: m.onMap, defesa: m.defesa, registros: cb.registros, homens: cc.roster?.homens, blocos: cc.roster?.blocos, bytesCam: fs.statSync(cam).size, naoPosicionada: m.naoPosicionada, erros: [...(cb.erros || []), ...(cc.erros || [])].slice(0, 4), s: Math.round((Date.now() - t0) / 1000) };
    fs.rmSync(m.dir, { recursive: true, force: true });
  } catch (e) { linha = { id: c.id, veredito: 'ERRO', detalhe: e.message.slice(0, 300) }; }
  L.escreverLinha(path.join(DIR, 'offline.jsonl'), linha);
  console.log(`${c.id} ${linha.veredito} no mapa ${linha.noMapa ?? '-'} inimigo ${linha.defesa?.units ?? '-'} registros ${linha.registros ?? '-'} homens ${linha.homens ?? '-'} (${linha.s ?? '-'} s)${linha.detalhe ? ' ' + linha.detalhe : ''}`);
}
console.log(`${casos.length} casos em ${DIR}`);
