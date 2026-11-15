// O TACTICAL MAP DE CADA MAPA (17/10/2026): a imagem de 952x350 que o briefing mostra no botao "Tactical Map", uma por
// arquivo de mapa do app (Assault/Attack/Probe e Meet: a zona do jogador muda entre as versoes). Terreno da biblioteca
// (assets/map_images/<id>.png), a zona de setup do JOGADOR (a pintura vermelha: o jogador e sempre o vermelho,
// forge.buildBattle) e os objetivos que ele conhece (vagas vermelhas tipo <= 4, Known to Player/Both), com a legenda a
// esquerda e o painel "Mission Objectives" a direita, no estilo do briefing do CMBS. A zona do inimigo nao aparece
// (decisao do autor). Desenhado em HTML e fotografado pelo Chrome headless, so na maquina de quem gera; o app so le o
// PNG pronto (app/src/imagem.mjs pngParaBmp) e grava na batalha.
//   node tools/re/tatico.mjs                 -> assets/map_images/<id>.tatico.png de todo mapa do censo do app
//   node tools/re/tatico.mjs --mapa "<f do censo>"  so esse
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { mapCensus, meetCensus, mapFile } from '../../app/src/catalog.mjs';
import { decodificar, doMapa, TIPO_OBJ, nomeDe } from './ia_escrever.mjs';
import { pintura } from './zonas.mjs';
import { imageId, APP_IMAGES, desenharParaApp } from './galeria_mapas.mjs';

export const TAMANHO = [952, 350];
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const KNOWN_PLAYER = new Set([0, 2]);   // Known to Player / Both
export const arquivoTatico = (m) => path.join(APP_IMAGES, imageId(m.f) + '.tatico.png');

