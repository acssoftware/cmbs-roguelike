// PARSER do bloco do mapa (secoes 69-78). Le, na corrente completa:
//   - cabecalho OX OY W H (canvas em tiles; tile = 8 m)
//   - categorias de objeto em sequencia: contador u32 + registros
//       . construcoes (secao 77/78): registro = 13 bytes de cabecalho | count u32 | count*16 bytes
//         (as 4 paredes por unidade — janela/porta/cor, que nao decodificamos); comprimento =
//         17 + 16*count. Posicao em meio-tiles de canvas: tile = X/2 - OX, Y/2 - OY.
//       . (categoria do meio, ainda nao identificada)
//       . flavor objects (secao 76): registro de 8 bytes | u16 categoria | u16 tipo | u16 X | u16 Y
//   - grade 5 bytes/tile: byte0 tipo (secao 74), byte2 foliage, byte3 flags (0x40 = foliage),
//     byte4 zona de setup (3 bits altos, 1..6)
//   - camada 4 bytes/tile: elevacao u16 decimetros + flags u16 (secao 71)
//
// A grade e ancorada pela heuristica de `zonas.grade`; as construcoes sao lidas para frente a
// partir do 1o contador. Validado: contagem e posicao batem em Podlypyky (vila), QBSMALL (496
// casas), City (235), e no laboratorio.
import { ler } from './transplante.mjs';
import { expandir } from './escape.mjs';
import { dimensoes, grade } from './zonas.mjs';

// Le a lista de construcoes a partir do 1o contador (base = pos de W,H + 4).
export function construcoes(c, base, OX, OY) {
  const n = c.readUInt32LE(base);
  let o = base + 4; const out = [];
  for (let i = 0; i < n; i++) {
    if (o + 17 > c.length) throw new Error(`construcao ${i}: estourou o buffer em ${o}`);
    const sub = c[o], X = c.readUInt16LE(o + 1), Y = c.readUInt16LE(o + 3);
    const count = c.readUInt32LE(o + 13);
    if (count < 0 || count > 64) throw new Error(`construcao ${i} @${o}: count implausivel ${count} (${c.subarray(o, o + 18).toString('hex')})`);
    out.push({ sub, X, Y, count, len: 17 + 16 * count, off: o, tileX: Math.round(X / 2 - OX), tileY: Math.round(Y / 2 - OY) });
    o += 17 + 16 * count;
  }
  return { construcoes: out, fim: o, n };
}

// Alinha a grade: a heuristica de `grade()` erra a fase por +-1 conforme o mapa (secao 79). O
// inicio verdadeiro e o offset perto dela que deixa TODOS os byte0 na faixa do catalogo (<=46).
export function alinharGrade(c, W, H, G0) {
  let best = G0, bestOk = -1;
  for (let dG = -3; dG <= 3; dG++) {
    const G = G0 + dG; if (G < 0) continue;
    let ok = 0; for (let t = 0; t < W * H; t++) if (c[G + 5 * t] <= 46) ok++;
    if (ok > bestOk) { bestOk = ok; best = G; }
  }
  return { G: best, fracaoOk: bestOk / (W * H) };
}

// Categoria do meio (secao 80): contador u32 + registros de 7 bytes `tipo u8 | X u16 | Y u16 |
// 2 bytes`. Poucos por mapa (Podlypyky 3, City 4, QBSMALL 0) — provavel Bridges. E flavor (secao
// 76): contador u32 + registros de 8 bytes. Andar as tres categorias localiza a grade SEM
// heuristica (validado contra a ancora de elevacao em todo mapa de laboratorio e contra o
// Podlypyky). E a forma correta; `alinharGrade` fica so de fallback para cenarios que nao andam.
export function meioEFlavor(c, o) {
  const nMeio = c.readUInt32LE(o); o += 4;
  const meio = []; for (let i = 0; i < nMeio; i++) { meio.push({ tipo: c[o], X: c.readUInt16LE(o + 1), Y: c.readUInt16LE(o + 3), off: o }); o += 7; }
  const nFlavor = c.readUInt32LE(o); o += 4;
  const flavor = []; for (let i = 0; i < nFlavor; i++) { flavor.push({ cat: c.readUInt16LE(o), tipo: c.readUInt16LE(o + 2), X: c.readUInt16LE(o + 4), Y: c.readUInt16LE(o + 6), off: o }); o += 8; }
  return { meio, flavor, fim: o };
}

