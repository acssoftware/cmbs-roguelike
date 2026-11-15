// IMAGE WORK IN PLAIN JAVASCRIPT (17/10/2026): what the app needs to put its own pictures into a battle file without a
// browser or a native module — read a PNG (the map library and the font atlases), write the 24-bit BMP the game wants
// (briefing images, list headers), and draw a little: rectangles, lines, curves and text from a pre-rendered bitmap
// font. `arvoreDoCaminho` draws the campaign's battle tree for the top strip of the briefing (702 x 224).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ------------------------------------------------------------------------------------------ PNG in, BMP out

// A PNG as the library and headless Chrome write them: 8 bits, RGB (2) or RGBA (6), no interlace. -> { w, h, rgba }
export function lerPng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('not a PNG');
  let o = 8, w = 0, h = 0, bits = 0, tipo = 0; const idat = [];
  while (o + 8 <= buf.length) {
    const n = buf.readUInt32BE(o), nome = buf.toString('latin1', o + 4, o + 8); const dados = buf.subarray(o + 8, o + 8 + n);
    if (nome === 'IHDR') { w = dados.readUInt32BE(0); h = dados.readUInt32BE(4); bits = dados[8]; tipo = dados[9]; if (dados[12]) throw new Error('interlaced PNG'); }
    else if (nome === 'IDAT') idat.push(dados);
    else if (nome === 'IEND') break;
    o += 12 + n;
  }
  if (bits !== 8 || (tipo !== 2 && tipo !== 6)) throw new Error(`PNG ${bits} bits, color type ${tipo}: only 8-bit RGB/RGBA`);
  const bpp = tipo === 6 ? 4 : 3, passo = w * bpp;
  const cru = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(w * h * 4);
  let ant = Buffer.alloc(passo), cur = Buffer.alloc(passo);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = cru[y * (passo + 1)], lin = cru.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1));
    for (let i = 0; i < passo; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = ant[i], c = i >= bpp ? ant[i - bpp] : 0, x = lin[i];
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < w; x++) { const s = x * bpp, d = (y * w + x) * 4; rgba[d] = cur[s]; rgba[d + 1] = cur[s + 1]; rgba[d + 2] = cur[s + 2]; rgba[d + 3] = bpp === 4 ? cur[s + 3] : 255; }
    [ant, cur] = [cur, ant];
  }
  return { w, h, rgba };
}

