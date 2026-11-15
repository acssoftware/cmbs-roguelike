// Grava em tipos_confirmados.json os nomes colhidos pelo casamento das capturas.
import fs from 'fs';
import { casar } from './casar.mjs';
const R = '../../research';
const CEN = ['ZZ RU ALL', 'ZZ UKR ALL', 'ZZ US ALL'];
const NOTA_FORT = 'Nomes dos itens que ficam DEBAIXO de uma formacao de fortificacao. Ali o ' +
  'indice quer dizer outra coisa: no ZZ US ALL, 0x00/0x01 aparece dez vezes seguidas como ' +
  '"Barbed Wire" e no resto do arquivo como "Infantry Carrier Vehicle (M1126 Stryker)"; ' +
  '0x00/0x07 e "Target Reference Point" ali e "Mobile Gun System (M1128 Stryker)" fora. ' +
  'Quem escolhe a tabela e a formacao-mae, nao o byte +18. Por isso estes nomes ficam fora ' +
  'das tabelas gerais: misturar os dois corromperia o catalogo.';

const t = JSON.parse(fs.readFileSync(`${R}/tipos_confirmados.json`, 'utf8'));
const p = JSON.parse(fs.readFileSync(`${R}/progresso_mapeamento.json`, 'utf8'));
t.fortificacoes = t.fortificacoes || {};
t.fortificacoes._nota = NOTA_FORT;

let novos = 0, nf = 0; const umVoto = [], diverg = [];
const melhorNome = (votos) => [...votos.entries()].sort((a, b) => b[1] - a[1]);
for (const cen of CEN) {
  const r = casar(`${cen}.btt`, cen);
  for (const [chave, votos] of r.fort) {
    const arr = melhorNome(votos);
    if (!t.fortificacoes[chave]) { t.fortificacoes[chave] = arr[0][0]; nf++; }
  }
  for (const [chave, votos] of r.achados) {
    const [tb, val] = chave.split('/');
    const arr = melhorNome(votos);
    if (arr.length > 1) diverg.push(`${chave} "${arr[0][0]}"x${arr[0][1]} vs ${arr.slice(1).map((x) => `"${x[0]}"x${x[1]}`).join(' ')}`);
    if (arr[0][1] === 1) umVoto.push(chave);
    t.tabelas[tb] = t.tabelas[tb] || {};
    if (!t.tabelas[tb][val]) { t.tabelas[tb][val] = arr[0][0]; novos++; }
  }
}
for (const k of Object.keys(t.tabelas)) {
  const meta = {}, vals = {};
  for (const [a, b] of Object.entries(t.tabelas[k])) (a.startsWith('_') ? meta : vals)[a] = b;
  t.tabelas[k] = { ...meta, ...Object.fromEntries(Object.entries(vals).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) };
  p.lidos[k] = Object.keys(vals).map(Number).sort((a, b) => a - b);
  p.descartados[k] = (p.descartados[k] || []).filter((v) => !vals['0x' + v.toString(16).padStart(2, '0')]);
}
fs.writeFileSync(`${R}/tipos_confirmados.json`, JSON.stringify(t, null, 1));
fs.writeFileSync(`${R}/progresso_mapeamento.json`, JSON.stringify(p, null, 1));

const pares = JSON.parse(fs.readFileSync(`${R}/cmbs_pares_v3.json`, 'utf8'));
const REAIS = ['0x00','0x04','0x05','0x07','0x0b','0x0d','0x0e','0x0f','0x18','0x19','0x1a'];
let oc = 0, cob = 0; const det = {};
for (const x of pares) {
  const [v, tb] = x.par.split('/'); const k = '0x' + parseInt(tb, 16).toString(16).padStart(2, '0');
  if (!REAIS.includes(k)) continue;
  const d = det[k] = det[k] || { oc: 0, cob: 0 };
  d.oc += x.n; oc += x.n; if (t.tabelas[k]?.[v]) { d.cob += x.n; cob += x.n; }
}
let tot = 0; for (const v of Object.values(t.tabelas)) tot += Object.keys(v).filter((x) => !x.startsWith('_')).length;
const nfort = Object.keys(t.fortificacoes).filter((x) => !x.startsWith('_')).length;
console.log(`${novos} novos nas tabelas, ${nf} novos em fortificacao | ${tot} tipos + ${nfort} de fortificacao | cobertura ${(100*cob/oc).toFixed(1)}% | faltam ${oc-cob} unidades\n`);
for (const k of REAIS) if (det[k]) console.log(`   ${k}: ${String(det[k].cob).padStart(4)}/${String(det[k].oc).padStart(4)}  ${String(Math.round(100*det[k].cob/det[k].oc)).padStart(3)}%`);
if (diverg.length) console.log(`\ndivergencias (resolvidas por maioria):\n   ${diverg.join('\n   ')}`);
