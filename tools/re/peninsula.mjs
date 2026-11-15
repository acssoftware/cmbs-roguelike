// A PENINSULA DO PORTO (02/10) — o primeiro mapa inventado, sem cidade real por baixo. O desenho e o
// esboco que o autor aprovou (research/esbocos/peninsula_do_porto.html): peninsula com porto e cidade de
// porte medio, zona industrial com refinaria, centro de predios com praca, bairros de casas espacadas e,
// fora do mar, fazendas e matas. Sem IA propria: os planos sao os da base, com as zonas e os triggers
// realocados para os objetivos novos (o mesmo do Mucuge, E86).
//
// BASE: `Open-Hills (1248 X 1200) 314 Assault.btt`, 156 x 150 tiles — a mais proxima do esboco
// (1296 x 1104 m) entre as bases que o escritor aceita (a de 1200 x 1136 nao confirma a grade). O
// defensor dela esta a OESTE e o atacante a LESTE, entao o esboco entra ESPELHADO: porto e peninsula a
// oeste, fazendas a leste, o jogador ataca do leste. A geometria e escrita nas coordenadas do esboco
// (metros, x para leste, y para o SUL, como no SVG) e convertida aqui.
//
// O que ja estava provado e e reaproveitado: escritor de pecas (FORMATO 94), grade com terreno, estrada
// em peca e rotacao, folhagem e zona (120), elevacao coluna a coluna (71.1) com todo tile manual,
// predios por registro copiado do catalogo do editor (E86), objetivos e zonas de IA trocados no lugar.
// Novo aqui: o MAR (Water plano no nivel da base) e os galpoes da fabrica do Podlypyky como industria.
//
//   node tools/re/peninsula.mjs [saida.btt]
import fs from 'node:fs';
import { escrever, montarGrade, montarElevacao, montarConstrucoes, montarPontesFlavor, moldes, pecas, montarRuas } from './mapa_escrever.mjs';
import { lerMapa } from './mapa.mjs';
import { lerPlanos } from './ia.mjs';
import { listasDeObjetivos, ehTrigger } from './gatilhos.mjs';

const GF = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const QB = GF + 'Quick Battle Maps/';
const BASE = QB + 'Open-Hills (1248 X 1200) 314 Assault.btt';
const FABRICA = QB + 'Podlypyky-Rough (1936 X 1808) 088 Assault.btt';
const W = 156, H = 150;
const SW = 1296, SH = 1104;                       // o esboco, em metros

// --- esboco -> tile (espelhado: o leste do esboco e o oeste do mapa; y do esboco cresce para o sul) ---
const KX = (W * 8) / SW, KY = (H * 8) / SH;
const tx = (sx) => ((SW - sx) * KX) / 8;
const ty = (sy) => ((SH - sy) * KY) / 8;
const T = ([sx, sy]) => [tx(sx), ty(sy)];
// e o caminho de volta: o ponto do esboco no centro de um tile
const sxDe = (x) => SW - ((x + 0.5) * 8) / KX;
const syDe = (y) => SH - ((y + 0.5) * 8) / KY;

// --- paleta (research/terreno_catalogo.json, E86) ---
const GRASS = 7, GRASS_Y = 8, CLOVER = 9, GRASS_T = 11, WEEDS = 13, DIRT = 0, SAND = 6, MUD = 16,
  PAV1 = 18, PAV2 = 19, GRAVEL = 20, DIRT_LOT = 21, COBBLE = 29, LT_FOREST = 38, HVY_FOREST = 39,
  HEAVY_ROCKS = 41, PLOW = [25, 26], CROP = [31, 32, 33, 34, 35, 36], WATER = 28, MARSH = 17;
const EST = { dirt: 1, gravel: 10, pav1: 19, pav2: 28, rail: 55, stream: 64 };
const PESO = { [EST.pav1]: 7, [EST.pav2]: 6, [EST.gravel]: 5, [EST.dirt]: 4, [EST.rail]: 3, [EST.stream]: 2 };
// folhagem: especie + 1 no array (0 = nada). Tree A..H 0..7, Bush A..C 8..10.
const FOLHOSA = [0, 2, 3], NOVA = 6, ARBUSTO = [8, 9, 10];

