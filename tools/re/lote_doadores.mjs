// Gera uma batalha por DOADOR, para testar muitos em sequencia e achar o que separa os que
// copiam dos que travam. A serie de tamanho morreu quando o Combined Arms podado a 46
// registros travou, menor que o Tank 31 de 44 que passa: nao e porte, e o doador.
import fs from 'fs';
import { ler, marcador, raizDoLado } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore, contagemDeFilhos } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const TEMPLATE = 'ZZ QBSMALL ALL add manual 2.btt';

const d = ler(S + TEMPLATE);
const cru = d.cru, porPos = indiceDeTokens(d.tokens);
const R = registros(cru).sort((a, b) => a.off - b.off);
const ini = (off) => inicioDoRegistro(cru, porPos, off).pos;
const alinhar = (m, base) => m + (((base % 256) - (m % 256)) + 256) % 256;
const maxId = Math.max(...R.map((x) => x.id));

export function gerar(idDoador, rotulo) {
  const i = R.findIndex((x) => x.id === idDoador);
  if (i < 0) throw new Error(`formacao ${idDoador} nao achada`);
  const fim = subArvore(cru, porPos, R, i);
  const a = ini(R[i].off), b = ini(R[fim].off);
  const nRegs = fim - i;
  const nToks = d.tokens.filter((t) => t.pos >= a && t.pos < b).length;
  const saida = `AA D${String(idDoador).padStart(4, '0')} ${rotulo}.btt`;

  const idBase = alinhar(maxId + 100, R[i].id);
  const buf = Buffer.from(cru.subarray(a, b));
  R.slice(i, fim).forEach((x, k) => {
    buf.writeUInt32LE(idBase + k, x.off + 3 - a);
    buf[x.off + 7 - a] &= ~0x80;
  });
  const tk = d.tokens.filter((t) => t.pos >= a && t.pos < b).map((t) => ({ pos: t.pos - a, cod: t.cod }));

  // mantem visivel so o doador; o resto some
  const manter = new Set(R.slice(i, fim).map((x) => x.id));
  const corpo0 = Buffer.from(cru);
  R.filter((x) => x.nm && !manter.has(x.id)).forEach((x) => { corpo0[x.off + 7] |= 0x80; });

  const corpo = Buffer.concat([corpo0.subarray(0, b), buf, corpo0.subarray(b)]);
  const kCorte = d.tokens.findIndex((t) => t.pos >= b);
  const toks = [
    ...d.tokens.slice(0, kCorte),
    ...tk.map((t) => ({ pos: t.pos + b, cod: t.cod })),
    ...d.tokens.slice(kCorte).map((t) => ({ pos: t.pos + buf.length, cod: t.cod })),
  ];

  const army = R[i].army === 2 ? 0x27 : 0x17;
  const mm = marcador({ cru: corpo, tokens: toks });
  const raiz = raizDoLado(corpo.subarray(mm.pos), army);
  corpo.writeUInt32LE(raiz.n + 1, mm.pos + raiz.pos);

  const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru: corpo, tokens: toks }, d.esc)]);
  reconstruir(S + TEMPLATE, S + saida, (x, k) => (k === 1 ? bloco : x));

  const v = ler(S + saida);
  if (!v.cru.equals(corpo)) throw new Error('cru divergente');
  const ids = registros(v.cru).map((x) => x.id);
  const dup = ids.filter((x, k) => ids.indexOf(x) !== k);
  if (dup.length) throw new Error(`ids duplicados: ${[...new Set(dup)].slice(0, 5).join(', ')}`);
  return { saida, nRegs, nToks, nm: R[i].nm, army: ['?', 'US', 'RU', 'UKR'][R[i].army] };
}

const EH_MAIN = process.argv[1] && /[\\/]lote_doadores\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const alvos = process.argv.slice(2).map(Number);
  const linhas = [];
  for (const id of alvos) {
    const r = gerar(id, 'X');
    console.log(`${r.saida}  ${String(r.nRegs).padStart(3)} regs ${String(r.nToks).padStart(4)} tok  ${r.army.padEnd(4)} ${r.nm}`);
    linhas.push({ id, ...r });
  }
  fs.writeFileSync('../../research/lote_doadores.json', JSON.stringify(linhas, null, 1));
}
