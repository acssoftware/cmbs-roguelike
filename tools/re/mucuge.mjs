// MUCUGE (BA) — mapa gerado 100% por codigo, sem editor (secao 94).
//
// Fontes: OpenStreetMap (ruas, edificacoes, hidrografia, vegetacao; ODbL) e SRTM 30 m via
// opentopodata (elevacao). Baixados em /c/tmp/mucuge.json e /c/tmp/mucuge_elev.json.
//
// Base: `Podlypyky-Rough (1936 X 1808) 088 Assault.btt` — 242x226 tiles (1936 x 1808 m), que cobre
// a mancha urbana inteira (1742 x 1935 m). Manter o tamanho da base evita mexer em tudo que
// depende de W,H (preambulo, camera, regiao de IA): so o CONTEUDO muda.
//
// O que e escrito: grade (terreno, estradas com peca e rotacao, folhagem, zonas de setup copiadas da
// base, rotulos), elevacao e a lista de construcoes; na cauda, os tres objetivos trocados no lugar.
// O que e copiado da base: preambulo, camera, regiao de IA e o resto da cauda.
// Desde a E86 o arquivo vira batalha pelo `buildBattle` do app e abre no jogo (spec/testes.md E86).
//
// TERRENO — A PALETA DA v2 ALAGOU A CIDADE (E85, 21/09). Eu tinha dado nome aos valores por
// HISTOGRAMA ("aparece em mapa de vila", "domina mapa de morro") e errei a familia de metade deles:
// 28 ("terreiro"), 45 ("cascalho") e 30 ("mata rala") sao da familia da AGUA; 18 ("mata") e chao de
// cidade; 38 ("chao comum") e FLORESTA; 16 e 17 ("pavimento", "rua de pedra") nao sao urbanos. O
// autor abriu a previa 3-D e a cidade era um espelho, com uma margem ingreme em volta de cada tile —
// que eu tinha lido como "o rio virou canion".
//
// A paleta de agora sai de `tools/re/censo_terreno.mjs`, que mede o COMPORTAMENTO de cada valor
// nos mapas do jogo em vez de onde ele aparece:
//   agua/vau/brejo  17 28 30 37 40 45   plano (degrau <= 0,05 m), ZERO casas, zero estradas
//   chao urbano     18 19 20 21 29      40 a 143 casas por mil tiles, 80-90% em mapa de cidade
//   mata            38 39               ~78% dos tiles com folhagem
//   rocha           2 4 5               ingreme (degrau 0,5 a 0,8 m)
//   campo           7 8 9 10 11 13 14   o chao aberto; o 7 e o mais comum de todos (297 mil tiles)
//   terra           0 1                 16-27 casas por mil, 14-21% com estrada
//   lavoura         31..36 (e 25, 26)   sem casa, sem folhagem
// Os 38 valores que existem batem com os 38 itens da paleta do editor, mas o NOME de cada um so
// sai pintando a paleta (Etapa 4 do plano de tela) — feito na E86 (research/terreno_catalogo.json).
// Na paleta de chao NENHUM valor da familia da agua entra; o rio e Water de verdade (`rio = 'agua'`),
// num espelho plano abaixo das margens, que e a regra medida no editor.
import fs from 'node:fs';
import { escrever, montarGrade, montarElevacao, montarConstrucoes, montarPontesFlavor, moldes, pecas, restoSemPlanos, montarRuas, pontesNasTravessias } from './mapa_escrever.mjs';
import { lerGrade } from './mapa.mjs';
import { lerPlanos } from './ia.mjs';
import { listasDeObjetivos, ehTrigger } from './gatilhos.mjs';

const QB = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Quick Battle Maps/';
const BASE = QB + 'Podlypyky-Rough (1936 X 1808) 088 Assault.btt';
const W = 242, H = 226, MLAT = 110574;
// A CIDADE (E86, Etapa 6). O gerador nasceu para Mucuge e serve a qualquer cidade que caiba na base
// de 1936 x 1808 m: o que era Mucuge virou configuracao — o centro, os caches do OSM e do SRTM
// (`tools/re/cidade_baixar.mjs` baixa os dois) e os tres lugares dos objetivos. `achar` recebe as
// tags de um elemento do OSM; sem `achar`, vale a heuristica PADRAO de `gerar` (o mais perto do centro).
// `nome` e o que o jogo mostra no objetivo (curto: cabe no nome da base), `rotulo` o texto no mapa.
const ascii = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');
export const CIDADES = {
  mucuge: {
    nome: 'Mucuge', clat: -13.00925, clon: -41.372725, mlon: 108464, osm: 'C:/tmp/mucuge.json', elev: 'C:/tmp/mucuge_elev.json',
    centro: { achar: (t) => t.leisure === 'park' && /Prop.rcio/i.test(t.name || ''), nome: 'Mucuge' },
    igreja: { achar: (t) => t.amenity === 'place_of_worship' && /Santo Ant/i.test(t.name || ''), nome: 'Santo Antonio', rotulo: 'Igreja Santo Antonio' },
    terceiro: { achar: (t) => t.landuse === 'cemetery', nome: 'Cemiterio', rotulo: 'Cemiterio Bizantino' },
    rio: 'Rio Mucuge',
  },
};
// O NOME DO OBJETIVO QUE CABE: o novo nao pode passar do da base (a troca e no lugar). Tenta
// "Nome (Min VP)", depois sem o espaco; se nao couber, tira palavras do COMECO ("Senhor dos Passos" ->
// "Passos": o nome proprio fica no fim) antes de cortar letras.
export function nomeObjetivo(nome, vp, max) {
  const palavras = ascii(nome).split(/\s+/).filter(Boolean);
  for (let k = 0; k < palavras.length; k++) {
    const n = palavras.slice(k).join(' ').replace(/^(de|da|do|dos|das)\s+/i, '');
    for (const s of [`${n} (${vp} VP)`, `${n}(${vp} VP)`]) if (s.length <= max) return s;
  }
  return `${ascii(nome).slice(0, max - vp.length - 5)}(${vp} VP)`;
}
let CLAT, CLON, MLON, lat0, lon0, CID;
export function usarCidade(nome) {
  let c = CIDADES[nome];
  if (!c) {
    const arq = new URL(`../../research/cidades/${nome}.json`, import.meta.url);
    if (!fs.existsSync(arq)) throw new Error(`cidade ${nome}: nem em CIDADES nem em research/cidades/${nome}.json`);
    c = JSON.parse(fs.readFileSync(arq, 'utf8'));
  }
  CID = c; CLAT = c.clat; CLON = c.clon; MLON = c.mlon || Math.round(111320 * Math.cos(c.clat * Math.PI / 180));
  lat0 = CLAT - (H / 2) * 8 / MLAT; lon0 = CLON - (W / 2) * 8 / MLON;
  return c;
}
usarCidade('mucuge');
// A caixa que o mapa cobre e a grade de amostras do SRTM (a cada 4 tiles), para o baixador.
export function caixaDaCidade(c) {
  const mlon = c.mlon || Math.round(111320 * Math.cos(c.clat * Math.PI / 180));
  const la0 = c.clat - (H / 2) * 8 / MLAT, lo0 = c.clon - (W / 2) * 8 / mlon;
  const P = 4, amostras = [];
  for (let j = 0; j <= Math.floor(H / P); j++) for (let i = 0; i <= Math.floor(W / P); i++) amostras.push([(la0 + (j * P) * 8 / MLAT).toFixed(6), (lo0 + (i * P) * 8 / mlon).toFixed(6)]);
  return { sul: la0, oeste: lo0, norte: la0 + H * 8 / MLAT, leste: lo0 + W * 8 / mlon, amostras };
}
const tx = (lon) => (lon - lon0) * MLON / 8;              // x cresce para LESTE
const ty = (lat) => (lat - lat0) * MLAT / 8;              // y cresce para o NORTE (grade guardada do sul)

