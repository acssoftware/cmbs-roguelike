// Varre todas as funcoes conhecidas e identifica as que sao SERIALIZADORAS
import { indice } from './index.mjs';
import { analisarSerializador } from './esquema.mjs';
const funcs = indice();
console.error(`varrendo ${funcs.length} funcoes...`);
const serial = [];
for (const f of funcs) {
  let a; try { a = analisarSerializador(f.va, 3000); } catch (_) { continue; }
  const campos = a.itens.filter((x) => x.tipo === 'campo');
  if (campos.length >= 4) {
    serial.push({ va: f.va, chamadas: f.chamadas, campos: campos.length,
      bytes: campos.reduce((t, c) => t + c.bytes, 0), insn: a.instrucoes });
  }
}
serial.sort((a, b) => b.campos - a.campos);
console.log(`serializadores encontrados: ${serial.length}\n`);
console.log("     VA     campos  bytes  insn  chamado");
console.log("-".repeat(50));
serial.slice(0, parseInt(process.argv[2] || '30')).forEach((s) =>
  console.log(`  0x${s.va.toString(16).padEnd(8)} ${String(s.campos).padStart(6)} ${String(s.bytes).padStart(6)} ${String(s.insn).padStart(5)} ${String(s.chamadas).padStart(7)}x`));
