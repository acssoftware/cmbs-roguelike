// O ESCRITOR DA REGIAO DE IA (05/10/2026, plano "IA autoral para o defensor"). Ate aqui o repositorio so
// mexia na IA no lugar (tiles com a mesma contagem, `trocarZonasIA`; uma espera, `gatilhos.escreverEspera`).
// Este modulo DECODIFICA a regiao inteira (os 10 planos x 16 grupos x entradas) e as 30 vagas de objetivo
// numa estrutura editavel e CODIFICA de volta, byte a byte: o teste de identidade nos mapas do pacote e o
// que garante que o escritor grava o que o leitor (`ia.mjs`, `gatilhos.mjs`) le.
//
// Formato (ia.mjs, gatilhos.mjs, FORMATO 91/123): depois da elevacao vem
//   CAMERA 48 B | u32 len | REGIAO (len B) | 130 B | 30 VAGAS de objetivo | resto do arquivo
//   REGIAO  = u32 5 | 5 PLANOS (azul) | u32 5 | 5 PLANOS (vermelho) | cauda (Support Targets: alvosDeApoio, 14/10)
//   PLANO   = u16 uso | u32 16 | 16 SLOTS (slot g = grupo g)
//   SLOT    = u32 nEntradas | ENTRADA (Setup) | ENTRADAS (Order 2..)
//   ENTRADA = 7 B prefixo | u32 a | u32 b | u8 podeDisparar | u8 n | n x (u8 tipo | u16 i | u16 j) | ptr 4 |
//             u32 count | count x (u32 x, u32 y no canvas) | TRAILER (0 B nos mapas de QB, 19 B nos saves novos)
//   VAGA    = u8 tipo | u8 known | u16 pontos | u16 len | nome | u32 cor | u32 n | tiles [| u8 0]
//
// O PREFIXO de 7 bytes (`+0 +1 +2 +3 +4 +5 +6`), inferido pelo censo de 6.345 entradas e MEDIDO NO EDITOR em 05/10/2026
// (25 de 25 valores conferem; research/ia_codigos.json, mapa ZZ MAPA/0IA CAL.btt):
//   +0 Passenger (0/1)   +1 tipo da ordem (Max Assault 0, Assault 1, Advance 2, Quick 3, Dash 4; Setup = 2)
//   +3 Occupy buildings (Rooftops 0, Upper 1, Mixed 2, Lower 3)   +5 Stance (abaixo)   +2 +4 +6 sempre 0
import { lerPlanos } from './ia.mjs';
import { vagasDeObjetivos } from './gatilhos.mjs';
import { pecas, escrever } from './mapa_escrever.mjs';

export const TIPO_ORDEM = { 'Max Assault': 0, Assault: 1, Advance: 2, Quick: 3, Dash: 4 };
export const OCCUPY = { Rooftops: 0, Upper: 1, Mixed: 2, Lower: 3 };
export const STANCE = {
  Active: 0, Normal: 1, Cautious: 2,
  'Ambush 1000': 3, 'Ambush 600': 4, 'Ambush 300': 5, 'Ambush 150': 6, 'Ambush 75': 7,
  'Ambush Armor 1000': 8, 'Ambush Armor 600': 9, 'Ambush Armor 300': 10, 'Ambush Armor 150': 11, 'Ambush Armor 75': 12,
  Hide: 13,
};
export const USO = { 'Not Used': 0, 'Used Rarely': 1, 'Used Sometimes': 2, 'Used Frequently': 3 };
export const TIPO_OBJ = { Occupy: 0, Preserve: 1, Destroy: 2, Touch: 3, Exit: 4, 'Trigger friendly': 5, 'Trigger friendly armor': 6, 'Trigger enemy': 7, 'Trigger enemy armor': 8 };
export const KNOWN = { Player: 0, Enemy: 1, Both: 2, Neither: 3 };
export const nomeDe = (tabela, v) => Object.keys(tabela).find((k) => tabela[k] === v) ?? String(v);

