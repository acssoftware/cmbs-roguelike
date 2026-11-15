// COMPOR NA CORRENTE COMPLETA, com o lado de cada formacao EXPLICITO (secao 68).
//
// Sucede ao compor.mjs, que trabalhava na corrente compactada adivinhando tokens e deduzia o
// lado do exercito. Aqui a estrutura e a medida:
//   forca   = cabecalho(17: 00 | desc u32 | A u32 | N u32 | K_azul u32) + bloco azul + [bloco vermelho] + rodape
//   bloco vermelho = K_verm u32 imediatamente antes do id do seu primeiro registro
//   registro = 00 00 00 | id u32 | ... ; entre registros, zeros pela regra do ultimo byte do anterior
//              (0x02 -> 8, 0x40..0x46 -> 13, outro -> 9), contando os 3 zeros da cabeca do seguinte
// A carga de uma fonte = do primeiro registro (com seus 3 zeros) ate o fim do ultimo (antes do
// rodape). Ids renumerados em sequencia de insercao. A e N somados. Reencodado com a regra do
// gravador, que reproduz forcas byte a byte.
import { abrirCompleto } from './anexar2.mjs';
import { regraDeEnchimento } from './regs.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { cabecalho } from './lados.mjs';

const fimDosRegistros = (c, desde) => { for (let i = desde; i < c.length; i++) { if (c[i] !== 0) continue; let z = 0; while (i + z < c.length && c[i + z] === 0) z++; if (z >= 32) return i; i += z; } return c.length; };
// regra de enchimento em regs.mjs (regraDeEnchimento), com o caso core (secao 110.1)
const zerosIniciais = (b) => { let k = 0; while (k < b.length && b[k] === 0) k++; return k; };

// Carga de uma fonte: registros do primeiro ao ultimo, sem cabecalho, sem contador, sem rodape.
function carga(X) {
  const c = X.completo; const h = cabecalho(X);
  const ini = X.m + 17 + (h.kAzul === 0 ? 4 : 0) - 3;          // 3 zeros de cabeca do 1o registro
  const bytes = Buffer.from(c.subarray(ini, fimDosRegistros(c, X.R[X.R.length - 1].c)));
  const topos = h.kAzul === 0 ? h.kVerm : h.kAzul;
  // N vem do CABECALHO de cada fonte (o valor do editor, que difere um pouco da contagem — secao 54), como o compor antigo, cujos arquivos carregam
  return { bytes, registros: X.R.map((r) => ({ idRel: r.c + 3 - ini })), unidades: h.N, A: h.A, topos };
}

