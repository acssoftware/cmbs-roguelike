// A FORCA A PE: uma copia de cada folha de infantaria que a biblioteca de um exercito oferece.
//
// Para que serve: ler nome de arma. Os pares `classe/item` que ainda nao tem nome sao quase todos
// arma de infantaria comum do lado russo — o `2/26` tem 1.035 portadores nos saves — e eles nunca
// puderam ser lidos porque nos saves onde aparecem o russo e a IA, e o `=` so cicla o que e meu.
//
// POR QUE NAO A FORCA DIRIGIDA. `forca_pares.mjs` tenta ir direto: dos saves sai o TIPO que carrega
// cada par, a ponte de tipos leva a biblioteca. Mas a ponte cobre 168 dos 376 tipos e justamente os
// tipos russos da `City 001` ficaram de fora — ela nasce de campanhas que passaram por uma virada, e
// nenhuma campanha russa passou. Entao a escolha e por NOME, e a aposta e a variedade: uma copia de
// cada folha a pe cobre todo papel de infantaria que existe, e o que sobrar depois se ve.
//
// Nada de veiculo: quem separa e o NOME e nao o papel (a lição do E46 — a bandeira da LIB mente).
// Fica pequena de proposito: batalha que carrega em segundos e cabe no orcamento inicial.
//
//   node tools/re/forca_pe.mjs RU               mostra a forca
//   node tools/re/forca_pe.mjs RU --gravar      escreve research/forca_pe_RU.json
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const R = JSON.parse(fs.readFileSync(path.join(RAIZ, 'app/data/rules.json'), 'utf8'));

// a escada (30/10): os creditos iniciais sao a razao do preset padrao x o primeiro degrau
const INICIAL = await (async () => { const C = await import(new URL('../../app/src/campaign.mjs', import.meta.url)); return C.startingCredits(C.rules()); })();
const C = await import(`file:///${RAIZ.replace(/\\/g, '/')}/app/src/catalog.mjs`);

const NACAO = (process.argv[2] || 'RU').toUpperCase();
const TETO = Number(process.argv.find((a) => /^--teto=/.test(a))?.split('=')[1] || INICIAL || 2500);

// Papel de veiculo e de arma pesada fora: o que interessa e homem com arma na mao.
const FORA_PAPEL = new Set(['apc', 'ifv', 'tank', 'artillery', 'aa', 'drone', 'trp', 'truck', 'mortar', 'other']);
// E o nome decide, porque o papel erra: "ATGM Vehicle (BRDM-2M)" tem papel atgm.
const NOME_DE_VEICULO = /\(|Vehicle|Carrier|Tank|Howitzer|Gun\b|Truck|Drone|Antiaircraft/;
const EXCECAO = /Team|Squad|Section/;   // "Machinegun Team (PKM)" e "Team (RPO)" sao a pe

const porNome = new Map();
for (const f of C.libraryForArmies([NACAO])) {
  let tree; try { tree = C.formationTree(f.file); } catch { continue; }
  const anda = (n) => {
    if (n.isFormation) { n.children.forEach(anda); return; }
    if (n.offMap) return;
    const papel = C.roleOf(n.name, n.offMap, R);
    if (FORA_PAPEL.has(papel)) return;
    if (NOME_DE_VEICULO.test(n.name) && !EXCECAO.test(n.name)) return;
    const preco = C.priceUnit(n, f.nation, R);
    const antes = porNome.get(n.name);
    if (!antes || antes.preco > preco) porNome.set(n.name, { preco, file: f.file, key: n.key, papel, tipo: n.type.join(',') });
  };
  tree.roots.forEach(anda);
}

// Mais baratas primeiro: assim o teto corta o que e caro e repetido de papel, nao a variedade.
const escolhidas = [];
let custo = 0;
for (const [nome, v] of [...porNome].sort((a, b) => a[1].preco - b[1].preco)) {
  if (custo + v.preco > TETO) continue;
  escolhidas.push({ nome, ...v });
  custo += v.preco;
}

const porFonte = new Map();
for (const u of escolhidas) {
  if (!porFonte.has(u.file)) porFonte.set(u.file, []);
  porFonte.get(u.file).push(u);
}
const picks = [...porFonte.entries()].map(([source, lista]) => ({ source, nation: NACAO, keep: lista.map((u) => u.key) }));

console.log(`${NACAO}: ${porNome.size} folhas a pe distintas na biblioteca`);
console.log(`escolhidas ${escolhidas.length} em ${picks.length} fontes, ${custo} cr de ${TETO}\n`);
for (const [file, lista] of porFonte) {
  console.log(`   ${file.replace(/\.btt$/, '')}`);
  for (const u of lista) console.log(`        ${String(u.preco).padStart(4)} cr  ${u.papel.padEnd(9)} ${u.nome.padEnd(44)} tipo ${u.tipo}`);
}
const deFora = [...porNome].filter(([n]) => !escolhidas.some((e) => e.nome === n));
if (deFora.length) console.log(`\nficaram de fora por preco: ${deFora.map(([n, v]) => `${n} (${v.preco})`).join(', ')}`);

if (process.argv.includes('--gravar')) {
  const saida = path.join(RAIZ, `research/forca_pe_${NACAO}.json`);
  fs.writeFileSync(saida, JSON.stringify({
    nota: `Uma copia de cada folha A PE da biblioteca ${NACAO}, para ler nome de arma no painel: o que falta nomear e arma de infantaria, e so se le no lado do JOGADOR. Pronta para POST /api/campaigns. Refazer com \`node tools/re/forca_pe.mjs ${NACAO} --gravar\`.`,
    nacao: NACAO, unidades: escolhidas.length, custo, teto: TETO,
    corpo: { name: `ZZ PE ${NACAO}`, armies: [NACAO], enemySide: NACAO === 'RU' ? 'US' : 'RU', enemyEffort: 0.5, rescueChance: 0, picks },
    detalhe: escolhidas.map((u) => ({ nome: u.nome, papel: u.papel, preco: u.preco, tipo: u.tipo, file: u.file, key: u.key })),
  }, null, 1) + '\n');
  console.log(`\n-> ${saida}`);
}
