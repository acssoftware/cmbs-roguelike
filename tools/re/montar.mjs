// MONTA uma formacao que nao existe no cenario, a partir de moldes do proprio arquivo.
//
// Uma formacao compravel que ninguem comprou nao esta no arquivo — nao ha o que desmascarar.
// E copiar de outro cenario trava o jogo, porque metade do registro e estado do cenario de
// origem (secao 15). A saida e montar: duplicar registros do PROPRIO arquivo como moldes e
// reescrever neles tipo (+17,+18) e exercito (+14). O registro e um recipiente generico; o
// conteudo vem do tipo.
//
// Molde por CATEGORIA. Converter registro de infantaria em infantaria esta provado
// (ZZ RU PLT FULL); infantaria em veiculo nao. Entao veiculo usa molde de veiculo.
import fs from 'fs';
import { analisar, blocoUnidades } from './unidades.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const EXERCITO = { US: 1, RU: 2, UKR: 3 };

// Platoon (LRS) americana e Platoon (RPO) russa, lidas do ZZ US ALL e do ZZ RU ALL
const LRS = {
  nome: 'Platoon (LRS)', cab: [0x15, 0x19], army: 'US',
  filhos: [[0x24, 0x04, 'inf'], [0x25, 0x04, 'inf'], [0x23, 0x04, 'inf'], [0x23, 0x04, 'inf'], [0x23, 0x04, 'inf']],
};
const RPO = {
  nome: 'Platoon (RPO)', cab: [0x3d, 0x19], army: 'RU',
  filhos: [[0xb1, 0x07, 'inf'],
    [0x8d, 0x0e, 'inf'], [0x8d, 0x0e, 'inf'], [0x8d, 0x0e, 'inf'],
    [0xdf, 0x0d, 'inf'], [0xdf, 0x0d, 'inf'], [0xdf, 0x0d, 'inf'],
    [0xdf, 0x0d, 'inf'], [0xdf, 0x0d, 'inf'], [0xdf, 0x0d, 'inf'],
    [0x61, 0x05, 'vei'], [0x61, 0x05, 'vei'], [0x61, 0x05, 'vei']],
};

// O contador de filhos NAO esta no registro da formacao (24 bytes fixos): esta no cabecalho
// do PRIMEIRO FILHO, que usa a variante com u32 intercalado antes do id. Ler "+27 da
// formacao" funcionava por coincidencia — 24 + 3 cai exatamente nesse contador — e por isso
// dava lixo quando a formacao tinha nome customizado, que estica o registro alem de 24 bytes.
// Montar uma formacao exige, entao, que o primeiro filho seja um registro dessa variante.
// Variantes de isolamento: T4 e a RPO SO com a infantaria (sem veiculo), T5 e a LRS com um
// unico veiculo acrescentado. A diferenca entre elas responde se o que quebra e o molde de
// veiculo ou os tipos/tamanho da RPO.
const RPO_INF = { nome: 'Platoon (RPO) so infantaria', cab: [0x3d, 0x19], army: 'RU',
  filhos: RPO.filhos.filter((f) => f[2] === 'inf') };
const LRS_VEI = { nome: 'Platoon (LRS) + 1 veiculo', cab: [0x15, 0x19], army: 'US',
  filhos: [...LRS.filhos, [0x61, 0x05, 'vei']] };

// T6: a MESMA LRS que funcionou, so que com 10 filhos em vez de 5 — isola contagem e
// repeticao de molde, sem nada de russo. T7: a RPO reduzida a 5 filhos — isola o "ser russo"
// com a contagem que ja se sabe que passa.
const LRS10 = { nome: 'Platoon (LRS) com 10 filhos', cab: [0x15, 0x19], army: 'US',
  filhos: Array.from({ length: 10 }, (_, k) => [k === 0 ? 0x24 : 0x23, 0x04, 'inf']) };
const RPO5 = { nome: 'Platoon (RPO) com 5 filhos', cab: [0x3d, 0x19], army: 'RU',
  filhos: RPO.filhos.slice(0, 5) };