// lista: [{ arquivo, lado: 'azul'|'vermelho' }] — o primeiro azul e a base (qualquer exercito).
export function compor(lista, saida) {
  const azuis = lista.filter((f) => f.lado === 'azul'), verms = lista.filter((f) => f.lado === 'vermelho');
  if (!azuis.length) throw new Error('precisa de ao menos uma formacao azul');
  const base = abrirCompleto(azuis[0].arquivo); const cb = base.completo; const hb = cabecalho(base);
  const iniBase = base.m + 17 + (hb.kAzul === 0 ? 4 : 0) - 3;
  const fimBase = fimDosRegistros(cb, base.R[base.R.length - 1].c);
  const pecas = [carga(base)]; pecas[0].lado = 'azul';
  for (const f of azuis.slice(1)) { const p = carga(abrirCompleto(f.arquivo)); p.lado = 'azul'; pecas.push(p); }
  for (const f of verms) { const p = carga(abrirCompleto(f.arquivo)); p.lado = 'vermelho'; pecas.push(p); }

  // monta o corpo: pecas em sequencia, com enchimento pela regra e o contador do bloco vermelho
  let corpo = Buffer.alloc(0); let proximoId = 1; let kAzul = 0, kVerm = 0, A = 0, N = 0; let primeiroVerm = true;
  // Onde comeca o ULTIMO registro ja gravado em `corpo` (os 3 zeros de cabeca dele): a regra de
  // enchimento precisa saber se ele e um registro curto (E52) — um drone como topo, seguido de
  // outro topo, levava os 13 zeros do byte 0x42 onde o jogo quer 9, e travava.
  let ultimoInicio = null;
  for (const p of pecas) {
    const bytes = Buffer.from(p.bytes);
    p.registros.forEach((r) => bytes.writeUInt32LE(proximoId++, r.idRel));
    const ultimoTam = p.registros.length ? bytes.length - (p.registros[p.registros.length - 1].idRel - 3) : 0;
    let prefixo = Buffer.alloc(0);
    // OS ZEROS DE CABECA vao ate o id do primeiro registro, e nao "ate o primeiro byte nao-zero" (03/10,
    // bateria de carga): com os ids ja renumerados, um primeiro registro de id multiplo de 256 (512 =
    // 00 02 00 00) tem o byte baixo do id = 0, e contar zeros iniciais comia esse byte — o enchimento saia
    // com um zero a menos ("7 zeros ate o id seguinte, regra pede 8") e, no primeiro vermelho, o id perdia
    // o primeiro byte ("K_verm 512 != 2"). 12 de 140 casos da bateria; a ZZ-PE-RU parou na batalha 2 assim.
    const cabeca = p.registros.length ? Math.min(p.registros[0].idRel, zerosIniciais(bytes)) : zerosIniciais(bytes);
    if (corpo.length) { const pad = regraDeEnchimento(corpo, corpo.length, ultimoInicio) - cabeca; prefixo = Buffer.alloc(Math.max(0, pad)); }
    if (p.lado === 'vermelho' && primeiroVerm) {
      // o contador K_verm entra logo antes do id: [zeros da regra][K_verm][id...] — os 3 zeros de cabeca somem
      const semCabeca = bytes.subarray(cabeca);
      const pad = corpo.length ? regraDeEnchimento(corpo, corpo.length, ultimoInicio) : 0;
      const k = Buffer.alloc(4); k.writeUInt32LE(0, 0);            // preenchido no fim
      corpo = Buffer.concat([corpo, Buffer.alloc(pad), k, semCabeca]); p.posK = corpo.length - k.length - semCabeca.length;
      primeiroVerm = false;
    } else corpo = Buffer.concat([corpo, prefixo, bytes]);
    if (ultimoTam) ultimoInicio = corpo.length - ultimoTam;
    if (p.lado === 'azul') kAzul += p.topos; else kVerm += p.topos;
    A += p.A; N += p.unidades;
  }
  if (kVerm) corpo.writeUInt32LE(kVerm, pecas.find((p) => p.posK !== undefined).posK);
  // cabecalho da base, com A, N, K_azul refeitos; o primeiro registro azul vem sem os 3 zeros de cabeca (o cabecalho termina no id)
  const cab = Buffer.from(cb.subarray(base.m, base.m + 17)); cab.writeUInt32LE(A - 16 * (pecas.length - 1), 5); cab.writeUInt32LE(N, 9); cab.writeUInt32LE(kAzul, 13);
  const completo = Buffer.concat([cb.subarray(0, base.m), cab, corpo.subarray(3), cb.subarray(fimBase)]);
  reconstruir(azuis[0].arquivo, saida, (x, k) => (k === 1 ? codificarComoJogo(completo, base.d.esc) : x));
  const V = abrirCompleto(saida); const ids = V.R.map((r) => r.id).sort((a, b) => a - b);
  const esperado = pecas.reduce((s, p) => s + p.registros.length, 0);
  if (V.R.length !== esperado) throw new Error(`gravado com ${V.R.length} registros, esperava ${esperado}`);
  const buraco = ids.findIndex((x, i) => i && x !== ids[i - 1] + 1); if (buraco > 0) throw new Error(`ids com buraco em ${ids[buraco]}`);
  return { registros: V.R.length, kAzul, kVerm, A: A - 16 * (pecas.length - 1), N };
}
