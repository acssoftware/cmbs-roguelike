// LADOS: qualquer exercito em qualquer lado (secao 68).
//
// Na corrente completa o cabecalho da forca e FIXO: `00 | descritor u32 | A u32 | N u32 | K_azul u32`
// (17 bytes), seguido do primeiro registro. Se K_azul = 0 nao ha bloco azul e o bloco vermelho vem
// logo em seguida, comecando pelo seu proprio contador `K_verm u32` (a "variante com contador").
// Era isso o "cabecalho de 15 bytes" das fontes russas: os zeros do N tokenizados escondiam a
// largura fixa. Converter uma fonte vermelha-primeiro em base azul = K_azul := K_verm e remover
// os 4 bytes do contador. O lado NAO depende do exercito (secao 57): e posicional.
import { ler } from './transplante.mjs';
import { registros } from './regs.mjs';
import { expandir, codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { abrirCompleto } from './anexar2.mjs';

export function cabecalho(X) {            // X = abrirCompleto(...)
  const c = X.completo, m = X.m;
  const kAzul = c.readUInt32LE(m + 13);
  return { desc: c.readUInt32LE(m + 1), A: c.readUInt32LE(m + 5), N: c.readUInt32LE(m + 9), kAzul,
           kVerm: kAzul === 0 ? c.readUInt32LE(m + 17) : null, primeiroId: c.readUInt32LE(m + 17 + (kAzul === 0 ? 4 : 0) + 3) };
}

// Fonte vermelha-primeiro -> base azul (mesmos registros, agora no bloco azul).
export function converterParaAzul(entrada, saida) {
  const X = abrirCompleto(entrada); const c = X.completo, m = X.m; const h = cabecalho(X);
  if (h.kAzul !== 0) throw new Error(`ja e azul-primeiro (K_azul = ${h.kAzul})`);
  const novo = Buffer.concat([c.subarray(0, m + 13), Buffer.alloc(4), c.subarray(m + 21)]);
  novo.writeUInt32LE(h.kVerm, m + 13);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? codificarComoJogo(novo, X.d.esc) : x));
  const V = abrirCompleto(saida); const hv = cabecalho(V);
  if (V.R.length !== X.R.length) throw new Error(`registros ${X.R.length} -> ${V.R.length}`);
  return { kAzul: hv.kAzul, registros: V.R.length, bytesAteId: V.R[0].c + 3 - V.m };
}

const EH_MAIN = process.argv[1] && /[\\/]lados\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'cabecalho') { const X = abrirCompleto(a); console.log(JSON.stringify(cabecalho(X))); }
  else if (cmd === 'azul') { console.log(JSON.stringify(converterParaAzul(a, b))); }
  else console.log('uso: node lados.mjs cabecalho <a.btt> | azul <vermelho-primeiro.btt> <saida.btt>');
}
