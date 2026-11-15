// O PAIOL SO DE QUEM TEM PAIOL — e, desde a E40, lido pela GRAMATICA do rabo.
//
// A primeira versao achava os campos por diferenca entre saves (110.7) e depois cortava o que nao
// parecia municao. Funcionou ate o dia em que um id de item pequeno (24, o 125mm do T-64BV) casou
// com o campo que precede o contador da lista, e a escrita pos `10` no contador: o jogo leu dez
// pares onde havia cinco e o save deu "Out of memory" (E40). A diferenca entre saves tambem deixava
// artefatos na tabela: o "item 7 = 18" do BMP-2 era o `0007 0012` do cabecalho, e o 7,62 sumia por
// "aparecer em tres tipos" — como se fosse defeito uma metralhadora coaxial ser comum.
//
// Agora a lista e LIDA (FORMATO 110.8):
//
//   u16 n | n x (u16 item, u16 qtd) | u16 m | m x (u16 item, u16 qtd) | [u16 x] | ff ff
//
// e a tabela guarda o maior visto por (nome do veiculo, item), do paiol e da carga em separado. O
// que continua daqui e a LISTA BRANCA por nome, via ponte de tipos: tropa a pe tem a municao na
// cauda dos homens, e escrever no bloco dela e escrever no escuro.
//
//   tropa a pe   Squad / Team / Section / Platoon / Company / Battalion / Battery
//   maquina      Vehicle / Carrier / Tank / Howitzer / Gun / Mortar / Drone / Helicopter / Truck / System
//
// Quem tem os DOIS substantivos (`Medium Mortar Team`, `Team (Antitank Gun)`) fica de fora. Tipo que
// a ponte nao conhece tambem: a ponte vem dos rosters das campanhas do autor, entao o que ela ignora
// nunca esteve numa forca dele.
//
//   node tools/re/paiol_maquinas.mjs            mostra o que sairia
//   node tools/re/paiol_maquinas.mjs --gravar   escreve research/toe_veiculos.json
import fs from 'node:fs';
import path from 'node:path';
import { colherPelaGramatica, formaDoNome, TABELA } from './toe_veiculos.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const R = JSON.parse(fs.readFileSync(path.join(RAIZ, 'app/data/rules.json'), 'utf8'));
const ponte = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/tipos_ponte.json'), 'utf8')).ponte;
const C = await import(`file:///${RAIZ.replace(/\\/g, '/')}/app/src/catalog.mjs`);

const A_PE = /\b(Squad|Team|Section|Platoon|Company|Battalion|Battery)\b/;
const MAQUINA = /\b(Vehicle|Carrier|Tank|Howitzer|Gun|Mortar|Drone|Helicopter|Truck|System)\b/;

function classifica(tipo) {
  const v = ponte[tipo];
  if (!v) return { tag: 'desconhecido', nome: `tipo ${tipo}` };
  const pe = A_PE.test(v.nome), maq = MAQUINA.test(v.nome);
  if (pe && maq) return { tag: 'ambiguo', nome: v.nome };
  if (maq) return { tag: 'maquina', nome: v.nome, papel: C.roleOf(v.nome, false, R) };
  return { tag: 'a-pe', nome: v.nome };
}

// A forma do rabo (veiculo tem `x`, canhao nao) sai do nome do tipo: sem ela um veiculo com x = 0
// tambem le como canhao, deslocado, e a leitura deslocada passa por plausivel.
const c = colherPelaGramatica(undefined, (tipo) => formaDoNome((ponte[tipo] || {}).nome));
console.log(`${c.lidos} saves, ${c.unidades} blocos de unidade: ${c.comLista} com lista legivel, ${c.ambiguos} com mais de uma leitura (ignorados)`);
console.log(`   ${c.porTipo.size} tipos com lista`);

