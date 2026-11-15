// LEITOR DOS PLANOS DE IA que ja vem prontos nos mapas (secoes 84-85, 90-91).
//
// Objetivo pratico (autor, 04/09): NAO autorar planos — o mapa de Quick Battle ja traz os seus.
// O gerador precisa saber QUAIS GRUPOS o plano usa, para distribuir as unidades neles (byte +16
// do registro, secao 70). Se todas as unidades ficarem no grupo 1, os demais grupos do plano
// ficam sem tropa e suas ordens nao rodam.
//
// ESTRUTURA (medida byte a byte no laboratorio, no Podlypyky e nos originais de QB, secao 91):
//   ... grade (5 B/tile) | elevacao (4 B/tile) | 12 floats = CAMERA do editor (1,1,2,1,1,0,... quando
//   nunca movida; NAO e assinatura) | u32 len | REGIAO (len bytes)
//   REGIAO = u32 5 | plano 1..5 (Blue) | u32 5 | plano 1..5 (Red) | cauda (Support Targets etc.)
//   plano  = u16 USO (0 Not Used, 1 Rarely, 2 Sometimes, 3 Frequently) | u32 16 | 16 SLOTS de
//            grupo, POSICIONAIS (slot g = grupo g)
//   slot   = u32 nOrdens | ENTRADA (setup) | (nOrdens-1) x ENTRADA (ordens)
//   ENTRADA = 7 B | u32 a | u32 b | u8 | u8 n | n x 5 B | ptr 4 | u32 count | count x (u32 x, u32 y
//             no canvas 1024) | TRAILER      (a, b parecem tempos em segundos: 2460/4200, 0/60)
//   TRAILER = 0 bytes nos mapas ORIGINAIS de Quick Battle (formato antigo) ou 19 bytes
//             (01 | ptr 4 | u32 0 | u32 1 | u16 0 | u32 0) nos saves do editor atual. O ptr sao
//             4 bytes de ponteiro serializado (mudam por save): NAO sao marcador.
// A caminhada e DETERMINISTICA: cada count e validado pelas coordenadas que o seguem (no canvas,
// nao no retangulo do mapa: mapas redimensionados guardam areas fora dele); uma entrada que nao
// valida marca o plano como nao confiavel. O trailer e detectado uma vez por arquivo.
import { ler } from './transplante.mjs';
import { expandir } from './escape.mjs';
import { lerMapa } from './mapa.mjs';

export const USO = { 0: 'Not Used', 1: 'Used Rarely', 2: 'Used Sometimes', 3: 'Used Frequently' };
const CAB6 = (c, h) => h >= 0 && h + 6 <= c.length && c.readUInt16LE(h) <= 3 && c.readUInt32LE(h + 2) === 16;   // cabecalho de plano
const CAB = (c, h) => h >= 0 && h + 10 <= c.length && c.readUInt32LE(h) === 5 && CAB6(c, h + 4);                 // u32 5 planos + cabecalho

export function contexto(caminho) {
  const d = ler(caminho); const { completo: c } = expandir(d.cru, d.tokens);
  const m = lerMapa(caminho);
  let ini = null, origem = 'grade', delta = null;
  // fimGrade ja desconta os landmarks (secao 92): a elevacao vai de fimGrade a fimGrade + 4WH
  const esperado = m.fimGrade != null ? m.fimGrade + 4 * m.W * m.H + 48 : null;
  if (esperado != null && CAB(c, esperado + 4)) ini = esperado;
  if (ini == null) {   // fallback: procura `u32 len | u32 5 | u16 uso | u32 16` a partir da grade
    origem = 'busca';
    for (let h = Math.max(4, m.gridStart || 0); h + 10 < c.length; h++) { if (c[h] !== 5 || c[h + 6] !== 0x10) continue; if (CAB(c, h) && c.readUInt32LE(h - 4) > 100 && c.readUInt32LE(h - 4) < c.length) { ini = h - 4; break; } }
    if (ini == null) throw new Error('regiao de IA nao localizada');
    if (esperado != null) delta = ini - esperado;
  }
  const len = c.readUInt32LE(ini);
  return { c, m, ini, len, fim: Math.min(c.length, ini + 4 + len), W: m.W, H: m.H, OX: m.OX, OY: m.OY, origem, delta };
}

