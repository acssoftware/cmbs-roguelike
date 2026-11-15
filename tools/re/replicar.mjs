// REPLICA batalhoes de topo do mesmo tipo — a operacao que faltava.
//
// A chave descoberta: cada LADO declara sua contagem de formacoes de topo num u32 colado
// antes do id da PRIMEIRA formacao de topo do lado. Validado contra as edicoes reais do
// editor: azul 117 -> 118 -> 122 e vermelho 78 -> 79 -> 85, batendo adicao por adicao com o
// que foi comprado no ZZ QBSMALL ALL / add manual / add manual 2. E quando o editor insere,
// NENHUM outro contador muda — so o trecho novo e esse u32.
//
// A receita, entao, espelha o editor:
//   1. copiar a sub-arvore do doador (span de bytes delimitado por FAIXA DE ID, nao pelo
//      passeio de contadores, que engole vizinhos quando o extrator perde registros);
//   2. ids novos e sequenciais no fim do espaco (como o editor faz: 6379, 6385...);
//   3. emendar a copia logo apos o span do doador — irma de topo, nunca aninhada;
//   4. incrementar a contagem do lado. Nada mais.
import fs from 'fs';
import { blocoUnidades } from './unidades.mjs';
import { lerTemplate } from './recortar.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const TEMPLATE = 'ZZ QBSMALL ALL add manual 2.btt';
const SAIDA = 'ZZ QB 4CA 6T31.btt';

const { bl, L } = lerTemplate(TEMPLATE);
const porOffset = [...L].sort((a, b) => a.offsetReg - b.offsetReg);

// ---- faixas de id, com fronteiras conhecidas --------------------------------------------
// Os dois Combined Arms azuis entram por SELECAO: todo CA carrega ~2 registros de cabecalho
// anomalo que o extrator nao decodifica, e copiar sem reescrever o id deles duplicaria ids
// ativos. Numa faixa MANTIDA eles nao incomodam — ficam presentes como parte do batalhao.
// O Tank 31 vermelho e o doador de insercao: 44 de 44 registros visiveis, reescrita completa.
const FAIXAS = {
  CA1: { ini: 609,  fim: 771,  copias: 0 },
  CA2: { ini: 6399, fim: 6561, copias: 2 },
  T31: { ini: 5325, fim: 5369, copias: 5 },
};

function span(faixa) {
  const dentro = porOffset.filter((x) => x.id >= faixa.ini && x.id < faixa.fim);
  const primeiro = dentro[0];
  const iFim = porOffset.indexOf(dentro[dentro.length - 1]) + 1;
  const fimBytes = iFim < porOffset.length ? porOffset[iFim].offsetReg : bl.length;
  return { dentro, ini: primeiro.offsetReg, fim: fimBytes };
}

// Uma copia do span com todos os ids reescritos. Os registros que o extrator NAO enxerga
// (no CA azul, os ids 6400 e 6506) tem o id reescrito por varredura do intervalo de bytes
// entre os vizinhos visiveis — escopo apertado para nao tocar em dado que coincida.
function copiar(sp, idBase) {
  const c = Buffer.from(bl.subarray(sp.ini, sp.fim));
  let prox = idBase;
  const usados = new Set();
  // 1) registros visiveis: id na posicao conhecida
  sp.dentro.forEach((x) => { const p = x.offset + 3 - sp.ini; c.writeUInt32LE(prox, p); usados.add(p); prox++; });
  // 2) registros que o extrator nao enxerga. A regra universal, conferida no ZZ QB 4CA 6T
  //    add manual contra o registro invisivel id 7168: o id fica SEMPRE 11 bytes antes do
  //    padrao [exercito] 60 00, e o byte de presenca 7 antes. O erro da versao anterior foi
  //    pegar o primeiro padrao do vao — que pertence ao registro visivel anterior — e
  //    reescrever o id dele pela segunda vez.
  const EXS = new Set([0x14,0x15,0x16,0x17,0x24,0x25,0x26,0x27,0x34,0x35,0x36,0x37]);
  const ids = sp.dentro.map((x) => x.id);
  for (let k = 1; k < ids.length; k++) {
    const faltam = ids[k] - ids[k - 1] - 1;
    if (faltam <= 0) continue;
    const a = sp.dentro[k - 1].offsetReg - sp.ini, b = sp.dentro[k].offsetReg - sp.ini;
    const alvos = [];
    for (let p = a; p + 3 <= b; p++) {
      if (!EXS.has(c[p]) || c[p + 1] !== 0x60 || c[p + 2] !== 0x00) continue;
      const idPos = p - 11;
      if (idPos < a || usados.has(idPos)) continue;
      alvos.push(idPos);
    }
    if (alvos.length !== faltam)
      throw new Error(`vao [${a}..${b}): ${faltam} id(s) faltando mas ${alvos.length} ancora(s) — nao vou chutar`);
    for (const idPos of alvos) { c.writeUInt32LE(prox, idPos); usados.add(idPos); prox++; }
  }
  return { c, usados: prox - idBase };
}