// A TABELA E POR NOME, nao por `tipo:tamanho` (E38): o tamanho do bloco anda com o numero de homens,
// e o mesmo obus M119A3 aparece com DOIS ids de tipo (1545 e 2057) conforme a vaga da TO&E de onde
// veio. Os campos de todos os tipos de um mesmo nome entram juntos, com o maior maximo visto.
// UM BLOCO SO NAO ENSINA. O contador `n` e um u16 pequeno, e um u16 pequeno antes da lista de
// verdade pode coincidir com uma leitura mais longa que passa por plausivel (um Stryker Mk19 ganhou
// "item 1 = 6, item 32 = 0" assim). Item que so apareceu num bloco fica de fora; com dois ja e
// dotacao, porque a coincidencia nao se repete no mesmo lugar em blocos diferentes.
const MINIMO = 2;
const itens = {}, carga = {}, sequencias = {}, descartados = {}, sozinhos = [];
const contagem = { maquina: 0, 'a-pe': 0, ambiguo: 0, desconhecido: 0 };
const nomes = { maquina: new Set(), 'a-pe': new Set(), ambiguo: new Set() };
const junta = (destino, nome, mapa, rotulo) => {
  destino[nome] = destino[nome] || {};
  for (const [item, v] of mapa) {
    if (v.vezes < MINIMO) { sozinhos.push(`${nome} ${rotulo} ${item}=${v.max}`); continue; }
    if (!(destino[nome][item] >= v.max)) destino[nome][item] = v.max;
  }
};
for (const [tipo, t] of c.porTipo) {
  const q = classifica(tipo);
  contagem[q.tag]++;
  if (nomes[q.tag]) nomes[q.tag].add(q.nome);
  if (q.tag !== 'maquina') { descartados[tipo] = { porque: q.tag, nome: q.nome, itens: Object.fromEntries([...t.itens].map(([i, v]) => [i, v.max])) }; continue; }
  const nome = String(q.nome).replace(/\s+#\d+$/, '');
  junta(itens, nome, t.itens, 'paiol');
  junta(carga, nome, t.carga, 'carga');
  // As sequencias vistas em 2+ blocos, da mais comum para a mais rara. Sequencia de um bloco so
  // fica de fora pela mesma razao dos itens: pode ser um `n` que coincidiu.
  sequencias[nome] = sequencias[nome] || {};
  for (const [seq, vezes] of t.sequencias) sequencias[nome][seq] = (sequencias[nome][seq] || 0) + vezes;
}
for (const n of Object.keys(sequencias)) {
  sequencias[n] = Object.entries(sequencias[n]).filter(([, v]) => v >= MINIMO).sort((a, b) => b[1] - a[1]).map(([seq]) => seq.split(',').map(Number));
  if (!sequencias[n].length) delete sequencias[n];
}
for (const n of Object.keys(itens)) if (!Object.keys(itens[n]).length && !Object.keys(carga[n] || {}).length) { delete itens[n]; delete carga[n]; }

// O KIT DE BLINDAGEM NAO MUDA O PAIOL (E77). `(APS)` e `(ERA)` sao o mesmo casco com outra protecao,
// e a colheita mostra isso onde ha dado dos dois lados: o M2A3 Bradley (APS) e o (ERA) saem
// identicos, item por item. Onde so ha dado de um lado a variante herda: o autor tem UM Abrams
// (APS) e ele so foi visto depois de uma batalha (`524=4`, quatro tiros de Multi), enquanto o Abrams
// sem kit ja foi visto cheio (`524=21`). Sem isto o refit "reabastecia" o APS para quatro tiros.
// Vale o maior por item dentro da familia, e as sequencias de todos.
const familia = (nome) => nome.replace(/ \((?:APS|ERA)\)(?=\))/, '');
const porFamilia = new Map();
for (const n of Object.keys(itens)) { const f = familia(n); if (!porFamilia.has(f)) porFamilia.set(f, []); porFamilia.get(f).push(n); }
for (const [, membros] of porFamilia) {
  if (membros.length < 2) continue;
  for (const destino of [itens, carga]) {
    const maior = {};
    for (const n of membros) for (const [item, q] of Object.entries(destino[n] || {})) if (!(maior[item] >= q)) maior[item] = q;
    for (const n of membros) destino[n] = { ...maior };
  }
  const seqs = new Map();
  for (const n of membros) for (const s of sequencias[n] || []) seqs.set(s.join(','), s);
  for (const n of membros) if (seqs.size) sequencias[n] = [...seqs.values()];
}

console.log(`   ficam ${contagem.maquina} tipos de maquina (${Object.keys(itens).length} nomes)`);
console.log(`   saem  ${contagem['a-pe']} de tropa a pe, ${contagem.ambiguo} ambiguos, ${contagem.desconhecido} de tipo que a ponte nao conhece`);
console.log(`\nas maquinas:`);
for (const n of Object.keys(itens).sort()) {
  const p = Object.entries(itens[n]).map(([i, m]) => `${i}:${m}`).join(' ');
  const g = Object.entries(carga[n]).map(([i, m]) => `${i}:${m}`).join(' ');
  const s = (sequencias[n] || []).map((q) => q.join(',')).join(' | ');
  console.log(`   ${n.padEnd(50)} paiol ${p}${g ? `   carga ${g}` : ''}${s ? `   ordem ${s}` : ''}`);
}
if (sozinhos.length) console.log(`\nvistos num bloco so, fora: ${sozinhos.join('; ')}`);
if (nomes.ambiguo.size) console.log(`\nambiguas, fora por conservadorismo: ${[...nomes.ambiguo].sort().join('; ')}`);
console.log(`\na pe, fora: ${[...nomes['a-pe']].sort().slice(0, 10).join('; ')}${nomes['a-pe'].size > 10 ? ` e mais ${nomes['a-pe'].size - 10}` : ''}`);

if (process.argv.includes('--gravar')) {
  fs.writeFileSync(TABELA, JSON.stringify({
    nota: 'O paiol de cada unidade que TEM paiol: veiculo, canhao e tubo. Lido pela gramatica do rabo do bloco (FORMATO 110.8, `toe_veiculos.lerRabo`): maior visto por (nome, item), paiol e carga em separado. A lista branca sai daqui, pelo NOME do tipo na ponte (`tipos_ponte.json`). Refazer com `node tools/re/paiol_maquinas.mjs --gravar`.',
    saves: c.lidos, unidades: c.unidades, comLista: c.comLista, ambiguos: c.ambiguos,
    itens, carga, sequencias, descartados,
  }, null, 1) + '\n');
  console.log(`\n-> ${TABELA}`);
}
