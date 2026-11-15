// A FORCA MINIMA QUE MOSTRA AS ARMAS QUE FALTAM.
//
// `plano_armas.mjs` diz QUE formacoes tocam os tipos nunca amostrados. Mas comprar a formacao
// inteira e comprar 190 unidades para ver duas — e uma batalha de 1900 unidades nao se joga, nem se
// carrega depressa. Aqui a forca e montada folha a folha: UMA copia de cada tipo que falta, e nada
// mais. A poda fecha para cima sozinha (`prunePlan`), entao os cabecalhos vem junto sem entrar em
// campo.
//
// Sai no formato que `POST /api/campaigns` espera, para a campanha nascer do arquivo e nao do mouse.
//
//   node tools/re/forca_armas.mjs UKR              mostra a forca
//   node tools/re/forca_armas.mjs UKR --gravar     escreve research/forca_armas_UKR.json
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const R = JSON.parse(fs.readFileSync(path.join(RAIZ, 'app/data/rules.json'), 'utf8'));

// a escada (30/10): os creditos iniciais sao a razao do preset padrao x o primeiro degrau
const INICIAL = await (async () => { const C = await import(new URL('../../app/src/campaign.mjs', import.meta.url)); return C.startingCredits(C.rules()); })();
const C = await import(`file:///${RAIZ.replace(/\\/g, '/')}/app/src/catalog.mjs`);

const NACAO = (process.argv[2] || 'UKR').toUpperCase();
const plano = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/plano_armas_quentes.json'), 'utf8'));
const faltam = new Map(plano.tiposQueFaltam.filter((t) => t.nacoes.includes(NACAO)).map((t) => [t.par, t]));
console.log(`${NACAO}: ${faltam.size} tipos que faltam e existem neste exercito`);

// A copia mais barata de cada tipo, e de preferencia numa fonte que ja vai entrar por outro tipo —
// menos fontes e menos cabecalho arrastado para o campo.
const candidatos = new Map();      // par -> [{file, key, price, nome, papel}]
for (const f of C.libraryForArmies([NACAO])) {
  let tree; try { tree = C.formationTree(f.file); } catch { continue; }
  const anda = (n) => {
    if (n.isFormation) { n.children.forEach(anda); return; }
    const par = n.type.join(',');
    if (!faltam.has(par) || n.offMap) return;
    if (!candidatos.has(par)) candidatos.set(par, []);
    candidatos.get(par).push({ file: f.file, nation: f.nation, key: n.key, price: C.priceUnit(n, f.nation, R), nome: n.name, papel: C.roleOf(n.name, n.offMap, R) });
  };
  tree.roots.forEach(anda);
}
console.log(`   ${candidatos.size} deles tem copia no mapa nesta biblioteca`);

// Escolha gulosa por FONTE: enquanto houver tipo descoberto, entra a fonte que cobre mais deles.
// Assim a forca sai concentrada em poucos arquivos, que e o que deixa a batalha pequena.
const porFonte = new Map();
for (const [par, lista] of candidatos) for (const c of lista) {
  if (!porFonte.has(c.file)) porFonte.set(c.file, new Map());
  const m = porFonte.get(c.file);
  if (!m.has(par) || m.get(par).price > c.price) m.set(par, c);
}
const descobertos = new Set(candidatos.keys());
const escolha = new Map();         // file -> [candidatos]
while (descobertos.size) {
  let melhor = null;
  for (const [file, m] of porFonte) {
    if (escolha.has(file)) continue;
    const ganho = [...m.keys()].filter((p) => descobertos.has(p)).length;
    if (ganho && (!melhor || ganho > melhor.ganho)) melhor = { file, m, ganho };
  }
  if (!melhor) break;
  const meus = [...melhor.m.entries()].filter(([p]) => descobertos.has(p)).map(([, c]) => c);
  escolha.set(melhor.file, meus);
  for (const [p, c] of melhor.m) if (meus.includes(c)) descobertos.delete(p);
}

const picks = [];
let unidades = 0, custo = 0;
for (const [file, lista] of escolha) {
  picks.push({ source: file, nation: NACAO, keep: lista.map((c) => c.key) });
  unidades += lista.length;
  custo += lista.reduce((a, c) => a + c.price, 0);
}
console.log(`\n${picks.length} fontes, ${unidades} unidades, ${custo} cr (orcamento ${INICIAL})`);
for (const [file, lista] of escolha) {
  console.log(`   ${String(lista.length).padStart(3)} unidades | ${file.replace(/\.btt$/, '')}`);
  for (const c of lista.slice(0, 4)) console.log(`        ${c.papel.padEnd(9)} ${c.nome}`);
  if (lista.length > 4) console.log(`        ... e mais ${lista.length - 4}`);
}
if (descobertos.size) console.log(`\n${descobertos.size} tipos ficaram de fora`);

if (process.argv.includes('--gravar')) {
  const saida = path.join(RAIZ, `research/forca_armas_${NACAO}.json`);
  fs.writeFileSync(saida, JSON.stringify({
    nota: `Forca minima para ver as armas dos tipos ${NACAO} nunca amostrados: uma copia de cada, folha a folha. Pronta para POST /api/campaigns. Refazer com \`node tools/re/forca_armas.mjs ${NACAO} --gravar\`.`,
    nacao: NACAO, tipos: candidatos.size, unidades, custo,
    corpo: { name: `ZZ ARMAS ${NACAO}`, armies: [NACAO], enemySide: NACAO === 'RU' ? 'US' : 'RU', enemyEffort: 0.5, rescueChance: 0, picks },
    detalhe: [...escolha.entries()].map(([file, lista]) => ({ file, unidades: lista.map((c) => ({ key: c.key, nome: c.nome, papel: c.papel, preco: c.price })) })),
  }, null, 1) + '\n');
  console.log(`\n-> ${saida}`);
}
