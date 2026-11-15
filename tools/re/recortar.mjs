// Recorta uma forca a partir de um template que contem TUDO.
//
// Esta e a rota que funciona, e ela dispensa a sintese de registros. O ZZ QBSMALL ALL tem as
// 957 formacoes dos tres exercitos num mapa de Quick Battle jogavel, todas compradas — 6008
// registros, nenhum mascarado. Montar uma batalha e entao apagar o que nao entra, e nao criar
// o que falta: so o bit 0x80 do byte +7, que e a operacao mais segura que este projeto tem.
//
// Nenhum contador precisa ser mexido: o registro mascarado continua existindo, e as contagens
// declaradas pelas formacoes seguem valendo.
import fs from 'fs';
import { analisar, blocoUnidades, extrairUnidades } from './unidades.mjs';
import { prefixoPorCatalogo } from './prefixo.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const CABECA = new Set([0x19, 0x0b, 0x1a, 0x18]);
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const cat = JSON.parse(fs.readFileSync('../../research/tipos_confirmados.json', 'utf8'));

export function lerTemplate(arquivo) {
  const bl = blocoUnidades(S + arquivo);
  const prefixo = prefixoPorCatalogo(bl).prefixo;
  const vis = new Set(); const todos = [];
  extrairUnidades(bl, prefixo).filter((x) => x.offset + 19 <= bl.length)
    .sort((a, b) => a.offsetReg - b.offsetReg)
    .forEach((x) => {
      if (vis.has(x.offsetReg)) return; vis.add(x.offsetReg);
      const nm = cat.tabelas[hx(bl[x.offset + 18])]?.[hx(bl[x.offset + 17])];
      if (nm) todos.push({ ...x, nm, tab: bl[x.offset + 18], val: bl[x.offset + 17],
                           army: bl[x.offset + 14] >> 4, form: CABECA.has(bl[x.offset + 18]) });
    });
  // so as corridas de ids crescentes; o resto e falso positivo do extrator
  const L = []; let g = [];
  todos.forEach((x) => {
    if (g.length && (x.id <= g[g.length - 1].id || x.id - g[g.length - 1].id > 4)) {
      if (g.length >= 5) L.push(...g); g = [];
    }
    g.push(x);
  });
  if (g.length >= 5) L.push(...g);
  return { bl, prefixo, L };
}

// A sub-arvore de uma formacao: o contador esta no PRIMEIRO FILHO dela (secoes 17 e 20).
export function subArvore(bl, L, i) {
  const prim = L[i + 1];
  if (!prim || prim.desloc !== 4) return i + 1;          // formacao sem filhos legiveis
  const n = bl.readUInt32LE(prim.offsetReg + 3);
  if (!(n > 0 && n < 400)) return i + 1;
  let k = i + 1;
  for (let c = 0; c < n && k < L.length; c++) k = L[k].form ? subArvore(bl, L, k) : k + 1;
  return k;
}

// Liga cada registro ao pai, andando na pre-ordem com os contadores. Serve para saber onde
// declarar um filho a mais quando se duplica uma formacao: a contagem do pai fica no PRIMEIRO
// FILHO dele. As formacoes de topo ficam sem pai — a contagem da lista de topo nao esta no
// fluxo de registros (967 contadores para 957 formacoes, todos entre 1 e 19).
export function pais(bl, L) {
  const pai = new Array(L.length).fill(-1);
  const pilha = [];
  for (let i = 0; i < L.length; i++) {
    while (pilha.length && pilha[pilha.length - 1].resta === 0) pilha.pop();
    if (pilha.length) { pai[i] = pilha[pilha.length - 1].i; pilha[pilha.length - 1].resta--; }
    if (L[i].form) {
      const p = L[i + 1];
      const n = p && p.desloc === 4 ? bl.readUInt32LE(p.offsetReg + 3) : 0;
      if (n > 0 && n < 400) pilha.push({ i, resta: n });
    }
  }
  return pai;
}

export function recortar({ template, saida, querem }) {
  const { bl, L } = lerTemplate(template);
  const manter = new Set();
  const achados = [];
  // QUANTIDADE por SELECAO, nao por duplicacao. Se a batalha pede duas do mesmo tipo, pega-se
  // dois exemplares do template — cada um escrito pelo jogo, cada um com id proprio. Duplicar
  // sub-arvore aninhando a copia na original nao funciona (ZZ QB DUPLO travou), e declarar uma
  // formacao de topo a mais tambem nao: quando o editor acrescenta uma, NENHUM contador do
  // fluxo de registros muda, entao essa contagem mora fora dele.
  for (const q of querem) {
    const n = q.quantidade || 1;
    for (let c = 0; c < n; c++) {
      const i = L.findIndex((x, k) => x.form && x.val === q.val && x.tab === q.tab &&
                                      x.army === q.army && !manter.has(k));
      if (i < 0) throw new Error(`o template so tem ${c} exemplar(es) de ${hx(q.tab)}/${hx(q.val)} do exercito ${q.army}; foram pedidos ${n}. Compre mais no editor.`);
      const fim = subArvore(bl, L, i);
      for (let k = i; k < fim; k++) manter.add(k);
      achados.push({ i, fim, nm: L[i].nm, n: fim - i - 1 });
    }
  }
  const mascarar = L.filter((_, k) => !manter.has(k));

  const emendas = [];

  reconstruir(S + template, S + saida, (bloco, idx) => {
    if (idx !== 1) return bloco;
    const c = Buffer.from(bloco);
    mascarar.forEach((x) => { c[x.offset + 7] |= 0x80; });
    return c;
  });

  const novo = blocoUnidades(S + saida);
  const esperado = bl.length + emendas.reduce((t, e) => t + e.buf.length, 0);
  if (novo.length !== esperado) throw new Error(`tamanho: ${novo.length} vs ${esperado}`);
  // conferir SEMPRE no arquivo gerado, nunca no bloco de origem
  const dep = lerTemplate(saida);
  return { total: L.length, mascarados: mascarar.length, achados, L: dep.L, bl: dep.bl };
}

const EH_MAIN = process.argv[1] && /[\\/]recortar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const r = recortar({
    template: 'ZZ QBSMALL ALL.btt', saida: 'ZZ QB LRS RPO.btt',
    querem: [
      { tab: 0x19, val: 0x15, army: 1 },                    // Platoon (LRS), americana
      { tab: 0x19, val: 0x3d, army: 2, quantidade: 2 },      // Platoon (RPO), russa, DUAS
    ],
  });
  console.log(`ZZ QB LRS RPO.btt gerado — ${r.mascarados} de ${r.total} registros mascarados`);
  r.achados.forEach((a) => console.log(`   mantida: ${a.nm} com ${a.n} filhos`));
  console.log('\nforca resultante:');
  r.L.forEach((x, k) => {
    if (r.bl[x.offset + 7] & 0x80) return;
    console.log(`   ${x.form ? '[F]' : '   '} ${['?', 'US', 'RU', 'UKR'][x.army] || '?'}  ${x.nm}`);
  });
}
