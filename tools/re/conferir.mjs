// Imprime o alinhamento LADO A LADO de cada encaixe proposto, para conferencia com os olhos.
// Resultado de um voto so nao se grava sem ver a coluna do arquivo bater com a da tela.
import fs from 'fs';
import { ordemCompleta } from './oob.mjs';
import { igual } from './casar.mjs';
const R = '../../research';
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const [arq, cen, ia] = [process.argv[2], process.argv[3], parseInt(process.argv[4], 10)];
const t = JSON.parse(fs.readFileSync(`${R}/tipos_confirmados.json`, 'utf8'));
const { bl, linhas } = ordemCompleta(arq, 6);
const nome = (o) => t.tabelas[hx(bl[o + 18])]?.[hx(bl[o + 17])];
const caps = fs.readdirSync(`${R}/capturas_lidas`)
  .map((f) => JSON.parse(fs.readFileSync(`${R}/capturas_lidas/${f}`, 'utf8').replace(/^\uFEFF/, '')))
  .filter((c) => c.cen === cen).sort((a, b) => a.n - b.n);
for (const c of caps) {
  for (let k = 0; k < c.linhas.length; k++) {
    let bons = 0;
    for (let d = -6; d <= 6; d++) {
      if (!d) continue; const L = linhas[ia + d], kk = k + d;
      if (!L || kk < 0 || kk >= c.linhas.length) continue;
      const n = nome(L.off); if (n && igual(n, c.linhas[kk])) bons++;
    }
    if (bons < 3) continue;
    console.log(`\n--- captura n=${c.n}, alvo na linha k=${k}  (${bons} vizinhos batendo)`);
    for (let d = -6; d <= 6; d++) {
      const L = linhas[ia + d], kk = k + d;
      const esq = L ? (nome(L.off) || '??? ' + hx(bl[L.off + 18]) + '/' + hx(bl[L.off + 17])) : '(corte)';
      const dir = kk >= 0 && kk < c.linhas.length ? c.linhas[kk] : '';
      const ok = L && nome(L.off) && dir && igual(nome(L.off), dir) ? '=' : (d === 0 ? '>>' : ' ');
      console.log(`   ${String(ia + d).padStart(4)} ${esq.slice(0, 44).padEnd(44)} ${ok.padEnd(2)} ${dir}`);
    }
  }
}
