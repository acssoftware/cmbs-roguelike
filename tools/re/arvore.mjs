// Traca a arvore de serializacao a partir de uma raiz: o formato E essa arvore
import fs from 'fs';
import { analisarSerializador } from './esquema.mjs';

const rotulos = new Map();
try {
  JSON.parse(fs.readFileSync('../../research/serializadores_rotulados.json', 'utf8'))
    .forEach((r) => { if (!rotulos.has(r.serializador)) rotulos.set(r.serializador, r.classe); });
} catch (_) {}

const cache = new Map();
function analisar(va) {
  if (!cache.has(va)) { try { cache.set(va, analisarSerializador(va, 4000)); } catch (_) { cache.set(va, null); } }
  return cache.get(va);
}
function ehSerializador(va) {
  const a = analisar(va);
  return a && a.itens.filter((x) => x.tipo === 'campo').length >= 2;
}

export function arvore(va, prof = 4, vistos = new Set(), saida = []) {
  if (prof < 0 || vistos.has(va)) return saida;
  vistos.add(va);
  const a = analisar(va);
  if (!a) return saida;
  const campos = a.itens.filter((x) => x.tipo === 'campo');
  const subs = a.itens.filter((x) => x.tipo === 'sub' && ehSerializador(x.alvo));
  saida.push({ va, prof, campos: campos.length, bytes: campos.reduce((t, c) => t + c.bytes, 0),
    classe: rotulos.get(va) || null, filhos: subs.map((s) => s.alvo) });
  for (const s of subs) arvore(s.alvo, prof - 1, vistos, saida);
  return saida;
}

const EH_MAIN = process.argv[1] && /[\\/]arvore\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const raiz = parseInt(process.argv[2], 16);
  const prof = parseInt(process.argv[3] || '4');
  const nos = arvore(raiz, prof);
  console.log(`arvore de serializacao a partir de 0x${raiz.toString(16)} (profundidade ${prof})`);
  console.log(`${nos.length} serializadores alcancados\n`);
  console.log("prof      VA       campos  bytes  classe");
  console.log("-".repeat(64));
  nos.forEach((n) => console.log(
    `${' '.repeat(n.prof === undefined ? 0 : 0)}${String(prof - n.prof).padStart(3)}  0x${n.va.toString(16).padEnd(9)} ${String(n.campos).padStart(6)} ${String(n.bytes).padStart(6)}  ${n.classe || ''}`));
  const tot = nos.reduce((t, n) => t + n.bytes, 0);
  console.log(`\ntotal de bytes diretos na arvore: ${tot}`);
}
