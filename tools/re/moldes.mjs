// BANCO DE MOLDES (PLANO_EXTRAS, secao 98): um registro canonico por tipo `(val, tab)`, colhido
// da biblioteca LIB uma vez. E o que permite sintetizar qualquer unidade do catalogo sem doador:
// molde + id novo + semente + posicao + grupo.
//
// Canonico = bytes do registro (com os 3 zeros de cabeca, sem os zeros de cauda) com id = 0, flag
// +7 sem 0x80/0x40/0x20/0x10, grupo +16 = 0, semente +20..+27 = 0, rumo/x/y = 0. Tudo o mais
// (exercito, categoria de compra +12, atributos, cauda de assentos/armas) fica como na fonte.
//
// Registros com nome embutido (bit 0x10) sao ignorados. Tipos com registros de tamanhos diferentes
// (transportes com passageiros) guardam TODAS as variantes, a mais frequente primeiro.
//
//   node moldes.mjs            -> gera research/moldes.json e imprime o resumo
//   node moldes.mjs "Breach Team"   -> mostra os moldes desse nome
import fs from 'node:fs';
import { abrirCompleto } from './anexar2.mjs';
import { posicaoNoCompleto } from './acrescentar.mjs';
import { catalogo } from './regs.mjs';

const LIB = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/LIB/';
const SAIDA = new URL('../../research/moldes.json', import.meta.url);
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const EX = { 1: 'US', 2: 'RU', 3: 'UKR' };

const fimDosRegistros = (c, desde) => { for (let i = desde; i < c.length; i++) { if (c[i] !== 0) continue; let z = 0; while (i + z < c.length && c[i + z] === 0) z++; if (z >= 32) return i; i += z; } return c.length; };

export function canonizar(c, R, k) {
  const r = R[k]; let fim = R[k + 1] ? R[k + 1].c : fimDosRegistros(c, r.c); while (fim > r.c && c[fim - 1] === 0) fim--;
  const b = Buffer.from(c.subarray(r.c, fim));
  if (b.length < 20) return { anomalia: `registro de ${b.length} B` };  // fantasma do scanner ou registro colado
  if (b[7] & 0x10) return null;                                        // nome embutido: nao serve de molde
  b.writeUInt32LE(0, 3); b[7] &= ~(0x80 | 0x40 | 0x20 | 0x10); b[16] = 0;
  // POSICAO: `10 | rumo | x | y` em +28 nos times e em +30 nos veiculos (que tem um u16 a mais em
  // +20); a SEMENTE de 8 B e sempre o que precede o 0x10. Aeronaves/drones (24 B) nao tem posicao.
  const plaus = (o) => o + 13 <= b.length && b[o] === 0x10 && Math.abs(b.readFloatLE(o + 5)) < 20000 && Math.abs(b.readFloatLE(o + 9)) < 20000;
  let offPos = null; if (!r.form) for (const o of [28, 30]) if (plaus(o)) { offPos = o; break; }
  if (offPos === null && !r.form && b.length >= 41) { const p = posicaoNoCompleto(c, r, R[k + 1] ? R[k + 1].c : r.c + 80); if (p) offPos = p.o - r.c; }
  if (offPos !== null) { b.fill(0, offPos - 8, offPos); b.fill(0, offPos + 1, offPos + 13); }   // semente, rumo, x, y
  else if (b.length >= 28) b.fill(0, 20, Math.min(28, b.length));
  // O que varia entre registros do MESMO tipo e nao e estrutura: +8 (indice na formacao), +9..+11
  // (atributos: experiencia, motivacao, lideranca...) e, nos veiculos, um u16 em +20 (serie?). Sai
  // da chave canonica e vai para `atributos`/`n20`, para o sintetizador escolher.
  const atributos = b.subarray(8, 12).toString('hex'); b.fill(0, 8, 12);
  let n20 = null; if (offPos === 30) { n20 = b.readUInt16LE(20); b.fill(0, 20, 22); }
  return { bytes: b, tam: b.length, offPos, exercito: c[r.c + 14], categoria: c[r.c + 12], form: !!r.form, atributos, n20 };
}

