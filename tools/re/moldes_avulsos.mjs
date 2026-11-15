// BANCO DE MOLDES DE VEICULO AVULSO (17/10/2026, gabarito do autor `Game Files/TESTING/STRYKER.btt`).
//
// O "Single Vehicle" que o editor vende NAO e o veiculo da formacao: no registro, o mesmo (val, tab) vem com
// `+8 = 0` (sem vaga na TO&E), `+11 = 0xc3` (bits baixos 3 — os de formacao tem 1; os Breach Teams avulsos tambem
// tem 3), `+20..21 = 60 0d` e SEM a cauda de equipamento (43 B canonicos contra 52). E e a vaga da TO&E que decide o
// que o jogo poe dentro: o M1126 de pelotao nasce com Javelin, o avulso nao. O banco da LIB (`moldes.mjs`) so tem
// registros de formacao, entao um extra sintetizado dali era um veiculo de pelotao disfarcado (ZZ STRYKER AVULSO).
//
// Fontes: `TESTING/STRYKER.btt` e todo `TESTING/*AVULSO*.btt` que o autor salvar no editor com veiculos da lista
// "Single Vehicles" (um arquivo por exercito serve). Discriminador: registro de unidade com o bit 0x02 de +11.
//
//   node tools/re/moldes_avulsos.mjs            -> lista o que colheria
//   node tools/re/moldes_avulsos.mjs --gravar   -> grava research/moldes_avulsos.json
import fs from 'node:fs';
import path from 'node:path';
import { abrirCompleto } from './anexar2.mjs';
import { canonizar } from './moldes.mjs';
import { catalogo } from './regs.mjs';

const TESTING = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/TESTING/';
const SAIDA = new URL('../../research/moldes_avulsos.json', import.meta.url);
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const EX = { 1: 'US', 2: 'RU', 3: 'UKR' };

// bit 0x02 de +11: 3 contra 1 nos arquivos do editor, 2 contra 0 no core do app (o bit 0 cai no caminho)
export const ehAvulso = (c, r) => !r.form && (c[r.c + 11] & 0x02) !== 0;

export function fontes() {
  if (!fs.existsSync(TESTING)) return [];
  return fs.readdirSync(TESTING).filter((f) => /\.btt$/i.test(f) && (/^STRYKER\.btt$/i.test(f) || /AVULSO/i.test(f))).sort().map((f) => path.join(TESTING, f));
}

export function colher(arquivos = fontes()) {
  const cat = catalogo(); const tipos = {}; let registros = 0, avulsos = 0; const anomalias = [];
  for (const f of arquivos) {
    let X; try { X = abrirCompleto(f); } catch (e) { anomalias.push(`${path.basename(f)}: ${e.message.slice(0, 80)}`); continue; }
    const c = X.completo, R = X.R;
    R.forEach((r, k) => {
      registros++;
      if (!ehAvulso(c, r)) return;
      const m = canonizar(c, R, k);
      if (!m || m.anomalia) { anomalias.push(`${path.basename(f)} id ${r.id}: ${m?.anomalia || 'nome embutido'}`); return; }
      if (m.offPos !== 30) { anomalias.push(`${path.basename(f)} id ${r.id} ${r.nm}: posicao em +${m.offPos}, nao e veiculo`); return; }
      avulsos++;
      const chave = `${hx(r.val)},${hx(r.tab)}`; const nome = cat.tabelas[hx(r.tab)]?.[hx(r.val)] || r.nm || null;
      const t = (tipos[chave] ||= { nome, val: r.val, tab: r.tab, form: false, variantes: [] });
      const hex = m.bytes.toString('hex');
      let v = t.variantes.find((x) => x.hex === hex);
      if (!v) { v = { hex, tam: m.tam, offPos: m.offPos, exercito: EX[m.exercito >> 4] || hx(m.exercito), categoria: hx(m.categoria), n: 0, fontes: [], atributos: {}, n20: {} }; t.variantes.push(v); }
      v.n++; if (!v.fontes.includes(path.basename(f))) v.fontes.push(path.basename(f));
      v.atributos[m.atributos] = (v.atributos[m.atributos] || 0) + 1; if (m.n20 !== null) v.n20[m.n20] = (v.n20[m.n20] || 0) + 1;
    });
  }
  const maisComum = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const t of Object.values(tipos)) { t.variantes.sort((a, b) => b.n - a.n); for (const v of t.variantes) { v.atributosComum = maisComum(v.atributos); v.n20Comum = maisComum(v.n20); } }
  return { nota: 'Moldes de veiculo AVULSO (Single Vehicles do editor), colhidos de gabaritos em Game Files/TESTING; ver tools/re/moldes_avulsos.mjs', gerado: new Date().toISOString(), fontes: arquivos.map((f) => path.basename(f)), registros, avulsos, anomalias, tipos };
}

export function moldesAvulsos() { try { return JSON.parse(fs.readFileSync(SAIDA, 'utf8')); } catch { return { tipos: {} }; } }

// Molde avulso por nome (ou par) e exercito, como `moldes.molde()`: a variante mais vista, ja com os atributos
// (+8 = 0, +11 = 0xc3) e o u16 de +20 mais comuns.
export function moldeAvulso(nomeOuPar, exercito = null) {
  const M = moldesAvulsos();
  const cands = Object.values(M.tipos || {}).filter((t) => (typeof nomeOuPar === 'string' ? t.nome === nomeOuPar : t.val === nomeOuPar[0] && t.tab === nomeOuPar[1]));
  const vs = cands.flatMap((t) => t.variantes.map((v) => ({ ...v, tipo: t }))).filter((v) => !exercito || v.exercito === exercito).sort((a, b) => b.n - a.n);
  if (!vs.length) return null;
  const v = vs[0]; const b = Buffer.from(v.hex, 'hex');
  if (v.atributosComum) Buffer.from(v.atributosComum, 'hex').copy(b, 8);
  if (v.n20Comum !== null && v.offPos === 30) b.writeUInt16LE(+v.n20Comum, 20);
  return { nome: v.tipo.nome, val: v.tipo.val, tab: v.tipo.tab, form: false, bytes: b, tam: v.tam, offPos: v.offPos, exercito: v.exercito, categoria: v.categoria, n: v.n, fontes: v.fontes, avulso: true };
}

const EH_MAIN = process.argv[1] && /[\\/]moldes_avulsos\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const M = colher();
  console.log(`${M.fontes.length} fonte(s): ${M.fontes.join(', ')} | ${M.registros} registros, ${M.avulsos} avulsos, ${Object.keys(M.tipos).length} tipos`);
  for (const t of Object.values(M.tipos)) console.log(`  ${t.nome} (${hx(t.val)},${hx(t.tab)}): ` + t.variantes.map((v) => `${v.exercito} ${v.tam} B x${v.n} +8..11 ${v.atributosComum} n20 ${v.n20Comum} [${v.fontes.join(', ')}]`).join(' | '));
  if (M.anomalias.length) console.log('anomalias:', M.anomalias.join(' ; '));
  if (process.argv.includes('--gravar')) { fs.writeFileSync(SAIDA, JSON.stringify(M, null, 1)); console.log('gravado', SAIDA.pathname); }
}