// --- a geografia do esboco -----------------------------------------------------------------------
const TERRA = [[0, 0], [600, 0], [640, 110], [610, 210], [650, 300], [760, 285], [880, 310], [990, 370], [1040, 470], [1035, 610], [1000, 705], [900, 775], [770, 830], [660, 860], [610, 920], [640, 1010], [600, 1104], [0, 1104]];
const RIACHO = [[320, 1104], [340, 1000], [370, 930], [400, 860], [430, 800], [450, 750], [480, 680], [500, 620], [520, 560], [530, 520], [545, 450], [555, 410], [570, 340], [580, 300], [612, 212]];
const RODOVIA = [[0, 560], [520, 560], [654, 552], [942, 552], [1012, 556]];
const NORTE = [[600, 552], [600, 330], [700, 318], [800, 330], [900, 345], [985, 390]];
// a ferrovia em RETA: a curva de trilho (estrada 58) nenhum dos 333 mapas reais usa (envelope_mapas)
const FERROVIA = [[0, 366], [905, 366]];
const SUL = [[470, 560], [480, 700], [560, 790], [660, 835], [780, 812], [900, 762], [990, 700]];
const TRILHAS = [[[270, 40], [270, 1060]], [[410, 100], [410, 1000]], [[0, 222], [540, 222]], [[0, 760], [480, 760]]];
const RUAS_BAIRRO = [[[565, 440], [654, 440]], [[565, 760], [905, 760]], [[610, 335], [610, 545]], [[610, 565], [610, 850]], [[700, 330], [700, 424]], [[800, 680], [800, 812]], [[880, 680], [880, 770]]];
const CORE_X = [654, 726, 798, 870, 942], CORE_Y = [424, 488, 552, 616, 680];       // eixos das ruas do centro
const QUADRAS_X = [660, 732, 804, 876], QUADRAS_Y = [430, 494, 558, 622];          // canto NO de cada quadra 60 x 52
const PRACA = { x: 732, y: 494, w: 72, h: 64 };
const INDUSTRIA = [[790, 312], [985, 350], [985, 435], [790, 435]];
const CAIS = [[985, 380], [1030, 470], [1026, 610], [995, 700]];
const PIERES = [[1035, 500, 56, 14], [1030, 600, 60, 14]];
const MOLHE = [[1060, 430], [1095, 520], [1100, 640], [1070, 720]];
const MATAS = [[[20, 20], [235, 20], [240, 100], [200, 170], [60, 180], [20, 120]], [[20, 880], [250, 890], [265, 1000], [200, 1080], [20, 1080]]];
const POMAR_MORRO = { cx: 450, cy: 760, rx: 56, ry: 72 };
const POMAR_ENTRADA = [600, 590, 650, 700];
const SITIOS = [[120, 200], [335, 345], [195, 625], [440, 540], [120, 905], [470, 880]];
const BAIRROS = [[565, 335, 654, 545], [565, 715, 654, 850], [665, 325, 790, 418], [665, 690, 905, 825], [490, 480, 560, 540]];
const ARMAZENS_PORTO = [[968, 452], [984, 532], [975, 624]];

// --- geometria em tiles ---
const dentro = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
const idx = (x, y) => y * W + x;
function noPoligono(px, py, pol) {
  let c = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, yi] = pol[i], [xj, yj] = pol[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const distSeg = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
const distLinha = (px, py, pts) => { let d = Infinity; for (let k = 1; k < pts.length; k++) d = Math.min(d, distSeg(px, py, pts[k - 1], pts[k])); return d; };
// rua 4-conexa em tiles (a Draw Tool faz a escada; montarRuas poe a peca certa em cada degrau)
function riscar4(ptsEsboco, marcar) {
  const pts = ptsEsboco.map(T);
  let ult = null;
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
    const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
    for (let q = 0; q <= n; q++) {
      const x = Math.round(x1 + ((x2 - x1) * q) / n), y = Math.round(y1 + ((y2 - y1) * q) / n);
      if (ult && ult[0] !== x && ult[1] !== y) {
        const d = (px, py) => Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / (Math.hypot(x2 - x1, y2 - y1) || 1);
        const [ax, ay] = d(x, ult[1]) <= d(ult[0], y) ? [x, ult[1]] : [ult[0], y];
        if (dentro(ax, ay)) marcar(ax, ay);
      }
      if (!ult || ult[0] !== x || ult[1] !== y) { if (dentro(x, y)) marcar(x, y); ult = [x, y]; }
    }
  }
}
// ruido de baixa frequencia, deterministico (manchas, nao listras: E86)
const ruido = (x, y, s = 0) => Math.sin(x * 0.41 + 1.3 + s) + Math.sin(y * 0.37 + 0.7 + s) + Math.sin((x + y) * 0.23 + s) + 0.6 * Math.sin((x - y) * 0.53 + s);
const hash = (x, y, s = 0) => (((x * 73856093) ^ (y * 19349663) ^ (s * 83492791)) >>> 0) % 1000 / 1000;

