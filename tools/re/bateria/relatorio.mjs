// O RELATORIO DA BATERIA (03/10): cruza o veredito offline com o do jogo, caso a caso.
//   node tools/re/bateria/relatorio.mjs --run r1   -> research/bateria/<run>/RELATORIO.md
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const arg = (k, padrao) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : padrao; };
const RUN = arg('--run'); if (!RUN) throw new Error('--run NOME');
const DIR = path.join(L.DIR_BATERIA, RUN);
const { casos } = JSON.parse(fs.readFileSync(path.join(DIR, 'casos.json'), 'utf8'));
const off = new Map(L.lerLinhas(path.join(DIR, 'offline.jsonl')).map((l) => [l.id, l]));
for (const extra of fs.readdirSync(L.DIR_BATERIA).filter((d) => d !== RUN)) {           // refeitos offline (ex.: r2)
  const f = path.join(L.DIR_BATERIA, extra, 'offline.jsonl');
  if (fs.existsSync(f)) for (const l of L.lerLinhas(f)) if (off.has(l.id) && casos.some((c) => c.id === l.id)) off.set(l.id, l);
}
const res = L.lerLinhas(path.join(DIR, 'resultados.jsonl'));
const porCaso = new Map(); for (const l of res) { if (!l.caso) continue; if (!porCaso.has(l.caso)) porCaso.set(l.caso, {}); porCaso.get(l.caso)[l.etapa] = l; }

const linhas = [];
for (const [id, e] of porCaso) {
  const c = casos.find((x) => x.id === id); const o = off.get(id);
  linhas.push({
    id, nome: c?.nome?.slice(0, 70) || '', fam: c?.familia, offline: o?.veredito || '-',
    unidades: o?.volume?.corePresentes ?? '-', registros: o?.volume?.registros ?? '-',
    b1: e.b1?.veredito || '-', virada: e.virada ? `${e.virada.variante} ${e.virada.veredito}` : '-', b2: e.b2?.veredito || '-',
    pico: e.b1?.mem?.peakVirt || '-', carga: e.b1?.tempos?.total ?? '-', fim: e.fim?.veredito || '-',
    nota: [e.b1?.veredito !== 'OK' ? e.b1?.detalhe : null, e.virada?.veredito === 'ERRO-APP' ? e.virada.detalhe : null].filter(Boolean).join(' · ').slice(0, 160),
  });
}
linhas.sort((a, b) => a.id.localeCompare(b.id));
const conta = (f) => { const m = {}; for (const l of linhas) m[l[f]] = (m[l[f]] || 0) + 1; return m; };
const offTodos = {}; for (const o of off.values()) { offTodos[o.familia] = offTodos[o.familia] || {}; offTodos[o.familia][o.veredito] = (offTodos[o.familia][o.veredito] || 0) + 1; }

const md = [
  `# Bateria de carga — run ${RUN}`, '',
  `Gerado em ${new Date().toISOString()}. Casos: \`casos.json\` (${casos.length}); offline: \`offline.jsonl\`; tela: \`resultados.jsonl\`.`, '',
  '## Offline (todos os casos)', '',
  '| família | vereditos |', '|---|---|',
  ...Object.entries(offTodos).sort().map(([f, v]) => `| ${f} | ${Object.entries(v).map(([k, n]) => `${k} ${n}`).join(', ')} |`), '',
  '## Tela', '',
  `Batalha 1: ${JSON.stringify(conta('b1'))} · batalha 2: ${JSON.stringify(conta('b2'))} · fim: ${JSON.stringify(conta('fim'))}`, '',
  '| caso | fam | offline | em campo | registros | b1 | virada | b2 | pico virtual (MB) | b1 (s) | nota |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...linhas.map((l) => `| ${l.id} | ${l.fam} | ${l.offline} | ${l.unidades} | ${l.registros} | ${l.b1} | ${l.virada} | ${l.b2} | ${l.pico} | ${l.carga} | ${l.nota.replace(/\|/g, '/')} |`), '',
  '## Volume (família C)', '',
  '| caso | em campo | homens no save | b1 | pico virtual (MB) |', '|---|---|---|---|---|',
  ...linhas.filter((l) => l.fam === 'C').sort((a, b) => a.unidades - b.unidades).map((l) => { const s = porCaso.get(l.id)['virada-save']; let h = '-'; try { h = JSON.parse(s?.detalhe || '{}').homens ?? '-'; } catch {} return `| ${l.id} | ${l.unidades} | ${h} | ${l.b1} | ${l.pico} |`; }),
];
fs.writeFileSync(path.join(DIR, 'RELATORIO.md'), md.join('\n') + '\n');
console.log(`${path.join(DIR, 'RELATORIO.md')}: ${linhas.length} casos na tela`);