const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };

// ---------------------------------------------------------------------------------------- decodificar

function lerEntrada(c, o, T) {
  const prefixo = Buffer.from(c.subarray(o, o + 7));
  const a = c.readUInt32LE(o + 7), b = c.readUInt32LE(o + 11), pode = c[o + 15], n = c[o + 16];
  const esperas = []; for (let k = 0; k < n; k++) { const q = o + 17 + 5 * k; esperas.push({ tipo: c[q], i: c.readUInt16LE(q + 1), j: c.readUInt16LE(q + 3) }); }
  const pPtr = o + 17 + 5 * n;
  const ptr = Buffer.from(c.subarray(pPtr, pPtr + 4));
  const count = c.readUInt32LE(pPtr + 4);
  const tiles = []; for (let k = 0; k < count; k++) tiles.push([c.readUInt32LE(pPtr + 8 + 8 * k), c.readUInt32LE(pPtr + 12 + 8 * k)]);
  const fimTiles = pPtr + 8 + 8 * count;
  const trailer = Buffer.from(c.subarray(fimTiles, fimTiles + T));
  return { e: { prefixo, a, b, pode, esperas, ptr, tiles, trailer }, fim: fimTiles + T };
}

// A estrutura editavel de um mapa (ou cenario). Tiles das entradas e vagas ficam no CANVAS (como gravados);
// `tile(x, y)` / `canvas` convertem com OX/OY.
export function decodificar(arquivo) {
  const r = lerPlanos(arquivo);
  if (!r.confiavel) throw new Error('planos de IA ilegiveis: nao da para reescrever com seguranca');
  const c = r.c, T = r.trailer;
  const p = pecas(arquivo); const fimElev = p.c.length - p.resto.length;
  if (!p.c.equals(c)) throw new Error('as duas leituras da corrente nao batem');
  const regFim = r.ini + 4 + r.len;
  let o = r.ini + 4; const lados = [];
  for (let s = 0; s < 2; s++) {
    const nPlanos = c.readUInt32LE(o); o += 4; if (nPlanos !== 5) throw new Error(`lado ${s}: ${nPlanos} planos, esperava 5`);
    const planos = [];
    for (let k = 0; k < 5; k++) {
      const uso = c.readUInt16LE(o), nSlots = c.readUInt32LE(o + 2); o += 6; if (nSlots !== 16) throw new Error(`plano com ${nSlots} slots`);
      const slots = [];
      for (let g = 0; g < 16; g++) {
        const nE = c.readUInt32LE(o); o += 4; const entradas = [];
        for (let j = 0; j < nE; j++) { const x = lerEntrada(c, o, T); entradas.push(x.e); o = x.fim; }
        slots.push(entradas);
      }
      planos.push({ uso, slots });
    }
    lados.push(planos);
  }
  if (o > regFim) throw new Error('a caminhada passou do fim da regiao');
  const vagas = vagasDeObjetivos(c, regFim + 130);
  const ult = vagas[vagas.length - 1]; const fimVagas = ult.fim + (ult.extra ? 1 : 0);
  return {
    arquivo, T, OX: r.ini != null ? p.m.OX : 0, OY: p.m.OY, W: p.W, H: p.H,
    camera: Buffer.from(c.subarray(fimElev, r.ini)),
    azul: lados[0], vermelho: lados[1],
    cauda: Buffer.from(c.subarray(o, regFim)),
    entre: Buffer.from(c.subarray(regFim, regFim + 130)),
    vagas: vagas.map((v) => ({
      lado: v.lado, vaga: v.vaga, tipo: v.tipo, known: v.known, pontos: v.pontos, nome: v.nome,
      cor: c.readUInt32LE(v.em + 6 + v.nome.length),
      tiles: Array.from({ length: v.n }, (_, k) => [c.readUInt32LE(v.tilesEm + 8 * k), c.readUInt32LE(v.tilesEm + 8 * k + 4)]),
      extra: v.extra,
    })),
    depois: Buffer.from(c.subarray(fimVagas)),
  };
}