// ACHAR O CABECALHO `OX OY W H` de forma AUTO-VALIDADA (secao 83). `zonas.dimensoes` aceitava o
// primeiro par plausivel e errava em 192 dos 360 mapas de QB (OX de 54718 num canvas de 1024, W,H
// deslocados de um u16). Aqui as restricoes do canvas entram (OX,OY < 1024 e OX+W, OY+H <= 1024)
// e, sobretudo, o candidato so vale se as 3 categorias de objeto ANDAREM ate uma grade sadia.
export function acharCabecalho(c) {
  for (let i = 240; i < 460; i++) {
    const OX = c.readUInt16LE(i - 4), OY = c.readUInt16LE(i - 2), W = c.readUInt16LE(i), H = c.readUInt16LE(i + 2);
    // ate 1024 tiles (05/10, E146): o Huge Novohurivka-Open Meet tem 688 de largura (5504 m); o canvas de 1024 ja limita
    if (!(W >= 20 && W <= 1024 && H >= 20 && H <= 1024 && W % 2 === 0 && H % 2 === 0)) continue;
    if (!(OX < 1024 && OY < 1024 && OX + W <= 1024 && OY + H <= 1024)) continue;
    try {
      const b = construcoes(c, i + 4, OX, OY);
      const mf = meioEFlavor(c, b.fim);
      if (mf.fim + 9 * W * H > c.length) continue;
      let ok = 0; for (let t = 0; t < W * H; t++) if (c[mf.fim + 5 * t] <= 46) ok++;
      if (ok / (W * H) >= 0.95) return { OX, OY, W, H, pos: i, b, mf };
    } catch { /* candidato invalido */ }
  }
  return null;
}

// INDEXA a grade tile a tile (secao 92): o stride NAO e fixo. Um tile com o bit 0x80 no byte0 e um
// LANDMARK (rotulo de texto do mapa): a tupla de 5 bytes e seguida de `u16 len | texto`
// ("Podlypyky", "HWY H-11"...). ~80 dos 360 mapas de QB tem pelo menos um. Devolve o offset de
// cada tile, os landmarks e o fim da grade (= inicio da elevacao, que vai de la ate a camera).
// Um rotulo tem de PARECER texto: so ASCII imprimivel (com NULs de enchimento no fim, como
// "Zhorstok\0\0") e ao menos duas letras. Sem isso, tuplas de tile viram falsos landmarks e
// desalinham tudo o que vem depois (foi o que aconteceu com os mapas `Village 001/004`, secao 93).
const NOME_PLAUSIVEL = (c, o, len) => {
  let letras = 0;
  for (let i = 0; i < len; i++) { const b = c[o + i]; if (b === 0) continue; if (b < 0x20 || b > 0x7e) return false; if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122)) letras++; }
  return letras >= 2;
};
export function indexarGrade(c, G, W, H) {
  const WH = W * H; const offsets = new Int32Array(WH); const landmarks = []; let o = G;
  for (let t = 0; t < WH; t++) {
    if (o + 5 > c.length) { offsets.fill(Math.min(o, c.length - 5), t); return { offsets, landmarks, fim: null }; }   // grade mal ancorada (fallback)
    offsets[t] = o;
    if ((c[o] & 0x80) && o + 7 <= c.length) { const len = c.readUInt16LE(o + 5); if (len >= 1 && len <= 64 && o + 7 + len <= c.length && NOME_PLAUSIVEL(c, o + 7, len)) { landmarks.push({ x: t % W, y: Math.floor(t / W), nome: c.toString('latin1', o + 7, o + 7 + len).replace(/\0+$/, '') }); o += 7 + len; continue; } }
    o += 5;
  }
  return { offsets, landmarks, fim: o };
}
// Stride fixo de 5 B (sem landmarks): para grades de fallback, onde a indexacao nao e confirmada.
function indiceFixo(G, W, H) { const WH = W * H; const offsets = new Int32Array(WH); for (let t = 0; t < WH; t++) offsets[t] = G + 5 * t; return { offsets, landmarks: [], fim: G + 5 * WH };
}
// A regiao de IA (secao 91) comeca em fimGrade + 4*W*H + 48 com `u32 len | u32 5 | u16 uso | u32 16`:
// e a prova deterministica de que a grade foi lida certa (inclusive os landmarks).
const IA_CONFERE = (c, fimGrade, W, H) => { const h = fimGrade + 4 * W * H + 52; return h + 10 <= c.length && c.readUInt32LE(h) === 5 && c.readUInt16LE(h + 4) <= 3 && c.readUInt32LE(h + 6) === 16; };
// Indexada se a regiao de IA confirmar; senao stride fixo (que tambem so vale se confirmar).
// Se nenhum dos dois confirmar, o inicio da grade pode estar 1-2 bytes fora (o fim das categorias
// de objeto erra em alguns mapas): tenta shifts, sempre exigindo a confirmacao da IA — e prova, nao
// heuristica. Recupera 10 mapas e revela rotulos que estavam sendo comidos ("Hospital", "HWY P09").
// O fim da regiao de IA na corrente completa, sem passar por `ler` (que chama isto; E169). null se nao achar.
export function fimDaRegiaoIA(c) {
  const achado = acharCabecalho(c); if (!achado) return null;
  const ix = escolherIndice(c, achado.mf.fim, achado.W, achado.H); if (ix.fim == null) return null;
  const ini = ix.fim + 4 * achado.W * achado.H + 48;
  if (ini + 10 > c.length || !IA_CONFERE(c, ix.fim, achado.W, achado.H)) return null;
  return ini + 4 + c.readUInt32LE(ini);
}

