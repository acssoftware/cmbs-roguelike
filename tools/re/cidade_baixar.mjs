// BAIXAR UMA CIDADE para o gerador de mapas (E86, Etapa 6 do PLANO_MAPAS_NA_TELA).
//
//   node tools/re/cidade_baixar.mjs <id> <lat> <lon> ["Nome no mapa"]
//
// Grava tres arquivos:
//   C:/tmp/<id>.json              OSM da caixa do mapa (Overpass, `out geom`: vias com geometria,
//                                 nos so os que tem tag) — o mesmo formato do C:/tmp/mucuge.json
//   C:/tmp/<id>_elev.json         SRTM 30 m (opentopodata) numa grade de 4 em 4 tiles, chave
//                                 "lat,lon" com 6 casas — a que `mucuge.campoElevacao` le
//   research/cidades/<id>.json    a configuracao que `mucuge.gerar(saida, { cidade: '<id>' })` usa
//
// A caixa e a da base (1936 x 1808 m, `mucuge.caixaDaCidade`), centrada em lat/lon. Os lugares dos
// objetivos (praca, igreja, terceiro) saem da heuristica do gerador; para fixar um, edite a
// configuracao gravada. Fontes: OpenStreetMap (ODbL) e SRTM via opentopodata (limite publico: 100
// pontos e 1 chamada por segundo — o baixador espera 1,2 s entre chamadas).
import fs from 'node:fs';
import path from 'node:path';
import { caixaDaCidade } from './mucuge.mjs';

const [id, lat, lon, ...resto] = process.argv.slice(2);
if (!id || !lat || !lon) { console.log('uso: node tools/re/cidade_baixar.mjs <id> <lat> <lon> ["Nome no mapa"]'); process.exit(1); }
const cfg = { nome: resto.join(' ') || id, clat: +lat, clon: +lon, osm: `C:/tmp/${id}.json`, elev: `C:/tmp/${id}_elev.json` };
const cx = caixaDaCidade(cfg);
const UA = { 'User-Agent': 'cmbs-map-writer/0.1 (personal research; node fetch)', Accept: 'application/json' };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) OSM. Folga de 300 m em volta: rio e rua que cruzam a borda chegam inteiros.
if (!fs.existsSync(cfg.osm)) {
  const f = 300 / 110574;
  const bb = `${(cx.sul - f).toFixed(6)},${(cx.oeste - f).toFixed(6)},${(cx.norte + f).toFixed(6)},${(cx.leste + f).toFixed(6)}`;
  const q = `[out:json][timeout:180];(way(${bb});node(${bb})(if:count_tags() > 0););out geom;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
  const txt = await r.text();
  if (!txt.startsWith('{')) throw new Error(`Overpass HTTP ${r.status}: ${txt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
  fs.writeFileSync(cfg.osm, txt);
  const j = JSON.parse(txt);
  console.log(`OSM: ${j.elements.length} elementos -> ${cfg.osm}`);
} else console.log(`OSM ja em ${cfg.osm}`);

// 2) SRTM, em lotes de 100
const cache = fs.existsSync(cfg.elev) ? JSON.parse(fs.readFileSync(cfg.elev, 'utf8')) : {};
const faltam = cx.amostras.filter(([la, lo]) => cache[`${la},${lo}`] === undefined);
console.log(`SRTM: ${cx.amostras.length} amostras, faltam ${faltam.length}`);
for (let k = 0; k < faltam.length; k += 100) {
  const lote = faltam.slice(k, k + 100);
  const url = 'https://api.opentopodata.org/v1/srtm30m?locations=' + lote.map(([la, lo]) => `${la},${lo}`).join('|');
  let j = null;
  for (let tentativa = 1; tentativa <= 5 && !j; tentativa++) {
    const r = await fetch(url, { headers: UA });
    if (r.status === 429) { await espera(5000 * tentativa); continue; }
    const txt = await r.text();
    if (!txt.startsWith('{')) throw new Error(`opentopodata HTTP ${r.status}: ${txt.slice(0, 200)}`);
    j = JSON.parse(txt);
  }
  if (!j || j.status !== 'OK') throw new Error(`opentopodata: ${j ? j.status : 'sem resposta'}`);
  j.results.forEach((res, i) => { cache[`${lote[i][0]},${lote[i][1]}`] = res.elevation; });
  fs.writeFileSync(cfg.elev, JSON.stringify(cache));
  process.stdout.write(`  ${Math.min(k + 100, faltam.length)}/${faltam.length}\r`);
  await espera(1200);
}
const vals = cx.amostras.map(([la, lo]) => cache[`${la},${lo}`]);
if (vals.some((v) => v == null)) throw new Error('amostra de elevacao nula (mar ou fora do SRTM?)');
console.log(`\nSRTM: ${Math.min(...vals)}..${Math.max(...vals)} m -> ${cfg.elev}`);

// 3) a configuracao
const dir = path.resolve(import.meta.dirname, '../../research/cidades');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(cfg, null, 1) + '\n');
console.log(`-> research/cidades/${id}.json`);
