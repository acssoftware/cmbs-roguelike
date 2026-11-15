// O ESTADO DE CADA VEICULO NO FIM DA BATALHA (FORMATO 110.11, E90).
//
// O save da TRANSICAO guarda, no bloco de cada maquina que ja pisou no mapa, o mesmo "Vehicle Status"
// que o editor mostra na ficha da unidade — 1 Destroyed, 2 Immobilized, 3 OK. Fica logo depois das
// vagas da tripulacao (`A k` + 13 zeros cada; num bloco com homens, os registros deles):
//
//     a | S | c | f32 | u32 n
//
//   S     o estado, na escala do editor. Vistos: 1, 2 e 3. (0 Burning e 4 Dismounted nunca apareceram
//         num roster; o 0 fica de fora de proposito, porque `00 00 00` + zeros + um contador e o que o
//         enchimento do bloco mais faz, e era o unico falso positivo da varredura.)
//   a, c  bandeiras de 0/1. Na EASY2, EBD e ONT `a` = 1 so com S = 1 e `c` = 1 sempre; na MVSC (a
//         campanha mais antiga) `a` = 1 em tudo e `c` virou 0 na segunda virada. Nao separam nada
//         que S ja nao separe.
//   f32   um float em [0, 1] que anda entre batalhas (1,0 no imobilizado, 0 em sobreviventes
//         tambem): nao e integridade nem mobilidade. O E63 leu nele a "maquina avariada que o jogo
//         recusa" — as duas recusadas eram S = 1, destruidas.
//   n     constante por tipo (BMP-2 10, T-64BV 11, Stryker 12, BTR-4E e Abrams 14, Bradley 15, MT-LBM
//         4, Ural 2, HMMWV 3/6): o tamanho da lista que vem depois.
//
// A PROVA E O AAR. O bloco do roster traz o AAR ACUMULADO da campanha (111.13), por categoria. A conta
// "maquinas que viraram S = 1 nesta batalha" bate com o que o AAR somou em 13 viradas de 4 campanhas
// (EASY2 1-7, EBD 1-3, MVSC 1-2, ONT 1): blindados, outros veiculos e tanques, virada por virada. A
// unica diferenca e o T-64BV #1 da EASY2 na batalha 3: lutou (o paiol dele caiu de 9 para 6), acabou
// S = 1 com a tripulacao inteira viva e o AAR nao o contou — a leitura provavel e o veiculo abandonado
// que o jogo da como perdido no fim sem contar como baixa de combate. Para o app da no mesmo: a
// maquina nao volta.
//
// O IMOBILIZADO NAO E PERDA. S = 2 nunca entra no AAR (Bradley 563 na batalha 7 da EASY2, BTR 52 na 2
// da EBD, Stryker 55 na 1 da MVSC) e o JOGO o conserta: o BTR 52 da EBD saiu S = 2 da batalha 2 e
// voltou S = 3 da 3, com o float mexido — lutou de novo.
//
// SO MAQUINA QUE JA LUTOU TEM O CAMPO. O bloco dormente (103/118 B, nunca instanciado) nao tem trio
// nenhum. E nenhum bloco de infantaria acendeu em 8 saves e 3.800 blocos.
import fs from 'node:fs';
import path from 'node:path';
import { blocosDoSave } from './toe_veiculos.mjs';
import { lerSave, soldados, veiculos } from './saves.mjs';
import { lerRoster } from './roster.mjs';

export const ESTADOS = { 1: 'destruido', 2: 'imobilizado', 3: 'ok', 4: 'desmontado' };

// O primeiro achado vale: nas varreduras, quando havia dois, o segundo era sempre o `00 00 00` do
// enchimento — que o S >= 1 ja tira.
export function estadoDoBloco(b) {
  for (let o = 5; o + 11 <= b.length; o++) {
    if (b[o] > 1 || b[o + 1] < 1 || b[o + 1] > 4 || b[o + 2] > 1) continue;
    // o fim da ultima vaga: 5 zeros no minimo (13 numa vaga vazia; o registro compacto de um homem
    // da MVSC termina com 5)
    let z = 0; while (z < 5 && b[o - 1 - z] === 0) z++;
    if (z < 5) continue;
    const v = b.readFloatLE(o + 3);
    if (!(v >= 0 && v <= 1.0001)) continue;
    if (v !== 0 && (b[o + 6] < 0x3a || b[o + 6] > 0x3f)) continue;   // float de verdade, nao inteiro
    const n = b[o + 7];
    if (n < 2 || n > 0x30 || b[o + 8] || b[o + 9] || b[o + 10]) continue;
    // os n floats que vem depois sao o dano de cada subsistema (110.11-13), o mesmo que o registro do
    // veiculo traz no save de batalha — e por isso servem de impressao digital entre os dois arquivos
    const danos = [];
    for (let k = 0; k < n && o + 11 + 4 * k + 4 <= b.length; k++) danos.push(b.readFloatLE(o + 11 + 4 * k));
    return { off: o, codigo: b[o + 1], estado: ESTADOS[b[o + 1]], a: b[o], c: b[o + 2], f: v, n, danos };
  }
  return null;
}