// --- terreno e estradas (valores colhidos de mapas reais, ver cabecalho) -------------------
// COM NOME desde a E86 (research/terreno_catalogo.json, medido pintando a paleta no editor). A E85
// tinha acertado as FAMILIAS pelo censo e errado os nomes dentro delas: o 14 que eu usava como areia e
// Grass XT, o 1 de "cascalho" e Dirt Red, o 20 de "pavimento" e Gravel, e o 29 de "terreiro" e o
// Cobblestone — que e o que o centro historico de Mucuge tem de verdade.
const CHAO = 7 /* Grass */, ROCHA = 4 /* Rocky */, ROCHA2 = 2 /* Hard */, CAPIM = 11 /* Grass T */,
      AREIA = 6 /* Sand */, CASCALHO = 20 /* Gravel */, PEDRA = 29 /* Cobblestone */, PAV = 18 /* Pavement 1 */,
      TERREIRO = 21 /* Dirt Lot */, MATA = 38 /* Lt Forest */, MATA_L = 39 /* Hvy Forest */,
      CROP = [31, 32, 33, 34, 35, 36] /* Crop 1..6 */;
const AGUA = 28 /* Water — so no leito do rio (rio = 'agua'), nunca na paleta de chao */;
// FOLHAGEM COM NOME (E86, research: ZZ MAPA/H6 FOLHAGEM). Tree A..H = 0..7, Bush A..C = 8..10, Brush =
// 32 sem a flag de arvore. Na previa: A folhosa larga, B colunar, C copa de carvalho, D folhosa
// pequena, E conifera, F tipo betula, G arvore nova, H PINHEIRO alto. Ate a v8 toda arvore solta era
// o 7 (H) e a Chapada saiu com cara de pinhal; o campo rupestre e arbusto e arvore baixa retorcida,
// e a mata ciliar e folhosa. No array `folha` guardo ESPECIE + 1 (0 = nada), para o Tree A (0) nao
// se confundir com "sem folhagem"; o mato vai como 33 (32 + 1).
const ARBUSTO = [8, 9, 10], ARVORE_BAIXA = [3, 6], FOLHOSA = [0, 2, 3], MATO = 32;
// A trava: se alguem voltar a por um valor de agua aqui, o gerador recusa em vez de alagar o mapa.
const FAMILIA_AGUA = new Set([17 /* Marsh */, 28 /* Water */, 30 /* Deep Ford */, 37 /* Reeds */, 40 /* Shallow Ford */, 45 /* Deep Marsh */]);
for (const [nome, v] of Object.entries({ CHAO, ROCHA, ROCHA2, CAPIM, AREIA, CASCALHO, PEDRA, PAV, TERREIRO, MATA, MATA_L })) {
  if (FAMILIA_AGUA.has(v)) throw new Error(`paleta: ${nome} = ${v} e da familia da agua (censo_terreno.mjs)`);
}
const EST = { dirt: 1, gravel: 10, pav1: 19, pav2: 28, trilha: 37, stream: 64 };
const VIA = {                                             // OSM highway -> tipo de estrada
  primary: EST.pav1, secondary: EST.pav1, tertiary: EST.pav1, tertiary_link: EST.pav1,
  residential: EST.pav2, unclassified: EST.pav2, pedestrian: EST.pav2, living_street: EST.pav2,
  service: EST.gravel, track: EST.dirt, path: EST.trilha, footway: EST.trilha, steps: EST.trilha,
};
const PESO = { [EST.pav1]: 6, [EST.pav2]: 5, [EST.gravel]: 4, [EST.dirt]: 3, [EST.trilha]: 2, [EST.stream]: 7 };

// --- elevacao: bilinear sobre a grade SRTM amostrada a cada 4 tiles ------------------------
function campoElevacao() {
  const cache = JSON.parse(fs.readFileSync(CID.elev, 'utf8'));
  const P = 4, nx = Math.floor(W / P) + 1, ny = Math.floor(H / P) + 1;
  const g = new Float64Array(nx * ny); let min = Infinity, max = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const la = lat0 + (j * P) * 8 / MLAT, lo = lon0 + (i * P) * 8 / MLON;
    const v = cache[la.toFixed(6) + ',' + lo.toFixed(6)];
    if (v === undefined) throw new Error(`amostra faltando em ${i},${j}`);
    g[j * nx + i] = v; min = Math.min(min, v); max = Math.max(max, v);
  }
  const em = (x, y) => {                                   // bilinear, em metros absolutos
    const fx = Math.min(x / P, nx - 1.001), fy = Math.min(y / P, ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i], d = g[(j + 1) * nx + i + 1];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  return { em, min, max };
}

// --- geometria ----------------------------------------------------------------------------
const dentro = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
function riscar(pts, marcar) {                             // caminha a polilinha marcando tiles
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
    const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 3));
    for (let s = 0; s <= n; s++) { const x = Math.round(x1 + (x2 - x1) * s / n), y = Math.round(y1 + (y2 - y1) * s / n); if (dentro(x, y)) marcar(x, y); }
  }
}
// A RUA TEM DE SER 4-CONEXA (E86). `riscar` arredonda pontos da polilinha e da uma linha 8-conexa:
// num passo diagonal os dois tiles so se tocam pela quina, e o motor nao liga peca pela quina. Aqui,
// a cada passo diagonal entra o tile intermediario mais perto da linha — a escada que a Draw Tool do
// editor tambem faz, e sobre a qual `montarRuas` poe as meias-diagonais.
function riscar4(pts, marcar) {
  let ult = null;
  const passo = (x, y, x1, y1, x2, y2) => {
    if (ult && ult[0] !== x && ult[1] !== y) {
      // dois candidatos: (x, ult.y) e (ult.x, y); fica o de centro mais perto da reta
      const dist = (px, py) => Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / (Math.hypot(x2 - x1, y2 - y1) || 1);
      const [ax, ay] = dist(x, ult[1]) <= dist(ult[0], y) ? [x, ult[1]] : [ult[0], y];
      if (dentro(ax, ay)) marcar(ax, ay);
    }
    if (!ult || ult[0] !== x || ult[1] !== y) { if (dentro(x, y)) marcar(x, y); ult = [x, y]; }
  };
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
    const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
    for (let q = 0; q <= n; q++) passo(Math.round(x1 + (x2 - x1) * q / n), Math.round(y1 + (y2 - y1) * q / n), x1, y1, x2, y2);
  }
}
function preencher(anel, marcar) {                          // varredura de poligono (par-impar)
  const ys = anel.map((p) => p[1]); const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let k = 0; k < anel.length; k++) {
      const [ax, ay] = anel[k], [bx, by] = anel[(k + 1) % anel.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + (y - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.ceil(xs[i])); x <= Math.min(W - 1, Math.floor(xs[i + 1])); x++) marcar(x, y);
  }
}

