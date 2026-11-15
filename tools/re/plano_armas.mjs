// QUE FORCA COMPRAR PARA VER AS ARMAS QUE FALTAM.
//
// A amostra de armas veio da campanha que o autor jogou, e ela e enviesada: 63 unidades a pe
// distintas existem na biblioteca e os 115 saves tocaram um terco delas. Nenhum Stinger Team,
// nenhum HMG Team, nenhum Grenade Launcher Team — e e exatamente ali que moram os itens da classe 2
// que nunca apareceram.
//
// A correcao nao e esperar: e montar a forca DE PROPOSITO. Este script diz qual, e em que ordem.
//
// A conta so fica honesta com `tipos_ponte.json`, porque os dois lados falam catalogos diferentes:
// a colheita indexa pelo `u16 tipo` do roster, a biblioteca pelo par `[val, tab]`. Sem a ponte, o
// casamento tem de ser por nome — e ha 26 `Headquarters Team` distintos.
//
//   node tools/re/plano_armas.mjs                      mostra o plano
//   node tools/re/plano_armas.mjs --quentes            so os papeis que trazem arma nova (sem QG)
//   node tools/re/plano_armas.mjs --quentes --gravar   escreve research/plano_armas_quentes.json
import fs from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SAIDA = () => path.join(RAIZ, QUENTES ? 'research/plano_armas_quentes.json' : 'research/plano_armas.json');
const R = JSON.parse(fs.readFileSync(path.join(RAIZ, 'app/data/rules.json'), 'utf8'));
const C = await import(`file:///${RAIZ.replace(/\\/g, '/')}/app/src/catalog.mjs`);