// ----------------------------------------------------------------------------------------- codificar

function codificarEntrada(e, T) {
  if (e.esperas.length > 1) throw new Error('uma ordem so espera um trigger');
  const partes = [e.prefixo, u32(e.a), u32(e.b), Buffer.from([e.pode, e.esperas.length])];
  for (const w of e.esperas) partes.push(Buffer.from([w.tipo]), u16(w.i), u16(w.j));
  partes.push(e.ptr, u32(e.tiles.length));
  const t = Buffer.alloc(8 * e.tiles.length); e.tiles.forEach(([x, y], k) => { t.writeUInt32LE(x, 8 * k); t.writeUInt32LE(y, 8 * k + 4); });
  partes.push(t);
  if (T) { if (e.trailer.length !== T) throw new Error(`entrada com trailer de ${e.trailer.length} B num arquivo de ${T}`); partes.push(e.trailer); }
  return Buffer.concat(partes);
}

export function codificarRegiao(d) {
  const partes = [];
  for (const lado of [d.azul, d.vermelho]) {
    partes.push(u32(5));
    for (const pl of lado) {
      partes.push(u16(pl.uso), u32(16));
      for (const slot of pl.slots) { partes.push(u32(slot.length)); for (const e of slot) partes.push(codificarEntrada(e, d.T)); }
    }
  }
  partes.push(d.cauda);
  return Buffer.concat(partes);
}

function codificarVaga(v) {
  const nome = Buffer.from(v.nome, 'latin1');
  const t = Buffer.alloc(8 * v.tiles.length); v.tiles.forEach(([x, y], k) => { t.writeUInt32LE(x, 8 * k); t.writeUInt32LE(y, 8 * k + 4); });
  return Buffer.concat([Buffer.from([v.tipo, v.known]), u16(v.pontos), u16(nome.length), nome, u32(v.cor), u32(v.tiles.length), t, v.extra ? Buffer.from([0]) : Buffer.alloc(0)]);
}

// O `resto` do escritor de mapas (tudo depois da elevacao)
export function codificar(d) {
  const regiao = codificarRegiao(d);
  return Buffer.concat([d.camera, u32(regiao.length), regiao, d.entre, ...d.vagas.map(codificarVaga), d.depois]);
}

export function gravar(base, saida, d) {
  const r = escrever(base, saida, { resto: codificar(d) });
  return { ...r, saida };
}

// ------------------------------------------------------------------------------------------- autoria

export const canvas = (d, tiles) => tiles.map(([x, y]) => [x + d.OX, y + d.OY]);
export const doMapa = (d, tiles) => tiles.map(([x, y]) => [x - d.OX, y - d.OY]);

// Uma entrada nova. `setup`: a primeira do grupo (sem tipo de ordem; o arquivo guarda o default 2).
// `molde`: uma entrada existente do mesmo arquivo de onde vem o ptr e o trailer (o ptr e um ponteiro
// serializado que muda a cada save; copiar um valido e o mais conservador).
export function entrada(d, { setup = false, tipo = 'Advance', occupy = 'Mixed', stance = 'Normal', passenger = null, a = 0, b = 60, pode = false, espera = null, tiles = [] }, molde) {
  const prefixo = Buffer.from([passenger ?? (setup ? 1 : 0), setup ? 2 : TIPO_ORDEM[tipo], 0, OCCUPY[occupy], 0, STANCE[stance], 0]);
  if ([prefixo[1], prefixo[3], prefixo[5]].some((v) => v === undefined || Number.isNaN(v))) throw new Error(`valor desconhecido: tipo ${tipo}, occupy ${occupy}, stance ${stance}`);
  return { prefixo, a, b, pode: pode ? 1 : 0, esperas: espera ? [espera] : [], ptr: Buffer.from(molde.ptr), tiles: canvas(d, tiles), trailer: molde.trailer.length === 19 ? TRAILER_NEUTRO() : Buffer.from(molde.trailer) };   // o Withdraw do molde nao vem junto
}

