// Validacao: descomprime a cadeia de blocos e exige conteudo semantico (texto ingles)
import fs from 'fs';
import path from 'path';
import { descomprimirDoContainer } from './lz.mjs';
import { abrir, lerListaStrings } from './ext.mjs';
let T = 0, OK = 0, SEM = 0, FA = 0;
for (const dir of process.argv.slice(2)) {
  let ok = 0, sem = 0, fa = 0, n = 0, blocos = 0, entrada = 0, saida = 0;
  for (const a of fs.readdirSync(dir).filter((x) => /\.btt$/i.test(x))) {
    const r = abrir(path.join(dir, a));
    const L = r && lerListaStrings(r.b, r.bmpFim);
    if (!L) { fa++; continue; }
    n++;
    const d = descomprimirDoContainer(r.b, L.fim);
    if (!d.blocos.length) { fa++; continue; }
    blocos += d.blocos.length; saida += d.bytes;
    entrada += d.blocos.reduce((s, b) => s + b.tamComprimido, 0);
    const s = d.saida.toString('latin1');
    const p = (s.match(/\b(the|and|your|will|have|with|from|this|that|forces|mission)\b/gi) || []).length;
    if (p >= 15) ok++; else sem++;
  }
  console.log(`${path.basename(dir).padEnd(20)} ${String(n).padStart(4)} arq | ${String(blocos).padStart(4)} blocos | texto OK ${String(ok).padStart(4)} | sem ${String(sem).padStart(3)} | falha ${String(fa).padStart(2)} | expansao ${(saida / entrada).toFixed(2)}x`);
  T += n; OK += ok; SEM += sem; FA += fa;
}
console.log(`\nTOTAL ${T}: ${OK} com conteudo verificado, ${SEM} sem texto detectavel, ${FA} falhas`);