// A 24-bit BMP, bottom-up, BGR, rows padded to 4 bytes: the only format the game's headers and briefing accept.
// `pix` is top-down RGB (3 bytes a pixel) or RGBA (4).
export function bmp24(w, h, pix, canais = 3) {
  const linha = Math.ceil(w * 3 / 4) * 4, n = 54 + linha * h; const b = Buffer.alloc(n);
  b.write('BM', 0, 'latin1'); b.writeUInt32LE(n, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(linha * h, 34);
  b.writeInt32LE(2835, 38); b.writeInt32LE(2835, 42);
  for (let y = 0; y < h; y++) { const o = 54 + (h - 1 - y) * linha; for (let x = 0; x < w; x++) { const s = (y * w + x) * canais; b[o + x * 3] = pix[s + 2]; b[o + x * 3 + 1] = pix[s + 1]; b[o + x * 3 + 2] = pix[s]; } }
  return b;
}
export const pngParaBmp = (buf) => { const p = lerPng(buf); return bmp24(p.w, p.h, p.rgba, 4); };

// ------------------------------------------------------------------------------------------ the canvas

const hex = (c) => (typeof c === 'string' ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] : c);
export class Tela {
  constructor(w, h, fundo = '#10130e') {
    this.w = w; this.h = h; this.px = Buffer.alloc(w * h * 3); const c = hex(fundo);
    for (let i = 0; i < w * h; i++) { this.px[i * 3] = c[0]; this.px[i * 3 + 1] = c[1]; this.px[i * 3 + 2] = c[2]; }
  }
  ponto(x, y, cor, a = 1) {
    x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3, c = hex(cor);
    if (a >= 1) { this.px[o] = c[0]; this.px[o + 1] = c[1]; this.px[o + 2] = c[2]; return; }
    for (let k = 0; k < 3; k++) this.px[o + k] = Math.round(this.px[o + k] * (1 - a) + c[k] * a);
  }
  cor(x, y) { const o = ((y | 0) * this.w + (x | 0)) * 3; return [this.px[o], this.px[o + 1], this.px[o + 2]]; }
  rect(x, y, w, h, cor, a = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.ponto(x + i, y + j, cor, a); }
  // the border of a rectangle; `traco` > 0 draws it dashed (traco on, traco off)
  moldura(x, y, w, h, cor, esp = 1, traco = 0) {
    const liga = (k) => !traco || (k % (traco * 2)) < traco;
    for (let e = 0; e < esp; e++) {
      for (let i = 0; i < w; i++) if (liga(i)) { this.ponto(x + i, y + e, cor); this.ponto(x + i, y + h - 1 - e, cor); }
      for (let j = 0; j < h; j++) if (liga(j)) { this.ponto(x + e, y + j, cor); this.ponto(x + w - 1 - e, y + j, cor); }
    }
  }
  linha(x1, y1, x2, y2, cor, esp = 1) {
    x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1), sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1; let err = dx - dy;
    const r = Math.floor((esp - 1) / 2), r2 = esp - 1 - r;
    for (;;) {
      if (esp === 1) this.ponto(x1, y1, cor); else for (let j = -r; j <= r2; j++) for (let i = -r; i <= r2; i++) this.ponto(x1 + i, y1 + j, cor);
      if (x1 === x2 && y1 === y2) break;
      const e2 = 2 * err; if (e2 > -dy) { err -= dy; x1 += sx; } if (e2 < dx) { err += dx; y1 += sy; }
    }
  }
  // a cubic Bezier sampled into short lines
  curva(x1, y1, cx1, cy1, cx2, cy2, x2, y2, cor, esp = 1, n = 24) {
    let px = x1, py = y1;
    for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; const x = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2, y = u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2; this.linha(px, py, x, y, cor, esp); px = x; py = y; }
  }
  larguraTexto(atlas, s) { let w = 0; for (const ch of String(s)) { const g = atlas.glifos[ch] || atlas.glifos['?']; if (g) w += g[2]; } return w; }
  // `y` is the top of the line; `alinhar`: 'esq' (default), 'centro', 'dir'
  texto(atlas, s, x, y, cor, { alinhar = 'esq' } = {}) {
    const larg = this.larguraTexto(atlas, s); let cx = alinhar === 'centro' ? x - larg / 2 : alinhar === 'dir' ? x - larg : x; cx = Math.round(cx);
    const img = atlas.img; const c = hex(cor);
    for (const ch of String(s)) {
      const g = atlas.glifos[ch] || atlas.glifos['?']; if (!g) continue;
      for (let j = 0; j < atlas.altura; j++) for (let i = 0; i < g[1]; i++) {
        const cov = img.rgba[((j * img.w) + g[0] + i) * 4] / 255; if (cov > 0.04) this.ponto(cx + i, y + j, c, cov);
      }
      cx += g[2];
    }
    return larg;
  }
  bmp() { return bmp24(this.w, this.h, this.px); }
}

// A bitmap font: <nome>.png (white glyphs on black, coverage in the red channel) + <nome>.json
// { altura, glifos: { "A": [x, largura, avanco] } }, made once by tools/re/fonte_atlas.mjs.
const atlases = new Map();
export function atlas(pasta, nome) {
  const chave = path.join(pasta, nome); if (atlases.has(chave)) return atlases.get(chave);
  const meta = JSON.parse(fs.readFileSync(chave + '.json', 'utf8')); const img = lerPng(fs.readFileSync(chave + '.png'));
  const a = { ...meta, img }; atlases.set(chave, a); return a;
}

// ------------------------------------------------------------------------------------------ the battle tree

export const CORES = { bg: '#10130e', panel: '#1a1f16', line: '#3a422f', ink: '#ecefe6', dim: '#b4bca8', faint: '#8b937f', accent: '#d9b444', band: '#121610', bandAlt: '#0c0f0a', played: '#6d5d26', chosenBg: '#262412' };
// so o encontro ganha sigla (23/10: a batalha comum nao tem mais tipo)
const ABREV = { Meet: 'ME' };

