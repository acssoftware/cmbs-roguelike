import fs from 'fs';
import { Capstone, Const, loadCapstone } from 'capstone-wasm';
import { va2off } from './disasm.mjs';
const EXE = process.env.CM_EXE || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const buf = fs.readFileSync(EXE);
await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);
const ini = parseInt(process.argv[2],16), fim = parseInt(process.argv[3],16);
const off = va2off(ini);
const insns = cs.disasm(buf.subarray(off, off + (fim-ini)), { address: ini });
const filtro = process.argv[4] ? new RegExp(process.argv[4],'i') : null;
for (const i of insns) {
  const linha = `  0x${Number(i.address).toString(16).padStart(8,'0')}  ${i.mnemonic.padEnd(9)} ${i.opStr}`;
  if (!filtro || filtro.test(i.mnemonic + ' ' + i.opStr)) console.log(linha);
}
