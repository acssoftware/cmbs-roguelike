// O DESENHO DE CONFERENCIA DE UM PLANO DE IA (05/10/2026): o terreno da galeria (`galeria_mapas.desenhar`) com, a
// esquerda, as zonas de Setup de cada grupo e as unidades onde ficaram; a direita, os triggers e os destinos das
// ordens. Uma pagina HTML local com as duas imagens e a legenda, para o autor conferir antes de jogar.
//   node tools/re/ia_desenho.mjs "<batalha.btt>" "<mapa base>" <saida.html>
import fs from 'node:fs';
import path from 'node:path';
import { desenhar, png } from './galeria_mapas.mjs';
import { aplicarDoutrina, GRUPOS } from './ia_doutrina.mjs';
import { lerRumos } from './rumo.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { grupos as gruposDe } from './agrupar.mjs';

const ESC = 6;   // pixels por tile no desenho final
const COR = {
  1: '#ffffff', 2: '#ff3b30', 3: '#ff9500', 4: '#ffcc00', 5: '#8e5a2b', 6: '#5ac8fa', 7: '#007aff', 8: '#5856d6',
  9: '#1c3d7a', 10: '#ff2d55', 11: '#34c759', 12: '#00c7be', 13: '#2e7d32', 14: '#af52de', 15: '#e040fb', 16: '#795548',
};
const COR_TRIG = { A: '#5ac8fa', B: '#007aff', C: '#5856d6', MAJ: '#ff2d55' };
const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

function base(arquivo) {
  const r = desenhar(arquivo); const { W, H, PX } = r; const w = W * ESC, h = H * ESC;
  const img = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = ((Math.floor(y * PX / ESC)) * r.w + Math.floor(x * PX / ESC)) * 4, q = (y * w + x) * 4; r.img.copy(img, q, o, o + 4); }
  // clareia o terreno para as camadas aparecerem
  for (let i = 0; i < img.length; i += 4) for (let k = 0; k < 3; k++) img[i + k] = Math.round(img[i + k] * 0.55 + 255 * 0.25);
  return { W, H, w, h, img };
}
function pinta(B, tx, ty, cor, a = 1, borda = false) {
  for (let j = 0; j < ESC; j++) for (let i = 0; i < ESC; i++) {
    if (borda && i > 0 && j > 0 && i < ESC - 1 && j < ESC - 1) continue;
    const px = tx * ESC + i, py = (B.H - 1 - ty) * ESC + j; if (px < 0 || py < 0 || px >= B.w || py >= B.h) continue;
    const o = (py * B.w + px) * 4; for (let k = 0; k < 3; k++) B.img[o + k] = Math.round(B.img[o + k] * (1 - a) + cor[k] * a); B.img[o + 3] = 255;
  }
}
function contorno(B, tiles, cor, a = 0.25) {
  const set = new Set(tiles.map((t) => t.join()));
  for (const [x, y] of tiles) {
    const borda = !set.has(`${x + 1},${y}`) || !set.has(`${x - 1},${y}`) || !set.has(`${x},${y + 1}`) || !set.has(`${x},${y - 1}`);
    pinta(B, x, y, cor, borda ? 0.95 : a);
  }
}
function ponto(B, x, y, cor) { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) pinta(B, x + dx, y + dy, Math.abs(dx) + Math.abs(dy) === 2 ? [0, 0, 0] : cor, 1); }

