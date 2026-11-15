// ROSTER INICIAL DO `.cam` (secao 111.18): a lista de unidades core com que a campanha comeca.
// E o bloco LZ do cabecalho do `.cam` (o mesmo que o save de transicao carrega adiante, secao
// 111.13), na versao sem soldados: o jogo so cria os homens na primeira batalha.
//
//   [textos e titulos do briefing ...][u32 QUANTAS][bloco x QUANTAS]        (o roster acaba ai)
//
// Bloco de uma unidade:
//   [u32 CORE ID][u16 tipo][8 B atributos][u8 lideranca][05 04 03 00][u32 n][4 B 00]
//   [n x 15 B de SLOT][6 B 00]                          -> 33 + 15n bytes
//   veiculo: mais 25 B depois dos slots                 -> 33 + 15n + 25
//   formacao: n = 0                                     -> 33
// SLOT = [u8 equipe][u8 indice na equipe][13 B 00]: os homens que a unidade vai ter. Um esquadrao
// de 9 sai `1.0 1.1 1.2 1.3 1.4 | 2.0 2.1 2.2 2.3` (as duas equipes do TO&E), um de 6 sai 3 + 3.
// `tipo` e o par que so o roster usa (tools/re/tipos.mjs).
//
// A lista e percorrida em CADEIA (cada bloco diz o seu tamanho pelo n), nao por busca de
// assinatura — e o unico jeito de nao pular as formacoes, que tem n = 0. Medido nas campanhas do
// jogo: Crossing the Dnieper 256 blocos, Task Force 3-69 170, The Shield of Kiev 195 e ZZ DINAMICA
// 246, todas terminando exatamente no fim do roster.
//
//   node roster_cam.mjs ler <campanha.cam>
//   node roster_cam.mjs efetivo <entrada.cam> <saida.cam> <coreId:n> [coreId:n ...]
import fs from 'node:fs';
import path from 'node:path';
import { lerCam, escreverCam } from './cam.mjs';
import { descomprimir, comprimirLiterais } from './lz.mjs';
import { cabecalhoDoBloco, decodificar, expandir, codificarComoJogo } from './escape.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { fimDoConteudo } from './core.mjs';
import { decodificar as lerAtributos, EXPERIENCIA, MOTIVACAO, FITNESS, SUPRIMENTO, LIDERANCA } from './atributos.mjs';

// A assinatura e `05 04 03` e um quarto byte que varia (00 nas campanhas US/RU, 01 no catalogo
// ucraniano) — nao faz parte da marca.
const ASS3 = Buffer.from([0x05, 0x04, 0x03]);
const acharASS = (b, de) => b.indexOf(ASS3, de);
const temASS = (b, p) => b[p] === 0x05 && b[p + 1] === 0x04 && b[p + 2] === 0x03;
const CABECA = 15, POS_N = 19, POS_SLOTS = 27, SLOT = 15;

// OS 8 BYTES DE ATRIBUTOS DO BLOCO, decodificados em 07/09 (secao 112.12) por casamento com o
// registro do .btt e provados por REPRODUCAO: escrever aqui o atributo da propria unidade refaz o
// roster de tres campanhas de fabrica em 88-100% dos blocos, contra 8-51% do molde cru.
//
//   +6..+9  zeros (as vezes 01 em +6 e +9, campos ainda sem nome)
//   +10 experiencia   +11 motivacao   +12 ? (suprimento e o palpite)   +13 fitness
//   +14 lideranca, com SINAL (254 = -2, 255 = -1)
const POS = { experiencia: 10, motivacao: 11, suprimento: 12, fitness: 13 };
const ESCALA = { experiencia: EXPERIENCIA, motivacao: MOTIVACAO, suprimento: SUPRIMENTO, fitness: FITNESS };

// Escreve num bloco os atributos de uma unidade (o objeto que `atributos.decodificar` devolve).
// Sem isso o bloco carrega os atributos do DOADOR de onde o molde foi colhido: a forca do jogador
// entrava na campanha com conscritos, moral Poor e ate Unfit que ela nunca teve.
export function comAtributos(buf, a) {
  if (!a) return buf;
  const b = Buffer.from(buf);
  for (const [campo, off] of Object.entries(POS)) {
    const v = ESCALA[campo].indexOf(a[campo]);
    if (v >= 0) b[off] = v;
  }
  const lid = LIDERANCA.indexOf(a.lideranca);
  if (lid >= 0) b[14] = (lid - 2 + 256) % 256;
  return b;
}