const ponte = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/tipos_ponte.json'), 'utf8')).ponte;
const colheita = Object.keys(JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/toe_armas.json'), 'utf8')).tipos || {});
const amostrados = new Set(colheita.filter((t) => ponte[t]).map((t) => ponte[t].par));

// QUEM CARREGA ARMA DE INFANTARIA. O papel decide: tripulante de veiculo tambem e homem, mas a arma
// dele e pistola ou carabina e essas ja estao todas nomeadas. Fora do mapa nao entra — nao ha icone
// para passar o mouse.
const A_PE = new Set(['infantry', 'hq', 'recon', 'engineer', 'sniper', 'mg', 'atgm', 'at_inf', 'manpads', 'support']);

// `--quentes` tira os QG da conta. Sao 97 dos 216 tipos que faltam, e um QG carrega o mesmo M4 ou a
// mesma AK do resto do exercito — perseguir os 97 dobra o tamanho da forca para nao mostrar arma
// nenhuma. O que paga a batalha e metralhadora, antitanque, antiaereo, atirador e engenharia.
const QUENTES = process.argv.includes('--quentes');
const INTERESSA = QUENTES ? new Set([...A_PE].filter((p) => p !== 'hq')) : A_PE;

const fontes = new Map();
const tipos = new Map();
for (const f of C.libraryForArmies(['US', 'UKR', 'RU'])) {
  let tree; try { tree = C.formationTree(f.file); } catch { continue; }
  const meus = new Set();
  let unidades = 0, aPe = 0;
  const anda = (n) => {
    if (n.isFormation) { n.children.forEach(anda); return; }
    unidades++;
    const papel = C.roleOf(n.name, n.offMap, R);
    if (!INTERESSA.has(papel) || n.offMap) return;
    aPe++;
    const par = n.type.join(',');
    meus.add(par);
    if (!tipos.has(par)) tipos.set(par, { nome: n.name, papel, nacoes: new Set() });
    tipos.get(par).nacoes.add(f.nation);
  };
  tree.roots.forEach(anda);
  if (meus.size) fontes.set(f.file, { nacao: f.nation, nome: f.source.replace(/\.btt$/, ''), tipos: meus, unidades, aPe, file: f.file });
}

const falta = new Set([...tipos.keys()].filter((p) => !amostrados.has(p)));
console.log(`${tipos.size} tipos a pe distintos na biblioteca (pelo par [val, tab])`);
console.log(`   ${tipos.size - falta.size} ja amostrados, ${falta.size} nunca vistos`);
const porPapel = new Map();
for (const p of falta) { const x = tipos.get(p).papel; porPapel.set(x, (porPapel.get(x) || 0) + 1); }
console.log(`   o que falta, por papel: ${[...porPapel.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);

// COBERTURA GULOSA, mas o criterio de desempate importa: entre duas fontes que trazem o mesmo tanto
// de tipo novo, ganha a MENOR. Uma batalha com um batalhao de 190 unidades demora a jogar, e o que
// se quer aqui e ver arma, nao vencer.
const restante = new Set(falta);
const escolhidas = [];
const livres = new Map(fontes);
while (restante.size) {
  let melhor = null;
  for (const [file, f] of livres) {
    const ganho = [...f.tipos].filter((x) => restante.has(x)).length;
    if (!ganho) continue;
    const peso = ganho / f.unidades;                    // tipo novo por unidade que entra em campo
    if (!melhor || ganho > melhor.ganho || (ganho === melhor.ganho && peso > melhor.peso)) melhor = { file, f, ganho, peso };
  }
  if (!melhor) break;
  escolhidas.push(melhor);
  for (const x of melhor.f.tipos) restante.delete(x);
  livres.delete(melhor.file);
}

let acc = 0, unid = 0;
console.log(`\n${escolhidas.length} formacoes cobrem os ${falta.size - restante.size} tipos alcancaveis:`);
console.log('   novos | acumulado | unidades | formacao');
const plano = [];
for (const e of escolhidas) {
  acc += e.ganho; unid += e.f.unidades;
  plano.push({ file: e.f.file, nacao: e.f.nacao, nome: e.f.nome, tiposNovos: e.ganho, unidades: e.f.unidades, acumulado: acc });
  console.log(`   ${String(e.ganho).padStart(5)} | ${String(Math.round(100 * acc / falta.size)).padStart(8)}% | ${String(e.f.unidades).padStart(8)} | ${e.f.nacao} ${e.f.nome}`);
}
if (restante.size) console.log(`   ${restante.size} tipos sem nenhuma fonte a pe (provavelmente so aparecem fora do mapa)`);
console.log(`\ntotal se comprar tudo: ${unid} unidades em ${escolhidas.length} formacoes`);

// ONDE CORTAR. Comprar as 39 e uma batalha impossivel de jogar; as primeiras poucas ja pagam quase
// tudo. Estes sao os cortes uteis.
console.log('\nonde cortar:');
for (const marca of [50, 75, 90, 100]) {
  let n = 0, u = 0, c = 0;
  for (const e of escolhidas) { n++; u += e.f.unidades; c += e.ganho; if (100 * c / falta.size >= marca) break; }
  console.log(`   ${String(marca).padStart(3)}% dos tipos -> ${String(n).padStart(2)} formacoes, ${String(u).padStart(4)} unidades`);
}

if (process.argv.includes('--gravar')) {
  fs.writeFileSync(SAIDA(), JSON.stringify({
    nota: 'Que formacoes comprar para que uma unica campanha mostre as armas que nunca foram amostradas. Os tipos sao o par [val, tab] da biblioteca; o que ja foi visto sai da colheita (`toe_armas.json`) traduzida por `tipos_ponte.json`. Ordem gulosa: a cada passo entra a fonte que traz mais tipo novo, desempatando pela menor. Refazer com `node tools/re/plano_armas.mjs --gravar`.',
    aPeNaBiblioteca: tipos.size,
    jaAmostrados: tipos.size - falta.size,
    faltando: falta.size,
    semFonte: restante.size,
    plano,
    tiposQueFaltam: [...falta].map((p) => ({ par: p, nome: tipos.get(p).nome, papel: tipos.get(p).papel, nacoes: [...tipos.get(p).nacoes] })),
  }, null, 1) + '\n');
  console.log(`\n-> ${SAIDA()}`);
}
