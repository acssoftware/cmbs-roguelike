// O ICONE DO LANCADOR (14/11/2026, autor: o pacote para a comunidade). O CMBS Roguelike.exe mostra na bandeja e no
// Explorer o mesmo logo que o app poe nos arquivos do jogo (app/art/briefing/logo170.bmp, 170x170, 24 bits). Um .ico
// com quatro tamanhos (16, 24, 32, 48), cada um reduzido pela media da area (170/16 nao e inteiro: cada pixel de destino
// pesa as fracoes dos pixels de origem que cobre). Deterministico: o teste 243 gera de novo e compara byte a byte.
//
//   node tools/lancador/icone.mjs          escreve app/launcher/launcher.ico
//
// O formato: ICONDIR (reservado 0, tipo 1, N) + N ICONDIRENTRY de 16 bytes + por imagem um BITMAPINFOHEADER com a altura
// DOBRADA (a mascara AND conta como a metade de baixo), os pixels BGRA de baixo para cima e a mascara AND de 1 bit,
// linhas alinhadas a 32 bits, toda zero (opaca).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const LOGO = path.join(RAIZ, 'app', 'art', 'briefing', 'logo170.bmp');
export const ICONE = path.join(RAIZ, 'app', 'launcher', 'launcher.ico');
export const TAMANHOS = [16, 24, 32, 48];

// um BMP de 24 bits, sem compressao, de baixo para cima -> { w, h, rgb } de cima para baixo
function lerBmp24(b) {
  if (b.toString('latin1', 0, 2) !== 'BM') throw new Error('nao e BMP');
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), hAssinada = b.readInt32LE(22), bpp = b.readUInt16LE(28), comp = b.readUInt32LE(30);
  if (bpp !== 24 || comp !== 0) throw new Error(`BMP ${bpp} bits, compressao ${comp}: so 24 bits sem compressao`);
  const h = Math.abs(hAssinada), deBaixo = hAssinada > 0, passo = Math.ceil((w * 3) / 4) * 4;
  const rgb = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const linha = off + (deBaixo ? h - 1 - y : y) * passo;
    for (let x = 0; x < w; x++) {
      const o = linha + x * 3, d = (y * w + x) * 3;
      rgb[d] = b[o + 2]; rgb[d + 1] = b[o + 1]; rgb[d + 2] = b[o];
    }
  }
  return { w, h, rgb };
}

// reducao pela media da area: cada pixel de destino cobre [x0, x1) x [y0, y1) em coordenadas de origem
function reduzir(img, n) {
  const out = new Uint8Array(n * n * 3);
  const sx = img.w / n, sy = img.h / n;
  for (let j = 0; j < n; j++) {
    const y0 = j * sy, y1 = y0 + sy;
    for (let i = 0; i < n; i++) {
      const x0 = i * sx, x1 = x0 + sx;
      const soma = [0, 0, 0]; let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const py = Math.min(y + 1, y1) - Math.max(y, y0);
        if (py <= 0) continue;
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const px = Math.min(x + 1, x1) - Math.max(x, x0);
          if (px <= 0) continue;
          const a = px * py, o = (y * img.w + x) * 3;
          soma[0] += img.rgb[o] * a; soma[1] += img.rgb[o + 1] * a; soma[2] += img.rgb[o + 2] * a; area += a;
        }
      }
      const d = (j * n + i) * 3;
      for (let c = 0; c < 3; c++) out[d + c] = Math.max(0, Math.min(255, Math.round(soma[c] / area)));
    }
  }
  return out;
}

// uma imagem do .ico: BITMAPINFOHEADER + BGRA de baixo para cima + mascara AND zerada
function imagemIco(rgb, n) {
  const passoMascara = ((n + 31) >> 5) * 4;
  const cab = Buffer.alloc(40);
  cab.writeUInt32LE(40, 0); cab.writeInt32LE(n, 4); cab.writeInt32LE(n * 2, 8);
  cab.writeUInt16LE(1, 12); cab.writeUInt16LE(32, 14); cab.writeUInt32LE(0, 16);
  cab.writeUInt32LE(n * n * 4 + passoMascara * n, 20);
  const px = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = ((n - 1 - y) * n + x) * 4, s = (y * n + x) * 3;
    px[o] = rgb[s + 2]; px[o + 1] = rgb[s + 1]; px[o + 2] = rgb[s]; px[o + 3] = 255;
  }
  return Buffer.concat([cab, px, Buffer.alloc(passoMascara * n)]);
}

export function gerarIco(bmp = fs.readFileSync(LOGO), tamanhos = TAMANHOS) {
  const img = lerBmp24(bmp);
  const imagens = tamanhos.map((n) => imagemIco(reduzir(img, n), n));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(tamanhos.length, 4);
  let pos = 6 + 16 * tamanhos.length;
  const entradas = tamanhos.map((n, k) => {
    const e = Buffer.alloc(16);
    e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imagens[k].length, 8); e.writeUInt32LE(pos, 12);
    pos += imagens[k].length;
    return e;
  });
  return Buffer.concat([dir, ...entradas, ...imagens]);
}

// le um .ico de volta: as entradas e a conferencia de cada cabecalho (o teste usa)
export function lerIco(b) {
  const n = b.readUInt16LE(4);
  const entradas = [];
  for (let k = 0; k < n; k++) {
    const o = 6 + 16 * k;
    const w = b[o] || 256, h = b[o + 1] || 256, bpp = b.readUInt16LE(o + 6), bytes = b.readUInt32LE(o + 8), off = b.readUInt32LE(o + 12);
    entradas.push({ w, h, bpp, bytes, off, biSize: b.readUInt32LE(off), biW: b.readInt32LE(off + 4), biH: b.readInt32LE(off + 8) });
  }
  return { reservado: b.readUInt16LE(0), tipo: b.readUInt16LE(2), n, entradas };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ico = gerarIco();
  fs.mkdirSync(path.dirname(ICONE), { recursive: true });
  fs.writeFileSync(ICONE, ico);
  console.log(`${path.relative(RAIZ, ICONE)}: ${TAMANHOS.join(', ')} px, ${ico.length} bytes`);
}
