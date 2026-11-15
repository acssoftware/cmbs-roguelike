// Aplica o template de 3x formacoes em varios mapas de Quick Battle de uma vez.
//
// Cada saida e o MAPA do alvo com a FORCA do template — a operacao da secao 28, ja aprovada
// em jogo (ZZ ASINTORF ALL). Grava numa subpasta do GENERATOR_TEMPLATES para nao encostar no
// template feito a mao, que e um mapa Assault e teria nome igual ao de uma das saidas.
//
// Uso:  node lote_mapas.mjs [tipo]        tipo = Assault (padrao), Attack, Probe, Meet
import fs from 'fs';
import path from 'path';
import { ler, marcador, raizDoLado } from './transplante.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { registros } from './regs.mjs';

const G = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const DIR_QB = G + 'Quick Battle Maps/';
const TEMPLATE = G + 'GENERATOR_TEMPLATES/City  (688 X 736) 047r Assault.btt';
const TIPO = process.argv[2] || 'Assault';
const DIR_SAIDA = G + 'GENERATOR_TEMPLATES/' + TIPO.toUpperCase() + '/';

const T = ler(TEMPLATE);
const mT = marcador(T);
const azT = raizDoLado(T.cru.subarray(mT.pos), 0x17);
const vmT = raizDoLado(T.cru.subarray(mT.pos), 0x27);
console.log(`template: ${azT.n} formacoes azuis, ${vmT.n} vermelhas, cauda de ${T.cru.length - mT.pos} bytes crus\n`);

if (!fs.existsSync(DIR_SAIDA)) fs.mkdirSync(DIR_SAIDA, { recursive: true });

const alvos = fs.readdirSync(DIR_QB)
  .filter((f) => f.toLowerCase().endsWith('.btt'))
  .filter((f) => new RegExp(`\\b${TIPO}\\b`, 'i').test(f))
  .sort();

const ok = [], pulados = [], falhas = [];
let bytes = 0;

for (const nome of alvos) {
  try {
    const A = ler(DIR_QB + nome);
    const mA = marcador(A);
    // mapas que ja vem com tropa de fabrica ficam de fora: a forca deles pode estar casada
    // com os objetivos do mapa, e trocar isso e mexer no desenho do designer
    if (raizDoLado(A.cru.subarray(mA.pos), 0x17) || raizDoLado(A.cru.subarray(mA.pos), 0x27)) {
      pulados.push({ nome, motivo: 'ja vem com tropa' });
      continue;
    }

    const cru = Buffer.concat([A.cru.subarray(0, mA.pos), T.cru.subarray(mT.pos)]);
    const desloc = mA.pos - mT.pos;
    const tokens = [
      ...A.tokens.slice(0, mA.k),
      ...T.tokens.slice(mT.k).map((t) => ({ pos: t.pos + desloc, cod: t.cod })),
    ];
    const bloco = Buffer.concat([Buffer.from([A.esc, 0x00]), codificar({ cru, tokens }, A.esc)]);
    reconstruir(DIR_QB + nome, DIR_SAIDA + nome, (b, i) => (i === 1 ? bloco : b));

    // conferencia no arquivo gravado, nunca no planejado
    const V = ler(DIR_SAIDA + nome);
    if (!V.cru.equals(cru)) throw new Error('cru do gerado divergente');
    const mV = marcador(V);
    const az = raizDoLado(V.cru.subarray(mV.pos), 0x17);
    const vm = raizDoLado(V.cru.subarray(mV.pos), 0x27);
    if (!az || az.n !== azT.n || !vm || vm.n !== vmT.n)
      throw new Error(`forca no gerado: azul ${az?.n}, vermelha ${vm?.n}`);
    if (!V.cru.subarray(0, mA.pos).equals(A.cru.subarray(0, mA.pos)))
      throw new Error('o mapa do alvo foi alterado');
    const nRegs = registros(V.cru).length;

    const tam = fs.statSync(DIR_SAIDA + nome).size;
    bytes += tam;
    ok.push({ nome, regs: nRegs, mb: tam / 1048576 });
    process.stdout.write(`  ok ${ok.length.toString().padStart(3)}  ${nome.slice(0, 52).padEnd(54)} ${(tam / 1048576).toFixed(1)} MB\n`);
  } catch (e) {
    falhas.push({ nome, erro: e.message.slice(0, 50) });
    process.stdout.write(`  -- ${nome.slice(0, 52).padEnd(54)} ${e.message.slice(0, 40)}\n`);
  }
}

console.log(`\n${alvos.length} mapas "${TIPO}" no jogo`);
console.log(`   gerados:  ${ok.length}  (${(bytes / 1048576).toFixed(0)} MB em ${DIR_SAIDA})`);
console.log(`   pulados:  ${pulados.length}  (ja vinham com tropa)`);
console.log(`   falharam: ${falhas.length}`);
if (falhas.length) {
  const m = new Map();
  falhas.forEach((f) => m.set(f.erro, (m.get(f.erro) || 0) + 1));
  [...m].forEach(([e, n]) => console.log(`      ${n}x  ${e}`));
}
fs.writeFileSync(`../../research/lote_${TIPO.toLowerCase()}.json`,
  JSON.stringify({ template: TEMPLATE, saida: DIR_SAIDA, gerados: ok, pulados, falhas }, null, 1));
