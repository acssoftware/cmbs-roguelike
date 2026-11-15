// VER UM PLANO DE IA SOBRE O MAPA (06/10/2026): PNG de revisao — o terreno da galeria ampliado, grade a cada 10 tiles
// (linha forte a cada 50), pintura de setup (azul/vermelho), objetivos de pontuacao (amarelo), triggers (contorno
// magenta) e, por cima, as zonas de IA pedidas em cores. Norte em cima; o tile (0,0) e o canto inferior esquerdo.
//   node tools/re/ia_ver.mjs "<mapa.btt>" <saida.png> [--plano azul|vermelho] [--grupos 1,2,5] [--n 1] [--escala 6]
//   camadas: o Setup de cada grupo pedido em cor cheia leve; as ordens do grupo em contorno da mesma cor.
import fs from 'node:fs';
import { desenhar, png } from './galeria_mapas.mjs';
import { decodificar, doMapa } from './ia_escrever.mjs';

export const CORES = [[230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230],
  [210, 245, 60], [250, 190, 212], [0, 128, 128], [220, 190, 255], [170, 110, 40], [255, 250, 200], [128, 0, 0], [170, 255, 195]];

// camadas: [{ tiles: [[x,y]...], cor: [r,g,b], cheio: alfa 0..1 | 0, contorno: true|false }]
export function verPlano(arquivo, camadas = [], { escala = 6, objetivos = true, triggers = true } = {}) {
  const r = desenhar(arquivo); const { W, H } = r; const s = escala;
  const w = W * s, h = H * s; const img = Buffer.alloc(w * h * 4);
  // terreno (r.img esta a 2 px por tile) e a pintura de setup por cima
  const zonas = Buffer.alloc(r.w * r.h * 4);
  { const z = desenhar(arquivo); }   // (as zonas da galeria vem num PNG; recalculamos abaixo pela grade)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(r.w - 1, Math.floor(x / s * 2)), sy = Math.min(r.h - 1, Math.floor(y / s * 2));
    const o = (y * w + x) * 4, so = (sy * r.w + sx) * 4; img[o] = r.img[so]; img[o + 1] = r.img[so + 1]; img[o + 2] = r.img[so + 2]; img[o + 3] = 255;
  }
  const mistura = (tx, ty, cor, a, so = null) => {
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      if (so && !so(i, j)) continue;
      const px = tx * s + i, py = (H - 1 - ty) * s + j; if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const o = (py * w + px) * 4; for (let k = 0; k < 3; k++) img[o + k] = Math.round(img[o + k] * (1 - a) + cor[k] * a);
    }
  };
  const contorno = (tiles, cor, a = 1, grossura = 1) => {
    const set = new Set(tiles.map((t) => t.join()));
    for (const [x, y] of tiles) {
      const n = !set.has(`${x},${y + 1}`), sul = !set.has(`${x},${y - 1}`), l = !set.has(`${x + 1},${y}`), o = !set.has(`${x - 1},${y}`);
      if (n || sul || l || o) mistura(x, y, cor, a, (i, j) => (n && j < grossura) || (sul && j >= s - grossura) || (o && i < grossura) || (l && i >= s - grossura));
    }
  };
  const d = decodificar(arquivo);
  // pintura de setup: pela grade do proprio mapa
  const { lerMapa, lerGrade } = await_mapa;
  const g = lerGrade(lerMapa(arquivo));
  const azul = [], verm = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = g.tile(x, y).zona; if (v) (v <= 3 ? azul : verm).push([x, y]); }
  for (const [x, y] of azul) mistura(x, y, [60, 110, 230], 0.18);
  for (const [x, y] of verm) mistura(x, y, [230, 60, 50], 0.22);
  contorno(azul, [40, 90, 230], 0.9, 2); contorno(verm, [220, 40, 40], 0.9, 2);
  if (objetivos) for (const v of d.vagas) if (v.tiles.length && v.tipo <= 4) contorno(doMapa(d, v.tiles), [255, 230, 0], 1, 2);
  if (triggers) for (const v of d.vagas) if (v.tiles.length && v.tipo >= 5 && v.tipo <= 8 && v.lado === 'azul') contorno(doMapa(d, v.tiles), [255, 0, 255], 0.7, 1);
  for (const c of camadas) {
    if (c.cheio) for (const [x, y] of c.tiles) mistura(x, y, c.cor, c.cheio);
    if (c.contorno !== false) contorno(c.tiles, c.cor, 1, c.grossura || 2);
    if (c.ponto) mistura(c.ponto[0], c.ponto[1], c.cor, 1);
  }
  // grade: a cada 10 tiles fina, a cada 50 forte
  for (let t = 0; t <= Math.max(W, H); t += 10) {
    const a = t % 50 === 0 ? 0.55 : 0.25;
    if (t <= W) for (let y = 0; y < h; y++) { const px = Math.min(w - 1, t * s); const o = (y * w + px) * 4; for (let k = 0; k < 3; k++) img[o + k] = Math.round(img[o + k] * (1 - a)); }
    if (t <= H) for (let x = 0; x < w; x++) { const py = Math.min(h - 1, (H - t) * s); const o = (py * w + x) * 4; for (let k = 0; k < 3; k++) img[o + k] = Math.round(img[o + k] * (1 - a)); }
  }
  return png(w, h, img);
}
const await_mapa = await import('./mapa.mjs');

// as camadas de um plano de IA (lado/n) para os grupos pedidos
export function camadasDoPlano(arquivo, { lado = 'azul', n = 1, grupos = null } = {}) {
  const d = decodificar(arquivo); const pl = d[lado][n - 1]; const out = [];
  pl.slots.forEach((s, g) => {
    if (grupos && !grupos.includes(g + 1)) return;
    const cor = CORES[g % CORES.length];
    s.forEach((e, k) => { if (e.tiles.length) out.push({ grupo: g + 1, k, tiles: doMapa(d, e.tiles), cor, cheio: k === 0 ? 0.35 : 0, contorno: true, grossura: k === 0 ? 1 : 2 }); });
  });
  return out;
}

if (process.argv[1] && /ia_ver\.mjs$/.test(process.argv[1])) {
  const [arq, saida] = process.argv.slice(2);
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const grupos = arg('--grupos') ? arg('--grupos').split(',').map(Number) : null;
  const cam = arg('--plano') ? camadasDoPlano(arq, { lado: arg('--plano'), n: +(arg('--n') || 1), grupos }) : [];
  fs.writeFileSync(saida, verPlano(arq, cam, { escala: +(arg('--escala') || 6) }));
  console.log(saida, cam.length, 'camadas');
}