// O FORMATO NOVO DO EDITOR (E150): cada entrada termina num trailer de 19 B — [0] = 1, [1..4] lixo de memoria do
// editor (gravamos 0), [5..8] = 0, [9] = 1, [10] = ponto especial da ordem (0 nenhum, 2 = Withdraw, SHIFT+clique;
// medido no plano do autor de 05/10), [11..14] x e [15..18] y do tile (canvas). O Withdraw so existe no formato novo;
// `paraFormatoNovo` converte um mapa do formato antigo (trailer 0) dando a toda entrada o trailer neutro.
export const TRAILER_NEUTRO = () => { const t = Buffer.alloc(19); t[0] = 1; t[9] = 1; return t; };
export function paraFormatoNovo(d) {
  if (d.T === 19) return d;
  if (d.T !== 0) throw new Error(`trailer de ${d.T} B: formato desconhecido`);
  for (const lado of [d.azul, d.vermelho]) for (const pl of lado) for (const s of pl.slots) for (const e of s) e.trailer = TRAILER_NEUTRO();
  d.T = 19;
  return d;
}
// E153 (06/10/2026): NAO HA COMO GRAVAR O FORMATO NOVO. O trailer existe so em arquivo de versao 0x94/0x9b (byte 18
// do arquivo cru; 0x8b..0x8d = formato antigo) e a versao muda outras partes do arquivo: trailer com versao 8b trava
// o editor, e trocar a versao para 9b ou 94 tambem trava (City 047r V4/V9/V10). Todo mapa e cenario que o app grava
// fica no formato ANTIGO; um plano salvo pelo editor (formato novo) volta ao antigo por `paraFormatoAntigo`, e o
// Withdraw que ele tinha se perde (o autor o repoe no editor quando quiser).
export function paraFormatoAntigo(d) {
  if (d.T === 0) return d;
  for (const lado of [d.azul, d.vermelho]) for (const pl of lado) for (const s of pl.slots) for (const e of s) e.trailer = Buffer.alloc(0);
  d.T = 0;
  return d;
}
export const versaoDoArquivo = (buf) => buf[18];   // 0x8b..0x8d antigo (sem trailer), 0x94/0x9b novo

// O tile de Withdraw de uma ordem (tile do MAPA): "veiculos vao em Reverse ate a zona de movimento, virados para o
// inimigo; infantaria recua em lances; usam fumaca" (manual v4.00 p.8). Exige o formato novo.
export function comWithdraw(d, e, [x, y]) {
  if (d.T !== 19) throw new Error('Withdraw exige o formato novo (paraFormatoNovo)');
  const t = Buffer.from(e.trailer.length === 19 ? e.trailer : TRAILER_NEUTRO()); t.fill(0, 1, 5);
  t[10] = 2; t.writeUInt32LE(x + d.OX, 11); t.writeUInt32LE(y + d.OY, 15);
  return { ...e, trailer: t };
}

// Um slot vazio igual aos que o proprio arquivo usa (o primeiro grupo sem setup nem ordens que achar).
export function slotVazio(d) {
  for (const lado of [d.azul, d.vermelho]) for (const pl of lado) for (const s of pl.slots) if (s.length === 1 && !s[0].tiles.length && !s[0].esperas.length) return [{ ...s[0], prefixo: Buffer.from(s[0].prefixo), ptr: Buffer.from(s[0].ptr), tiles: [], esperas: [], trailer: Buffer.from(s[0].trailer) }];
  throw new Error('o arquivo nao tem um slot vazio para servir de molde');
}