// O bloco do roster dentro do cabecalho do .cam: `u32 tam | LZ` que expande contendo "Situation".
export function acharRoster(cabecalho) {
  for (let p = 0; p + 8 < cabecalho.length; p++) {
    const tam = cabecalho.readUInt32LE(p);
    if (tam < 500 || p + 4 + tam > cabecalho.length) continue;
    try {
      const lz = Buffer.from(descomprimir(cabecalho.subarray(p + 4, p + 4 + tam), 0).saida);
      if (lz.indexOf('Situation', 0, 'latin1') < 0) continue;
      const h = cabecalhoDoBloco(lz);
      const d = decodificar(lz, h.esc, h.inicio, lz.length, h.atalhos);
      return { pos: p, tam, esc: h.esc, exp: Buffer.from(expandir(Buffer.from(d.cru), d.tokens).completo) };
    } catch {}
  }
  return null;
}

// A lista: o u32 QUANTAS vem 4 bytes antes do primeiro bloco.
export function lerLista(exp) {
  let q = acharASS(exp, 0);
  while (q >= 0) { const n = exp.readUInt32LE(q + 4); if (n <= 60 && q >= CABECA + 4) break; q = acharASS(exp, q + 4); }
  if (q < 0) throw new Error('roster sem lista de unidades');
  const ini = q - CABECA;
  const quantas = exp.readUInt32LE(ini - 4);
  if (!(quantas > 0 && quantas < 5000)) throw new Error(`contador implausivel em ${ini - 4}: ${quantas}`);
  const blocos = []; let p = ini;
  for (let k = 0; k < quantas; k++) {
    if (!temASS(exp, p + CABECA)) throw new Error();
    const n = exp.readUInt32LE(p + POS_N);
    const prox = acharASS(exp, p + POS_N);
    const fim = k === quantas - 1 ? exp.length : prox - CABECA;
    const extra = fim - p - (33 + SLOT * n);
    if (extra < 0) throw new Error(`bloco ${k} em ${p}: tamanho ${fim - p} menor que o minimo ${33 + SLOT * n}`);
    blocos.push({ p, tam: fim - p, coreId: exp.readUInt32LE(p), tipo: exp.readUInt16LE(p + 4),
      atributos: Buffer.from(exp.subarray(p + 6, p + 14)), lideranca: exp[p + 14], n, extra,
      buf: Buffer.from(exp.subarray(p, fim)) });
    p = fim;
  }
  if (p !== exp.length) throw new Error(`a lista termina em ${p}, mas o roster tem ${exp.length} B`);
  return { ini, quantas, blocos, prefixo: Buffer.from(exp.subarray(0, ini - 4)) };
}

// Troca o efetivo NOMINAL de um bloco: corta ou repete SLOTS. Cortar tira os ultimos (a segunda
// equipe some antes da primeira); crescer repete o ultimo slot andando o indice.
export function comEfetivo(bloco, n) {
  if (n === bloco.n) return bloco;
  if (n < 0 || n > 60) throw new Error(`efetivo ${n} fora de 0..60`);
  const b = bloco.buf, slots = [];
  for (let k = 0; k < bloco.n; k++) slots.push(Buffer.from(b.subarray(POS_SLOTS + SLOT * k, POS_SLOTS + SLOT * (k + 1))));
  while (slots.length > n) slots.pop();
  while (slots.length < n) {
    const u = slots[slots.length - 1];
    const novo = Buffer.alloc(SLOT);
    if (u) { novo[0] = u[0]; novo[1] = u[1] + 1; } else { novo[0] = 1; novo[1] = 0; }
    slots.push(novo);
  }
  const cabeca = Buffer.from(b.subarray(0, POS_SLOTS)); cabeca.writeUInt32LE(n, POS_N);
  const rabo = Buffer.from(b.subarray(POS_SLOTS + SLOT * bloco.n));   // os 6 B finais (e os 25 do veiculo)
  const buf = Buffer.concat([cabeca, ...slots, rabo]);
  return { ...bloco, n, tam: buf.length, buf };
}

