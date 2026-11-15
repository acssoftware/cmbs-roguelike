// Extrai o ESQUEMA do formato lendo as funcoes serializadoras do executavel.
//
// Padrao do serializador (mesmo codigo serve leitura e escrita; o stream decide a direcao):
//
//     mov/movzx eax, <tam> ptr [esi + OFFSET]    ; le o campo do objeto
//     lea ecx, [esp + N]                          ; buffer temporario
//     mov [esp+N], eax                            ; copia para o buffer
//     mov eax, dword ptr [edi]                    ; vtable do stream
//     push <TAMANHO>                              ; quantos bytes
//     push ecx
//     mov ecx, edi
//     call dword ptr [eax]                        ; stream->serialize(buf, tamanho)
//
// Cada `push <TAMANHO>` seguido de `call dword ptr [eax]` e UM CAMPO do arquivo,
// na ordem exata em que aparece no fluxo. Chamadas diretas (`call 0xADDR`) antes ou
// entre os campos serializam a classe base ou sub-objetos.
import fs from 'fs';
import { Capstone, Const, loadCapstone } from 'capstone-wasm';
import { va2off } from './disasm.mjs';
import { operacoes } from './ops.mjs';

const EXE = process.env.CM_EXE
  || 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Shock Force 2/CM Shock Force 2.exe';
const buf = fs.readFileSync(EXE);

await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);

// Le uma funcao ate o `ret`, devolvendo as instrucoes
export function instrucoes(va, max = 4096) {
  const off = va2off(va);
  if (off === null) return [];
  const bytes = buf.subarray(off, off + Math.min(max, buf.length - off));
  const out = [];
  for (const i of cs.disasm(bytes, { address: va, count: 2000 })) {
    out.push({ addr: Number(i.address), m: i.mnemonic, o: i.opStr });
    if (i.mnemonic === 'ret') break;
  }
  return out;
}

// Analisa uma funcao serializadora. Delega a ops.mjs (implementacao unica e corrigida:
// em stdcall o TAMANHO e o penultimo push antes do call, nao o ultimo).
export function analisarSerializador(va, max = 8000) {
  const ops = operacoes(va, max);
  const itens = ops.filter((o) => o.op === 'campo' || o.op === 'chamada')
    .map((o) => o.op === 'campo'
      ? { tipo: 'campo', addr: o.addr, bytes: o.bytes, membro: o.membro || '?', larguraMembro: o.larguraMembro || '?' }
      : { tipo: 'sub', addr: o.addr, alvo: o.alvo });
  return { va, instrucoes: ops.length, itens };
}

// Percorre recursivamente: serializador -> classe base -> sub-objetos
export function esquemaRecursivo(va, profundidade = 3, vistos = new Set()) {
  if (vistos.has(va) || profundidade < 0) return null;
  vistos.add(va);
  const a = analisarSerializador(va);
  const campos = a.itens.filter((x) => x.tipo === 'campo');
  const subs = a.itens.filter((x) => x.tipo === 'sub');
  // so desce em sub-chamadas que tambem parecem serializadores
  const filhos = [];
  for (const s of subs) {
    const sa = analisarSerializador(s.alvo);
    const nCampos = sa.itens.filter((x) => x.tipo === 'campo').length;
    if (nCampos >= 2) {
      const f = esquemaRecursivo(s.alvo, profundidade - 1, vistos);
      if (f) filhos.push({ chamadaEm: s.addr, ...f });
    }
  }
  return { va, campos, subs: subs.map((s) => s.alvo), filhos, bytesTotais: campos.reduce((t, c) => t + c.bytes, 0) };
}

function imprimir(n, ident = '') {
  console.log(`${ident}0x${n.va.toString(16)}  — ${n.campos.length} campos, ${n.bytesTotais} bytes diretos`);
  n.campos.forEach((c, k) =>
    console.log(`${ident}   [${String(k).padStart(3)}] ${String(c.bytes)}b  membro ${c.membro.padEnd(8)} (${c.larguraMembro})`));
  n.filhos.forEach((f) => { console.log(`${ident}   -> sub-objeto em 0x${f.chamadaEm.toString(16)}:`); imprimir(f, ident + '      '); });
}

const EH_MAIN = process.argv[1] && /[\\/]esquema\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  for (const a of process.argv.slice(2)) {
    const va = parseInt(a, 16);
    const e = esquemaRecursivo(va, 2);
    console.log(`\n===== serializador 0x${va.toString(16)} =====`);
    imprimir(e);
  }
}