export function html(m) {
  const arquivo = mapFile(m); const d = decodificar(arquivo); const z = pintura(arquivo);
  const idImg = path.join(APP_IMAGES, imageId(m.f) + '.png'); if (!fs.existsSync(idImg)) desenharParaApp(m);
  const terreno = fs.readFileSync(idImg).toString('base64');
  const W = d.W, H = d.H;
  const AW = 952 - 150 - 264 - 16, AH = 350 - 16; const esc = Math.min(AW / W, AH / H); const mw = W * esc, mh = H * esc;
  const objs = d.vagas.filter((v) => v.lado === 'vermelho' && v.tipo <= 4 && v.tiles.length && KNOWN_PLAYER.has(v.known));
  const contorno = (tiles) => {
    const s = new Set(tiles.map(([x, y]) => x + ',' + y)); const segs = [];
    for (const [x, y] of tiles) {
      const Y = H - 1 - y;
      if (!s.has(x + ',' + (y + 1))) segs.push(`M${x} ${Y}h1`);
      if (!s.has(x + ',' + (y - 1))) segs.push(`M${x} ${Y + 1}h1`);
      if (!s.has(x - 1 + ',' + y)) segs.push(`M${x} ${Y}v1`);
      if (!s.has(x + 1 + ',' + y)) segs.push(`M${x + 1} ${Y}v1`);
    }
    return segs.join('');
  };
  const cel = (tiles) => tiles.map(([x, y]) => `M${x} ${H - 1 - y}h1v1h-1z`).join('');
  const jogador = z.vermelho.flatMap((l) => l.tiles);
  const cent = (t) => [t.reduce((a, q) => a + q[0], 0) / t.length, H - 1 - t.reduce((a, q) => a + q[1], 0) / t.length];
  const nomeObj = (v) => v.nome.replace(/\s*\((Maj|Min|Major|Minor)\.? ?VP'?s?\)\s*/i, '').trim().toUpperCase() || 'OBJECTIVE';
  const esc_ = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svgObjs = objs.map((v) => { const t = doMapa(d, v.tiles); return `<path d="${cel(t)}" class="objf"/><path d="${contorno(t)}" class="objc"/>`; }).join('');
  const rotulos = objs.map((v) => { const t = doMapa(d, v.tiles); const [cx, cy] = cent(t); return `<div class="rot" style="left:${(cx + 0.5) * esc}px;top:${(cy + 0.5) * esc}px">${esc_(nomeObj(v))}</div>`; }).join('');
  const total = objs.reduce((a, v) => a + v.pontos, 0);
  const linhas = objs.slice(0, 8).map((v) => `<div class="obj"><b>${esc_(nomeObj(v))}</b> — ${nomeDe(TIPO_OBJ, v.tipo).toUpperCase()} — ${v.pontos}</div>`).join('');
  const titulo = m.f.replace(/\s*(Meet|Assault|Attack|Probe)\s*\.btt$/i, '').replace(/\s+/g, ' ').trim();
  const tipo = { Meet: 'MEETING ENGAGEMENT' }[m.tipo] || String(m.tipo || '').toUpperCase();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:952px;height:350px;background:#1b1d18;font-family:"Bahnschrift","Segoe UI",sans-serif;color:#e8e6d9;overflow:hidden;position:relative}
.leg{position:absolute;left:0;top:0;width:150px;height:350px;background:#2b2d29;padding:12px 10px;font:600 11px "Bahnschrift SemiCondensed","Bahnschrift",sans-serif;letter-spacing:.02em}
.leg .it{display:flex;align-items:center;gap:8px;margin:0 0 10px}.sw{width:22px;height:14px;flex:none}
.leg .esc{position:absolute;left:10px;bottom:12px;right:10px;font-weight:400;color:#b9b8ad;font-size:10.5px;line-height:1.5}
.mapa{position:absolute;left:${150 + 8 + (AW - mw) / 2}px;top:${8 + (AH - mh) / 2}px;width:${mw}px;height:${mh}px;box-shadow:0 0 0 2px #0c0d0b,0 0 0 3px #4b4d45}
.mapa img{position:absolute;inset:0;width:100%;height:100%;filter:saturate(.8) contrast(1.05)}
.mapa svg{position:absolute;inset:0;width:100%;height:100%}
.zona{fill:rgba(240,200,70,.55);stroke:none}.zonac{stroke:#ffd75a;stroke-width:${Math.max(0.5, 1.6 / esc).toFixed(2)};fill:none}
.objf{fill:rgba(235,85,60,.42)}.objc{stroke:#ff6a4d;stroke-width:${Math.max(0.5, 2 / esc).toFixed(2)};fill:none}
.rot{position:absolute;transform:translate(-50%,-50%);font:700 10.5px "Bahnschrift SemiCondensed","Bahnschrift",sans-serif;letter-spacing:.06em;color:#fff;background:rgba(12,13,11,.78);border:1px solid #e2705f;padding:1px 5px;white-space:nowrap}
.norte{position:absolute;right:6px;top:6px;font:700 11px "Bahnschrift",sans-serif;color:#fff;text-shadow:0 0 3px #000}
.pan{position:absolute;right:0;top:0;width:264px;height:350px;background:linear-gradient(#24261f,#1a1c17);padding:12px}
.pan h3{font:400 15px "Stencil","Bahnschrift",sans-serif;letter-spacing:.12em;color:#f2efe2;margin:0 0 8px;text-align:center}
.obj{background:#0d0e0c;border:1px solid #3d3f37;border-radius:9px;padding:4px 10px;margin:0 0 5px;font:600 11px "Bahnschrift SemiCondensed","Bahnschrift",sans-serif;letter-spacing:.03em;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.obj b{color:#e8b93c;font-weight:700}
.tot{margin-top:8px;background:#0d0e0c;border:1px solid #3d3f37;border-radius:9px;padding:5px;text-align:center;font:700 13px "Bahnschrift",sans-serif;letter-spacing:.05em}
.nome{position:absolute;left:12px;right:12px;bottom:12px;font:600 10.5px "Bahnschrift SemiCondensed","Bahnschrift",sans-serif;color:#b9b8ad;letter-spacing:.04em;text-align:center;line-height:1.5}
</style></head><body>
<div class="leg">
 <div class="it"><span class="sw" style="background:rgba(240,200,70,.6);border:1.5px solid #ffd75a"></span>YOUR SETUP ZONE</div>
 <div class="it"><span class="sw" style="background:rgba(235,85,60,.45);border:1.5px solid #ff6a4d"></span>OBJECTIVE</div>
 <div class="esc">${W * 8} x ${H * 8} m<br>1 square = 8 m<br>North up</div>
</div>
<div class="mapa"><img src="data:image/png;base64,${terreno}">
 <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges"><path d="${cel(jogador)}" class="zona"/><path d="${contorno(jogador)}" class="zonac"/>${svgObjs}</svg>
 ${rotulos}<div class="norte">N &#9650;</div></div>
<div class="pan"><h3>MISSION OBJECTIVES</h3>${linhas || '<div class="obj">NO TERRAIN OBJECTIVES</div>'}<div class="tot">TOTAL ${total}</div>
 <div class="nome">${esc_(titulo.toUpperCase())}<br>${tipo} - CMBS ROGUELIKE</div></div>
</body></html>`;
}

export function gerar(m) {
  if (!CHROME) throw new Error('nem Chrome nem Edge para fotografar o Tactical Map');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tatico-')); const h = path.join(dir, 't.html'), p = path.join(dir, 't.png');
  try {
    fs.writeFileSync(h, html(m));
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${TAMANHO.join(',')}`, `--screenshot=${p}`, 'file:///' + h.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 60000 });
    const saida = arquivoTatico(m); fs.copyFileSync(p, saida); return saida;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && /tatico\.mjs$/.test(process.argv[1])) {
  const i = process.argv.indexOf('--mapa'); const so = i > 0 ? process.argv[i + 1] : null;
  const mapas = [...mapCensus(), ...meetCensus()].filter((m) => !so || m.f === so || m.f.startsWith(so));
  if (!mapas.length) { console.error('nenhum mapa'); process.exit(1); }
  const falhas = [];
  for (const [k, m] of mapas.entries()) {
    try { gerar(m); } catch (e) { falhas.push(`${m.f}: ${e.message}`); }
    process.stdout.write(`\r${k + 1}/${mapas.length} ${m.f.slice(0, 60).padEnd(60)}`);
  }
  console.log(`\n${mapas.length - falhas.length} Tactical Maps em ${APP_IMAGES}${falhas.length ? '\nFALHAS:\n' + falhas.join('\n') : ''}`);
}
