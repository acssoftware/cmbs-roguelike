// A GALERIA DOS MAPAS DO ROGUELIKE (04/10/2026): os mapas de Quick Battle que o app sorteia (`mapCensus()`, os
// `serve`) desenhados de cima, numa pagina estatica para folhear. Por mapa, duas imagens PNG do mesmo tamanho:
// o terreno (chao por tipo, relevo sombreado, folhagem, ruas, riachos, muros e predios) e as zonas de setup
// (azul = valores 1-3, vermelho = 4-7, como em `zonas.mjs pintura`), que a pagina sobrepoe e liga/desliga.
// Norte em cima: a grade comeca no SUL (linha 0 = y maximo da imagem).
//
//   node tools/re/galeria_mapas.mjs            -> research/galeria_mapas/index.html + png/: SO a selecao do autor
//                                                (mapas.json: Assault/Attack/Probe e os Meet), com a marca de plano de IA autoral
//   node tools/re/galeria_mapas.mjs --meet     -> research/galeria_meet/: os Meeting Engagement elegiveis (research/mapas_meet.json,
//                                                `serve`), lidos da pasta do jogo, com o resultado da bateria me1 (E146)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { mapCensus, meetCensus, mapFile } from '../../app/src/catalog.mjs';
import { lerMapa, lerGrade } from './mapa.mjs';
import { lerElevacao } from './mapa_escrever.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const MEET = process.argv.includes('--meet');
const SAIDA = path.join(RAIZ, 'research', MEET ? 'galeria_meet' : 'galeria_mapas');
const QB = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Quick Battle Maps/';
const PX = 2;   // pixels por tile (8 m)

// ------------------------------------------------------------------------------------------ PNG

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
export function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const cru = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(cru, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(cru, { level: 9 })), bloco('IEND', Buffer.alloc(0))]);
}

// --------------------------------------------------------------------------------------- cores

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// chao (terreno_catalogo.json): verdes para grama, marrons para terra, cinzas para pedra e calcamento
const CHAO = {
  0: '#9c7a52', 1: '#a8664a', 2: '#8f7b5c', 4: '#8d8a80', 5: '#97796a', 6: '#d8c48e', 7: '#7fa65a', 8: '#93ad5c', 9: '#76a356',
  10: '#8fae63', 11: '#6f9a4f', 12: '#86a454', 13: '#879a55', 14: '#6a924a', 16: '#6e5a42', 17: '#6b8a6e', 18: '#a3a3a0', 19: '#b0aea8',
  20: '#b3a58c', 21: '#a08868', 25: '#a98f5f', 26: '#a98f5f', 28: '#3f74b0', 29: '#9d958a', 30: '#5f92c4', 31: '#c2b36a', 32: '#b8a85c',
  33: '#c9b874', 34: '#b5b06a', 35: '#c4a95f', 36: '#bba76c', 37: '#7b9a7a', 38: '#5d8746', 39: '#476e37', 40: '#7aa8d4', 41: '#7a776f',
  45: '#5a7f74', 46: '#7a9c52',
};
const CHAO_RGB = Object.fromEntries(Object.entries(CHAO).map(([k, v]) => [k, hex(v)]));
// estradas por faixa do byte1 (base do tipo + forma 0..8): terra, cascalho, pavimento 1 e 2, trilha, (46),
// ferrovia, riacho, rodovia; 83+ sao muros e cercas
function corDaEstrada(e) {
  if (e >= 83) return hex('#4a4038');
  const t = Math.floor((e - 1) / 9);
  return hex(['#8a6a44', '#a49274', '#5e5e5c', '#4c4c4a', '#b59d78', '#6e6e6a', '#2b2b2b', '#2f6db5', '#3b3b3b'][t] || '#555555');
}
const PREDIO = hex('#b24a3a');
const AZUL = [70, 130, 230], VERMELHO = [225, 60, 50];

// ------------------------------------------------------------------------------------- desenho

