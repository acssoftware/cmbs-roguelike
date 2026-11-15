// Refaz o censo de pares (tipo, tabela) contando SO os registros que entram numa corrida de
// ids crescentes. O censo antigo (cmbs_pares_v2.json) contava tambem os falsos positivos do
// extrator: em "BSBP 05 City" ele acha 58 registros 0x07/0x77 a 29-33 bytes DENTRO do
// registro real anterior, com cinco ids repetidos na casa dos 17.000 enquanto os ids reais
// vao ate ~700. Nao sao unidades. Eram eles que faziam a tabela 0x07 parecer 17% incompleta.
import fs from 'fs';
import { ordemCompleta } from './oob.mjs';
const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');

// Item de fortificacao nao e tipo geral: ele herda o nome da mae e nao tem significado
// proprio, entao nao entra no denominador. Sao reconhecidos por serem filhos de um bloco de
// fortificacao — cabecalho com nome de fortificacao, ou cabecalho seguido de seis ou mais
// filhos identicos. O bloco cujo cabecalho o extrator perdeu num corte escapa dessa deteccao;
// para esses vale o par (mae, filho) ja registrado em fortificacoes, desde que o par NAO
// tenha nome nas tabelas gerais — se tem, e uma ocorrencia legitima fora de fortificacao.
const FORT = /trench|sandbag|barbed wire|mines|target reference|bunker|foxhole|roadblock|obstacle|rubble/i;
const CABECA = new Set([0x19, 0x0b, 0x1a, 0x18]);
const t = JSON.parse(fs.readFileSync('../../research/tipos_confirmados.json', 'utf8'));
const soFort = new Set(Object.keys(t.fortificacoes || {}).filter((k) => !k.startsWith('_'))
  .map((k) => k.split(' + ')[1])
  .filter((p) => { const [tb, v] = p.split('/'); return !t.tabelas[tb]?.[v]; }));

const cont = new Map(); let arqs = 0, linhas = 0, fora = 0;
for (const f of fs.readdirSync(S).filter((x) => /\.btt$/i.test(x) && !/^ZZ /.test(x))) {
  let d; try { d = ordemCompleta(f, 6); } catch (_) { continue; }
  arqs++;
  const bl2 = d.bl;
  const ehFort = new Array(d.linhas.length).fill(false);
  let sob = false;
  d.linhas.forEach((L, i) => {
    if (!L) { sob = false; return; }
    const nm = t.tabelas[hx(bl2[L.off + 18])]?.[hx(bl2[L.off + 17])];
    if (CABECA.has(bl2[L.off + 18])) { sob = FORT.test(nm || ''); return; }
    ehFort[i] = sob;
  });
  for (let i = 1; i < d.linhas.length; i++) {
    const H = d.linhas[i - 1], L = d.linhas[i];
    if (!H || !L || !CABECA.has(bl2[H.off + 18]) || CABECA.has(bl2[L.off + 18])) continue;
    const ch = `${hx(bl2[L.off + 17])}/${hx(bl2[L.off + 18])}`;
    let j = i; while (j < d.linhas.length && d.linhas[j] &&
      `${hx(bl2[d.linhas[j].off + 17])}/${hx(bl2[d.linhas[j].off + 18])}` === ch) j++;
    if (j - i >= 6) for (let q = i; q < j; q++) ehFort[q] = true;
  }
  d.linhas.forEach((L, i) => {
    if (!L) return;
    const par = `${hx(d.bl[L.off+17])}/${hx(d.bl[L.off+18])}`;
    if (ehFort[i] || soFort.has(`${hx(d.bl[L.off+18])}/${hx(d.bl[L.off+17])}`)) { fora++; return; }
    linhas++;
    const k = `${hx(d.bl[L.off+17])}/${hx(d.bl[L.off+18])}`;
    cont.set(k, (cont.get(k) || 0) + 1);
  });
}
const saida = [...cont.entries()].map(([par, n]) => ({ par, n })).sort((a, b) => b.n - a.n);
fs.writeFileSync('../../research/cmbs_pares_v3.json', JSON.stringify(saida, null, 1));
console.log(`${arqs} cenarios de fabrica | ${linhas} registros | ${saida.length} pares distintos | ${fora} itens de fortificacao fora do denominador`);

const velho = JSON.parse(fs.readFileSync('../../research/cmbs_pares_v2.json', 'utf8'));
const mv = new Map(velho.map((x) => [x.par, x.n]));
const sumiram = velho.filter((x) => !cont.has(x.par)).sort((a, b) => b.n - a.n);
console.log(`\ncensos: v2 tinha ${velho.reduce((s,x)=>s+x.n,0)} registros em ${velho.length} pares; v3 tem ${linhas} em ${saida.length}`);
console.log(`${sumiram.length} pares sumiram (so existiam no ruido). Os maiores:`);
sumiram.slice(0, 12).forEach((x) => console.log(`   ${x.par}  ${x.n}`));
