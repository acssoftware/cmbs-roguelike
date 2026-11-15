// Descomprime um .bts (save) — que nao tem thumbnail, entao varre o inicio do arquivo
import fs from 'fs';
import { descomprimir } from './lz.mjs';
const f = process.argv[2];
const b = fs.readFileSync(f);
console.log(`${f.split(/[\/]/).pop()}  ${b.length} bytes`);
let melhor = null;
for (let off = 0x40; off < 0x400; off++) {
  const t = descomprimir(b, off, 16384);
  if (t.saida.length < 8192) continue;
  const d = descomprimir(b, off);
  const pontos = (d.fim === 'terminador' ? 1e9 : 0) + d.saida.length;
  if (!melhor || pontos > melhor.pontos) melhor = { off, d, pontos };
  if (d.fim === 'terminador') break;
}
if (!melhor) { console.log('  nao localizou fluxo comprimido'); process.exit(1); }
const { off, d } = melhor;
console.log(`  fluxo em ${off} -> ${d.saida.length} bytes (${(d.saida.length/(b.length-off)).toFixed(2)}x), ${d.simbolos} simbolos, fim="${d.fim}"`);
const saida = Buffer.from(d.saida);
fs.writeFileSync(process.argv[3] || 'save_descomprimido.bin', saida);
console.log(`  gravado em ${process.argv[3] || 'save_descomprimido.bin'}`);