export function desenhar(arquivo) {
  const m = lerMapa(arquivo); const g = lerGrade(m); const e = lerElevacao(m);
  const { W, H } = m; const w = W * PX, h = H * PX;
  const img = Buffer.alloc(w * h * 4), zonas = Buffer.alloc(w * h * 4);
  let zmin = Infinity, zmax = -Infinity; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const z = e.em(x, y); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  const z = (x, y) => e.em(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y)));
  const pinta = (buf, tx, ty, cor, a = 255, dx = 0, dy = 0, tam = PX) => {
    for (let j = 0; j < tam; j++) for (let i = 0; i < tam; i++) {
      const px = tx * PX + dx + i, py = (H - 1 - ty) * PX + dy + j; if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const o = (py * w + px) * 4; buf[o] = cor[0]; buf[o + 1] = cor[1]; buf[o + 2] = cor[2]; buf[o + 3] = a;
    }
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = g.tile(x, y);
    // relevo: luz de noroeste sobre a declividade (8 m por tile), mais uma faixa leve a cada 5 m de altitude
    const dzx = (z(x + 1, y) - z(x - 1, y)) / 16, dzy = (z(x, y + 1) - z(x, y - 1)) / 16;
    let luz = 1 + (-dzx + dzy) * 0.9; luz = Math.max(0.6, Math.min(1.3, luz));
    const curva = Math.floor(z(x, y) / 5) !== Math.floor(z(x + 1, y) / 5) || Math.floor(z(x, y) / 5) !== Math.floor(z(x, y + 1) / 5);
    const base = CHAO_RGB[t.tipo] || [128, 128, 128];
    let cor = base.map((c) => Math.max(0, Math.min(255, Math.round(c * luz * (curva ? 0.9 : 1)))));
    pinta(img, x, y, cor);
    if (t.foliageFlag || (t.foliage > 0 && t.foliage < 32)) pinta(img, x, y, [40, 78, 34], 255, 0, 0, 1);         // arvore: ponto escuro
    if (t.estrada) pinta(img, x, y, corDaEstrada(t.estrada));
  }
  // zonas: contorno forte e preenchimento leve, para o terreno continuar legivel por baixo
  const lado = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return 0; const v = g.tile(x, y).zona; return v ? (v <= 3 ? 1 : 2) : 0; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = lado(x, y); if (!l) continue;
    const borda = lado(x + 1, y) !== l || lado(x - 1, y) !== l || lado(x, y + 1) !== l || lado(x, y - 1) !== l;
    pinta(zonas, x, y, l === 1 ? AZUL : VERMELHO, borda ? 235 : 60);
  }
  for (const b of m.construcoes) {
    // X,Y em meios-tiles de canvas: o predio cobre ~1 tile a partir do meio-tile da ancora
    const hx = b.X / 2 - m.OX, hy = b.Y / 2 - m.OY; const tx = Math.floor(hx), ty = Math.floor(hy);
    pinta(img, tx, ty, PREDIO, 255, Math.round((hx - tx) * PX), -Math.round((hy - ty) * PX), PX);
  }
  return { W, H, w, h, PX, img, terreno: png(w, h, img), zonas: png(w, h, zonas), zmin, zmax, casas: m.construcoes.length };
}

