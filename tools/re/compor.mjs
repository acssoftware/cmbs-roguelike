// COMPOR uma forca somando um arquivo de formacao a outro arquivo, uma peca por vez.
//
// E a evolucao de `juntar.mjs`, que so sabia emendar no fim e por isso so funcionava dentro do
// mesmo lado. Aqui a peca entra no lugar certo da arvore, e cada contagem e atualizada na casa
// dela. Aprovado em jogo: Combined Arms americano + Mech Infantry ucraniano no azul + Tank 31
// russo no vermelho, montados a partir da pasta `formations`.
//
// A ARVORE DA FORCA, que foi o que custou entender:
//
//   forca
//    +- bloco do lado A (azul)      primeira formacao SEM token: o cabecalho da forca e o dela
//    |   +- formacoes, de exercitos misturados (EUA e Ucrania se alternam)
//    +- bloco do lado B (vermelho)  primeira formacao com token e CONTADOR
//        +- formacoes
//
// Duas regras que sairam dos arquivos comparativos do autor:
//
//   1. A contagem de formacoes de um bloco mora no PRIMEIRO REGISTRO dele, na variante com
//      contador (u32 em off-1). E o mesmo principio ja documentado para formacoes: a contagem
//      de filhos vive no primeiro filho. O bloco do PRIMEIRO lado e a excecao — a contagem
//      dele fica no cabecalho da forca, porque ele nao tem registro anterior.
//
//   2. Exercito nao e nivel da arvore. Ucranianos e americanos se alternam dentro do bloco
//      azul, sem contador proprio. Cheguei a supor o contrario e a vitrine desmentiu: seis
//      corridas de exercito alternadas, com contador so no bloco vermelho.
//
// O QUE NAO SE DEVE LER DO CABECALHO DA FONTE. O campo N (unidades) fica em offset variavel
// entre arquivos — no `UKR Mountain` ele devolve 1391 onde a contagem real e 135. Um valor
// plausivel e errado, que passou por tres rodadas de teste sem eu desconfiar. Por isso aqui ele
// e CONTADO dos registros, nao lido.
import { ler as lerArquivo, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
export const ladoDe = (r) => (r.army === 2 ? 'verm' : 'azul');
const unidades = (R) => R.filter((r) => !r.form).length;

// ONDE FICA O CAMPO `A`. Nao da para usar offset fixo: os campos do cabecalho tem comprimento
// variavel. O `US Stryker` gasta 4 bytes onde o `UKR Corps Reconnaissance` gasta 3, porque um
// valor e zero e o outro e 219 — cheira a inteiro de tamanho variavel. Lido no lugar errado, o
// `A` sai na casa dos bilhoes e o arquivo nasce morto.
//
// A saida e procurar em vez de calcular, validando contra o proprio conteudo: `A` vale cerca de
// 50 por registro (ajuste da secao 45), entao o u32 certo e o unico da faixa plausivel nos 24
// bytes antes do id do primeiro registro. Confere nos dois: Stryker 174 registros -> 8818,
// Corps Reconnaissance 90 -> 4486.
export function acharA(cru, R, m = null) {
  // Com o marcador em maos o campo e fixo: 00 | descritor u32 | A u32 (secao 54.1).
  if (m !== null) return { pos: m + 5, v: cru.readUInt32LE(m + 5) };
  const id = R[0].off + 3, esperado = 50 * R.length;
  let melhor = null;
  for (let o = -24; o <= -4; o++) {
    if (id + o < 0) continue;
    const v = cru.readUInt32LE(id + o);
    if (v < esperado * 0.5 || v > esperado * 1.6) continue;
    if (!melhor || Math.abs(v - esperado) < Math.abs(melhor.v - esperado)) melhor = { pos: id + o, v };
  }
  if (!melhor) throw new Error(`campo A nao localizado (esperava perto de ${esperado})`);
  return melhor;
}

// O CODIGO DO TOKEN DE CABECA nao e livre: nos 325 arquivos catalogados (secao 53 do FORMATO) ele e
// funcao do byte imediatamente anterior ao token — o ultimo byte do registro de tras. Byte 0x02
// pede 0x7; 0x40..0x46 pede 0xc; o resto pede 0x8. Gravar 0x07 fixo, como esta funcao fazia,
// so dava certo quando o registro anterior terminava em 0x02. Foi a causa de 12 dos 20 crashes
// auditados, inclusive todos os que seguiam uma unidade anexada (que termina em 0x42).
export const codigoDaCabeca = (byteAnterior) =>
  byteAnterior === 0x02 ? 0x7 : (byteAnterior >= 0x40 && byteAnterior <= 0x46 ? 0xc : 0x8);

export function adicionar(caminhoDestino, caminhoFonte, caminhoSaida) {
  const D = lerArquivo(caminhoDestino), F = lerArquivo(caminhoFonte);
  const md = marcador(D).pos, mf = marcador(F).pos;
  const pd = indiceDeTokens(D.tokens), pf = indiceDeTokens(F.tokens);
  const Rd = registros(D.cru).sort((a, b) => a.off - b.off);
  const Rf = registros(F.cru).sort((a, b) => a.off - b.off);
  if (!Rd.length || !Rf.length) throw new Error('um dos arquivos nao tem forca');
  // Formacoes off-map (secoes de morteiro etc.) tem cabecalho CURTO — A num byte, token 0x6, 00,
  // K — com 11 bytes ate o id em vez de 17 (secao 54.2). Como irma elas entram bem, porque a
  // copia parte de off+2; como BASE quebrariam A e N, que sao escritos por posicao.
  if (Rd[0].off + 3 - md !== 17) throw new Error(`destino com cabecalho de ${Rd[0].off + 3 - md} bytes ate o id: so o de 17 serve de base (formacao off-map como base nao e suportada)`);

  const lado = ladoDe(Rf[0]);
  const rd = D.tokens[D.tokens.length - 1].pos, rf = F.tokens[F.tokens.length - 1].pos;
  const mesmos = Rd.filter((r) => ladoDe(r) === lado);
  const novoLado = !mesmos.length;

  // De onde copiar a fonte: num lado NOVO a peca vira o primeiro registro do bloco e precisa
  // manter a variante com contador; num lado que ja existe ela e uma irma comum.
  let ini = Rf[0].off + 2;
  if (novoLado) {
    try {
      const i0 = inicioDoRegistro(F.cru, pf, Rf[0].off);
      if (i0.variante === 'contador') ini = i0.pos;
    } catch { /* fonte cujo primeiro registro nao tem token: fica na forma comum */ }
  }

  // Onde inserir: no fim do bloco daquele lado. Se o lado e novo, no fim da forca.
  let ponto = rd;
  if (!novoLado) {
    const ultimo = mesmos[mesmos.length - 1];
    const seguinte = Rd.find((r) => r.off > ultimo.off);
    if (seguinte) ponto = inicioDoRegistro(D.cru, pd, seguinte.off).pos;
  }

  const proximoId = Math.max(...Rd.map((r) => r.id)) + 1;
  const bloco = Buffer.from(F.cru.subarray(ini, rf));
  Rf.forEach((r, k) => {
    const o = r.off + 3 - ini;
    if (o >= 0 && o + 4 <= bloco.length) bloco.writeUInt32LE(proximoId + k, o);
  });

  const cru = Buffer.concat([D.cru.subarray(0, ponto), bloco, D.cru.subarray(ponto)]);
  const dF = ponto - ini, dep = bloco.length;
  const tokens = [
    ...D.tokens.filter((t) => t.pos < ponto),
    { pos: ponto, cod: codigoDaCabeca(D.cru[ponto - 1]) },
    ...F.tokens.filter((t) => t.pos > ini && t.pos < rf).map((t) => ({ pos: t.pos + dF, cod: t.cod })),
    ...D.tokens.filter((t) => t.pos >= ponto).map((t) => ({ pos: t.pos + dep, cod: t.cod })),
  ].sort((a, b) => a.pos - b.pos);

  const aD = acharA(D.cru, Rd, md), aF = acharA(F.cru, Rf, mf);
  cru.writeUInt32LE(aD.v + aF.v - 16, aD.pos);
  cru.writeUInt16LE(D.cru.readUInt16LE(md + 9) + unidades(Rf), md + 9);
  if (!novoLado && lado === 'azul') cru.writeUInt32LE(D.cru.readUInt32LE(md + 13) + 1, md + 13);
  if (!novoLado && lado === 'verm') {
    const p0 = mesmos[0], o = p0.off < ponto ? p0.off : p0.off + dep;
    cru.writeUInt32LE(cru.readUInt32LE(o - 1) + 1, o - 1);
  }

  const b = Buffer.concat([Buffer.from([D.esc, 0x00]), codificar({ cru, tokens }, D.esc)]);
  reconstruir(caminhoDestino, caminhoSaida, (x, k) => (k === 1 ? b : x));

  const v = lerArquivo(caminhoSaida);
  const Rv = registros(v.cru).sort((a, b) => a.off - b.off);
  if (Rv.length !== Rd.length + Rf.length)
    throw new Error(`gravado com ${Rv.length} registros, esperava ${Rd.length + Rf.length}`);
  const ids = Rv.map((r) => r.id).sort((a, b) => a - b);
  const buraco = ids.findIndex((x, i) => i && x !== ids[i - 1] + 1);
  if (buraco > 0) throw new Error(`ids com buraco em ${ids[buraco - 1]} -> ${ids[buraco]}`);
  return { registros: Rv.length, lado, novoLado, azuis: Rv.filter((r) => r.army !== 2).length,
           vermelhos: Rv.filter((r) => r.army === 2).length };
}

const EH_MAIN = process.argv[1] && /[\\/]compor\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [dest, fonte, saida] = process.argv.slice(2);
  if (!dest || !fonte || !saida) {
    console.log('uso: node compor.mjs <destino.btt> <formacao.btt> <saida.btt>');
  } else {
    const p = (x) => (/[\\/]/.test(x) ? x : S + x);
    const r = adicionar(p(dest), p(fonte), p(saida));
    console.log(`${saida}: ${r.registros} registros (${r.azuis} azuis, ${r.vermelhos} vermelhos)` +
                `  — entrou no lado ${r.lado}${r.novoLado ? ', que nao existia' : ''}`);
  }
}