// SEGUNDA TENTATIVA (20/09/2026). A primeira travou o carregamento, e a causa mais provavel nao era
// nenhum dos sete suspeitos do plano: a camada de elevacao e COLUNA A COLUNA (`x*H+y`, FORMATO 71.1)
// e o escritor gravava linha a linha — o jogo recebeu o relevo fatiado no passo errado, com degrau
// de 209 m entre tiles vizinhos (o maximo dos 333 mapas reais e 24 m). Corrigido no escritor.
//
// E desta vez TUDO fica dentro do envelope medido (`envelope_mapas.mjs`), de preferencia abaixo do
// p99 e nunca acima do maximo real:
//   relevo   254 m reais -> <= 80 m, por compressao SUAVE: o fundo do vale (onde esta a cidade) fica
//            em escala real e so as paredes da serra achatam. Maximo real 87, p99 82.
//   flags    "posta a mao" numa rede de 1 em 3 (11% dos tiles, ~6.100) em vez de 100% (54.692). A
//            mediana real e 10,5%, o maximo 51% e 15.360 tiles.
//   casas    <= 780 (p99 794, maximo 870), nenhuma em tile de estrada, nenhuma em barranco de mais
//            de 5 m (p99 6), e vizinhanca ortogonal contida (p99 247 pares).
// As duas pecas que nenhuma medida cobre ficam FORA do arquivo principal e entram so no segundo: o
// rio como estrada tipo Stream (so 10 de 333 mapas usam o 64) e os planos de IA esvaziados. No
// principal o rio e um leito de cascalho e areia, e os planos de IA sao os da base, byte a byte.
// `rede` = de quantos em quantos tiles vai um ponto de controle (flag manual). E84/E85: o editor
// REINTERPOLA todo tile que nao e manual, e entre pontos de uma malha regular ele faz PATAMARES — o
// perfil que voltou da ida e volta sobe em degraus de periodo 3 (37,1 37,3 37,7 | 39,7 40,1 40,6 |
// 43,8...), com rugosidade 0,71 m contra 0,11 m do que eu tinha escrito. O meu relevo era liso; os
// degraus da previa 3-D eram do editor. `rede = 1` marca TODOS os tiles e ele nao reinterpola nada —
// mas 100% de flag manual esta fora do envelope (maximo visto 51%) e ainda nao foi carregado.
// E86: `rio = 'agua'` (espelho de Water plano, abaixo das margens — a regra medida no F2),
// `predios = 'catalogo'` (moldes com nome de research/predios_catalogo.json, reto ou diagonal pela
// orientacao do contorno do OSM, e a igreja-matriz com o modelo de torre) e `rede = 1` como padrao.
// E86 (Etapa 5): `zonas = 'base'` e `objetivos = 'mucuge'` fazem o mapa JOGAVEL — ver trocarObjetivos.
// E86: `ruas = 'montadas'` (4-conexas, peca e rotacao por tile — ver montarRuas); 'soltas' e o de antes.
// E86: `relevoMax = 1000` — o RELEVO REAL. O 80 era o envelope dos mapas de QB (maximo 87 m) tomado como
// limite do motor, e nao e: rampas de 250 e 500 m e degraus de 50 m entre vizinhos carregam e desenham
// no editor (ZZ MAPA/0L1..0L3), e o Mucuge com os 254 m da Chapada rodou quatro turnos numa batalha.
// E86: `casasMax`/`vizinhasMax` sem teto — as 1474 casas do OSM (1,7x o maximo visto em QB) carregam,
// montam o 3-D em 14 s e rodam quatro turnos de batalha (ZZ MAPA/E9 MUCUGE 12 CASAS).
export function gerar(saida, { relevoMax = 1000, casasMax = 5000, vizinhasMax = 5000, barrancoMax = 5, rede = 1, rio = 'agua', planos = 'base', predios = 'catalogo', zonas = 'base', objetivos = 'mucuge', ruas = 'montadas', ia = 'mucuge', cidade = 'mucuge', corredeira = 1.0 } = {}) {
  const C = usarCidade(cidade);
  const osm = JSON.parse(fs.readFileSync(C.osm, 'utf8')).elements;
  const geo = (e) => (e.geometry || []).filter(Boolean).map((p) => [tx(p.lon), ty(p.lat)]);
  const { em, min: altMin, max: altMax } = campoElevacao();
  // compressao suave: S*(1 - e^(-h/S)). Perto do fundo a derivada e 1 (escala real); no topo satura.
  // S sai de S*(1-e^(-R/S)) = relevoMax, por bissecao.
  const R0 = altMax - altMin;
  let S = relevoMax;
  if (R0 > relevoMax) { let lo = relevoMax, hi = relevoMax * 50; for (let k = 0; k < 60; k++) { S = (lo + hi) / 2; if (S * (1 - Math.exp(-R0 / S)) > relevoMax) hi = S; else lo = S; } }
  const base20 = 20;                                        // piso do vale em 20 m (padrao do editor)
  const alt = (x, y) => base20 + (R0 > relevoMax ? S * (1 - Math.exp(-(em(x, y) - altMin) / S)) : em(x, y) - altMin);
  const p = pecas(BASE);
  if (p.W !== W || p.H !== H) throw new Error(`base ${p.W}x${p.H} != ${W}x${H}`);

  // OS TRES LUGARES (objetivos, igreja com torre, rotulos). Sem `achar` na configuracao: o centro e a
  // praca mais perto do centro do mapa, a igreja o templo mais perto dele, o terceiro o cemiterio (ou,
  // na falta, o mercado ou a escola) mais perto.
  const cM = [tx(CLON), ty(CLAT)];
  const pontoDe = (e) => { const g = e.geometry ? geo(e) : (e.lat != null ? [[tx(e.lon), ty(e.lat)]] : []); return g.length ? [g.reduce((a, q) => a + q[0], 0) / g.length, g.reduce((a, q) => a + q[1], 0) / g.length] : null; };
  const maisPerto = (teste) => { let best = null, d0 = Infinity; for (const e of osm) { if (!teste(e.tags || {})) continue; const q = pontoDe(e); if (!q || !dentro(Math.round(q[0]), Math.round(q[1]))) continue; const d = Math.hypot(q[0] - cM[0], q[1] - cM[1]); if (d < d0) { d0 = d; best = e; } } return best; };
  const PADRAO = {
    centro: [(t) => t.place === 'square' || (t.leisure === 'park' && /^Pra/i.test(ascii(t.name))), (t) => t.leisure === 'park'],
    igreja: [(t) => t.amenity === 'place_of_worship' && (!t.religion || t.religion === 'christian') && /matriz|catedral|igreja/i.test(ascii(t.name)), (t) => t.amenity === 'place_of_worship'],
    terceiro: [(t) => t.landuse === 'cemetery' || t.amenity === 'grave_yard', (t) => t.amenity === 'marketplace', (t) => t.amenity === 'school'],
  };
  const lugar = (k) => { const cfg = C[k] || {}; if (cfg.achar) return osm.find((e) => cfg.achar(e.tags || {})) || null; for (const t of PADRAO[k]) { const e = maisPerto(t); if (e) return e; } return null; };
  const LUG = { centro: lugar('centro'), igreja: lugar('igreja'), terceiro: lugar('terceiro') };
  const ehIgreja = (e) => !!LUG.igreja && e === LUG.igreja;

  // --- camadas ---
  const terreno = new Uint8Array(W * H), estrada = new Uint8Array(W * H), folha = new Uint8Array(W * H);
  const urbano = new Uint8Array(W * H);                    // proximidade de rua: quintal/terreiro
  const idx = (x, y) => y * W + x;

  // 1) chao de fundo pela declividade (Chapada: quanto mais ingreme, mais rocha)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(em(Math.min(x + 1, W - 1), y) - em(Math.max(x - 1, 0), y), em(x, Math.min(y + 1, H - 1)) - em(x, Math.max(y - 1, 0))) / 16;
    const r = ((x * 73 + y * 151) % 100) / 100;             // ruido deterministico
    terreno[idx(x, y)] = d > 0.35 ? (r < 0.6 ? ROCHA : ROCHA2) : d > 0.18 ? (r < 0.45 ? ROCHA2 : r < 0.8 ? CHAO : AREIA) : (r < 0.62 ? CHAO : r < 0.85 ? CAPIM : CASCALHO);
    // campo rupestre: arbusto e arvore baixa no plano; mato baixo entre as pedras da encosta
    const r2 = ((x * 37 + y * 91) % 97) / 97;
    if (d <= 0.18 && r > 0.9) folha[idx(x, y)] = 1 + (r2 < 0.65 ? ARBUSTO[Math.floor(r2 * 30) % 3] : ARVORE_BAIXA[Math.floor(r2 * 10) % 2]);
    else if (d > 0.18 && r > 0.93) folha[idx(x, y)] = 1 + MATO;
  }

  // 2) vegetacao e usos do OSM. Poligonos REGIONAIS sao descartados: os dois `natural=scrub` do
  //    OSM aqui cobrem a Chapada inteira (100x e 227x a area do mapa) e, se aplicados, apagam toda
  //    a variacao de rocha vinda da declividade. O chao de fundo ja representa o campo rupestre.
  const areaPoli = (g) => { let A = 0; for (let k = 0; k < g.length; k++) { const [x1, y1] = g[k], [x2, y2] = g[(k + 1) % g.length]; A += x1 * y2 - x2 * y1; } return Math.abs(A) / 2; };
  const REGIONAL = 0.25 * W * H;
  const areas = { wood: MATA, scrub: CAPIM, sand: AREIA, grass: CAPIM, cliff: null, ridge: null };
  for (const e of osm) {
    const t = e.tags || {}; const g = geo(e); if (g.length < 3) continue;
    if (areaPoli(g) > REGIONAL) continue;
    if (t.natural && areas[t.natural] != null) preencher(g, (x, y) => { terreno[idx(x, y)] = areas[t.natural]; if (t.natural === 'wood') folha[idx(x, y)] = 1 + FOLHOSA[(x * 7 + y * 3) % 3]; });
    if (t.landuse === 'quarry') preencher(g, (x, y) => { terreno[idx(x, y)] = ROCHA; });
    if (t.landuse === 'cemetery') preencher(g, (x, y) => { terreno[idx(x, y)] = CASCALHO; });
    if (t.landuse === 'plant_nursery' || t.landuse === 'farmland') preencher(g, (x, y) => { terreno[idx(x, y)] = CROP[(x + y) % 6]; });
    if (t.leisure === 'park' || t.leisure === 'pitch') preencher(g, (x, y) => { terreno[idx(x, y)] = CAPIM; });
  }
  // escarpas (natural=cliff) sao linhas: rocha nua na borda
  for (const e of osm) if ((e.tags || {}).natural === 'cliff') riscar(geo(e), (x, y) => { terreno[idx(x, y)] = ROCHA; folha[idx(x, y)] = 0; });

  // 3) hidrografia como estrada tipo Stream
  const leito = new Uint8Array(W * H);
  for (const e of osm) {
    const t = e.tags || {}; if (t.waterway !== 'river' && t.waterway !== 'stream') continue;
    riscar(geo(e), (x, y) => {
      if (rio === 'stream') estrada[idx(x, y)] = EST.stream;
      else if (rio === 'agua') { leito[idx(x, y)] = 2; terreno[idx(x, y)] = AGUA; folha[idx(x, y)] = 0; }
      else { leito[idx(x, y)] = 1; terreno[idx(x, y)] = ((x + y) % 3 === 0) ? AREIA : CASCALHO; folha[idx(x, y)] = 0; }
    });
  }

  // 4) ruas (a via mais importante vence) + faixa urbana ao redor
  const vias = osm.filter((e) => (e.tags || {}).highway && VIA[(e.tags || {}).highway] != null);
  for (const e of vias) {
    const tipo = VIA[e.tags.highway];
    (ruas === 'montadas' ? riscar4 : riscar)(geo(e), (x, y) => {
      const i = idx(x, y);
      if (estrada[i] === EST.stream) return;                // nao apagar o rio
      if (!estrada[i] || (PESO[tipo] || 0) > (PESO[estrada[i]] || 0)) estrada[i] = tipo;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dentro(x + dx, y + dy)) urbano[idx(x + dx, y + dy)] = 1;
    });
  }
  // O ATERRO (E86). O rio daqui tem UM tile de largura e e 8-conexo — uma escada diagonal de agua que
  // so se toca pelas quinas —, e a rua 4-conexa ora passa entre duas quinas, ora encosta num tile de
  // agua. Rua sobre agua vira agua no 3-D (o motor desenha o espelho por cima) e Water nao da
  // passagem: a rua ficava cortada. Nao ha "trecho com o rio dos dois lados" para uma ponte
  // (pontesNasTravessias recusou os 39 casos); num curso d'agua deste tamanho o certo e o aterro com
  // bueiro: o tile sai do leito e vira chao de rua, e o espelho segue dos dois lados.
  let aterros = 0;
  for (let i = 0; i < W * H; i++) if (estrada[i] && leito[i] === 2) { leito[i] = 0; terreno[i] = CASCALHO; aterros++; }

  // chao urbano: terreiro nos quintais, pedra na rua (nucleo historico), pavimento nas vias maiores
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    // MANCHAS, nao listras (E86): o hash `(x*31+y*17)%10` desenhava faixas diagonais regulares de
    // Gravel no meio do Dirt Lot, visiveis na previa 3-D. Um ruido de baixa frequencia faz quintais
    // de terra batida, gramados e trechos de chao nu que se emendam como num bairro de verdade.
    if (urbano[i] && !estrada[i] && !leito[i]) {
      const n = Math.sin(x * 0.41 + 1.3) + Math.sin(y * 0.37 + 0.7) + Math.sin((x + y) * 0.23) + 0.6 * Math.sin((x - y) * 0.53);
      terreno[i] = n > 0.9 ? CHAO : n > -1.1 ? TERREIRO : 0 /* Dirt */; folha[i] = 0;
    }
    if (estrada[i] === EST.pav2) { terreno[i] = PEDRA; folha[i] = 0; }
    if (estrada[i] === EST.pav1) { terreno[i] = PAV; folha[i] = 0; }
    if (estrada[i]) folha[i] = 0;                            // nenhuma arvore no meio de trilha ou estrada de terra
  }

  // 5) construcoes: uma por edificacao do OSM, deduplicada por tile
  const molde1 = moldes(BASE, (b) => b.count === 1).concat(moldes(QB + 'Town (1696 X 1696) 003a1.btt', (b) => b.count === 1));
  const molde2 = moldes(QB + 'Town (1696 X 1696) 003a1.btt', (b) => b.count === 2);
  // O CATALOGO (E86): cada molde com nome, e a escolha reta/diagonal pela orientacao do predio no OSM.
  const CAT = JSON.parse(fs.readFileSync(new URL('../../research/predios_catalogo.json', import.meta.url), 'utf8')).predios;
  const doCat = (nomes) => nomes.map((n) => CAT.find((c) => c.nome === n)).filter(Boolean).map((c) => ({ bytes: Buffer.from(c.registro, 'hex'), count: c.andares, sub: c.sub, nome: c.nome }));
  const CATALOGO = {
    reto1: doCat(['House 4', 'House 5', 'Commercial 1']), diag1: doCat(['House 12', 'House 13', 'Commercial 5']),
    reto2: doCat(['House 1', 'House 2', 'House 3', 'House 9', 'Commercial 3']), diag2: doCat(['House 7', 'House 10', 'House 11', 'House 16', 'Commercial 7']),
    igreja: doCat(['Church 3'])[0],
  };
  const porTile = new Map();
  for (const e of osm) {
    const t = e.tags || {}; if (!t.building) continue;
    const g = geo(e); if (g.length < 3) continue;
    let ax = 0, ay = 0, n = 0; for (const [x, y] of g) { ax += x; ay += y; n++; }
    const cx = ax / n, cy = ay / n;
    let A = 0; for (let k = 0; k < g.length; k++) { const [x1, y1] = g[k], [x2, y2] = g[(k + 1) % g.length]; A += x1 * y2 - x2 * y1; }
    A = Math.abs(A) / 2;                                    // area em tiles (shoelace)
    if (A <= 0.3) continue;                                 // galpao/telheiro de menos de 20 m2
    const meioX = cx - Math.round(cx) > 0.25, meioY = cy - Math.round(cy) > 0.25;
    // recorte: o meio-tile empurra a leitura um tile adiante, entao a borda leste/norte sobra 1
    const bx = Math.round(cx), by = Math.round(cy);
    // A FILEIRA DA BORDA NAO ACEITA PREDIO (E84): na ida e volta pelo editor voltaram 779 das 780
    // casas, e a que sumiu era a unica em tileY = 0. Um tile de folga nos quatro lados.
    if (bx < 1 || by < 1 || bx + (meioX ? 1 : 0) >= W - 1 || by + (meioY ? 1 : 0) >= H - 1) continue;
    const andares = +(t['building:levels'] || 0) >= 2 || A > 3.2 ? 2 : 1;
    // a orientacao: o angulo da aresta mais longa do contorno, dobrado em 0..90 graus
    let angulo = 0, maior = 0;
    for (let q = 0; q < g.length; q++) { const [x1, y1] = g[q], [x2, y2] = g[(q + 1) % g.length]; const L = Math.hypot(x2 - x1, y2 - y1); if (L > maior) { maior = L; angulo = Math.abs(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) % 90; } }
    const diagonal = angulo > 22.5 && angulo < 67.5;
    const k = bx + ',' + by;
    const ant = porTile.get(k);
    if (!ant || A > ant.A) porTile.set(k, { x: bx, y: by, meioX, meioY, A, andares, diagonal, igreja: ehIgreja(e) });
  }
  const barranco = (x, y) => { let d = 0; const v = alt(x, y); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (dentro(x + dx, y + dy)) d = Math.max(d, Math.abs(v - alt(x + dx, y + dy))); return d; };
  const descartes = { estrada: 0, barranco: 0, vizinhanca: 0, excesso: 0 };
  const postas = new Set(); let pares = 0;
  const escolhidas = [];
  for (const b of [...porTile.values()].sort((p, q) => q.A - p.A)) {          // as maiores primeiro
    const i = idx(b.x, b.y);
    if (estrada[i] || leito[i]) { descartes.estrada++; continue; }   // leito 1 (cascalho) ou 2 (agua)
    if (barranco(b.x, b.y) > barrancoMax) { descartes.barranco++; continue; }
    const viz = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => postas.has((b.x + dx) + ',' + (b.y + dy))).length;
    if (viz && pares + viz > vizinhasMax) { descartes.vizinhanca++; continue; }
    if (escolhidas.length >= casasMax) { descartes.excesso++; continue; }
    postas.add(b.x + ',' + b.y); pares += viz; escolhidas.push(b);
  }
  // A IGREJA-MATRIZ: no OSM ela e um PONTO (amenity=place_of_worship), nao um contorno de predio, entao
  // o laco de cima nunca a ve. Entra aqui, no tile do ponto, com o modelo de torre (Church 3, 8
  // andares), tirando as casas que caem na pegada dela.
  if (predios === 'catalogo' && CATALOGO.igreja) {
    const e = LUG.igreja;
    const pts = e ? (e.geometry ? geo(e) : (e.lat ? [[tx(e.lon), ty(e.lat)]] : [])) : [];
    if (pts.length) {
      const ix = Math.round(pts.reduce((a, q) => a + q[0], 0) / pts.length), iy = Math.round(pts.reduce((a, q) => a + q[1], 0) / pts.length);
      if (ix >= 2 && iy >= 2 && ix < W - 2 && iy < H - 2) {
        for (let k = escolhidas.length - 1; k >= 0; k--) if (Math.abs(escolhidas[k].x - ix) <= 2 && Math.abs(escolhidas[k].y - iy) <= 2) escolhidas.splice(k, 1);
        escolhidas.push({ x: ix, y: iy, meioX: false, meioY: false, A: 99, andares: 8, diagonal: false, igreja: true });
      }
    }
  }
  const construcoes = escolhidas.map((b, i) => {
    if (predios === 'catalogo') {
      if (b.igreja && CATALOGO.igreja) return { ...b, molde: CATALOGO.igreja };
      const pool = CATALOGO[(b.diagonal ? 'diag' : 'reto') + (b.andares === 2 ? '2' : '1')];
      return { ...b, molde: pool[(b.x * 7 + b.y * 13 + i) % pool.length] };
    }
    const pool = b.andares === 2 && molde2.length ? molde2 : molde1;
    return { ...b, molde: pool[(b.x * 7 + b.y * 13 + i) % pool.length] };
  });
  // terreiro sob cada casa, para a casa nao nascer em cima de rocha/mata
  for (const b of construcoes) { const i = idx(b.x, b.y); if (terreno[i] === MATA || terreno[i] === ROCHA || terreno[i] === ROCHA2) terreno[i] = TERREIRO; folha[i] = 0; }

  // 6) rotulos no mapa (secao 92): nomes reais, em ASCII
  const rotulos = new Map();
  // o rotulo: o da configuracao ou o nome do OSM em ASCII, curto (o maior rotulo visto em QB tem 22)
  const curto = (t, max = 22) => { const w = ascii(t).split(/\s+/).filter(Boolean); for (let k = 0; k < w.length; k++) { const s = w.slice(k).join(' '); if (s.length <= max) return s; } return ascii(t).slice(0, max); };
  const rotuloDe = (k) => (C[k] && C[k].rotulo) || curto((LUG[k] && LUG[k].tags && LUG[k].tags.name) || '') || null;
  const rioOsm = osm.find((e) => (e.tags || {}).waterway === 'river');
  const alvos = [
    [LUG.igreja, rotuloDe('igreja')],
    [LUG.terceiro, rotuloDe('terceiro')],
    [rioOsm, C.rio || (rioOsm && ascii(rioOsm.tags.name).slice(0, 22)) || null],
  ];
  for (const [e, nome] of alvos) {
    if (!e || !nome) continue;
    const g = e.geometry ? geo(e) : (e.lat ? [[tx(e.lon), ty(e.lat)]] : []);
    if (!g.length) continue;
    const cx = Math.round(g.reduce((s, q) => s + q[0], 0) / g.length), cy = Math.round(g.reduce((s, q) => s + q[1], 0) / g.length);
    if (dentro(cx, cy) && !rotulos.has(idx(cx, cy))) rotulos.set(idx(cx, cy), nome);
  }
  const cX = Math.round(tx(CLON)), cY = Math.round(ty(CLAT));
  if (!rotulos.has(idx(cX, cY))) rotulos.set(idx(cX, cY), ascii(C.nome).slice(0, 22));

  // O RIO COMO ESPELHO (E86): agua em encosta vira canion — o motor achata e escava cada tile. Cada
  // tile do leito fica na MENOR altura da vizinhanca 5x5 menos 1 m, suavizada ao longo do rio (media
  // dos vizinhos de leito), para o espelho andar plano e so descer a jusante.
  let altRio = null;
  if (rio === 'agua') {
    altRio = new Float32Array(W * H).fill(NaN);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (leito[idx(x, y)] !== 2) continue;
      // 3x3 menos 0,4 m: a v5 usava 5x5 menos 1 m e o rio saiu uma garganta de paredes verticais
      let lo = Infinity; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dentro(x + dx, y + dy)) lo = Math.min(lo, alt(x + dx, y + dy));
      altRio[idx(x, y)] = lo - 0.4;
    }
    for (let volta = 0; volta < 6; volta++) {
      const nova = Float32Array.from(altRio);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (Number.isNaN(altRio[idx(x, y)])) continue;
        let s0 = 0, n0 = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const v = dentro(x + dx, y + dy) ? altRio[idx(x + dx, y + dy)] : NaN; if (!Number.isNaN(v)) { s0 += v; n0++; } }
        nova[idx(x, y)] = Math.min(altRio[idx(x, y)], s0 / n0);
      }
      altRio = nova;
    }
  }
  // A CORREDEIRA (E86). Agua tem de ser plana: cada degrau do espelho entre tiles vizinhos vira uma
  // parede escura no 3-D. Em Mucuge o maior degrau e 0,8 m; em Lencois, que desce da serra, chegou a
  // 2,1 m (63 pares acima de 1 m) e o leito virou uma escada de paredes. Onde o espelho desce mais que
  // `corredeira` metros para um vizinho de agua, os DOIS tiles saem da agua e viram riacho (estrada
  // Stream) sobre Rocky, na altura do terreno — o poco plano segue como agua dos dois lados.
  let corredeiras = 0;
  if (altRio && corredeira) {
    const marcar = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = altRio[idx(x, y)]; if (Number.isNaN(v)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const X = x + dx, Y = y + dy; if (!dentro(X, Y)) continue;
        const u = altRio[idx(X, Y)]; if (Number.isNaN(u)) continue;
        if (Math.abs(u - v) > corredeira) { marcar[idx(x, y)] = 1; marcar[idx(X, Y)] = 1; }
      }
    }
    for (let i = 0; i < W * H; i++) if (marcar[i]) { altRio[i] = NaN; leito[i] = 0; terreno[i] = ROCHA; folha[i] = 0; if (!estrada[i]) estrada[i] = EST.stream; corredeiras++; }
  }
  // A MARGEM EM RAMPA: os tiles a 1 e 2 de distancia do espelho descem ate ele (2/3 e 1/3 do caminho),
  // para o rio correr num vale raso e nao num corte vertical.
  let margem = null;
  if (altRio) {
    margem = new Float32Array(W * H).fill(NaN);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!Number.isNaN(altRio[idx(x, y)])) continue;
      let d = 9, nivel = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X = x + dx, Y = y + dy; if (!dentro(X, Y)) continue;
        const v = altRio[idx(X, Y)]; if (Number.isNaN(v)) continue;
        const dd = Math.max(Math.abs(dx), Math.abs(dy)); if (dd < d || (dd === d && v < nivel)) { d = dd; nivel = v; }
      }
      if (d > 2) continue;
      const h = alt(x, y); if (h <= nivel) continue;
      margem[idx(x, y)] = nivel + (h - nivel) * (d === 1 ? 0.35 : 0.7);
    }
  }
  const altFinal = (x, y) => {
    if (altRio && !Number.isNaN(altRio[idx(x, y)])) return altRio[idx(x, y)];
    if (margem && !Number.isNaN(margem[idx(x, y)])) return margem[idx(x, y)];
    return alt(x, y);
  };

  // ZONAS DE SETUP (E86, Etapa 5). Ate o Mucuge 6 a grade saia com zona 0 em todo tile: o editor
  // carrega, mas um mapa sem zona de setup nao e jogavel ("Quick Battle Maps MUST have valid Setup
  // Zones"). `zonas = 'base'` copia a pintura da base tile a tile — o tamanho e o mesmo: Red 1 na
  // faixa sul (linhas 0..7) para o atacante, Blue 1 da linha 39 ao norte para o defensor —, tirando
  // a agua, para ninguem nascer dentro do rio.
  const gBase = zonas === 'base' ? lerGrade(p.m) : null;
  const zonaDe = (x, y) => (gBase && !leito[idx(x, y)] ? gBase.tile(x, y).zona : 0);

  // AS PECAS DAS RUAS (E86): forma e rotacao por tile, pelos vizinhos, como a Draw Tool monta.
  // riacho so se liga a riacho, rua so a rua (senao o riacho da corredeira "entra" na rua vizinha)
  const pecasRua = ruas === 'montadas' ? montarRuas(W, H, estrada, (a, b) => !!a && !!b && (a === EST.stream) === (b === EST.stream)) : null;
  const byteRua = (i) => (pecasRua ? pecasRua.byte[i] : estrada[i]);
  const rotRua = (i) => (pecasRua ? pecasRua.rot[i] : 0);

  // --- montar e escrever ---
  const grade = montarGrade(W, H, (x, y) => ({ tipo: terreno[idx(x, y)], estrada: byteRua(idx(x, y)), flags: rotRua(idx(x, y)), foliage: folha[idx(x, y)] ? folha[idx(x, y)] - 1 : 0, arvore: folha[idx(x, y)] > 0 && folha[idx(x, y)] - 1 < MATO, zona: zonaDe(x, y), rotulo: rotulos.get(idx(x, y)) }));
  const elevacao = montarElevacao(W, H, altFinal, (x, y) => x % rede === 0 && y % rede === 0);
  const construcoesBuf = montarConstrucoes(construcoes, p.OX, p.OY);
  // PONTES (E86): rua sobre agua vira agua no 3-D e Water nao da passagem — sem ponte, as ruas que
  // cruzam o rio ficavam cortadas para veiculo. Uma ponte de concreto por travessia.
  const travessias = rio === 'agua' ? pontesNasTravessias(W, H, estrada, (x, y) => leito[idx(x, y)] === 2) : { pontes: [], longas: [] };
  const pontesFlavor = montarPontesFlavor(travessias.pontes, [], p.OX, p.OY);
  // autor pediu o mapa SEM planos de IA, mas esvaziar os planos e uma peca que nenhuma medida cobre:
  // no arquivo principal ficam os da base (regiao identica a de um mapa real) e o esvaziamento vai
  // para o segundo arquivo.
  let resto = planos === 'vazios' ? restoSemPlanos(BASE).resto : undefined;
  let objs = [];
  if (objetivos === 'mucuge') {
    // Os lugares, do OSM: a praca do centro comercial, a matriz e o cemiterio "bizantino".
    const semente = (e) => { if (!e) return null; const g = e.geometry ? geo(e) : (e.lat ? [[tx(e.lon), ty(e.lat)]] : []); return g.length ? [Math.round(g.reduce((a, q) => a + q[0], 0) / g.length), Math.round(g.reduce((a, q) => a + q[1], 0) / g.length)] : null; };
    // sem praca achada, o centro do mapa
    const praca = semente(LUG.centro) || [Math.round(cM[0]), Math.round(cM[1])];
    const igreja = semente(LUG.igreja), terceiro = semente(LUG.terceiro);
    const nomeObj = nomeObjetivo;                            // o nome que cabe (ver nomeObjetivo)
    const nomeDe = (k, padrao) => (C[k] && C[k].nome) || ascii((LUG[k] && LUG[k].tags && LUG[k].tags.name) || '').replace(/^(Igreja|Praca|Cemiterio)( (de|da|do|dos|das))? /i, '') || padrao;
    resto = Buffer.from(resto || p.resto);
    objs = trocarObjetivos(resto, p, [
      { de: 'Podlypyky (Maj VP)', para: nomeObj(C.centro && C.centro.nome || C.nome, 'Maj', 18), semente: praca },
      { de: 'West Farms (Min VP)', para: nomeObj(nomeDe('terceiro', 'Cemiterio'), 'Min', 19), semente: terceiro || igreja },
      { de: 'East Factory (Min VP)', para: nomeObj(nomeDe('igreja', 'Igreja'), 'Min', 21), semente: igreja || terceiro },
    ], (x, y) => !leito[idx(x, y)]);
  }
  let zonasIA = [], triggers = [];
  if (ia === 'mucuge' && objs.length && planos === 'base') {
    zonasIA = trocarZonasIA(resto, p, objs, (x, y) => !leito[idx(x, y)], zonaDe);
    triggers = trocarTriggers(resto, p, objs, (x, y) => !leito[idx(x, y)]);
  }
  const r = escrever(BASE, saida, { construcoes: construcoesBuf, pontesFlavor, grade, elevacao, ...(resto ? { resto } : {}) });

  const hist = {}; terreno.forEach((v) => { hist[v] = (hist[v] || 0) + 1; });
  const hEst = {}; estrada.forEach((v) => { if (v) hEst[v] = (hEst[v] || 0) + 1; });
  return { r, triggers, cidade: C.nome, lugares: Object.fromEntries(Object.entries(LUG).map(([k, e]) => [k, e ? ascii((e.tags || {}).name || (e.tags || {}).landuse || '?') : null])), objs, zonasIA, pontes: travessias.pontes, pontesLongas: travessias.longas, pontesRecusadas: travessias.recusadas, aterros, corredeiras, pecasRua: pecasRua && pecasRua.conta, construcoes: construcoes.length, andares2: construcoes.filter((b) => b.andares === 2).length,
    rotulos: [...rotulos.values()], altMin, altMax, relevo: altMax - altMin, relevoNoMapa: R0 > relevoMax ? S * (1 - Math.exp(-R0 / S)) : R0, S, descartes, pares, hist, hEst,
    tilesRua: Object.values(hEst).reduce((a, b) => a + b, 0) };
}