// A EQUIPE DE CADA VAGA E O LUGAR DA UNIDADE NA FORMACAO (05/10/2026, E141). O primeiro byte de cada vaga diz ao jogo
// de que unidade da formacao aquele homem e; o jogo so grava os homens no roster da unidade cujo lugar casa. As
// campanhas oficiais numeram as irmas (um pelotao de tanques sai 0.x 1.x 2.x 3.x) e o lugar e o mesmo indice que o
// registro guarda no byte +8 (`b8 >> 2`). Os moldes vem todos com 1: so uma irma por formacao ganhava homens (o E83 —
// 112 de 285 unidades da RUS1 nunca persistidas). Provado em tela: E1 13 de 26 unidades com homens, E6 26 de 26.
// A esquadra (bit 0x80 do +8) fica como esta: as vagas dela sao as equipes A/B da propria esquadra.
export function comEquipe(buf, b8) {
  if (b8 == null || (b8 & 0x80)) return buf;
  const n = buf.readUInt32LE(POS_N); if (!n) return buf;
  const out = Buffer.from(buf); const v = (b8 >> 2) & 0x1f;
  for (let j = 0; j < n; j++) out[POS_SLOTS + SLOT * j] = v;
  return out;
}

export function comCoreId(bloco, coreId) {
  const buf = Buffer.from(bloco.buf); buf.writeUInt32LE(coreId, 0);
  return { ...bloco, coreId, buf };
}

// Remonta o roster expandido a partir dos blocos, na ordem dada.
export function montarRoster(lista, blocos) {
  const n = Buffer.alloc(4); n.writeUInt32LE(blocos.length);
  return Buffer.concat([lista.prefixo, n, ...blocos.map((x) => x.buf)]);
}

// Grava o .cam com o roster trocado. `mutar(blocos, lista)` devolve os blocos novos.
export function escreverRoster(entrada, saida, mutar) {
  const cam = lerCam(entrada);
  const R = acharRoster(cam.cabecalho);
  if (!R) throw new Error('roster nao encontrado no cabecalho da campanha');
  const lista = lerLista(R.exp);
  const novos = mutar(lista.blocos, lista) || lista.blocos;
  const exp = montarRoster(lista, novos);
  const comp = comprimirLiterais(Buffer.from(codificarComoJogo(exp, R.esc)));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const cabecalho = Buffer.concat([cam.cabecalho.subarray(0, R.pos), t4, comp, cam.cabecalho.subarray(R.pos + 4 + R.tam)]);
  escreverCam(cabecalho, cam.batalhas, saida);
  return { unidades: novos.length, roster: { antes: R.exp.length, depois: exp.length }, lz: { antes: R.tam, depois: comp.length } };
}

// QUEM ENTRA NO ROSTER (medido nas quatro campanhas de catalogo, secao 111.21): os registros que
// NAO sao formacao e cuja categoria (+12) nao e 0x60, em ordem crescente de CORE ID. No ZZ US ALL:
// 1919 registros - 282 formacoes - 55 de categoria 0x60 = os 1582 blocos do roster, na ordem.
export function unidadesDoCore(caminho) {
  const X = abrirCompleto(caminho); const c = X.completo;
  const out = [];
  for (let k = 0; k < X.R.length; k++) {
    const r = X.R[k];
    if (r.form || c[r.c + 12] === 0x60) continue;
    let i; try { i = fimDoConteudo(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); } catch { continue; }
    if (!i.core) continue;
    out.push({ coreId: c.readUInt32LE(i.fim), val: r.val, tab: r.tab, nome: r.nm, presente: c[i.fim + 4], atributos: lerAtributos(c, r.c), b8: c[r.c + 8] });
  }
  return out.sort((a, b) => a.coreId - b.coreId);
}