function escolherIndice(c, G0, W, H) {
  const tenta = (G) => {
    const ix = indexarGrade(c, G, W, H);
    if (ix.fim != null && IA_CONFERE(c, ix.fim, W, H)) return { ...ix, G };
    const fx = indiceFixo(G, W, H);
    if (IA_CONFERE(c, fx.fim, W, H)) return { ...fx, G };
    return null;
  };
  const r0 = tenta(G0); if (r0) return r0;
  for (let d = 1; d <= 8; d++) for (const G of [G0 - d, G0 + d]) { if (G < 0) continue; const r = tenta(G); if (r) return r; }
  const ix = indexarGrade(c, G0, W, H);
  return { ...(ix.fim != null ? ix : indiceFixo(G0, W, H)), G: G0 };
}

export function lerMapa(caminho) {
  const d = ler(caminho); const c = expandir(d.cru, d.tokens).completo;
  const achado = acharCabecalho(c);
  if (achado) {
    const ix = escolherIndice(c, achado.mf.fim, achado.W, achado.H);
    return { c, W: achado.W, H: achado.H, OX: achado.OX, OY: achado.OY, posWH: achado.pos,
             gridStart: ix.G, gridDeterminada: true, offsets: ix.offsets, landmarks: ix.landmarks, fimGrade: ix.fim,
             iaConfere: ix.fim != null && IA_CONFERE(c, ix.fim, achado.W, achado.H),
             construcoes: achado.b.construcoes, fimConstrucoes: achado.b.fim,
             meio: achado.mf.meio, flavor: achado.mf.flavor };
  }
  const dim = dimensoes(c);
  // Mapas de QB: contador de construcoes em W,H+4. Mapas de CENARIO tem campos extras antes do
  // contador (secao 80), entao a leitura para frente falha; nesse caso caimos no fallback sem
  // estourar. `b` pode nao existir.
  let b = null;
  try { b = construcoes(c, dim.pos + 4, dim.OX, dim.OY); } catch { /* cenario: formato de header proprio */ }
  let gridStart = null, meio = [], flavor = [], determinada = false;
  if (b) {
    try {
      const mf = meioEFlavor(c, b.fim);
      let ok = 0; for (let t = 0; t < dim.W * dim.H; t++) if (c[mf.fim + 5 * t] <= 46) ok++;
      if (ok / (dim.W * dim.H) >= 0.95) { gridStart = mf.fim; meio = mf.meio; flavor = mf.flavor; determinada = true; }
    } catch { /* cai no fallback */ }
  }
  if (gridStart == null) { try { gridStart = alinharGrade(c, dim.W, dim.H, grade(c).G).G; } catch {} }
  // Grade de fallback: a indexacao de landmarks so vale se a regiao de IA confirmar; senao stride fixo.
  const ix = gridStart != null ? escolherIndice(c, gridStart, dim.W, dim.H) : { offsets: null, landmarks: [], fim: null, G: gridStart };
  return { c, W: dim.W, H: dim.H, OX: dim.OX, OY: dim.OY, posWH: dim.pos, gridStart: ix.G, gridDeterminada: determinada,
           offsets: ix.offsets, landmarks: ix.landmarks, fimGrade: ix.fim, iaConfere: ix.fim != null && IA_CONFERE(c, ix.fim, dim.W, dim.H),
           construcoes: b ? b.construcoes : [], fimConstrucoes: b ? b.fim : null, meio, flavor };
}

