// Para cada valor que ainda falta, diz em QUE cenario de fabrica ele aparece e com que
// vizinhanca na arvore. Assim da para abrir o cenario no editor e ir direto no ponto, em vez
// de escrever sondas — que, depois do que se viu na zona de fortificacao, e arriscado: um
// indice escrito debaixo de outra formacao-mae pode ser lido em outra tabela.
import fs from 'fs';
import { ordemCompleta } from './oob.mjs';
const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const R = '../../research';
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');

const t = JSON.parse(fs.readFileSync(`${R}/tipos_confirmados.json`, 'utf8'));
const pares = JSON.parse(fs.readFileSync(`${R}/cmbs_pares_v3.json`, 'utf8'));
const falta = new Map();
for (const x of pares) {
  const [v, tb] = x.par.split('/'); const k = hx(parseInt(tb, 16));
  if (t.tabelas[k] && !t.tabelas[k][v]) falta.set(`${k}/${v}`, x.n);
}

const achado = new Map();
for (const f of fs.readdirSync(S).filter((x) => /\.btt$/i.test(x) && !/^ZZ /.test(x))) {
  let d; try { d = ordemCompleta(f, 6); } catch (_) { continue; }
  const { bl, linhas } = d;
  const nome = (o) => t.tabelas[hx(bl[o+18])]?.[hx(bl[o+17])];
  linhas.forEach((L, i) => {
    if (!L) return;
    const chave = `${hx(bl[L.off+18])}/${hx(bl[L.off+17])}`;
    if (!falta.has(chave)) return;
    const viz = [];
    for (let j = i - 3; j <= i + 3; j++) {
      if (j === i || j < 0 || j >= linhas.length || !linhas[j]) continue;
      const n = nome(linhas[j].off); if (n) viz.push(n);
    }
    const ant = achado.get(chave);
    if (!ant || viz.length > ant.viz.length) achado.set(chave, { f, i, tot: linhas.length, viz });
  });
}

const porArq = {};
[...falta.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
  const a = achado.get(k);
  if (!a) { (porArq['(nao achado em cenario de fabrica)'] ||= []).push({ k, n }); return; }
  (porArq[a.f] ||= []).push({ k, n, i: a.i, tot: a.tot, viz: a.viz });
});
Object.entries(porArq).sort((a, b) => b[1].length - a[1].length).forEach(([f, xs]) => {
  console.log(`\n${f}   (${xs.length} valor${xs.length > 1 ? 'es' : ''})`);
  xs.forEach((x) => console.log(x.viz === undefined ? `   ${x.k}  ${x.n} unidades` :`   ${x.k}  ${String(x.n).padStart(3)} unidades  |  linha ${x.i} de ${x.tot}  |  perto de: ${x.viz.slice(0, 4).join(' / ') || '(nada conhecido)'}`));
});
