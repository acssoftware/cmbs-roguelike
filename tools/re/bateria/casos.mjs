// O GERADOR DE CASOS DA BATERIA (03/10). Semente fixa: o mesmo run gera sempre os mesmos casos.
//   node tools/re/bateria/casos.mjs [--run NOME] [--semente N] [--b 60]
// -> research/bateria/<run>/casos.json
//
// Familias:
//   A  biblioteca: cada formacao da LIB sozinha e inteira (variantes e as tres SF inclusas)
//   B  combinacoes do jogador, o caminho real (<= 2.500 cr): 1-3 fontes, keep parcial, anexos,
//      trocas de equipamento, SF, exercitos mistos — com uma variante de virada (E0..E5)
//   C  volume (harvest): formacoes inteiras acumuladas ate N unidades em campo
//   D  defesa: um peloto pequeno contra o planDefense das batalhas 1-12, esforcos e sementes
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run', new Date().toISOString().slice(0, 10));
const SEMENTE = Number(arg('--semente', 20261003));
const NB = Number(arg('--b', 60));
const sorte = L.D.rng(SEMENTE);
const um = (lista) => lista[Math.floor(sorte() * lista.length)];
const INIMIGO = { US: 'RU', UKR: 'RU', RU: 'US' };
const ladoInimigo = (armies) => (armies.includes('RU') ? 'US' : 'RU');
const casos = [];
const novo = (fam, c) => { const n = casos.filter((x) => x.familia === fam).length + 1; casos.push({ id: `${fam}${String(n).padStart(3, '0')}`, familia: fam, ...c }); };

// --- A: a biblioteca --------------------------------------------------------------------------------
for (const nation of ['US', 'RU', 'UKR']) {
  for (const f of L.K.libFormations(nation, { variants: true, specialForces: true, rules: L.R }).filter((x) => !x.trp)) {
    const tree = L.K.formationTree(f.file);
    const pick = f.sf ? { source: f.file, nation, keep: L.C.priceOfPicks([{ source: f.file, nation, keep: [], sf: true }], nation, L.R)[0].keep, xp: {}, sf: true }
      : { source: f.file, nation, keep: L.todasAsChaves(tree), xp: {} };
    novo('A', { nome: `${nation} ${f.name}${f.sf ? ' (SF)' : ''}`, criar: { armies: [nation], enemySide: INIMIGO[nation], picks: [pick], harvest: true }, seed: SEMENTE, units: f.units });
  }
}

// --- B: combinacoes do jogador ------------------------------------------------------------------------
const VIRADAS = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5'];
const EXERCITOS = [['US'], ['RU'], ['UKR'], ['US', 'UKR']];
const lib = {}; for (const n of ['US', 'RU', 'UKR']) lib[n] = L.K.libFormations(n, { variants: true, rules: L.R }).filter((x) => !x.trp);
const sfs = {}; for (const n of ['US', 'RU', 'UKR']) sfs[n] = L.K.libFormations(n, { specialForces: true, rules: L.R }).filter((x) => x.sf);
function umPick(nation) {
  const f = um(lib[nation]); const tree = L.K.formationTree(f.file); const todos = L.nos(tree);
  const formacoes = todos.filter((n) => n.isFormation && n.key.includes('.')), folhas = todos.filter((n) => !n.isFormation && !n.offMap);
  const modo = um(['subarvore', 'subarvore', 'folhas', 'inteira']);
  let keep;
  if (modo === 'inteira' || (!formacoes.length && !folhas.length)) keep = L.todasAsChaves(tree);
  else if (modo === 'subarvore' && formacoes.length) keep = L.subarvore(tree, um(formacoes).key);
  else { const k = 2 + Math.floor(sorte() * 4); const esc = new Set(); while (esc.size < Math.min(k, folhas.length)) esc.add(um(folhas).key); keep = L.folhasCom(tree, [...esc]); }
  const pick = { source: f.file, nation, keep, xp: {}, modo };
  // anexo (30%): um veiculo avulso num no de formacao mantido
  const mantidas = todos.filter((n) => n.isFormation && keep.includes(n.key));
  if (sorte() < 0.3 && mantidas.length) { const v = um(L.K.singleVehicles([nation], { rules: L.R })); pick.extras = [{ tipo: v.name, key: um(mantidas).key, type: v.type }]; }
  // troca de equipamento (25%): uma opcao com molde e nome, num grupo que tem unidade mantida
  if (sorte() < 0.25) {
    const menu = L.K.equipmentMenu(tree, nation, L.R); const gs = Object.entries(menu.groups);
    if (gs.length) {
      const [g, G] = um(gs); const ops = G.options.filter((o) => o.roster && o.named && o.priced);
      const sob = todos.filter((n) => !n.isFormation && n.group === Number(g) && keep.includes(n.key));
      if (ops.length && sob.length) { const no = um(sob); const pai = no.key.slice(0, no.key.lastIndexOf('.')) || no.key; pick.swaps = [{ key: pai, group: Number(g), to: um(ops).type }]; }
    }
  }
  return pick;
}
for (let tent = 0; casos.filter((c) => c.familia === 'B').length < NB && tent < NB * 40; tent++) {
  const armies = um(EXERCITOS);
  const n = 1 + Math.floor(sorte() * 3);
  const picks = [];
  for (let k = 0; k < n; k++) picks.push(umPick(um(armies)));
  if (sorte() < 0.15) { const nat = um(armies); if (sfs[nat]?.length) { const s = sfs[nat][0]; picks.push({ source: s.file, nation: nat, keep: [], xp: {}, sf: true }); } }
  if (sorte() < 0.08 && picks.length) picks.push({ ...picks[0] });            // a mesma fonte duas vezes
  let priced; try { priced = L.C.priceOfPicks(picks, picks[0].nation, L.R); } catch { continue; }
  const preco = priced.reduce((a, p) => a + p.price, 0), onMap = priced.reduce((a, p) => a + p.onMapUnits, 0);
  if (preco > L.C.startingCredits(L.R) || !onMap || priced.some((p) => p.uncovered.length)) continue;
  const nb = casos.filter((c) => c.familia === 'B').length;
  novo('B', { nome: picks.map((p) => `${p.nation}:${path.basename(p.source, '.btt').replace(/^(US|RU|UKR) - /, '')}${p.modo ? '/' + p.modo : ''}${p.extras ? '+anexo' : ''}${p.swaps ? '+troca' : ''}${p.sf ? '/SF' : ''}`).join(' + '),
    criar: { armies, enemySide: ladoInimigo(armies), picks: picks.map(({ modo, ...p }) => p), harvest: false }, seed: SEMENTE + nb, preco, onMap, virada: VIRADAS[nb % VIRADAS.length] });
}