export function gerar(saida) {
  const p = pecas(BASE);
  if (p.W !== W || p.H !== H) throw new Error(`base ${p.W}x${p.H} != ${W}x${H}`);

  const terreno = new Uint8Array(W * H), estrada = new Uint8Array(W * H), folha = new Uint8Array(W * H);
  const mar = new Uint8Array(W * H), uso = new Uint8Array(W * H);     // uso: 1 cidade, 2 industria, 3 porto, 4 fazenda, 5 mata, 6 pomar, 7 praca
  const sx = new Float32Array(W * H), sy = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { sx[idx(x, y)] = sxDe(x); sy[idx(x, y)] = syDe(y); }

  // 1) o mar, os pieres e o molhe (terra que entra na agua)
  for (let i = 0; i < W * H; i++) mar[i] = noPoligono(sx[i], sy[i], TERRA) ? 0 : 1;
  for (const [x0, y0, w, h] of PIERES) for (let i = 0; i < W * H; i++) if (sx[i] >= x0 && sx[i] <= x0 + w && sy[i] >= y0 - 3 && sy[i] <= y0 + h + 3) { mar[i] = 0; uso[i] = 3; }
  for (let i = 0; i < W * H; i++) if (distLinha(sx[i], sy[i], MOLHE) <= 9) { mar[i] = 0; uso[i] = 3; }
  // distancia ao mar, em tiles (BFS 4-conexo), para a praia e para o relevo descer ate a agua
  const dMar = new Float32Array(W * H).fill(Infinity);
  { const fila = []; for (let i = 0; i < W * H; i++) if (mar[i]) { dMar[i] = 0; fila.push(i); }
    for (let k = 0; k < fila.length; k++) { const i = fila[k], x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (!dentro(X, Y)) continue; const j = idx(X, Y); if (dMar[j] > dMar[i] + 1) { dMar[j] = dMar[i] + 1; fila.push(j); } } } }

  // 2) usos do solo
  for (let i = 0; i < W * H; i++) {
    if (mar[i] || uso[i]) continue;
    const X = sx[i], Y = sy[i];
    if (noPoligono(X, Y, INDUSTRIA)) uso[i] = 2;
    else if (distLinha(X, Y, CAIS) <= 18) uso[i] = 3;
    else if (X >= PRACA.x && X <= PRACA.x + PRACA.w && Y >= PRACA.y && Y <= PRACA.y + PRACA.h) uso[i] = 7;
    else if (X >= 654 && X <= 942 && Y >= 424 && Y <= 686) uso[i] = 1;
    else if (BAIRROS.some(([a, b, c, d]) => X >= a && X <= c && Y >= b && Y <= d)) uso[i] = 1;
    else if (MATAS.some((m) => noPoligono(X, Y, m))) uso[i] = 5;
    else if (((X - POMAR_MORRO.cx) / POMAR_MORRO.rx) ** 2 + ((Y - POMAR_MORRO.cy) / POMAR_MORRO.ry) ** 2 <= 1) uso[i] = 6;
    else if (X >= POMAR_ENTRADA[0] && X <= POMAR_ENTRADA[2] && Y >= POMAR_ENTRADA[1] && Y <= POMAR_ENTRADA[3]) uso[i] = 6;
    else if (X < 545) uso[i] = 4;
    else uso[i] = 0;                                         // margem da peninsula: campo e quintal
  }

  // 3) chao por uso
  const talhao = (X, Y) => { const c = Math.floor((X - 10) / 135), r = Math.floor((Y - 30) / 175); return { c, r, k: ((c * 7 + r * 3) % 9 + 9) % 9 }; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), X = sx[i], Y = sy[i], n = ruido(x, y);
    if (mar[i]) { terreno[i] = WATER; continue; }
    switch (uso[i]) {
      case 1: terreno[i] = n > 0.9 ? GRASS : n > -1.1 ? DIRT_LOT : DIRT; break;
      case 2: terreno[i] = n > 0.4 ? GRAVEL : DIRT_LOT; break;
      case 3: terreno[i] = PAV1; break;
      case 7: terreno[i] = COBBLE; break;
      case 5: terreno[i] = n > 0.3 ? HVY_FOREST : LT_FOREST; folha[i] = 1 + FOLHOSA[Math.floor(hash(x, y) * 3)]; break;
      case 6: terreno[i] = GRASS_T; if ((x + y) % 2 === 0 && x % 2 === 0) folha[i] = 1 + NOVA; break;
      case 4: { const t = talhao(X, Y); terreno[i] = t.k < 6 ? CROP[t.k] : t.k < 8 ? PLOW[t.k - 6] : GRASS_Y; break; }
      default: terreno[i] = n > 0.5 ? GRASS : n > -0.8 ? CLOVER : WEEDS;
    }
    // praia: areia na linha d'agua, menos onde e porto
    if (dMar[i] <= 1 && uso[i] !== 3 && uso[i] !== 2) { terreno[i] = SAND; folha[i] = 0; }
  }
  // cercas vivas: arbustos nas divisas de alguns talhoes
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y); if (uso[i] !== 4) continue;
    const a = talhao(sx[i], sy[i]), b = dentro(x + 1, y) ? talhao(sx[idx(x + 1, y)], sy[idx(x + 1, y)]) : a, c = dentro(x, y + 1) ? talhao(sx[idx(x, y + 1)], sy[idx(x, y + 1)]) : a;
    if ((a.c !== b.c || a.r !== c.r) && (a.c + a.r) % 2 === 0 && hash(x, y, 2) < 0.8) { terreno[i] = GRASS_T; folha[i] = 1 + ARBUSTO[Math.floor(hash(x, y, 3) * 3)]; }
  }

  // 4) o riacho (Stream: o relevo desce para a baia, e agua em degrau o motor nao desenha), mata ciliar e brejo na foz
  riscar4(RIACHO, (x, y) => { const i = idx(x, y); if (mar[i]) return; estrada[i] = EST.stream; terreno[i] = MUD; folha[i] = 0; });
  for (let i = 0; i < W * H; i++) {
    if (mar[i] || estrada[i] || uso[i] === 1 || uso[i] === 2 || uso[i] === 3) continue;
    const d = distLinha(sx[i], sy[i], RIACHO);
    if (d <= 14 && hash(i, 7) < 0.75) { terreno[i] = LT_FOREST; folha[i] = 1 + FOLHOSA[Math.floor(hash(i, 8) * 3)]; }
    if (Math.hypot(sx[i] - 600, sy[i] - 240) < 30 && dMar[i] <= 4) { terreno[i] = MARSH; folha[i] = 0; estrada[i] = 0; }
  }

  // 5) vias: a mais importante vence; riacho e ferrovia nao apagam rua (a rua passa por cima: bueiro e passagem de nivel)
  const pinta = (tipo) => (x, y) => { const i = idx(x, y); if (mar[i]) return; if (!estrada[i] || (PESO[tipo] || 0) > (PESO[estrada[i]] || 0)) estrada[i] = tipo; };
  riscar4(FERROVIA, pinta(EST.rail));
  for (const t of TRILHAS) riscar4(t, pinta(EST.dirt));
  riscar4(SUL, pinta(EST.dirt));
  riscar4(NORTE, pinta(EST.gravel));
  for (const r of RUAS_BAIRRO) riscar4(r, pinta(EST.gravel));
  for (const X of CORE_X) riscar4([[X, 424], [X, 680]], pinta(EST.pav2));
  for (const Y of CORE_Y) riscar4([[654, Y], [942, Y]], pinta(EST.pav2));
  riscar4(RODOVIA, pinta(EST.pav1));
  for (let i = 0; i < W * H; i++) {
    if (!estrada[i]) continue;
    folha[i] = 0;
    if (estrada[i] === EST.pav1) terreno[i] = PAV1;
    else if (estrada[i] === EST.pav2) terreno[i] = PAV2;
    else if (estrada[i] === EST.gravel || estrada[i] === EST.rail) terreno[i] = GRAVEL;
    else if (estrada[i] === EST.dirt) terreno[i] = DIRT;
  }
  // o brejo e agua: nenhuma via por cima
  for (let i = 0; i < W * H; i++) if (terreno[i] === MARSH) estrada[i] = 0;

  // 6) relevo (metros acima do mar). Crista nas fazendas (~24 m), morro da mata NE do esboco, morro do
  //    pomar, a cidade num dorso de ~14 m; tudo desce ate 1,5-2 m na linha d'agua. O mar fica plano.
  const bump = (X, Y, cx, cy, sxg, syg, a) => a * Math.exp(-(((X - cx) / sxg) ** 2 + ((Y - cy) / syg) ** 2) / 2);
  const ALT_MAR = 20;                                        // o nivel da base (padrao do editor)
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (mar[i]) { h[i] = 0; continue; }
    const X = sx[i], Y = sy[i];
    let v = 4 + 2 * (1 - X / SW)
      + bump(X, Y, 330, 480, 85, 300, 18)                  // a crista das fazendas
      + bump(X, Y, 130, 110, 90, 90, 12)                   // o morro da mata do norte
      + bump(X, Y, 440, 770, 55, 60, 11)                   // o morro do pomar
      + bump(X, Y, 790, 555, 120, 105, 9);                 // o dorso da cidade
    v = Math.min(v, 1.5 + 0.9 * dMar[i]);                   // desce ate a agua (0,9 m por tile)
    if (uso[i] === 3) v = 2;                                // cais, pieres e molhe: planos a 2 m
    if (terreno[i] === MARSH) v = 0.3;
    if (estrada[i] === EST.stream) v = Math.max(0.8, v - 1.2);
    h[i] = v;
  }
  // a cidade e a industria assentadas: o chao da quadra suaviza (media 3x3), para nao ter casa em barranco
  const suave = Float32Array.from(h);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = idx(x, y); if (mar[i] || !(uso[i] === 1 || uso[i] === 2 || uso[i] === 7)) continue;
    let s = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = idx(x + dx, y + dy); if (!mar[j]) { s += h[j]; n++; } }
    suave[i] = s / n;
  }
  const alt = (x, y) => ALT_MAR + suave[idx(x, y)];

  // 7) construcoes
  const CAT = JSON.parse(fs.readFileSync(new URL('../../research/predios_catalogo.json', import.meta.url), 'utf8')).predios;
  const doCat = (nomes) => nomes.map((n) => CAT.find((c) => c.nome === n)).filter(Boolean).map((c) => ({ bytes: Buffer.from(c.registro, 'hex'), count: c.andares, sub: c.sub, nome: c.nome }));
  const M = {
    centro: doCat(['Commercial 2', 'Commercial 4', 'Commercial 9', 'House 6', 'House 8', 'House 14', 'House 15']),
    centroAlto: doCat(['Commercial 4', 'Commercial 8']),
    bairro: doCat(['House 1', 'House 2', 'House 3', 'House 4', 'House 5', 'House 9']),
    sitio: doCat(['House 4', 'House 5', 'House 2']),
    celeiro: doCat(['Barn 1', 'Barn 2', 'Barn 3', 'Barn 4']),
    armazem: doCat(['Barn 2', 'Barn 6']),
    igreja: doCat(['Church 3'])[0],
  };
  // A INDUSTRIA: os galpoes da "East Factory" do Podlypyky (estilo 08, que nenhuma casa do catalogo tem)
  const mF = lerMapa(FABRICA);
  const rF = lerPlanos(FABRICA); const LF = listasDeObjetivos(mF.c, rF.ini + 4 + rF.len);
  const fab = LF.azul.find((o) => /Factory/.test(o.nome));
  const naFab = new Set(); for (let k = 0; k < fab.n; k++) naFab.add((mF.c.readUInt32LE(fab.tilesEm + 8 * k) - mF.OX) + ',' + (mF.c.readUInt32LE(fab.tilesEm + 8 * k + 4) - mF.OY));
  const vistos = new Set();
  M.galpao = mF.construcoes.filter((b) => naFab.has((Math.floor(b.X / 2) - mF.OX) + ',' + (Math.floor(b.Y / 2) - mF.OY)) && mF.c[b.off + 6] === 0x08)
    .map((b) => ({ bytes: Buffer.from(mF.c.subarray(b.off, b.off + b.len)), count: b.count, sub: b.sub }))
    .filter((m) => { const k = m.bytes.subarray(5, 11).toString('hex'); if (vistos.has(k)) return false; vistos.add(k); return true; });
  if (!M.galpao.length) throw new Error('nenhum galpao achado na fabrica do Podlypyky');

  const postas = new Map();
  const barranco = (x, y) => { let d = 0; const v = alt(x, y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (dentro(x + dx, y + dy)) d = Math.max(d, Math.abs(v - alt(x + dx, y + dy))); return d; };
  const livre = (x, y, viz = true) => {
    if (x < 1 || y < 1 || x >= W - 2 || y >= H - 2) return false;           // a fileira da borda descarta o predio (E84)
    const i = idx(x, y);
    if (mar[i] || estrada[i] || terreno[i] === MARSH || barranco(x, y) > 4) return false;
    if (postas.has(i)) return false;
    if (viz) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (postas.has(idx(x + dx, y + dy))) return false;
    return true;
  };
  const por = (x, y, molde, extra = {}) => { const i = idx(x, y); postas.set(i, { x, y, meioX: false, meioY: false, molde, ...extra }); folha[i] = 0; if (terreno[i] === LT_FOREST || terreno[i] === HVY_FOREST || CROP.includes(terreno[i])) terreno[i] = DIRT_LOT; };
  const escolhe = (lista, x, y) => lista[Math.floor(hash(x, y, 11) * lista.length)];

  // a igreja no meio da praca
  { const [x, y] = T([PRACA.x + PRACA.w / 2, PRACA.y + PRACA.h / 2]).map(Math.round); postas.set(idx(x, y), { x, y, meioX: false, meioY: false, molde: M.igreja }); }
  // o centro: o anel de cada quadra, um predio a cada 2 tiles, 3-4 andares; o miolo e patio
  for (const qx of QUADRAS_X) for (const qy of QUADRAS_Y) {
    if (qx === 732 && qy === 494) continue;                // a praca
    if (qx === 876 && qy === 622) continue;                // a ladeira do porto
    const [ax, ay] = T([qx + 60, qy + 52]).map(Math.ceil), [bx, by] = T([qx, qy]).map(Math.floor);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const borda = x === ax || x === bx || y === ay || y === by;
      if (!borda || (x + y) % 2) continue;
      if (livre(x, y)) por(x, y, hash(x, y, 5) < 0.25 ? escolhe(M.centroAlto, x, y) : escolhe(M.centro, x, y));
    }
  }
  // os bairros: casas de 1-2 andares a cada ~3 tiles (24 m), com folga, e um quintal com arvore
  for (const [a, b, c, d] of BAIRROS) {
    const [x0, y0] = T([c, d]).map(Math.ceil), [x1, y1] = T([a, b]).map(Math.floor);
    for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) {
      const X = x + Math.round(hash(x, y, 1) * 2 - 1), Y = y + Math.round(hash(x, y, 2) * 2 - 1);
      if (hash(x, y, 3) < 0.15 || uso[idx(X, Y)] !== 1 || !livre(X, Y)) continue;
      por(X, Y, escolhe(M.bairro, X, Y));
      const [qx, qy] = [X + 1, Y + 1]; if (dentro(qx, qy) && !estrada[idx(qx, qy)] && !postas.has(idx(qx, qy)) && hash(X, Y, 4) < 0.6) folha[idx(qx, qy)] = 1 + (hash(X, Y, 6) < 0.5 ? FOLHOSA[0] : ARBUSTO[0]);
    }
  }
  // a refinaria e o patio: galpoes da fabrica a cada 3 tiles
  {
    const xs = INDUSTRIA.map((q) => tx(q[0])), ys = INDUSTRIA.map((q) => ty(q[1]));
    for (let y = Math.ceil(Math.min(...ys)) + 1; y <= Math.floor(Math.max(...ys)) - 1; y += 3) for (let x = Math.ceil(Math.min(...xs)) + 1; x <= Math.floor(Math.max(...xs)) - 1; x += 3) {
      if (uso[idx(x, y)] === 2 && hash(x, y, 9) < 0.8 && livre(x, y)) por(x, y, escolhe(M.galpao, x, y));
    }
  }
  // os armazens do porto
  for (const q of ARMAZENS_PORTO) { const [x, y] = T(q).map(Math.round); for (const [dx, dy] of [[0, 0], [0, 2], [0, -2]]) if (livre(x + dx, y + dy)) por(x + dx, y + dy, escolhe(M.galpao, x + dx, y + dy)); }
  // os sitios: casa, celeiro e paiol, com terreiro
  for (const s of SITIOS) {
    const [x, y] = T(s).map(Math.round);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dentro(x + dx, y + dy) && !mar[idx(x + dx, y + dy)] && !estrada[idx(x + dx, y + dy)]) { terreno[idx(x + dx, y + dy)] = DIRT_LOT; folha[idx(x + dx, y + dy)] = 0; }
    [[0, 0, M.sitio], [3, 1, M.celeiro], [-1, 3, M.celeiro], [2, -3, M.sitio]].forEach(([dx, dy, l]) => { if (livre(x + dx, y + dy)) por(x + dx, y + dy, escolhe(l, x + dx, y + dy)); });
  }
  const construcoes = [...postas.values()];

  // 8) zonas de setup: o jogador (vermelho, Red 1 = 4) na faixa leste de 170 m (a oeste do esboco); o
  //    defensor (azul, Blue 1 = 1) na peninsula e no istmo. Nunca na agua.
  const zona = (i) => { if (mar[i] || terreno[i] === MARSH) return 0; if (sx[i] < 170) return 4; if (sx[i] > 540) return 1; return 0; };

  // 9) rotulos
  const rotulos = new Map();
  const rot = (q, s) => { const [x, y] = T(q).map(Math.round); if (dentro(x, y)) rotulos.set(idx(x, y), s); };
  rot([768, 470], 'Praca'); rot([1005, 470], 'Porto'); rot([880, 330], 'Refinaria'); rot([520, 600], 'Istmo');
  rot([440, 700], 'Morro do Pomar'); rot([900, 150], 'Baia Norte'); rot([880, 980], 'Baia Sul');

  // 10) ruas em peca e rotacao; cada classe so liga com ela mesma (riacho, ferrovia, rua)
  const classe = (v) => (v === EST.stream ? 2 : v === EST.rail ? 3 : 1);
  const pr = montarRuas(W, H, estrada, (a, b) => !!a && !!b && classe(a) === classe(b));

  // --- montar e escrever ---
  const grade = montarGrade(W, H, (x, y) => { const i = idx(x, y); return { tipo: terreno[i], estrada: pr.byte[i], flags: pr.rot[i], foliage: folha[i] ? folha[i] - 1 : 0, arvore: folha[i] > 0 && folha[i] - 1 < 32, zona: zona(i), rotulo: rotulos.get(i) }; });
  const elevacao = montarElevacao(W, H, alt, () => true);
  const construcoesBuf = montarConstrucoes(construcoes, p.OX, p.OY);
  const pontesFlavor = montarPontesFlavor([], [], p.OX, p.OY);

  // objetivos da base trocados no lugar (mesmo nome em tamanho, mesma contagem de tiles)
  const resto = Buffer.from(p.resto);
  const pode = (x, y) => !mar[idx(x, y)] && terreno[idx(x, y)] !== MARSH;
  const objs = trocarObjetivos(resto, p, [
    { de: 'Village (Maj VP)', para: 'Praca (Maj VP)', semente: T([768, 526]).map(Math.round) },
    { de: 'Hill & Road (Min VP)', para: 'Porto (Min VP)', semente: T([1000, 560]).map(Math.round) },
    { de: 'North Road (Min VP)', para: 'Refinaria (Min VP)', semente: T([880, 385]).map(Math.round) },
    { de: 'South Road (Min VP)', para: 'Istmo (Min VP)', semente: T([525, 560]).map(Math.round) },
  ], pode);
  const zonaDe = (x, y) => zona(idx(x, y));
  const zonasIA = trocarZonasIA(resto, p, objs, pode, zonaDe);
  const triggers = trocarTriggers(resto, p, objs, pode);
  const r = escrever(BASE, saida, { construcoes: construcoesBuf, pontesFlavor, grade, elevacao, resto });

  // relatorio
  const conta = (f) => { let n = 0; for (let i = 0; i < W * H; i++) if (f(i)) n++; return n; };
  const hs = Array.from(suave).filter((v, i) => !mar[i]);
  return {
    r, W, H, objs, zonasIA: zonasIA.length, triggers: triggers.length,
    mar: conta((i) => mar[i]) / (W * H), construcoes: construcoes.length,
    porTipo: { centro: construcoes.filter((b) => M.centro.includes(b.molde) || M.centroAlto.includes(b.molde)).length, bairro: construcoes.filter((b) => M.bairro.includes(b.molde)).length, galpao: construcoes.filter((b) => M.galpao.includes(b.molde)).length, sitio: construcoes.filter((b) => M.sitio.includes(b.molde) || M.celeiro.includes(b.molde)).length },
    galpoes: M.galpao.length, relevo: [Math.min(...hs), Math.max(...hs)],
    zonas: { vermelho: conta((i) => zona(i) === 4), azul: conta((i) => zona(i) === 1) },
    ruas: pr.conta, tilesRua: conta((i) => estrada[i]),
  };
}