// 2x2 para separar tipo de FORMACAO de tipos de FILHO. O que ja se sabe:
//   formacao 0x0b/0x54 + filhos do LADO A LADO  -> passou
//   formacao 0x19/0x3d + filhos da RPO          -> travou
// Falta cruzar. T8 poe os filhos da RPO sob a formacao que passa; T9 poe os filhos que
// passam sob a formacao da RPO.
const FILHOS_OK = [[0xa9, 0x07, 'inf'], [0xbc, 0x07, 'inf'], [0xdd, 0x00, 'inf'], [0xdd, 0x00, 'inf'], [0xdd, 0x00, 'inf']];
const T8 = { nome: 'filhos da RPO sob formacao 0x0b/0x54', cab: [0x54, 0x0b], army: 'RU', filhos: RPO.filhos.slice(0, 5) };
const T9 = { nome: 'filhos conhecidos sob formacao 0x19/0x3d', cab: [0x3d, 0x19], army: 'RU', filhos: FILHOS_OK };

const MOLDE = { form: 238, prim: 239, inf: 245, vei: 253 };
// O batalhao (id 186) e o registro-raiz que o extrator nao lista: nao entra na mascara nem
// precisa ser religado. Basta manter a companhia de pe para pendurar as duas formacoes.
const MAE = 249, ANCORA = 254, MANTER = [249];

const MODO = process.argv[2] || 'tudo';
const FAZ_MASK = MODO === 'mask' || MODO === 'tudo';
const FAZ_BUILD = MODO !== 'mask';
const SAIDA = { mask: 'ZZ T1 MASK.btt', build: 'ZZ T2 MONTA.btt', lrs: 'ZZ T3 LRS.btt',
                rpoinf: 'ZZ T4 RPO INF.btt', vei: 'ZZ T5 VEI.btt',
                lrs10: 'ZZ T6 LRS10.btt', rpo5: 'ZZ T7 RPO5.btt',
                t8: 'ZZ T8 FORM OK.btt', t9: 'ZZ T9 FILHOS OK.btt', tudo: 'ZZ LRS RPO.btt' }[MODO];

const bl = blocoUnidades(S + 'ZZ CONTA A.btt');
const r = analisar(S + 'ZZ CONTA A.btt');
const vis = new Set(); const L = [];
r.unidades.filter((x) => x.offset + 32 <= bl.length).sort((a, b) => a.offsetReg - b.offsetReg)
  .forEach((x) => { if (vis.has(x.offsetReg)) return; vis.add(x.offsetReg); L.push(x); });
const idx = (id) => L.findIndex((x) => x.id === id);

// bytes de um registro, do inicio dele ate o inicio do proximo
function molde(id) {
  const i = idx(id);
  if (i < 0) throw new Error(`molde ${id} nao achado`);
  const x = L[i], fim = L[i + 1].offsetReg;
  return { buf: bl.subarray(x.offsetReg, fim), dId: x.offset + 3 - x.offsetReg,
           d7: x.offset + 7 - x.offsetReg, d14: x.offset + 14 - x.offsetReg,
           d17: x.offset + 17 - x.offsetReg, d18: x.offset + 18 - x.offsetReg,
           d27: x.offset + 27 - x.offsetReg };
}
const M = { form: molde(MOLDE.form), prim: molde(MOLDE.prim), inf: molde(MOLDE.inf), vei: molde(MOLDE.vei) };

function registro(m, id, val, tab, army, filhos) {
  const c = Buffer.from(m.buf);
  c.writeUInt32LE(id, m.dId);
  c[m.d7] &= ~0x80;                                        // presente
  c[m.d17] = val; c[m.d18] = tab;
  c[m.d14] = (EXERCITO[army] << 4) | (c[m.d14] & 0x0f);    // exercito, raridade preservada
  if (filhos !== undefined) c.writeUInt32LE(filhos, 3);    // contador, no cabecalho da variante
  return c;
}

