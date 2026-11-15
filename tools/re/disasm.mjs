// Disassembler para o executavel do CM Shock Force 2 (PE32 x86)
import fs from 'fs';
import { pathToFileURL } from 'url';
import { Capstone, Const, loadCapstone } from 'capstone-wasm';

const EXE = process.env.CM_EXE
  || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';

const buf = fs.readFileSync(EXE);

// ---- PE ----
function lerPE(b) {
  const peOff = b.readUInt32LE(0x3c);
  const nSec = b.readUInt16LE(peOff + 6);
  const optSize = b.readUInt16LE(peOff + 20);
  const optOff = peOff + 24;
  const imageBase = b.readUInt32LE(optOff + 28);
  const secOff = optOff + optSize;
  const secs = [];
  for (let i = 0; i < nSec; i++) {
    const o = secOff + i * 40;
    secs.push({
      nome: b.toString('latin1', o, o + 8).replace(/\0/g, ''),
      vsize: b.readUInt32LE(o + 8),
      va: b.readUInt32LE(o + 12),
      rsize: b.readUInt32LE(o + 16),
      roff: b.readUInt32LE(o + 20),
      exec: !!(b.readUInt32LE(o + 36) & 0x20000000),
    });
  }
  return { imageBase, secs };
}
const pe = lerPE(buf);
export const va2off = (va) => {
  for (const s of pe.secs) {
    const ini = pe.imageBase + s.va;
    if (va >= ini && va < ini + s.rsize) return s.roff + (va - ini);
  }
  return null;
};
export const off2va = (off) => {
  for (const s of pe.secs)
    if (off >= s.roff && off < s.roff + s.rsize) return pe.imageBase + s.va + (off - s.roff);
  return null;
};
const secDe = (va) => {
  for (const s of pe.secs) {
    const ini = pe.imageBase + s.va;
    if (va >= ini && va < ini + s.rsize) return s.nome;
  }
  return '?';
};

await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);

// Desmonta a partir de um VA ate encontrar ret/jmp incondicional ou atingir o limite
export function funcao(va, maxInsn = 400) {
  const off = va2off(va);
  if (off === null) return { erro: `VA 0x${va.toString(16)} fora das secoes` };
  const bytes = buf.subarray(off, off + Math.min(4096, buf.length - off));
  const insns = cs.disasm(bytes, { address: va, count: maxInsn });
  const out = [];
  const chamadas = new Set();
  for (const i of insns) {
    const addr = Number(i.address);
    out.push({ addr, mnem: i.mnemonic, ops: i.opStr, size: i.size });
    if (i.mnemonic === 'call') {
      const m = i.opStr.match(/^0x([0-9a-f]+)$/);
      if (m) chamadas.add(parseInt(m[1], 16));
    }
    if (i.mnemonic === 'ret' || i.mnemonic === 'retn') break;
  }
  return { insns: out, chamadas: [...chamadas] };
}

export function imprimir(va, maxInsn = 400, rotulo = '') {
  const r = funcao(va, maxInsn);
  console.log(`\n===== 0x${va.toString(16)} (${secDe(va)}) ${rotulo} =====`);
  if (r.erro) { console.log('  ' + r.erro); return r; }
  for (const i of r.insns) {
    const alvo = i.mnem === 'call' || i.mnem.startsWith('j') ? '' : '';
    console.log(`  0x${i.addr.toString(16).padStart(8, '0')}  ${i.mnem.padEnd(8)} ${i.ops}${alvo}`);
  }
  if (r.chamadas.length)
    console.log(`  -> chama: ${r.chamadas.map((c) => '0x' + c.toString(16)).join(' ')}`);
  return r;
}

// Encontra o inicio provavel da funcao que contem um VA, procurando o prologo para tras
export function inicioFuncao(va, janela = 0x800) {
  const off = va2off(va);
  for (let back = 0; back < janela; back++) {
    const o = off - back;
    // push ebp ; mov ebp, esp   (55 8B EC)
    if (buf[o] === 0x55 && buf[o + 1] === 0x8b && buf[o + 2] === 0xec) return off2va(o);
  }
  return null;
}

const EH_MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (EH_MAIN && process.argv[2]) {
  const modo = process.argv[2];
  if (modo === 'sec') {
    console.log('ImageBase 0x' + pe.imageBase.toString(16));
    pe.secs.forEach((s) =>
      console.log(`  ${s.nome.padEnd(9)} VA 0x${(pe.imageBase + s.va).toString(16)}  arquivo 0x${s.roff.toString(16)}  ${s.rsize}b ${s.exec ? '[exec]' : ''}`));
  } else {
    for (let k = 2; k < process.argv.length; k++) {
      const va = parseInt(process.argv[k], 16);
      const ini = inicioFuncao(va);
      if (ini && ini !== va) console.log(`\n(inicio de funcao provavel para 0x${va.toString(16)}: 0x${ini.toString(16)})`);
      imprimir(ini || va, 120);
    }
  }
}

// Versao robusta: um candidato a prologo so vale se, desmontando linearmente,
// alcancar EXATAMENTE o VA alvo sem antes cruzar um ret.
export function inicioFuncaoV2(vaAlvo, janela = 0x1000) {
  const offAlvo = va2off(vaAlvo);
  if (offAlvo === null) return null;
  const cands = [];
  for (let back = 0; back < janela; back++) {
    const o = offAlvo - back;
    if (o < 0) break;
    const b0 = buf[o], b1 = buf[o + 1], b2 = buf[o + 2];
    const prologo =
      (b0 === 0x55 && b1 === 0x8b && b2 === 0xec) ||   // push ebp; mov ebp,esp
      (b0 === 0x53 || b0 === 0x56 || b0 === 0x57) ||   // push ebx/esi/edi
      (b0 === 0x83 && b1 === 0xec) ||                  // sub esp, imm8
      (b0 === 0x81 && b1 === 0xec) ||                  // sub esp, imm32
      (b0 === 0x8b && b1 === 0xff);                    // mov edi,edi (hotpatch)
    if (!prologo) continue;
    // exige que o byte anterior seja padding (int3/nop) ou um ret -> fronteira de funcao
    // fronteira: precedido por padding, ou alinhado em 16 bytes (padrao MSVC)
    const ant = buf[o - 1];
    const va0 = off2va(o);
    if (!(ant === 0xcc || ant === 0x90 || (va0 !== null && va0 % 16 === 0))) continue;
    cands.push(off2va(o));
  }
  for (const va of cands) {
    const off = va2off(va);
    const bytes = buf.subarray(off, off + Math.min(0x2000, buf.length - off));
    const insns = cs.disasm(bytes, { address: va, count: 3000 });
    for (const i of insns) {
      const a = Number(i.address);
      if (a === vaAlvo) return va;
      if (a > vaAlvo) break;
      if (i.mnemonic === 'ret') break;
    }
  }
  return null;
}