// ---------------------------------------------------------------------------------------- pagina

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(itens, { titulo = 'Roguelike Quick Battle maps', aba = 'Roguelike Maps', tipos = ['Attack'], nota = '' } = {}) {
  const legenda = [['Grass', '#7fa65a'], ['Forest', '#5d8746'], ['Dirt', '#9c7a52'], ['Crops / plowed', '#c2b36a'], ['Rock', '#8d8a80'], ['Pavement', '#a3a3a0'],
    ['Water', '#3f74b0'], ['Marsh', '#5a7f74'], ['Road', '#4c4c4a'], ['Stream', '#2f6db5'], ['Building', '#b24a3a'], ['Tree', '#284e22']]
    .map(([n, c]) => `<span class="leg"><i style="background:${c}"></i>${n}</span>`).join('') +
    '<span class="leg"><i style="background:rgba(70,130,230,.6)"></i>Blue setup</span><span class="leg"><i style="background:rgba(225,60,50,.6)"></i>Red setup (player)</span>';
  const dados = JSON.stringify(itens);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${aba}</title>
<style>
:root { --bg:#10130e; --panel:#1a1f16; --line:#3a422f; --ink:#ecefe6; --dim:#b4bca8; --faint:#8b937f; --accent:#d9b444; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: var(--panel); border-bottom: 1px solid var(--line); padding: 10px 16px; }
h1 { margin: 0 0 6px; font-size: 18px; color: var(--accent); }
.filtros { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
select, input { background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 3px; padding: 4px 6px; font: inherit; }
label { color: var(--dim); font-size: 13px; }
.leg { display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; color: var(--dim); font-size: 12px; }
.leg i { width: 12px; height: 12px; display: inline-block; border: 1px solid #0004; }
.legendas { margin-top: 6px; }
#n { color: var(--faint); font-size: 13px; }
.grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; padding: 16px; }
.cartao { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; cursor: zoom-in; }
.cartao:hover { border-color: var(--accent); }
.mini { position: relative; background: #000; aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.mini img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
.info { padding: 6px 9px 9px; font-size: 12.5px; }
.nome { color: var(--ink); font-weight: 600; font-size: 13px; word-break: break-word; }
.det { color: var(--faint); }
.tag { display: inline-block; padding: 0 5px; border-radius: 3px; background: #2a3122; color: var(--dim); margin-right: 4px; font-size: 11.5px; }
body.semzonas .z { display: none; }
#zoom { position: fixed; inset: 0; z-index: 10; background: #000d; display: none; flex-direction: column; }
#zoom.aberto { display: flex; }
#zoom .barra { padding: 8px 14px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
#zoom .barra b { color: var(--accent); }
#zoom .area { flex: 1; overflow: auto; display: flex; align-items: flex-start; justify-content: center; padding: 16px; }
#zoom .pilha { position: relative; }
#zoom .pilha img { display: block; image-rendering: pixelated; }
#zoom .pilha img.z { position: absolute; inset: 0; }
button { background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 3px; padding: 4px 10px; font: inherit; cursor: pointer; }
button:hover { border-color: var(--accent); }
</style></head>
<body>
<header>
  <h1>${titulo}</h1>${nota ? `<div class="det" style="margin-bottom:6px">${nota}</div>` : ''}
  <div class="filtros">
    <label>Mission <select id="f-tipo"><option value="">all</option>${tipos.map((t) => `<option>${t}</option>`).join('')}</select></label>
    <label>Tier <select id="f-tier"><option value="">all</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
    <label>Profile <select id="f-perfil"><option value="">all</option><option value="urbano">urban</option><option value="misto">mixed</option><option value="aberto">open</option></select></label>
    <label>Search <input id="f-txt" type="search" placeholder="name…"></label>
    <label><input id="f-zonas" type="checkbox" checked> setup zones</label>
    <span id="n"></span>
  </div>
  <div class="legendas">${legenda}</div>
</header>
<div class="grade" id="grade"></div>
<div id="zoom"><div class="barra"><b id="z-nome"></b><span id="z-det" class="det"></span><span style="flex:1"></span>
  <label>Zoom <select id="z-esc"><option value="1">1x</option><option value="2" selected>2x</option><option value="3">3x</option><option value="4">4x</option></select></label>
  <button id="z-fechar">Close (Esc)</button></div><div class="area"><div class="pilha" id="z-pilha"></div></div></div>
<script>
const MAPAS = ${dados};
const $ = (id) => document.getElementById(id);
const perfilEn = { urbano: 'urban', misto: 'mixed', aberto: 'open' };
function desenhar() {
  const t = $('f-tipo').value, tier = $('f-tier').value, p = $('f-perfil').value, q = $('f-txt').value.trim().toLowerCase();
  const lista = MAPAS.filter((m) => (!t || m.tipo === t) && (!tier || String(m.tier) === tier) && (!p || m.perfil === p) && (!q || m.f.toLowerCase().includes(q)));
  $('n').textContent = lista.length + ' of ' + MAPAS.length + ' maps';
  $('grade').innerHTML = lista.map((m) => '<div class="cartao" data-i="' + MAPAS.indexOf(m) + '"><div class="mini"><img src="png/' + m.png + '.png" loading="lazy" alt=""><img class="z" src="png/' + m.png + '.zonas.png" loading="lazy" alt=""></div>' +
    '<div class="info"><div class="nome">' + m.nomeHtml + '</div><div><span class="tag">' + m.tipo + '</span><span class="tag">tier ' + m.tier + '</span><span class="tag">' + (perfilEn[m.perfil] || m.perfil) + '</span>' + (m.iaAutoral ? '<span class="tag" style="background:#3a5a2a;color:#e8f5d0">AI plan</span>' : '') + '</div>' +
    '<div class="det">' + m.km + ' km · ' + m.tiles + ' tiles · ' + m.casas + ' buildings · ' + m.relevo + '</div><div class="det">red setup fits ' + (m.capVermelho ?? '?') + ' · blue ' + (m.capAzul ?? '?') + '</div>' + (m.bateria ? '<div class="det">' + m.bateria + '</div>' : '') + '</div></div>').join('');
  document.querySelectorAll('.cartao').forEach((c) => c.onclick = () => abrir(MAPAS[+c.dataset.i]));
}
let atual = null;
function abrir(m) {
  atual = m; const e = +$('z-esc').value;
  $('z-nome').textContent = m.f; $('z-det').textContent = m.tipo + ' · tier ' + m.tier + ' · ' + m.km + ' km · ' + m.casas + ' buildings · ' + m.relevo + ' · red setup fits ' + (m.capVermelho ?? '?');
  $('z-pilha').innerHTML = '<img src="png/' + m.png + '.png" width="' + m.w * e / 2 + '" alt=""><img class="z" src="png/' + m.png + '.zonas.png" width="' + m.w * e / 2 + '" alt="">';
  $('zoom').classList.add('aberto');
}
const fechar = () => $('zoom').classList.remove('aberto');
$('z-fechar').onclick = fechar; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
$('z-esc').onchange = () => atual && abrir(atual);
for (const id of ['f-tipo', 'f-tier', 'f-perfil']) $(id).onchange = desenhar;
$('f-txt').oninput = desenhar;
$('f-zonas').onchange = () => document.body.classList.toggle('semzonas', !$('f-zonas').checked);
desenhar();
</script>
</body></html>
`;
}

// ------------------------------------------------------------------------------------------ CLI

// A BIBLIOTECA DO APP (11/10/2026, E178): as mesmas duas imagens de todo mapa da selecao (Assault/Attack/Probe e Meet),
// lidas do pacote, em assets/map_images/<id>.png e <id>.zonas.png, mais index.json (nome do censo -> id, tamanho). O
// servidor as entrega so para o mapa de um no ja revelado (ou jogado): o nome do mapa de um no continua segredo.
export const imageId = (f) => String(f).replace(/\.btt$/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const APP_IMAGES = path.join(RAIZ, 'assets', 'map_images');
export function desenharParaApp(m) {
  const r = desenhar(mapFile(m));
  fs.mkdirSync(APP_IMAGES, { recursive: true });
  const id = imageId(m.f);
  fs.writeFileSync(path.join(APP_IMAGES, id + '.png'), r.terreno);
  fs.writeFileSync(path.join(APP_IMAGES, id + '.zonas.png'), r.zonas);
  return { id, w: r.w, h: r.h, W: r.W, H: r.H };
}

if (process.argv[1] && /galeria_mapas\.mjs$/.test(process.argv[1]) && process.argv.includes('--app')) {
  fs.rmSync(APP_IMAGES, { recursive: true, force: true });
  const indice = {}; const falhas = [];
  const mapas = [...mapCensus(), ...meetCensus()];
  for (const [i, m] of mapas.entries()) {
    try { indice[m.f] = desenharParaApp(m); } catch (e) { falhas.push(`${m.f}: ${e.message}`); }
    process.stdout.write(`\r${i + 1}/${mapas.length} ${m.f.slice(0, 60).padEnd(60)}`);
  }
  fs.writeFileSync(path.join(APP_IMAGES, 'index.json'), JSON.stringify({ note: 'node tools/re/galeria_mapas.mjs --app (E178): terrain and setup zones of every map of the selection, 2 px per 8 m tile, north up', maps: indice }, null, 1));
  let bytes = 0; for (const f of fs.readdirSync(APP_IMAGES)) bytes += fs.statSync(path.join(APP_IMAGES, f)).size;
  console.log(`\n${APP_IMAGES}: ${Object.keys(indice).length} mapas, ${(bytes / 1e6).toFixed(1)} MB${falhas.length ? '\nFALHAS:\n' + falhas.join('\n') : ''}`);
} else if (process.argv[1] && /galeria_mapas\.mjs$/.test(process.argv[1])) {
  fs.rmSync(path.join(SAIDA, 'png'), { recursive: true, force: true });   // so o que esta na selecao hoje
  fs.mkdirSync(path.join(SAIDA, 'png'), { recursive: true });
  const autorais = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(RAIZ, 'app', 'data', 'planos_ia.json'), 'utf8')).mapas));
  const meet = MEET ? JSON.parse(fs.readFileSync(path.join(RAIZ, 'research', 'mapas_meet.json'), 'utf8')).mapas.filter((m) => m.serve) : null;
  const ler = (f) => { try { return fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l)); } catch { return []; } };
  const off = new Map(ler(path.join(RAIZ, 'research', 'bateria', 'me1', 'offline.jsonl')).map((l) => [l.mapa, l]));
  const ids = new Map([...off.values()].map((l) => [l.id, l.mapa]));
  const tela = new Map(ler(path.join(RAIZ, 'research', 'bateria', 'me1', 'resultados.jsonl')).map((l) => [ids.get(l.caso), l]));
  const mapas = meet || [...mapCensus(), ...meetCensus()]; const itens = []; const falhas = [];
  for (const [i, m] of mapas.entries()) {
    const nome = m.f.replace(/\.btt$/i, ''); const id = nome.replace(/[^A-Za-z0-9]+/g, '_');
    try {
      const r = desenhar(MEET ? QB + m.f : mapFile(m));
      const o = MEET ? off.get(m.f) : null, t = MEET ? tela.get(m.f) : null;
      const bateria = o ? `battery: ${o.veredito === 'OK' ? `${o.noMapa} units placed, 0 outside the zone` : o.veredito}${t ? ` · loaded in game (${t.fases?.setup20 ?? t.fases?.setup} MB)` : ''}` : null;
      fs.writeFileSync(path.join(SAIDA, 'png', id + '.png'), r.terreno); fs.writeFileSync(path.join(SAIDA, 'png', id + '.zonas.png'), r.zonas);
      itens.push({ f: nome, nomeHtml: esc(nome), png: id, tipo: MEET ? 'Meet' : m.tipo, tier: m.tier, bateria, perfil: m.perfil, w: r.w, km: `${(r.W * 8 / 1000).toFixed(2)} × ${(r.H * 8 / 1000).toFixed(2)}`,
        tiles: `${r.W}×${r.H}`, casas: r.casas, relevo: `${Math.round(r.zmin)}–${Math.round(r.zmax)} m`, capVermelho: m.capVermelho, capAzul: m.capAzul,
        iaAutoral: !MEET && autorais.has(path.relative(path.join(RAIZ, 'assets'), mapFile(m)).split(path.sep).join('/')) });
      process.stdout.write(`\r${i + 1}/${mapas.length} ${nome.slice(0, 60).padEnd(60)}`);
    } catch (e) { falhas.push(`${nome}: ${e.message}`); }
  }
  itens.sort((a, b) => a.tier - b.tier || a.f.localeCompare(b.f));
  fs.writeFileSync(path.join(SAIDA, 'index.html'), MEET
    ? pagina(itens, { titulo: 'Meeting Engagement maps — eligible', aba: 'Meeting Engagement Maps', tipos: ['Meet'], nota: `${itens.length} maps that pass the E146 battery (both sides placed inside their setup zones, map intact). In a meeting engagement both sides attack: red is the player, blue the AI.` })
    : pagina(itens, { tipos: ['Attack', 'Meet'], nota: `Only the maps selected for the app (app/data/mapas.json): ${itens.filter((m) => m.tipo !== 'Meet').length} quick battle and ${itens.filter((m) => m.tipo === 'Meet').length} Meeting Engagement. <b>AI plan</b> = the blue AI plan was authored and reviewed (app/data/planos_ia.json).` }));
  let bytes = 0; for (const f of fs.readdirSync(path.join(SAIDA, 'png'))) bytes += fs.statSync(path.join(SAIDA, 'png', f)).size;
  console.log(`\n${path.join(SAIDA, 'index.html')}: ${itens.length} mapas, ${(bytes / 1e6).toFixed(1)} MB de imagens${falhas.length ? '\nFALHAS:\n' + falhas.join('\n') : ''}`);
}