export function desenharPlano(batalha, mapaBase, saidaHtml) {
  const dout = aplicarDoutrina(mapaBase); const Z = dout.Zs.Z, T = dout.Zs.T;
  const X = abrirCompleto(batalha); const gs = new Map(gruposDe(batalha).map((u) => [u.id, u.grupo]));
  const azul = lerRumos(batalha).filter((u) => u.lado === 'azul' && !u.ausente).map((u) => ({ nome: u.nome, g: gs.get(X.R[u.i].id), x: Math.floor(u.elementos[0].x / 8), y: Math.floor(u.elementos[0].y / 8) }));
  const usados = new Set(azul.map((u) => u.g));
  // esquerda: setups dos grupos com unidades (os vazios ficam fora para nao poluir) + as unidades
  const E = base(mapaBase);
  for (const G of GRUPOS) if (usados.has(G.g)) contorno(E, Z[G.zona] || [], hex(COR[G.g]), 0.18);
  for (const u of azul) ponto(E, u.x, u.y, hex(COR[u.g]));
  // direita: triggers e destinos das ordens (todos, com ou sem unidades)
  const D = base(mapaBase);
  for (const k of ['A', 'B', 'C', 'MAJ']) contorno(D, T[k], hex(COR_TRIG[k]), 0.22);
  for (const G of GRUPOS) if (G.ordem) contorno(D, Z[G.ordem.zona] || [], hex(COR[G.g]), 0.1);
  const dir = path.dirname(saidaHtml), nome = path.basename(saidaHtml, '.html');
  fs.writeFileSync(path.join(dir, nome + '.setup.png'), png(E.w, E.h, E.img));
  fs.writeFileSync(path.join(dir, nome + '.triggers.png'), png(D.w, D.h, D.img));
  const n = {}; for (const u of azul) n[u.g] = (n[u.g] || 0) + 1;
  const linhas = GRUPOS.map((G) => `<tr><td><i style="background:${COR[G.g]}"></i>G${G.g}</td><td>${G.papel}</td><td>${n[G.g] || 0}</td><td>${(Z[G.zona] || []).length}</td><td>${G.stance}</td><td>${G.espera ? 'Trig ' + G.espera : '—'}${G.pressao ? ` (or at ${mmss(dout.horaPressao)})` : ''}</td><td>${G.ordem ? `${G.ordem.tipo}, ${G.ordem.stance} → ${G.ordem.zona}` : 'static'}</td></tr>`).join('');
  const trig = Object.entries(COR_TRIG).map(([k, c]) => `<span class="leg"><i style="background:${c}"></i>Trig ${k}${k === 'MAJ' ? ' (major objective)' : ''} — ${T[k].length} tiles</span>`).join('');
  fs.writeFileSync(saidaHtml, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI Plan Check</title>
<style>:root{--bg:#10130e;--panel:#1a1f16;--line:#3a422f;--ink:#ecefe6;--dim:#b4bca8}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI",system-ui,sans-serif;padding:16px}
h1{font-size:18px;color:#d9b444;margin:0 0 4px}p{color:var(--dim);margin:4px 0 12px}.par{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}figcaption{color:var(--dim);font-size:13px;margin-bottom:4px}
img{image-rendering:pixelated;border:1px solid var(--line)}table{border-collapse:collapse;margin-top:14px;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:3px 10px;text-align:left}th{color:var(--dim);font-weight:600}
i{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px;border:1px solid #0006}.leg{margin-right:14px;color:var(--dim);font-size:13px}</style></head><body>
<h1>${path.basename(mapaBase).replace(/\.btt$/, '')} — authored AI plan (Blue, Plan 1)</h1>
<p>North up, the attacker comes from the bottom. Left: each group's setup zone (outline) and where its units were placed (dots). Right: the triggers and where each triggered group goes.</p>
<div class="par"><figure><figcaption>Setup zones and units</figcaption><img src="${nome}.setup.png" width="${E.w}"></figure>
<figure><figcaption>Triggers and order destinations</figcaption><img src="${nome}.triggers.png" width="${D.w}"><div>${trig}</div></figure></div>
<table><tr><th>Group</th><th>Role</th><th>Units</th><th>Setup tiles</th><th>Stance</th><th>Waits for</th><th>Then</th></tr>${linhas}</table>
<p>Occupy buildings = Mixed on every order. Triggered groups leave only when their trigger fires (window 00:00–3:00:00).</p></body></html>`);
  return { unidades: azul.length, grupos: [...usados].sort((a, b) => a - b) };
}

if (process.argv[1] && /ia_desenho\.mjs$/.test(process.argv[1])) {
  const [batalha, mapa, saida] = process.argv.slice(2);
  if (!saida) { console.error('uso: node tools/re/ia_desenho.mjs "<batalha.btt>" "<mapa base>" <saida.html>'); process.exit(2); }
  const r = desenharPlano(batalha, mapa, saida);
  console.log(`${saida}: ${r.unidades} unidades azuis nos grupos ${r.grupos.join(', ')}`);
}
