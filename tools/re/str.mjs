import fs from 'fs';
import { va2off } from './disasm.mjs';
const EXE = process.env.CM_EXE || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const b = fs.readFileSync(EXE);
for (const a of process.argv.slice(2)) {
  const va = parseInt(a, 16), off = va2off(va);
  if (off === null) { console.log(`0x${va.toString(16)}: fora das secoes`); continue; }
  let s = '';
  for (let i = 0; i < 60; i++) { const c = b[off + i]; if (c === 0) break; s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.'; }
  console.log(`0x${va.toString(16)}: "${s}"\n            hex ${b.subarray(off, off + 24).toString('hex')}`);
}