// THE CAMPAIGN'S BATTLE TREE for the briefing (702 x 224): Start on the left, the last battle on the right, one column
// per row of the path, the path's columns as lanes; tier bands; played nodes filled brass, the current one bordered
// brass, the next ones dashed; the route in brass. Map names and enemies stay secret (not drawn). `n` = this battle,
// `at` = its node. Without a path, a plain plate with the campaign name.
// `atual` = the node of the battle being built (makeBattle runs before the path moves to it); default the path's `at`
export function arvoreDoCaminho({ path: P, nome, n, atual = null, total = 12, rules, fontes, w = 702, h = 224 }) {
  const T = new Tela(w, h, CORES.bg); const f11 = fontes.f11, f13 = fontes.f13, f18 = fontes.f18;
  const titulo = `${String(nome || 'CMBS ROGUELIKE').toUpperCase()}`;
  if (!P?.nodes?.length) {
    T.rect(0, 0, w, h, CORES.bg); T.moldura(6, 6, w - 12, h - 12, CORES.line, 1);
    T.texto(f18, 'CMBS ROGUELIKE', w / 2, 70, CORES.accent, { alinhar: 'centro' });
    T.texto(f13, titulo, w / 2, 110, CORES.ink, { alinhar: 'centro' });
    T.texto(f13, `BATTLE ${n} OF ${total}`, w / 2, 134, CORES.dim, { alinhar: 'centro' });
    return T;
  }
  const rows = P.rows || total, cols = P.columns || 4;
  const x0 = 46, x1 = w - 30, passo = (x1 - x0) / rows; const colX = (r) => Math.round(x0 + r * passo);
  const yTopo = 30, yBase = h - 26; const laneY = (c) => Math.round(yTopo + (cols === 1 ? (yBase - yTopo) / 2 : 10 + c * ((yBase - yTopo - 20) / (cols - 1))));
  // tier bands
  (rules?.tiers || []).forEach((t, k) => {
    const a = t.battles[0], b = t.battles[t.battles.length - 1];
    T.rect(Math.round(colX(a) - passo / 2), yTopo - 4, Math.round(passo * (b - a + 1)), yBase - yTopo + 8, k % 2 ? CORES.bandAlt : CORES.band);
    T.texto(f11, `TIER ${t.tier}`, Math.round(colX(a) - passo / 2 + passo * (b - a + 1) / 2), h - 18, CORES.faint, { alinhar: 'centro' });
  });
  const NW = 38, NH = 22; const at = atual || P.at, route = new Set([...(P.route || []), at]), chosen = atual && atual !== P.at ? null : P.chosen;
  const porId = new Map(P.nodes.map((x) => [x.id, x])); const noAt = porId.get(at);
  const filhos = new Set(noAt?.edges || []);
  const centro = (x) => [colX(x.row), x.id === 'start' ? laneY((cols - 1) / 2) : laneY(x.col)];
  const rota = [...(P.route || [])]; if (rota[rota.length - 1] !== at) rota.push(at);
  const consecutivos = (a, b) => { const i = rota.indexOf(a); return i >= 0 && rota[i + 1] === b; };
  // edges first, route and chosen on top
  const arestas = []; for (const x of P.nodes) for (const e of x.edges || []) if (porId.has(e)) arestas.push([x, porId.get(e)]);
  const prio = (a, b) => (consecutivos(a.id, b.id) ? 2 : a.id === at && b.id === chosen ? 2 : a.id === at ? 1 : 0);
  arestas.sort((p, q) => prio(...p) - prio(...q));
  for (const [a, b] of arestas) {
    const [ax, ay] = centro(a), [bx, by] = centro(b); const sx = ax + NW / 2, ex = bx - NW / 2, mid = (sx + ex) / 2;
    const naRota = consecutivos(a.id, b.id), escolhida = a.id === at && b.id === chosen, proxima = a.id === at;
    T.curva(sx, ay, mid, ay, mid, by, ex, by, naRota || escolhida ? CORES.accent : proxima ? CORES.dim : CORES.line, naRota || escolhida ? 2 : 1);
  }
  for (const x of P.nodes) {
    const [cx, cy] = centro(x); const X = cx - NW / 2, Y = cy - NH / 2;
    const jogado = route.has(x.id) && x.id !== at, atual = x.id === at, proximo = filhos.has(x.id), escolhido = x.id === chosen;
    if (jogado) { T.rect(X, Y, NW, NH, CORES.accent); }
    else { T.rect(X, Y, NW, NH, atual || escolhido ? CORES.chosenBg : CORES.panel); T.moldura(X, Y, NW, NH, atual || escolhido ? CORES.accent : proximo ? CORES.dim : CORES.line, atual ? 2 : 1, proximo && !escolhido ? 3 : 0); }
    const rotulo = x.id === 'start' ? 'START' : `B${x.row} ${ABREV[x.kind] || ''}`.trim();
    T.texto(f11, rotulo, cx, Y + 5, jogado ? '#16130a' : atual || escolhido || proximo ? CORES.ink : CORES.faint, { alinhar: 'centro' });
  }
  T.texto(f13, `${titulo}  -  BATTLE ${n} OF ${total}`, 10, 7, CORES.ink);
  T.texto(f11, 'CMBS ROGUELIKE', w - 10, 9, CORES.accent, { alinhar: 'dir' });
  return T;
}