// --- C: volume ----------------------------------------------------------------------------------------
for (const nation of ['RU', 'UKR', 'US']) {
  const formas = lib[nation].map((f) => ({ f, p: L.C.priceOfPicks([{ source: f.file, nation, keep: L.todasAsChaves(L.K.formationTree(f.file)), xp: {} }], nation, L.R)[0] }))
    .filter((x) => !x.p.uncovered.length && x.p.onMapUnits > 0).sort((a, b) => b.p.onMapUnits - a.p.onMapUnits);
  for (const alvo of nation === 'RU' ? [150, 300, 500, 700, 882, 1000, 1200] : [500, 882, 1200]) {
    const esc = []; let soma = 0;
    for (const x of formas) { if (soma >= alvo) break; if (soma + x.p.onMapUnits > alvo * 1.1 && soma > 0) continue; esc.push(x); soma += x.p.onMapUnits; }
    if (soma < alvo * 0.9) continue;
    novo('C', { nome: `${nation} ${soma} em campo`, criar: { armies: [nation], enemySide: INIMIGO[nation], picks: esc.map((x) => ({ source: x.f.file, nation, keep: L.todasAsChaves(L.K.formationTree(x.f.file)), xp: {} })), harvest: true }, seed: SEMENTE, onMap: soma, alvo });
  }
}

// --- D: defesa ------------------------------------------------------------------------------------------
{
  // a forca de apoio: a MENOR formacao da nacao que poe gente no mapa (a menor de todas e o drone Orlan)
  const menor = (nation) => lib[nation].map((f) => ({ source: f.file, nation, keep: L.todasAsChaves(L.K.formationTree(f.file)), xp: {} }))
    .map((p) => ({ p, q: L.C.priceOfPicks([p], nation, L.R)[0] })).filter((x) => x.q.onMapUnits >= 3 && !x.q.uncovered.length).sort((a, b) => a.q.units - b.q.units)[0].p;
  const pick = menor('RU');
  for (const b of [1, 3, 4, 6, 7, 9, 10, 12]) for (const effort of [0.5, 1, 2]) for (const s of [1, 2, 3]) {
    novo('D', { nome: `defesa US b${b} x${effort} s${s}`, montar: { picks: [pick], armies: ['RU'], enemySide: 'US', battleNumber: b, effort, seed: SEMENTE + s }, battleNumber: b, effort });
  }
  for (const face of [true, false]) novo('D', { nome: `defesa US b12 x2 face ${face ? 'on' : 'off'}`, montar: { picks: [pick], armies: ['RU'], enemySide: 'US', battleNumber: 12, effort: 2, seed: SEMENTE, face }, battleNumber: 12, effort: 2 });
  const pickUS = menor('US');
  for (const b of [4, 10, 12]) for (const effort of [1, 2]) novo('D', { nome: `defesa RU b${b} x${effort}`, montar: { picks: [pickUS], armies: ['US'], enemySide: 'RU', battleNumber: b, effort, seed: SEMENTE }, battleNumber: b, effort });
}

const dir = path.join(L.DIR_BATERIA, RUN);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'casos.json'), JSON.stringify({ run: RUN, semente: SEMENTE, gerado: new Date().toISOString(), casos }, null, 1));
const por = {}; for (const c of casos) por[c.familia] = (por[c.familia] || 0) + 1;
console.log(`${path.join(dir, 'casos.json')}: ${casos.length} casos ${JSON.stringify(por)}`);