// Monta a lista de blocos de um roster a partir da forca core, com os moldes por tipo
// (`research/tipos_roster.json`, campo `bloco`). `tabela` e o JSON ja lido.
export function blocosDeForca(caminho, tabela) {
  const porPar = new Map(tabela.filter((x) => x.bloco).map((x) => [`${x.val},${x.tab}`, x]));
  const faltando = [];
  const blocos = unidadesDoCore(caminho).map((u) => {
    const t = porPar.get(`${u.val},${u.tab}`);
    if (!t) { faltando.push(u); return null; }
    const buf = comEquipe(comAtributos(Buffer.from(t.bloco, 'hex'), u.atributos), u.b8);
    buf.writeUInt32LE(u.coreId, 0);
    return { coreId: u.coreId, tipo: buf.readUInt16LE(4), n: buf.readUInt32LE(POS_N), tam: buf.length, extra: 0, buf };
  }).filter(Boolean);
  return { blocos, faltando };
}

// CAMPANHA INTEIRA POR CODIGO: cabecalho clonado de um `.cam` modelo (textos, [PLAYER FORCE] e
// imagem vem dele), roster montado da forca core e as batalhas dadas.
//   batalhas: [{ nome, btt (Buffer ou caminho), limiar = 4, nextWin, nextLose, pct }]
export function escreverCampanha({ modelo, core, batalhas, saida, tabela, blocos: dados }) {
  const cam = lerCam(modelo);
  const R = acharRoster(cam.cabecalho);
  if (!R) throw new Error(`o modelo ${path.basename(modelo)} nao tem roster no cabecalho`);
  const lista = lerLista(R.exp);
  const { blocos, faltando } = dados ? { blocos: dados, faltando: [] } : blocosDeForca(core, tabela);
  if (!blocos.length) throw new Error('a forca core nao rendeu nenhum bloco de roster');
  const exp = montarRoster(lista, blocos);
  const comp = comprimirLiterais(Buffer.from(codificarComoJogo(exp, R.esc)));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const cabecalho = Buffer.concat([cam.cabecalho.subarray(0, R.pos), t4, comp, cam.cabecalho.subarray(R.pos + 4 + R.tam)]);
  const bats = batalhas.map((b, i) => ({
    nome: b.nome, limiar: b.limiar ?? 4,
    nextWin: b.nextWin ?? (i + 1 < batalhas.length ? i + 1 : -1),
    nextLose: b.nextLose ?? (i + 1 < batalhas.length ? i + 1 : -1),
    pct: b.pct ?? [0, 0, 0, 100, 0, 0, 0, 100],
    btt: Buffer.isBuffer(b.btt) ? b.btt : fs.readFileSync(b.btt),
  }));
  const bytes = escreverCam(cabecalho, bats, saida);
  return { unidades: blocos.length, faltando, roster: { modelo: R.exp.length, novo: exp.length }, batalhas: bats.map((b) => `${b.nome} ${b.btt.length} B`), bytes };
}

const EH_MAIN = process.argv[1] && /[\\/]roster_cam\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'ler') {
    const cam = lerCam(a[0]); const R = acharRoster(cam.cabecalho); const L = lerLista(R.exp);
    console.log(`${path.basename(a[0])}: roster ${R.exp.length} B (LZ ${R.tam}), ${L.quantas} blocos; ${cam.batalhas.length} batalhas`);
    const porExtra = {}; for (const b of L.blocos) porExtra[b.extra] = (porExtra[b.extra] || 0) + 1;
    console.log(`   formacoes (n = 0): ${L.blocos.filter((b) => !b.n).length}; extras: ${JSON.stringify(porExtra)}`);
    for (const b of L.blocos.slice(0, 8)) console.log(`   core ${String(b.coreId).padStart(4)} tipo ${String(b.tipo).padStart(6)} n ${String(b.n).padStart(2)} extra ${b.extra} lid ${b.lideranca}`);
  } else if (cmd === 'efetivo') {
    const [entrada, saida, ...pares] = a;
    const alvo = new Map(pares.map((s) => s.split(':').map(Number)));
    const r = escreverRoster(entrada, saida, (blocos) => blocos.map((b) => (alvo.has(b.coreId) ? comEfetivo(b, alvo.get(b.coreId)) : b)));
    console.log(JSON.stringify(r));
  } else console.log('uso: node roster_cam.mjs ler <campanha.cam> | efetivo <entrada.cam> <saida.cam> <coreId:n> ...');
}