const coordsOk = (c, o, n, max = 12) => { for (let k = 0; k < Math.min(n, max); k++) { if (c.readUInt32LE(o + 8 * k) >= 1024 || c.readUInt32LE(o + 8 * k + 4) >= 1024) return false; } return true; };
const TRAILER_NOVO = (c, p) => p + 19 <= c.length && c[p] === 1 && c.readUInt32LE(p + 5) === 0 && c.readUInt32LE(p + 9) === 1 && c.readUInt16LE(p + 13) === 0 && c.readUInt32LE(p + 15) === 0;

// Prefixo de 7 bytes de toda entrada: `t 0 2 0 s 0` com t pequeno (tipo?) — serve de validador.
const PREFIXO = (c, p) => p + 7 <= c.length && c[p] <= 1 && c[p + 1] >= 1 && c[p + 1] <= 8 && c[p + 2] === 0 && c[p + 3] <= 4 && c[p + 4] === 0 && c[p + 6] === 0;
// O que pode vir depois de uma entrada: outra entrada (ordem), um slot (u32 nOrdens + entrada),
// um cabecalho de plano, o `u32 5` do outro lado, ou o fim da regiao.
const SEGUE_BEM = (x, p, T, ultimo) => { const { c } = x; if (p > x.fim) return false; if (T && !TRAILER_NOVO(c, p - T)) return false; if (ultimo) return true; if (p + 7 > x.fim) return false; if (PREFIXO(c, p)) return true; const n = c.readUInt32LE(p); if (n >= 1 && n <= 33 && PREFIXO(c, p + 4)) return true; return CAB6(c, p) || CAB(c, p); };

// Le uma ENTRADA (setup ou ordem) em `o`: 7 | u32 a | u32 b | 2 ou 7 bytes | ptr | count | tiles.
// O meio tem 17 ou 22 bytes (histograma de 14 mil setups e 1,7 mil ordens nos 360 mapas de QB),
// logo o count esta em +21 ou +26. Como o ptr das ORDENS pode ser 00000000, um count 0 falso em
// +21 e possivel: cada candidato e confirmado pelo que vem DEPOIS dos tiles (lookahead).
function lerEntrada(x, o, T, ultimo = false) {
  const { c } = x;
  const valida = (pc) => { if (pc + 4 > x.fim) return null; const n = c.readUInt32LE(pc); if (n > 80000 || pc + 4 + 8 * n > x.fim || !coordsOk(c, pc + 4, n)) return null; return n; };
  const a = c.readUInt32LE(o + 7), b = c.readUInt32LE(o + 11);
  const cands = [];
  for (const pre of [21, 26]) { const n = valida(o + pre); if (n != null) cands.push({ p: o + pre, n, segue: SEGUE_BEM(x, o + pre + 4 + 8 * n + T, T, ultimo) }); }
  const escolha = cands.find((k) => k.segue) || cands.find((k) => k.n > 0) || cands[0];
  if (!escolha) return null;
  const { p, n: count } = escolha;
  const tiles = []; for (let k = 0; k < count; k++) tiles.push([c.readUInt32LE(p + 4 + 8 * k) - x.OX, c.readUInt32LE(p + 8 + 8 * k) - x.OY]);
  return { count, tiles, a, b, meio: p - 4 - o - 4, countEm: p, ini: o, fim: p + 4 + 8 * count + T };
}