// Le a grade por tile: {tipo (byte0 & 0x7f, secao 74), estrada (byte1, secao 79: 0=nenhuma), foliage
// (byte2), foliageFlag (byte3 & 0x40), zona (byte4>>5, secao 72), landmark (bit 0x80 do byte0)}.
// Usa os offsets indexados (stride variavel por causa dos landmarks, secao 92).
export function lerGrade(m) {
  if (m.gridStart == null) throw new Error('grade nao alinhada');
  const { c, W, H } = m; const off = m.offsets || indexarGrade(c, m.gridStart, W, H).offsets;
  const tile = (x, y) => { const o = off[y * W + x]; return { tipo: c[o] & 0x7f, estrada: c[o + 1], foliage: c[o + 2], foliageFlag: (c[o + 3] & 0x40) !== 0, zona: c[o + 4] >> 5, landmark: (c[o] & 0x80) !== 0 }; };
  return { tile, W, H };
}

// Render de uma camada da grade em ASCII (norte em cima). `campo`: 'estrada' | 'zona' | 'foliage'
// | 'tipo'. Estrada/foliage: 'R'/'f' se !=0. Zona: 1..6. Tipo: letra do byte.
export function renderGrade(m, campo = 'estrada', largura = 100) {
  const g = lerGrade(m); const passo = Math.max(1, Math.ceil(m.W / largura)); const linhas = [];
  for (let y = m.H - 1; y >= 0; y -= passo) {
    let s = '';
    for (let x = 0; x < m.W; x += passo) {
      let v = 0; for (let dy = 0; dy < passo; dy++) for (let dx = 0; dx < passo; dx++) { const t = g.tile(x + dx, y - dy); v = Math.max(v, campo === 'foliageFlag' ? (t.foliageFlag ? 1 : 0) : t[campo] || 0); }
      s += campo === 'zona' ? (v || '.') : (campo === 'estrada' ? (v ? 'R' : '.') : (campo === 'foliage' ? (v ? 'f' : '.') : (v ? (v < 36 ? '#' : '~') : '.')));
    }
    linhas.push(s);
  }
  return linhas.join('\n');
}

// Grade de ocupacao de construcoes: quantas construcoes ancoram em cada tile.
export function gridConstrucoes(m) {
  const g = Array.from({ length: m.H }, () => new Array(m.W).fill(0));
  let fora = 0;
  for (const b of m.construcoes) {
    if (b.tileX >= 0 && b.tileX < m.W && b.tileY >= 0 && b.tileY < m.H) g[b.tileY][b.tileX]++;
    else fora++;
  }
  return { g, fora };
}

// Render ASCII (norte em cima): '.' vazio, 'o' 1 construcao, '#' 2+.
export function renderConstrucoes(m, largura = 100) {
  const { g } = gridConstrucoes(m);
  const passo = Math.max(1, Math.ceil(m.W / largura));
  const linhas = [];
  for (let y = m.H - 1; y >= 0; y -= passo) {
    let s = '';
    for (let x = 0; x < m.W; x += passo) {
      let v = 0; for (let dy = 0; dy < passo; dy++) for (let dx = 0; dx < passo; dx++) v += (g[y - dy]?.[x + dx] || 0);
      s += v === 0 ? '.' : (v < 2 ? 'o' : '#');
    }
    linhas.push(s);
  }
  return linhas.join('\n');
}

const EH_MAIN = process.argv[1] && /[\\/]mapa\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  const alvo = process.argv[2] || 'ZZ QBSMALL ALL.btt';
  const m = lerMapa(/[\\/]/.test(alvo) ? alvo : S + alvo);
  const { fora } = gridConstrucoes(m);
  console.log(`${alvo}: ${m.W}x${m.H} (OX${m.OX} OY${m.OY}) | ${m.construcoes.length} construcoes, ${fora} fora do mapa`);
  console.log(renderConstrucoes(m, 100));
}