// Uma vaga de objetivo-trigger nova (tipo 7 = A.I. Trigger (enemy), Known to Neither, como os autores de QB).
// `extra`: o byte 0 depois dos tiles, como os triggers que o proprio arquivo ja tem.
export function trigger(d, { nome, tiles, tipo = 'Trigger enemy', cor = null }) {
  const modelo = d.vagas.find((v) => v.tipo >= 5 && v.tipo <= 8 && v.tiles.length);
  return { tipo: TIPO_OBJ[tipo], known: KNOWN.Neither, pontos: 0, nome, cor: cor ?? modelo?.cor ?? 0, tiles: canvas(d, tiles), extra: modelo ? modelo.extra : true };
}

const EH_MAIN = process.argv[1] && /[\\/]ia_escrever\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const f = process.argv[2];
  if (!f) { console.log('uso: node tools/re/ia_escrever.mjs "<arquivo.btt>"   (decodifica, recodifica e confere a identidade)'); process.exit(1); }
  const d = decodificar(f); const ok = codificar(d).equals(pecas(f).resto);
  const n = (lado) => lado.map((pl) => pl.slots.filter((s) => s.length > 1 || s[0].tiles.length).length).join('/');
  console.log(`${f}: trailer ${d.T}, grupos com conteudo azul ${n(d.azul)} vermelho ${n(d.vermelho)}, ${d.vagas.filter((v) => v.tiles.length).length} vagas em uso, identidade ${ok ? 'OK' : 'FALHOU'}`);
}

// OS SUPPORT TARGETS (decodificados em 14/10/2026 no 024r: o autor trocou dois alvos para fumaca no editor). A cauda da
// regiao de IA e, para cada lado: u8 lado (0 azul, 1 vermelho) | u32 n | n ALVOS; ALVO = u8 missao (2 = supressao,
// 3 = fumaca; os outros valores do menu ainda nao medidos) | 4 B (iguais por indice entre arquivos: 20 09 00 ff,
// 16 06 00 ff, a0 2d 00 ff no azul, 11 11 11 11 no vermelho; nao mudam com a missao nem com a zona) | u32 m | m x
// (u32 x, u32 y) tiles no canvas. Os alvos nao pertencem a plano nenhum: o computador sorteia entre eles no inicio.
export const MISSAO_APOIO = { 2: 'Suppress', 3: 'Smoke' };
export function alvosDeApoio(d) {
  const c = d.cauda; let o = 0; const lados = [];
  while (o < c.length) {
    if (o + 5 > c.length) throw new Error('cauda: lado truncado');
    const lado = c[o]; const n = c.readUInt32LE(o + 1); o += 5; const alvos = [];
    for (let k = 0; k < n; k++) {
      const missao = c[o], params = Buffer.from(c.subarray(o + 1, o + 5)); const m = c.readUInt32LE(o + 5); o += 9;
      const tiles = []; for (let q = 0; q < m; q++) { tiles.push([c.readUInt32LE(o), c.readUInt32LE(o + 4)]); o += 8; }
      alvos.push({ missao, nome: MISSAO_APOIO[missao] || null, params, tiles });
    }
    lados.push({ lado, alvos });
  }
  if (o !== c.length) throw new Error('cauda: sobra');
  return lados;
}
export function codificarAlvos(lados) {
  const partes = [];
  for (const L of lados) {
    const h = Buffer.alloc(5); h[0] = L.lado; h.writeUInt32LE(L.alvos.length, 1); partes.push(h);
    for (const a of L.alvos) { const e = Buffer.alloc(9 + 8 * a.tiles.length); e[0] = a.missao; a.params.copy(e, 1); e.writeUInt32LE(a.tiles.length, 5); a.tiles.forEach(([x, y], q) => { e.writeUInt32LE(x, 9 + 8 * q); e.writeUInt32LE(y, 13 + 8 * q); }); partes.push(e); }
  }
  return Buffer.concat(partes);
}