// OS OBJETIVOS DA BASE, TROCADOS NO LUGAR. Um objetivo de terreno mora na cauda da regiao de IA,
// duas vezes (uma lista por lado, FORMATO 103/114):
//   00 | tipo | u16 pontos | u16 len | nome | u32 cor | u32 n | n x (u32 x, u32 y)
// com x,y em TILES somados a origem do mapa (OX, OY) e a lista em ordem de x e depois de y. A
// regiao tem um u32 de comprimento na frente; para nao ter de recalcula-lo (nem descobrir se ha
// outro por cima), o nome novo tem o MESMO comprimento (completado com espacos) e a lista a MESMA
// contagem: nenhum byte do resto muda de lugar. Os tiles de cada objetivo sao os n mais proximos da
// semente, pulando a agua e os ja tomados por outro objetivo.
function trocarObjetivos(resto, p, lista, pode) {
  const tomados = new Set();
  const feitos = [];
  for (const o of lista) {
    if (!o.semente) throw new Error(`objetivo ${o.para}: lugar nao achado no OSM`);
    if (o.para.length > o.de.length) throw new Error(`objetivo ${o.para}: nome maior que ${o.de}`);
    const de = Buffer.from(o.de, 'latin1'), para = Buffer.from(o.para.padEnd(o.de.length, ' '), 'latin1');
    const achados = [];
    for (let i = resto.indexOf(de); i >= 0; i = resto.indexOf(de, i + 1)) {
      if (resto[i - 6] !== 0 || resto.readUInt16LE(i - 2) !== de.length) continue;
      achados.push(i);
    }
    if (achados.length !== 2) throw new Error(`objetivo ${o.de}: ${achados.length} ocorrencias, esperava 2 (uma por lado)`);
    const n = resto.readUInt32LE(achados[0] + de.length + 4);
    let ax = 0, ay = 0; for (let k = 0; k < n; k++) { ax += resto.readUInt32LE(achados[0] + de.length + 8 + 8 * k) - p.OX; ay += resto.readUInt32LE(achados[0] + de.length + 12 + 8 * k) - p.OY; }
    const antes = [ax / n, ay / n];
    if (achados.some((i) => resto.readUInt32LE(i + de.length + 4) !== n)) throw new Error(`objetivo ${o.de}: contagens diferentes nos dois lados`);
    const [sx, sy] = o.semente;
    const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pode(x, y) && !tomados.has(y * W + x)) cand.push([Math.hypot(x - sx, y - sy), x, y]);
    cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const tiles = cand.slice(0, n).map(([, x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (tiles.length !== n) throw new Error(`objetivo ${o.para}: so ${tiles.length} tiles livres, precisa ${n}`);
    tiles.forEach(([x, y]) => tomados.add(y * W + x));
    for (const i of achados) {
      para.copy(resto, i);
      const t0 = i + de.length + 8;
      tiles.forEach(([x, y], k) => { resto.writeUInt32LE(x + p.OX, t0 + 8 * k); resto.writeUInt32LE(y + p.OY, t0 + 8 * k + 4); });
    }
    const xs = tiles.map((t) => t[0]), ys = tiles.map((t) => t[1]);
    feitos.push({ nome: o.para, pontos: resto.readUInt16LE(achados[0] - 4), n, semente: o.semente, antes, caixa: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  return feitos;
}

// AS ZONAS DOS PLANOS DE IA, NO LUGAR (E86). Os planos vem da base e as zonas que eles pintam
// (setup de cada grupo, destino de cada ordem) miram a geografia do Podlypyky: a vila, as fazendas
// do oeste, a fabrica do leste. No Mucuge so a vila caia, por acaso, na igreja. Cada zona PEQUENA
// (ate 2500 tiles; as areas de 4-5 mil que cobrem meio mapa ficam como estao) cujo centro esta a ate
// 25 tiles do centro antigo de um objetivo passa a ocupar os n tiles mais proximos do objetivo novo
// correspondente — mesma contagem, entao nada muda de lugar na regiao de IA. Setup do lado azul so em
// tile da zona de setup azul (o manual: fora dela "the AI will never setup there").
function trocarZonasIA(resto, p, objs, pode, zonaDe) {
  const r = lerPlanos(BASE);
  if (!r.confiavel) throw new Error('planos da base ilegiveis');
  const fimElevBase = p.c.length - p.resto.length;
  const feitos = [];
  const reescrever = (em, tiles, lado, setup) => {
    const n = tiles.length; if (!n || n > 2500) return;
    const cx = tiles.reduce((a, t) => a + t[0], 0) / n, cy = tiles.reduce((a, t) => a + t[1], 0) / n;
    let alvo = null, dist = 25;
    for (const o of objs) { const d = Math.hypot(cx - o.antes[0], cy - o.antes[1]); if (d < dist) { dist = d; alvo = o; } }
    if (!alvo) return;
    const [sx, sy] = alvo.semente;
    const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!pode(x, y)) continue;
      if (setup && lado === 'azul') { const z = zonaDe(x, y); if (z < 1 || z > 3) continue; }
      cand.push([Math.hypot(x - sx, y - sy), x, y]);
    }
    cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const novos = cand.slice(0, n).map(([, x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (novos.length !== n) throw new Error(`zona de IA: so ${novos.length} tiles para ${n}`);
    const off = em - fimElevBase;
    if (resto.readUInt32LE(off) !== n) throw new Error(`zona de IA: contagem ${resto.readUInt32LE(off)} != ${n} em resto+${off}`);
    novos.forEach(([x, y], k) => { resto.writeUInt32LE(x + p.OX, off + 4 + 8 * k); resto.writeUInt32LE(y + p.OY, off + 8 + 8 * k); });
    feitos.push({ lado, n, para: alvo.nome.trim(), setup });
  };
  for (const pl of r.planos) for (const g of pl.grupos) {
    reescrever(g.setupEm, g.setup, pl.lado, true);
    g.ordens.forEach((o, k) => reescrever(g.ordensEm[k], o, pl.lado, false));
  }
  return feitos;
}

// OS OBJETIVOS-TRIGGER, NO LUGAR (E87, FORMATO 123). Alem dos objetivos de pontos, a lista de cada
// lado traz objetivos "A.I. Trigger" (tipos 5..8): areas invisiveis que, tocadas, soltam um grupo que espera por
// elas ("Wait For"). O Podlypyky tem tres no azul — "farms", "Podlypyky" e "Factory" —, e as reservas
// G4, G5 e G6 do defensor ficam no setup ate o atacante toca-los (saem entre 45 e 59 min): o
// contra-ataque do mapa. trocarZonasIA mandou as ORDENS dessas reservas para os objetivos novos, mas o
// gatilho continuava na geografia do Podlypyky. Cada trigger vai para o objetivo novo cujo centro
// ANTIGO esta mais perto do dele, nos n tiles mais proximos da semente nova (mesma contagem, nome do
// mesmo tamanho: nada muda de lugar). Nao entram na conta de vitoria nem aparecem na partida.
function trocarTriggers(resto, p, objs, pode) {
  const fimElevBase = p.c.length - p.resto.length;
  const rIA = lerPlanos(BASE);
  const L = listasDeObjetivos(p.c, rIA.ini + 4 + rIA.len);
  const feitos = [];
  for (const lado of ['azul', 'vermelho']) for (const t of L[lado]) {
    if (!ehTrigger(t.tipo) || !t.n) continue;
    let cx = 0, cy = 0;
    for (let k = 0; k < t.n; k++) { cx += p.c.readUInt32LE(t.tilesEm + 8 * k) - p.OX; cy += p.c.readUInt32LE(t.tilesEm + 8 * k + 4) - p.OY; }
    cx /= t.n; cy /= t.n;
    let alvo = null, dist = Infinity;
    for (const o of objs) { const d = Math.hypot(cx - o.antes[0], cy - o.antes[1]); if (d < dist) { dist = d; alvo = o; } }
    if (!alvo) continue;
    const [sx, sy] = alvo.semente;
    const cand = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pode(x, y)) cand.push([Math.hypot(x - sx, y - sy), x, y]);
    cand.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const novos = cand.slice(0, t.n).map(([, x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const off = t.tilesEm - fimElevBase;
    if (resto.readUInt32LE(off - 4) !== t.n) throw new Error(`trigger ${t.nome}: contagem ${resto.readUInt32LE(off - 4)} != ${t.n}`);
    novos.forEach(([x, y], k) => { resto.writeUInt32LE(x + p.OX, off + 8 * k); resto.writeUInt32LE(y + p.OY, off + 8 * k + 4); });
    // o nome: o do objetivo novo, cortado ao tamanho do antigo (completado com espacos)
    const nomeNovo = alvo.nome.replace(/\s*\((Maj|Min) VP\)\s*$/, '').trim().slice(0, t.nome.length).padEnd(t.nome.length, ' ');
    Buffer.from(nomeNovo, 'latin1').copy(resto, t.pos - fimElevBase);
    feitos.push({ lado, de: t.nome, para: nomeNovo.trim(), n: t.n, distAntiga: Math.round(dist) });
  }
  return feitos;
}

const EH_MAIN = process.argv[1] && /[\\/]mucuge\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const DIR = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  const saida = process.argv[2] || DIR + 'MUCUGE BA 2.btt';
  const o = gerar(saida);
  if (!process.argv[2]) { const b = gerar(DIR + 'MUCUGE BA 2B (rio e sem IA).btt', { rio: 'stream', planos: 'vazios' }); console.log(`segundo arquivo: ${b.r.bytes} bytes, rio como Stream e planos de IA vazios`); }
  console.log(`  relevo no mapa ${o.relevoNoMapa.toFixed(1)} m (S = ${o.S.toFixed(1)}); casas descartadas: ${JSON.stringify(o.descartes)}; pares vizinhos ${o.pares}`);
  console.log(`${saida}\n  ${o.r.bytes} bytes (base ${o.r.base})`);
  console.log(`  construcoes ${o.construcoes} (${o.andares2} com 2 andares)`);
  console.log(`  altitude real ${o.altMin}..${o.altMax} m (relevo ${o.relevo} m) -> mapa 20..${(20 + o.relevoNoMapa).toFixed(0)} m, comprimido`);
  console.log(`  tiles com estrada ${o.tilesRua}:`, JSON.stringify(o.hEst));
  console.log(`  terreno:`, JSON.stringify(Object.entries(o.hist).sort((a, b) => b[1] - a[1]).slice(0, 8)));
  console.log(`  rotulos: ${o.rotulos.join(' | ')}`);
}