// Toda unidade do save que tem o campo: [{ coreId, tipo, homens, codigo, estado, ... }].
export function estadosDoSave(caminho) {
  const out = [];
  for (const u of blocosDoSave(caminho).unidades) {
    const e = estadoDoBloco(u.bytes);
    if (e) out.push({ coreId: u.coreId, tipo: u.tipo, homens: u.homens, ...e });
  }
  return out;
}

// O IMOBILIZADO QUE O JOGO DA COMO PERDIDO NO FIM (30/09). Na batalha 4 da RUS1 o T-90AM do Lapin
// terminou imobilizado, com dois tripulantes vivos a bordo (save do turno 28), e o jogo gravou
// Vehicle Status 1 (destruido) na transicao — o mesmo do T-64BV #1 da EASY2. O autor: imobilizado nao
// e destruido. A transicao sozinha nao separa os dois (S = 1, f = 0 nos dois), entao a prova vem do
// ULTIMO SAVE DE TURNO da mesma batalha: o veiculo de la que tem o MESMO perfil de dano por subsistema
// (os floats depois do S) e quem e — o do Lapin tem cinco subsistemas em 1,00 e 0,40/0,35, igual nos
// dois arquivos. Casamento so com perfil unico e com pelo menos um dano entre 0 e 1 (perfil vazio ou so
// de zeros e uns nao identifica ninguem); sem save de turno, nada muda.
const perfil = (ds) => (ds || []).filter((d) => d > 0.004).map((d) => Math.round(d * 100) / 100).sort((a, b) => a - b);
const chave = (p) => (p.some((d) => d > 0 && d < 1) ? p.join(',') : null);
// O ULTIMO SAVE DE TURNO da mesma batalha: "RUS1 BTT4 Transition.bts" (ou a entrega do app, "... Transition [B05]
// (rebuilt 1).bts") -> na mesma pasta, "RUS1 BTT4 final turn.bts" se existir (18/10: e o nome que o autor usa na RUS3),
// senao o de maior numero entre "RUS1 BTT4 TURN 028.bts" e "RUS1 BTT4 002.bts".
export function ultimoTurno(transicao) {
  const dir = path.dirname(transicao);
  const base = path.basename(transicao, '.bts').replace(/\s*\[B\d+[^\]]*\].*$/i, '').replace(/\s+transition$/i, '').toLowerCase();
  let melhor = null;
  for (const f of fs.readdirSync(dir)) {
    if (/\[B\d+/i.test(f) || /transition/i.test(f)) continue;
    const fim = /^(.*)\s+final\s+turn\.bts$/i.exec(f);
    if (fim && fim[1].toLowerCase() === base) return { n: Infinity, arquivo: path.join(dir, f) };
    const m = /^(.*?)\s+(?:turn\s+)?(\d+)\.bts$/i.exec(f);
    if (!m || m[1].toLowerCase() !== base) continue;
    if (!melhor || Number(m[2]) > melhor.n) melhor = { n: Number(m[2]), arquivo: path.join(dir, f) };
  }
  return melhor;
}

