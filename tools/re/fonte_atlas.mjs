// A FONTE BITMAP DAS IMAGENS GERADAS PELO APP (17/10/2026): o Chrome (headless, so na maquina de quem gera) desenha os
// glifos 32..126 da Bahnschrift semi-condensada em celulas fixas; aqui a tinta de cada celula e recortada e empacotada
// num PNG (branco sobre preto, a cobertura no canal vermelho) + JSON { altura, glifos: { c: [x, largura, avanco] } }
// que app/src/imagem.mjs le sem navegador. Um atlas por tamanho.
//   node tools/re/fonte_atlas.mjs            -> app/art/briefing/fonte_11.png/.json, fonte_13, fonte_18
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { lerPng } from '../../app/src/imagem.mjs';
import { png } from './galeria_mapas.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const SAIDA = path.join(RAIZ, 'app', 'art', 'briefing');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('nem Chrome nem Edge para desenhar a fonte');
const GLIFOS = Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k));

export function gerar(tamanho, nome = `fonte_${tamanho}`, { peso = 600, stretch = '87.5%' } = {}) {
  const cel = Math.ceil(tamanho * 2.2), alt = Math.ceil(tamanho * 1.55), porLinha = 16, linhas = Math.ceil(GLIFOS.length / porLinha);
  const W = cel * porLinha, H = alt * linhas;
  const celulas = GLIFOS.map((g, k) => `<div style="left:${(k % porLinha) * cel}px;top:${Math.floor(k / porLinha) * alt}px">${g.replace('&', '&amp;').replace('<', '&lt;')}</div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}body{width:${W}px;height:${H}px;position:relative;overflow:hidden}div{position:absolute;width:${cel}px;height:${alt}px;color:#fff;font:${peso} ${tamanho}px/${alt}px Bahnschrift,"Segoe UI",sans-serif;font-stretch:${stretch};text-align:left;padding-left:2px;white-space:pre;-webkit-font-smoothing:antialiased}</style></head><body>${celulas}</body></html>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-')); const htmlF = path.join(dir, 'f.html'), pngF = path.join(dir, 'f.png');
  fs.writeFileSync(htmlF, html);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, `--screenshot=${pngF}`, 'file:///' + htmlF.replace(/\\/g, '/')], { stdio: 'ignore' });
  const img = lerPng(fs.readFileSync(pngF)); fs.rmSync(dir, { recursive: true, force: true });
  const cov = (x, y) => img.rgba[(y * img.w + x) * 4];
  // recorta a tinta de cada celula (so na horizontal: todas as linhas partilham o topo)
  const glifos = []; let largTotal = 0;
  GLIFOS.forEach((g, k) => {
    const cx = (k % porLinha) * cel, cy = Math.floor(k / porLinha) * alt; let x0 = cel, x1 = -1;
    for (let x = 0; x < cel; x++) for (let y = 0; y < alt; y++) if (cov(cx + x, cy + y) > 24) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    const vazio = x1 < 0; const larg = vazio ? 0 : x1 - x0 + 1;
    const avanco = g === ' ' ? Math.round(tamanho * 0.32) : larg + Math.max(1, Math.round(tamanho * 0.1));
    glifos.push({ g, cx: cx + (vazio ? 0 : x0), cy, larg, avanco }); largTotal += larg + 1;
  });
  const out = Buffer.alloc(largTotal * alt * 4); const meta = { altura: alt, tamanho, glifos: {} }; let x = 0;
  for (const q of glifos) {
    for (let j = 0; j < alt; j++) for (let i = 0; i < q.larg; i++) { const s = ((q.cy + j) * img.w + q.cx + i) * 4, d = (j * largTotal + x + i) * 4; out[d] = out[d + 1] = out[d + 2] = img.rgba[s]; out[d + 3] = 255; }
    meta.glifos[q.g] = [x, q.larg, q.avanco]; x += q.larg + 1;
  }
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, nome + '.png'), png(largTotal, alt, out));
  fs.writeFileSync(path.join(SAIDA, nome + '.json'), JSON.stringify(meta));
  return { nome, largura: largTotal, altura: alt };
}

if (process.argv[1] && /fonte_atlas\.mjs$/.test(process.argv[1])) {
  for (const t of [11, 13, 18]) { const r = gerar(t); console.log(`${r.nome}: ${r.largura}x${r.altura}`); }
}