function montar(spec, idBase) {
  const partes = [registro(M.form, idBase, spec.cab[0], spec.cab[1], spec.army)];
  spec.filhos.forEach(([val, tab, cat], k) => {
    const m = k === 0 ? M.prim : M[cat];                   // o primeiro filho carrega a contagem
    partes.push(registro(m, idBase + 1 + k, val, tab, spec.army, k === 0 ? spec.filhos.length : undefined));
  });
  return Buffer.concat(partes);
}

const UMA = { lrs: LRS, rpoinf: RPO_INF, vei: LRS_VEI, lrs10: LRS10, rpo5: RPO5, t8: T8, t9: T9 }[MODO];
const trecho = !FAZ_BUILD ? Buffer.alloc(0)
  : UMA ? montar(UMA, 600)
  : Buffer.concat([montar(LRS, 600), montar(RPO, 620)]);
const nNovas = !FAZ_BUILD ? 0 : (UMA ? 1 : 2);
const mae = L[idx(MAE)], anc = L[idx(ANCORA)];
const filhosMae = bl.readUInt32LE(L[idx(250)].offsetReg + 3);

// Mascara o lado azul, menos a cadeia de pais. Filtrar so pelo nibble de exercito nao basta:
// o extrator devolve falsos positivos, e escrever no "+7" de um registro fantasma acerta
// dentro de um registro real. So entra quem tem tipo reconhecido no catalogo.
const cat = JSON.parse(fs.readFileSync('../../research/tipos_confirmados.json', 'utf8'));
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const temTipo = (x) => !!cat.tabelas[hx(bl[x.offset + 18])]?.[hx(bl[x.offset + 17])];
const mascarar = L.filter((x) => (bl[x.offset + 14] >> 4) === EXERCITO.US && temTipo(x) && !MANTER.includes(x.id));

reconstruir(S + 'ZZ CONTA A.btt', S + SAIDA, (bloco, i) => {
  if (i !== 1) return bloco;
  const c0 = Buffer.from(bloco);
  if (FAZ_MASK) mascarar.forEach((x) => { c0[x.offset + 7] |= 0x80; });
  // a mae precisa estar presente sempre: uma formacao pendurada em mae ausente nao aparece
  MANTER.forEach((id) => { c0[L[idx(id)].offset + 7] &= ~0x80; });
  if (nNovas) c0.writeUInt32LE(filhosMae + nNovas, L[idx(250)].offsetReg + 3);
  return Buffer.concat([c0.subarray(0, anc.offsetReg), trecho, c0.subarray(anc.offsetReg)]);
});

const novo = blocoUnidades(S + SAIDA);
if (novo.length !== bl.length + trecho.length) throw new Error(`tamanho: ${novo.length} vs ${bl.length + trecho.length}`);
// nenhum byte alterado fora do plano, na parte anterior a emenda
const planejado = new Set(FAZ_MASK ? mascarar.map((x) => x.offset + 7) : []);
planejado.add(L[idx(MAE)].offset + 7);
for (let k = 0; k < 4; k++) planejado.add(L[idx(250)].offsetReg + 3 + k);
let fora = 0;
for (let k = 0; k < anc.offsetReg; k++) if (bl[k] !== novo[k] && !planejado.has(k)) fora++;
if (fora) throw new Error(`${fora} bytes alterados FORA do plano`);
console.log(`${SAIDA} gerado — ${trecho.length} bytes inseridos`);
console.log(`   mascara: ${FAZ_MASK ? mascarar.length + ' registros do lado azul' : 'NAO'}`);
if (nNovas) console.log(`   Company (Rifle) id ${MAE}: ${filhosMae} -> ${filhosMae + nNovas} filhos`);
if (FAZ_BUILD) { const e = UMA || LRS; console.log(`   ids 600..${600 + e.filhos.length}: ${e.nome} (${e.army}), ${e.filhos.length} filhos` + (UMA ? '' : '')); }
if (nNovas === 2) console.log(`   ids 620..${620 + RPO.filhos.length}: ${RPO.nome} (${RPO.army}), ${RPO.filhos.length} filhos`);
