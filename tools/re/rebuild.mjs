// Reconstroi um .btt: descomprime os blocos, reescreve com o codificador de literais
// e remonta o container. Serve para provar que o caminho de escrita funciona.
import fs from 'fs';
import path from 'path';
import { descomprimir, comprimirLiterais, OFF_TAMANHO } from './lz.mjs';
import { abrir, lerListaStrings } from './ext.mjs';

export function reconstruir(entrada, saidaPath, transformar) {
  const r = abrir(entrada);
  const L = lerListaStrings(r.b, r.bmpFim);
  const base = L.fim;
  const inicioCadeia = base + OFF_TAMANHO;

  // le a cadeia original
  let o = inicioCadeia; const blocos = [];
  while (o + 4 < r.b.length) {
    const tam = r.b.readUInt32LE(o);
    if (tam <= 0 || o + 4 + tam > r.b.length) break;
    const d = descomprimir(r.b.subarray(o + 4, o + 4 + tam), 0);
    blocos.push(Buffer.from(d.saida));
    o += 4 + tam;
  }
  const cauda = r.b.subarray(o);            // o que vem depois da cadeia

  // aplica a transformacao (se houver) e re-codifica
  const novos = blocos.map((b, i) => transformar ? transformar(b, i) : b);
  const partes = [r.b.subarray(0, inicioCadeia)];
  for (const b of novos) {
    const c = comprimirLiterais(b);
    const len = Buffer.alloc(4); len.writeUInt32LE(c.length);
    partes.push(len, c);
  }
  partes.push(cauda);
  const saida = Buffer.concat(partes);
  fs.writeFileSync(saidaPath, saida);
  return { blocos: blocos.map((b) => b.length), original: r.b.length, novo: saida.length, cauda: cauda.length };
}

const EH_MAIN = process.argv[1] && /[\\/]rebuild\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const info = reconstruir(process.argv[2], process.argv[3]);
  console.log(`blocos originais (descomprimidos): ${info.blocos.join(', ')}`);
  console.log(`arquivo: ${info.original} -> ${info.novo} bytes  (cauda preservada: ${info.cauda} bytes)`);
  // verifica: reabre o arquivo novo e compara os blocos com os originais
  const a = abrir(process.argv[2]), b = abrir(process.argv[3]);
  const la = lerListaStrings(a.b, a.bmpFim), lb = lerListaStrings(b.b, b.bmpFim);
  const lerCadeia = (r, L) => {
    let o = L.fim + OFF_TAMANHO, out = [];
    while (o + 4 < r.b.length) {
      const t = r.b.readUInt32LE(o);
      if (t <= 0 || o + 4 + t > r.b.length) break;
      out.push(Buffer.from(descomprimir(r.b.subarray(o + 4, o + 4 + t), 0).saida));
      o += 4 + t;
    }
    return out;
  };
  const A = lerCadeia(a, la), B = lerCadeia(b, lb);
  console.log(`\nverificacao: ${A.length} blocos no original, ${B.length} no reconstruido`);
  let ok = A.length === B.length;
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const igual = A[i].equals(B[i]);
    console.log(`  bloco ${i + 1}: ${A[i].length} vs ${B[i].length} bytes  ${igual ? 'IDENTICO' : '*** DIFERENTE ***'}`);
    if (!igual) ok = false;
  }
  console.log(ok ? '\n=> ida e volta em nivel de ARQUIVO: OK' : '\n=> FALHOU');
}