// A TRIPULACAO NO FIM (18/10): cada maquina da campanha pelo NOME dos homens dela — o roster da transicao diz quem e de
// qual core, e o save de turno diz em que veiculo cada tripulacao esta e se ele foi destruido. O perfil de dano casa mal
// quando a lista de subsistemas do save de turno sai incompleta (RUS3 b2); os nomes nao dependem dela.
// Map coreId -> { time, destruido, imobilizado, mobilidade, aBordo, vivos, homens }.
export function tripulacaoNoFim(transicao, coreIds, turno = ultimoTurno(transicao)) {
  const out = new Map();
  if (!turno || !coreIds?.length) return { turno: turno?.arquivo || null, porCore: out };
  const ro = lerRoster(transicao);
  const nomesDe = new Map(ro.unidades.filter((u) => coreIds.includes(u.coreId)).map((u) => [u.coreId, new Set(u.soldados.map((s) => s.nome))]));
  const c = lerSave(turno.arquivo).completo;
  const vs = veiculos(c, soldados(c)).filter((v) => v.achado);
  for (const [coreId, nomes] of nomesDe) {
    if (!nomes.size) continue;
    const achados = vs.filter((v) => (v.tripulacao?.homens || []).some((h) => nomes.has(h.nome)));
    if (achados.length !== 1) continue;                        // ninguem ou ambiguo: sem evidencia
    const v = achados[0];
    out.set(coreId, { time: v.time, destruido: !!v.destruido, imobilizado: !!v.imobilizado, mobilidade: v.mobilidade, aBordo: v.aBordo, vivos: v.tripulacao.homens.filter((h) => !h.baixa).length, homens: v.tripulacao.homens.map((h) => h.nome) });
  }
  return { turno: turno.arquivo, porCore: out };
}
export function imobilizadosNoFim(transicao, estados = null) {
  const out = { turno: null, coreIds: [], detalhe: [] };
  const lidos = estados || estadosDoSave(transicao);
  const perdidos = lidos.filter((x) => x.codigo === 1 && chave(perfil(x.danos)));
  if (!perdidos.length) return out;
  const t = ultimoTurno(transicao);
  if (!t) return out;
  out.turno = t.arquivo;
  const c = lerSave(t.arquivo).completo;
  const vs = veiculos(c, soldados(c)).filter((v) => v.achado && !v.destruido);
  const porChave = new Map();
  for (const v of vs) {
    const k = chave(perfil((v.subsistemas || []).map((s) => s.dano)));
    if (k) porChave.set(k, [...(porChave.get(k) || []), v]);
  }
  const naTransicao = new Map();
  for (const x of lidos) { const k = chave(perfil(x.danos)); if (k) naTransicao.set(k, (naTransicao.get(k) || 0) + 1); }
  for (const x of perdidos) {
    const k = chave(perfil(x.danos));
    const achados = porChave.get(k) || [];
    if (achados.length !== 1 || naTransicao.get(k) !== 1) continue;      // ambiguo: nao arrisca
    const v = achados[0];
    if (!v.imobilizado) continue;
    out.coreIds.push(x.coreId);
    out.detalhe.push({ coreId: x.coreId, time: v.time, tripulacao: v.tripulacao.homens.filter((h) => !h.baixa).map((h) => h.nome), perfil: k });
  }
  return out;
}

// O que mudou entre duas viradas: quem virou destruido e quem virou imobilizado NESTA batalha.
export function mudancas(anterior, atual) {
  const antes = new Map((anterior || []).map((x) => [x.coreId, x.codigo]));
  return {
    destruidos: atual.filter((x) => x.codigo === 1 && antes.get(x.coreId) !== 1).map((x) => x.coreId),
    imobilizados: atual.filter((x) => x.codigo === 2 && antes.get(x.coreId) !== 2).map((x) => x.coreId),
  };
}

const EH_MAIN = process.argv[1] && /[\\/]veiculo_estado\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const SV = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const caminho = (x) => (/[\\/]/.test(x) ? x : SV + x + (/\.bts$/i.test(x) ? '' : '.bts'));
  const [atual, anterior] = process.argv.slice(2);
  if (!atual) { console.log('uso: node veiculo_estado.mjs <save da transicao> [save da transicao anterior]'); process.exit(1); }
  const A = estadosDoSave(caminho(atual));
  const cont = {}; for (const x of A) cont[x.estado] = (cont[x.estado] || 0) + 1;
  console.log(`${atual}: ${A.length} maquinas com estado — ${Object.entries(cont).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  for (const x of A) console.log(`  core ${String(x.coreId).padStart(4)} tipo ${String(x.tipo).padStart(5)} ${x.estado.padEnd(11)} a${x.a} c${x.c} f ${x.f.toFixed(2)} n ${x.n}${x.homens ? `  (${x.homens} homens no bloco)` : ''}`);
  if (anterior) {
    const m = mudancas(estadosDoSave(caminho(anterior)), A);
    console.log(`nesta batalha: destruidos [${m.destruidos.join(', ')}]  imobilizados [${m.imobilizados.join(', ')}]`);
  }
}