// --- objetivos, zonas de IA e triggers da base, no lugar (o mesmo do mucuge.mjs, E86/E87, com a base daqui) ---
function trocarObjetivos(resto, p, lista, pode) {
  const tomados = new Set(); const feitos = [];
  for (const o of lista) {
    if (o.para.length > o.de.length) throw new Error(`objetivo ${o.para}: nome maior que ${o.de}`);
    const de = Buffer.from(o.de, 'latin1'), para = Buffer.from(o.para.padEnd(o.de.length, ' '), 'latin1');
    const achados = [];
    for (let i = resto.indexOf(de); i >= 0; i = resto.indexOf(de, i + 1)) { if (resto[i - 6] !== 0 || resto.readUInt16LE(i - 2) !== de.length) continue; achados.push(i); }
    if (achados.length !== 2) throw new Error(`objetivo ${o.de}: ${achados.length} ocorrencias, esperava 2 (uma por lado)`);
    // cada lado guarda a SUA contagem (a base tem 270 de um lado e 271 do outro): os tiles sao os mesmos, cortados na de cada um
    const ns = achados.map((i) => resto.readUInt32LE(i + de.length + 4));
    const n = Math.max(...ns);
    const n0 = ns[0]; let ax = 0, ay = 0; for (let k = 0; k < n0; k++) { ax += resto.readUInt32LE(achados[0] + de.length + 8 + 8 * k) - p.OX; ay += resto.readUInt32LE(achados[0] + de.length + 12 + 8 * k) - p.OY; }
    const [sx, sy] = o.semente; const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pode(x, y) && !tomados.has(y * W + x)) cand.push([Math.hypot(x - sx, y - sy), x, y]);
    cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const tiles = cand.slice(0, n).map(([, x, y]) => [x, y]);
    if (tiles.length !== n) throw new Error(`objetivo ${o.para}: so ${tiles.length} tiles livres, precisa ${n}`);
    tiles.forEach(([x, y]) => tomados.add(y * W + x));
    achados.forEach((i, a) => { para.copy(resto, i); const t0 = i + de.length + 8; const meus = tiles.slice(0, ns[a]).sort((u, v) => u[0] - v[0] || u[1] - v[1]); meus.forEach(([x, y], k) => { resto.writeUInt32LE(x + p.OX, t0 + 8 * k); resto.writeUInt32LE(y + p.OY, t0 + 8 * k + 4); }); });
    feitos.push({ nome: o.para, pontos: resto.readUInt16LE(achados[0] - 4), n, semente: o.semente, antes: [ax / n0, ay / n0] });
  }
  return feitos;
}
function trocarZonasIA(resto, p, objs, pode, zonaDe) {
  const r = lerPlanos(BASE); if (!r.confiavel) throw new Error('planos da base ilegiveis');
  const fimElevBase = p.c.length - p.resto.length; const feitos = [];
  const reescrever = (em, tiles, lado, setup) => {
    const n = tiles.length; if (!n || n > 2500) return;
    const cx = tiles.reduce((a, t) => a + t[0], 0) / n, cy = tiles.reduce((a, t) => a + t[1], 0) / n;
    let alvo = null, dist = 25; for (const o of objs) { const d = Math.hypot(cx - o.antes[0], cy - o.antes[1]); if (d < dist) { dist = d; alvo = o; } }
    if (!alvo) return;
    const [sx, sy] = alvo.semente; const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!pode(x, y)) continue; if (setup && lado === 'azul') { const z = zonaDe(x, y); if (z < 1 || z > 3) continue; } cand.push([Math.hypot(x - sx, y - sy), x, y]); }
    cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const novos = cand.slice(0, n).map(([, x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (novos.length !== n) throw new Error(`zona de IA: so ${novos.length} tiles para ${n}`);
    const off = em - fimElevBase;
    if (resto.readUInt32LE(off) !== n) throw new Error(`zona de IA: contagem ${resto.readUInt32LE(off)} != ${n}`);
    novos.forEach(([x, y], k) => { resto.writeUInt32LE(x + p.OX, off + 4 + 8 * k); resto.writeUInt32LE(y + p.OY, off + 8 + 8 * k); });
    feitos.push({ lado, n, para: alvo.nome.trim(), setup });
  };
  for (const pl of r.planos) for (const g of pl.grupos) { reescrever(g.setupEm, g.setup, pl.lado, true); g.ordens.forEach((o, k) => reescrever(g.ordensEm[k], o, pl.lado, false)); }
  return feitos;
}
function trocarTriggers(resto, p, objs, pode) {
  const fimElevBase = p.c.length - p.resto.length; const rIA = lerPlanos(BASE);
  const L = listasDeObjetivos(p.c, rIA.ini + 4 + rIA.len); const feitos = [];
  for (const lado of ['azul', 'vermelho']) for (const t of L[lado]) {
    if (!ehTrigger(t.tipo) || !t.n) continue;
    let cx = 0, cy = 0; for (let k = 0; k < t.n; k++) { cx += p.c.readUInt32LE(t.tilesEm + 8 * k) - p.OX; cy += p.c.readUInt32LE(t.tilesEm + 8 * k + 4) - p.OY; }
    cx /= t.n; cy /= t.n;
    let alvo = null, dist = Infinity; for (const o of objs) { const d = Math.hypot(cx - o.antes[0], cy - o.antes[1]); if (d < dist) { dist = d; alvo = o; } }
    if (!alvo) continue;
    const [sx, sy] = alvo.semente; const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pode(x, y)) cand.push([Math.hypot(x - sx, y - sy), x, y]);
    cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const novos = cand.slice(0, t.n).map(([, x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const off = t.tilesEm - fimElevBase;
    if (resto.readUInt32LE(off - 4) !== t.n) throw new Error(`trigger ${t.nome}: contagem ${resto.readUInt32LE(off - 4)} != ${t.n}`);
    novos.forEach(([x, y], k) => { resto.writeUInt32LE(x + p.OX, off + 8 * k); resto.writeUInt32LE(y + p.OY, off + 8 * k + 4); });
    const nomeNovo = alvo.nome.replace(/\s*\((Maj|Min) VP\)\s*$/, '').trim().slice(0, t.nome.length).padEnd(t.nome.length, ' ');
    Buffer.from(nomeNovo, 'latin1').copy(resto, t.pos - fimElevBase);
    feitos.push({ lado, de: t.nome, para: nomeNovo.trim(), n: t.n });
  }
  return feitos;
}

const EH_MAIN = process.argv[1] && /[\\/]peninsula\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const saida = process.argv[2] || GF + 'ZZ MAPA/P1 PENINSULA.btt';
  const o = gerar(saida);
  console.log(`${saida}\n  ${o.r.bytes} bytes (base ${o.r.base}); ${o.W}x${o.H} tiles`);
  console.log(`  mar ${(100 * o.mar).toFixed(0)}% | construcoes ${o.construcoes} ${JSON.stringify(o.porTipo)} (${o.galpoes} modelos de galpao)`);
  console.log(`  relevo ${o.relevo[0].toFixed(1)}..${o.relevo[1].toFixed(1)} m acima do mar | zonas ${JSON.stringify(o.zonas)} | ruas ${o.tilesRua} tiles ${JSON.stringify(o.ruas)}`);
  console.log(`  objetivos: ${o.objs.map((x) => `${x.nome.trim()} ${x.n}`).join(' | ')} | zonas de IA ${o.zonasIA} | triggers ${o.triggers}`);
}