export function colher() {
  const cat = catalogo(); const tipos = {}; const anomalias = {}; let fontes = 0, registros = 0, comNome = 0;
  for (const f of fs.readdirSync(LIB).filter((x) => /\.btt$/i.test(x)).sort()) {
    let X; try { X = abrirCompleto(LIB + f); } catch (e) { console.error(`  X ${f}: ${e.message.slice(0, 60)}`); continue; }
    fontes++; const c = X.completo, R = X.R;
    R.forEach((r, k) => {
      registros++; const m = canonizar(c, R, k); if (!m) { comNome++; return; }
      if (m.anomalia) { (anomalias[f] ||= []).push(`id ${r.id} ${r.nm || '?'}: ${m.anomalia}`); return; }
      const chave = `${hx(r.val)},${hx(r.tab)}`; const nome = cat.tabelas[hx(r.tab)]?.[hx(r.val)] || null;
      const t = (tipos[chave] ||= { nome, val: r.val, tab: r.tab, form: m.form, variantes: [] });
      const hex = m.bytes.toString('hex');
      let v = t.variantes.find((x) => x.hex === hex);
      if (!v) { v = { hex, tam: m.tam, offPos: m.offPos, exercito: EX[m.exercito >> 4] || hx(m.exercito), categoria: hx(m.categoria), n: 0, fontes: [], atributos: {}, n20: {} }; t.variantes.push(v); }
      v.n++; if (v.fontes.length < 3 && !v.fontes.includes(f)) v.fontes.push(f);
      v.atributos[m.atributos] = (v.atributos[m.atributos] || 0) + 1; if (m.n20 !== null) v.n20[m.n20] = (v.n20[m.n20] || 0) + 1;
    });
  }
  const maisComum = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  for (const t of Object.values(tipos)) { t.variantes.sort((a, b) => b.n - a.n); for (const v of t.variantes) { v.atributosComum = maisComum(v.atributos); v.n20Comum = maisComum(v.n20); } }
  return { gerado: new Date().toISOString(), fontes, registros, comNome, anomalias, tipos };
}

export function moldes() { return JSON.parse(fs.readFileSync(SAIDA, 'utf8')); }

// Molde por nome (ou por par) e nacao: devolve a variante mais frequente com esse exercito.
export function molde(nomeOuPar, exercito = null) {
  const M = moldes(); const cands = Object.values(M.tipos).filter((t) => (typeof nomeOuPar === 'string' ? t.nome === nomeOuPar : t.val === nomeOuPar[0] && t.tab === nomeOuPar[1]));
  const vs = cands.flatMap((t) => t.variantes.map((v) => ({ ...v, tipo: t }))).filter((v) => !exercito || v.exercito === exercito).sort((a, b) => b.n - a.n);
  if (!vs.length) return null;
  const v = vs[0]; const b = Buffer.from(v.hex, 'hex');
  // devolve o molde ja com os atributos e o u16 de +20 mais comuns (o sintetizador pode trocar)
  if (v.atributosComum) Buffer.from(v.atributosComum, 'hex').copy(b, 8);
  if (v.n20Comum !== null && v.offPos === 30) b.writeUInt16LE(+v.n20Comum, 20);
  return { nome: v.tipo.nome, val: v.tipo.val, tab: v.tipo.tab, form: v.tipo.form, bytes: b, tam: v.tam, offPos: v.offPos, exercito: v.exercito, categoria: v.categoria, n: v.n, alternativas: vs.length - 1, atributos: v.atributosComum, n20: v.n20Comum };
}

const EH_MAIN = process.argv[1] && /[\\/]moldes\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const alvo = process.argv[2];
  if (alvo) {
    const M = moldes();
    for (const t of Object.values(M.tipos).filter((x) => x.nome === alvo)) console.log(`${t.nome} (${hx(t.val)},${hx(t.tab)})${t.form ? ' FORMACAO' : ''}: ` + t.variantes.map((v) => `${v.exercito} ${v.tam} B x${v.n} cat ${v.categoria} pos+${v.offPos} [${v.fontes[0]}]`).join(' | '));
  } else {
    const M = colher(); fs.writeFileSync(SAIDA, JSON.stringify(M, null, 1));
    const T = Object.values(M.tipos); const unid = T.filter((t) => !t.form);
    console.log(`${M.fontes} fontes, ${M.registros} registros (${M.comNome} com nome, ignorados); ${T.length} tipos com molde: ${unid.length} unidades, ${T.length - unid.length} formacoes`);
    console.log(`unidades com uma so variante: ${unid.filter((t) => t.variantes.length === 1).length}; com 2+: ${unid.filter((t) => t.variantes.length > 1).length}; sem posicao em +28: ${unid.filter((t) => t.variantes[0].offPos !== 28).length}`);
    const cat = catalogo(); let semMolde = 0; for (const [tab, T2] of Object.entries(cat.tabelas)) for (const val of Object.keys(T2)) if (/^0x/.test(val) && !M.tipos[`${val},${tab}`]) semMolde++;
    console.log(`tipos do catalogo sem molde na LIB: ${semMolde}`);
    const porEx = {}; unid.forEach((t) => t.variantes.forEach((v) => { porEx[v.exercito] = (porEx[v.exercito] || 0) + 1; })); console.log('variantes por exercito:', JSON.stringify(porEx));
    console.log('exemplos com 2+ variantes:', unid.filter((t) => t.variantes.length > 1).slice(0, 8).map((t) => `${t.nome} [${t.variantes.map((v) => v.tam + 'x' + v.n).join(',')}]`).join(' | '));
  }
}