// ---- contagens de topo dos dois lados ---------------------------------------------------
function contagemDoLado(army) {
  for (let p = 0; p + 6 <= bl.length; p++) {
    if (bl[p] !== army || bl[p + 1] !== 0x60 || bl[p + 2] !== 0x00) continue;
    if (![0x19, 0x0b, 0x1a, 0x18].includes(bl[p + 4])) continue;
    const o = p - 14, id = bl.readUInt32LE(o + 3), n = bl.readUInt32LE(o - 1);
    if (id < 1 || id > 20000 || n < 1 || n > 1500) continue;
    return { pos: o - 1, n, id };
  }
  throw new Error(`raiz do exercito 0x${army.toString(16)} nao achada`);
}
const azul = contagemDoLado(0x17);
const verm = contagemDoLado(0x27);

// ---- montagem ---------------------------------------------------------------------------
const spCA1 = span(FAIXAS.CA1), spCA2 = span(FAIXAS.CA2), spT31 = span(FAIXAS.T31);
// O maior id NAO pode vir so dos registros visiveis: as formacoes de fortificacao compradas
// por ultimo (Trench, exercito com raridade 5) sao invisiveis ao extrator e ocupam ids acima
// do maximo visivel — colidir com elas foi a causa da segunda leva de duplicatas. O padrao
// [exercito] 60 00 enxerga todo mundo; o id fica 11 bytes antes dele.
const EXS_ID = new Set([0x14,0x15,0x16,0x17,0x24,0x25,0x26,0x27,0x34,0x35,0x36,0x37]);
let maxId = Math.max(...L.map((x) => x.id));
for (let p = 11; p + 3 <= bl.length; p++) {
  if (!EXS_ID.has(bl[p]) || bl[p + 1] !== 0x60 || bl[p + 2] !== 0x00) continue;
  const id = bl.readUInt32LE(p - 11);
  if (id > maxId && id < 20000) maxId = id;
}
let idLivre = maxId + 100;
console.log(`maior id no arquivo (incluindo invisiveis): ${maxId}; ids novos a partir de ${idLivre}`);

const copiasT31 = [], copiasCA = [];
for (let k = 0; k < FAIXAS.T31.copias; k++) {
  const cp = copiar(spT31, idLivre); idLivre += 100;
  if (cp.usados !== 44) throw new Error('copia T31 nao reescreveu 44 ids');
  copiasT31.push(cp.c);
}
for (let k = 0; k < FAIXAS.CA2.copias; k++) {
  const cp = copiar(spCA2, idLivre); idLivre += 250;
  if (cp.usados !== FAIXAS.CA2.fim - FAIXAS.CA2.ini)
    throw new Error(`copia CA reescreveu ${cp.usados} ids, esperava ${FAIXAS.CA2.fim - FAIXAS.CA2.ini}`);
  copiasCA.push(cp.c);
}

const manter = new Set([...spCA1.dentro, ...spCA2.dentro, ...spT31.dentro].map((x) => x.offsetReg));
const mascarar = L.filter((x) => !manter.has(x.offsetReg));

const emendas = [
  { pos: spT31.fim, buf: Buffer.concat(copiasT31) },
  { pos: spCA2.fim, buf: Buffer.concat(copiasCA) },
].sort((a, b) => b.pos - a.pos);

reconstruir(S + TEMPLATE, S + SAIDA, (bloco, idx) => {
  if (idx !== 1) return bloco;
  let c = Buffer.from(bloco);
  mascarar.forEach((x) => { c[x.offset + 7] |= 0x80; });
  c.writeUInt32LE(azul.n + FAIXAS.CA2.copias, azul.pos);
  c.writeUInt32LE(verm.n + FAIXAS.T31.copias, verm.pos);
  for (const e of emendas) c = Buffer.concat([c.subarray(0, e.pos), e.buf, c.subarray(e.pos)]);
  return c;
});

// ---- verificacao ------------------------------------------------------------------------
const novo = blocoUnidades(S + SAIDA);
const esperado = bl.length + copiasT31.reduce((t, c) => t + c.length, 0) + copiasCA.reduce((t, c) => t + c.length, 0);
if (novo.length !== esperado) throw new Error(`tamanho: ${novo.length} vs ${esperado}`);
console.log(`${SAIDA} gerado`);
console.log(`   ${mascarar.length} de ${L.length} registros mascarados`);
console.log(`   azul: 2x Combined Arms por selecao + ${FAIXAS.CA2.copias} copias inseridas`);
console.log(`   vermelho: 1x Tank 31 por selecao + ${FAIXAS.T31.copias} copias inseridas`);
console.log(`   contagem de topo: azul ${azul.n} -> ${azul.n + FAIXAS.CA2.copias} | vermelha ${verm.n} -> ${verm.n + FAIXAS.T31.copias}`);
