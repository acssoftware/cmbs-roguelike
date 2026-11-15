// Passa o transplante por TODOS os mapas de Quick Battle, sem escrever nada em disco.
// Responde a pergunta que decide o gerador: o mapa do jogo, qualquer um, aceita receber a
// forca do template? O que pode dar errado por mapa: o bloco nao decodificar, o marcador de
// fim de mapa nao aparecer, o mapa ja ter tropas, ou a emenda nao reler igual ao planejado.
import fs from 'fs';
import { ler, marcador, raizDoLado } from './transplante.mjs';
import { codificar, decodificar } from './escape.mjs';

const G = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const DIR_QB = G + 'Quick Battle Maps/';
const TEMPLATE = G + 'GENERATOR_TEMPLATES/City  (688 X 736) 047r Assault.btt';

const T = ler(TEMPLATE);
const mT = marcador(T);
const azT = raizDoLado(T.cru.subarray(mT.pos), 0x17), vmT = raizDoLado(T.cru.subarray(mT.pos), 0x27);
console.log(`template: ${azT.n} formacoes azuis, ${vmT.n} vermelhas | cauda ${T.cru.length - mT.pos} bytes`);

const mapas = fs.readdirSync(DIR_QB).filter((f) => f.toLowerCase().endsWith('.btt')).sort();
console.log(`${mapas.length} mapas de Quick Battle\n`);

const falhas = [], variantes = new Map(), comTropas = [];
let ok = 0, bytesSaida = 0;
for (const nome of mapas) {
  try {
    const A = ler(DIR_QB + nome);
    const mA = marcador(A);
    variantes.set(mA.variante, (variantes.get(mA.variante) || 0) + 1);
    if (raizDoLado(A.cru.subarray(mA.pos), 0x17) || raizDoLado(A.cru.subarray(mA.pos), 0x27)) comTropas.push(nome);

    const cru = Buffer.concat([A.cru.subarray(0, mA.pos), T.cru.subarray(mT.pos)]);
    const desloc = mA.pos - mT.pos;
    const tokens = [...A.tokens.slice(0, mA.k), ...T.tokens.slice(mT.k).map((t) => ({ pos: t.pos + desloc, cod: t.cod }))];
    const corpo = codificar({ cru, tokens }, A.esc);
    bytesSaida += corpo.length + 2;

    // reler o que seria gravado: o codec tem de devolver exatamente o que foi planejado
    const volta = decodificar(Buffer.concat([Buffer.from([A.esc, 0x00]), corpo]), A.esc, 2);
    if (!volta.cru.equals(cru)) throw new Error('cru nao rele igual');
    if (volta.tokens.length !== tokens.length) throw new Error(`tokens ${volta.tokens.length} vs ${tokens.length}`);
    const mV = marcador(volta);
    const az = raizDoLado(volta.cru.subarray(mV.pos), 0x17), vm = raizDoLado(volta.cru.subarray(mV.pos), 0x27);
    if (!az || az.n !== azT.n || !vm || vm.n !== vmT.n) throw new Error(`forca: azul ${az?.n}, vermelha ${vm?.n}`);
    ok++;
  } catch (e) {
    falhas.push({ nome, erro: e.message });
  }
}

console.log(`aprovados: ${ok}/${mapas.length}`);
console.log(`variantes de marcador:`, [...variantes].map(([v, n]) => `${n}x ${v}`).join(' | '));
if (comTropas.length) console.log(`mapas que ja tinham tropas (${comTropas.length}): ${comTropas.slice(0, 5).join(', ')}${comTropas.length > 5 ? '...' : ''}`);
console.log(`tamanho total se todos fossem gravados: ${(bytesSaida / 1e6).toFixed(0)} MB de bloco cru (antes do container)`);
if (falhas.length) {
  console.log(`\nFALHAS (${falhas.length}):`);
  falhas.slice(0, 20).forEach((f) => console.log(`   ${f.nome}: ${f.erro}`));
}