export function lerPlanos(caminho) {
  const x = contexto(caminho); const { c } = x;
  let o = x.ini + 4; const planos = []; let confiavel = true; let T = null;
  for (let k = 0; k < 10; k++) {
    if (k % 5 === 0) { if (!CAB(c, o)) { confiavel = false; break; } o += 4; }   // u32 5 = numero de planos do lado
    if (!CAB6(c, o)) { confiavel = false; break; }
    const plano = { k, lado: k < 5 ? 'azul' : 'vermelho', plano: (k % 5) + 1, uso: c.readUInt16LE(o), usoNome: USO[c.readUInt16LE(o)] || '?', grupos: [], confiavel: true, ini: o };
    o += 6;
    for (let g = 1; g <= 16; g++) {
      const nOrd = c.readUInt32LE(o);
      if (nOrd < 1 || nOrd > 33) { plano.confiavel = false; break; }
      const ultimo = k === 9 && g === 16;
      if (T == null) { const e0 = lerEntrada(x, o + 4, 0, true); if (!e0) { plano.confiavel = false; break; } T = TRAILER_NOVO(c, e0.fim) ? 19 : 0; }   // formato do arquivo, decidido na 1a entrada
      const e = lerEntrada(x, o + 4, T, ultimo && nOrd === 1);
      if (!e) { plano.confiavel = false; break; }
      let p = e.fim;
      // `setupEm`/`ordensEm`: o offset do `u32 count` de cada lista na corrente completa, para quem
      // precisa reescrever os tiles no lugar (mucuge.trocarZonasIA, E86).
      // `entradas`: inicio (prefixo de 7 B) e count de cada entrada, setup primeiro — para quem le os
      // parametros crus da ordem (tipo, gatilho, "wait for"; E86).
      const grupo = { grupo: g, setup: e.tiles, setupEm: e.countEm, ordens: [], ordensEm: [], nOrdens: nOrd, tempo: [e.a, e.b], entradas: [{ ini: e.ini, countEm: e.countEm }] };
      let ok = true;
      for (let j = 2; j <= nOrd; j++) { const e2 = lerEntrada(x, p, T, ultimo && j === nOrd); if (!e2) { ok = false; break; } grupo.ordens.push(e2.tiles); grupo.ordensEm.push(e2.countEm); grupo.entradas.push({ ini: e2.ini, countEm: e2.countEm }); p = e2.fim; }
      if (!ok) { plano.confiavel = false; break; }
      if (e.count || nOrd > 1) plano.grupos.push(grupo);
      o = p;
    }
    planos.push(plano);
    if (!plano.confiavel) { confiavel = false; break; }
  }
  return { W: x.W, H: x.H, planos, confiavel, ini: x.ini, len: x.len, trailer: T, origem: x.origem, delta: x.delta, cauda: confiavel ? o - x.ini : null, falhaEm: confiavel ? null : o, c: x.c };
}

// Resumo ao gerador: por lado, o primeiro plano USADO (uso > 0) e confiavel com grupos.
export function gruposUsados(caminho) {
  const { planos } = lerPlanos(caminho);
  const out = { azul: null, vermelho: null };
  for (const lado of ['azul', 'vermelho']) {
    const cand = planos.filter((p) => p.lado === lado && p.confiavel && p.grupos.length);
    const p = cand.find((q) => q.uso > 0) || cand[0];
    if (p) out[lado] = { plano: p.plano, uso: p.usoNome, grupos: p.grupos.map((g) => g.grupo), ordens: p.grupos.map((g) => g.ordens.length) };
  }
  return out;
}

const EH_MAIN = process.argv[1] && /[\\/]ia\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  const alvo = process.argv[2] || 'ZZ QBLARGE BLANK.btt'; const f = /[\\/]/.test(alvo) ? alvo : S + alvo;
  const r = lerPlanos(f);
  console.log(`${alvo}: ${r.W}x${r.H}, regiao ${r.len} B (ancora: ${r.origem}${r.delta != null ? ' delta ' + r.delta : ''}, trailer ${r.trailer}), ${r.planos.length} blocos, confiavel=${r.confiavel}${r.cauda != null ? ', cauda em +' + r.cauda : ''}`);
  r.planos.forEach((p) => { if (!p.grupos.length && p.confiavel) return; console.log(`  ${p.lado} plano ${p.plano} [${p.usoNome}]${p.confiavel ? '' : ' NAO CONFIAVEL'}: ${p.grupos.map((g) => `G${g.grupo}(${g.setup.length}t${g.ordens.length ? '+' + g.ordens.length + 'o' : ''})`).join(' ')}`); });
  console.log('grupos usados:', JSON.stringify(gruposUsados(f)));
}
