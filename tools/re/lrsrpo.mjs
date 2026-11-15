// LRS platoon americana no lado azul, RPO platoon russa no lado vermelho.
//
// DUAS REGRAS QUE A SERIE DE TESTES ESTABELECEU:
//
// 1. A tabela 0x19 e COMPARTILHADA e indexada por exercito — 84 indices americanos, 59 russos,
//    zero em comum. Quem decide a leitura e o pai. Debaixo de um pai americano, o 0x19/0x3d da
//    RPO e um indice inexistente, e o jogo trava (foi o T9). A 0x0b e exclusivamente vermelha,
//    logo inequivoca em qualquer lugar (foi o T8). A solucao e respeitar a regra: cada formacao
//    vai sob um pai do proprio exercito.
//
// 2. A CATEGORIA vem do molde, nao do byte +18 que se escreve. Montando Section (LRS) (tabela
//    0x04) sobre molde de Team (Javelin) (tabela 0x0d), o jogo leu o indice na tabela do molde
//    e mostrou "Command Team". O molde tem de ser da MESMA TABELA do tipo-alvo.
//
// E o primeiro filho de cada formacao carrega o contador, o que exige o cabecalho da variante:
// tam = 0x04 com um u32 antes do id, contra tam = 0x0c do registro comum. Como nem toda tabela
// tem um molde dessa variante no cenario, o cabecalho e convertido na hora.
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const EXERCITO = { US: 1, RU: 2, UKR: 3 };

// molde por TABELA, escolhido entre os registros do proprio August Morning
const MOLDE_TAB = { 0x04: 206, 0x05: 191, 0x07: 184, 0x0d: 188, 0x0e: 368, 0x00: 214 };
const MOLDE_FORM = 238;

const LRS = { cab: [0x15, 0x19], army: 'US', maeId: 249, primFilhoDaMae: 250, ancoraId: 254,
  filhos: [[0x24, 0x04], [0x25, 0x04], [0x23, 0x04], [0x23, 0x04], [0x23, 0x04]] };
// A RPO entra como IRMA das duas formacoes vermelhas, nao como filha de uma delas. O contador
// da raiz vermelha esta no primeiro filho dela, que e o id 179 — vale 2, as duas formacoes que
// o cenario tem. A emenda vai ANTES do id 360, que e um ancoradouro bem definido; emendar no
// fim do bloco nao funcionou porque o fim do bloco nao e o fim da sub-arvore.
const RPO = { cab: [0x3d, 0x19], army: 'RU', maeId: null, primFilhoDaMae: 179, ancoraId: 360,
  filhos: [[0xb1, 0x07],
    [0x8d, 0x0e], [0x8d, 0x0e], [0x8d, 0x0e],
    [0xdf, 0x0d], [0xdf, 0x0d], [0xdf, 0x0d], [0xdf, 0x0d], [0xdf, 0x0d], [0xdf, 0x0d],
    [0x61, 0x05], [0x61, 0x05], [0x61, 0x05]] };

const bl = blocoUnidades(S + 'ZZ CONTA A.btt');
const r = analisar(S + 'ZZ CONTA A.btt');
const vis = new Set(); const L = [];
r.unidades.filter((x) => x.offset + 32 <= bl.length).sort((a, b) => a.offsetReg - b.offsetReg)
  .forEach((x) => { if (vis.has(x.offsetReg)) return; vis.add(x.offsetReg); L.push(x); });
const reg = (id) => L.find((x) => x.id === id);

function molde(id) {
  const i = L.findIndex((x) => x.id === id);
  const x = L[i];
  if (x.desloc !== 0) throw new Error(`molde ${id} nao e da forma comum`);
  return { buf: bl.subarray(x.offsetReg, L[i + 1].offsetReg), d: x.offset - x.offsetReg };
}
const M = {}; for (const [tab, id] of Object.entries(MOLDE_TAB)) M[tab] = molde(id);
const MF = molde(MOLDE_FORM);

function registro(m, id, val, tab, army) {
  const c = Buffer.from(m.buf);
  c.writeUInt32LE(id, m.d + 3);
  c[m.d + 7] &= ~0x80;
  c[m.d + 17] = val; c[m.d + 18] = tab;
  c[m.d + 14] = (EXERCITO[army] << 4) | (c[m.d + 14] & 0x0f);
  return c;
}
// converte o registro comum na variante que carrega o contador: tam 0x0c -> 0x04, com um u32
// inserido antes do id
function comContador(c, n) {
  const cont = Buffer.alloc(4); cont.writeUInt32LE(n, 0);
  return Buffer.concat([c.subarray(0, 1), Buffer.from([0x04, 0x00]), cont, c.subarray(3)]);
}

function montar(spec, idBase) {
  const p = [registro(MF, idBase, spec.cab[0], spec.cab[1], spec.army)];
  spec.filhos.forEach(([val, tab], k) => {
    const m = M[tab];
    if (!m) throw new Error(`sem molde para a tabela 0x${tab.toString(16)}`);
    const c = registro(m, idBase + 1 + k, val, tab, spec.army);
    p.push(k === 0 ? comContador(c, spec.filhos.length) : c);
  });
  return Buffer.concat(p);
}

const cat = JSON.parse(fs.readFileSync('../../research/tipos_confirmados.json', 'utf8'));
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const temTipo = (x) => !!cat.tabelas[hx(bl[x.offset + 18])]?.[hx(bl[x.offset + 17])];
const mascarar = L.filter((x) => (bl[x.offset + 14] >> 4) === EXERCITO.US && temTipo(x) && x.id !== LRS.maeId);

const trLRS = montar(LRS, 600), trRPO = montar(RPO, 620);
const ancLRS = reg(LRS.ancoraId).offsetReg;
const ancRPO = reg(RPO.ancoraId).offsetReg;
const contLRS = reg(LRS.primFilhoDaMae).offsetReg + 3;
const contRPO = reg(RPO.primFilhoDaMae).offsetReg + 3;

reconstruir(S + 'ZZ CONTA A.btt', S + 'ZZ LRS RPO 3.btt', (bloco, i) => {
  if (i !== 1) return bloco;
  const c0 = Buffer.from(bloco);
  mascarar.forEach((x) => { c0[x.offset + 7] |= 0x80; });
  c0[reg(LRS.maeId).offset + 7] &= ~0x80;
  c0.writeUInt32LE(c0.readUInt32LE(contLRS) + 1, contLRS);
  c0.writeUInt32LE(c0.readUInt32LE(contRPO) + 1, contRPO);
  // as duas emendas, da maior posicao para a menor, para os offsets nao se deslocarem
  return Buffer.concat([c0.subarray(0, ancLRS), trLRS, c0.subarray(ancLRS, ancRPO), trRPO, c0.subarray(ancRPO)]);
});

const novo = blocoUnidades(S + 'ZZ LRS RPO 3.btt');
if (novo.length !== bl.length + trLRS.length + trRPO.length) throw new Error('tamanho inesperado');
console.log('ZZ LRS RPO 3.btt gerado');
console.log(`   ${mascarar.length} registros do lado azul mascarados`);
console.log(`   LRS (US)  sob Company (Rifle) id ${LRS.maeId}   moldes: 0x04 -> id ${MOLDE_TAB[0x04]}`);
console.log(`   RPO (RU)  irma das formacoes vermelhas, emendada antes do id ${RPO.ancoraId}  moldes: 0x07 -> id ${MOLDE_TAB[0x07]}, 0x0e -> id ${MOLDE_TAB[0x0e]}, 0x0d -> id ${MOLDE_TAB[0x0d]}, 0x05 -> id ${MOLDE_TAB[0x05]}`);
