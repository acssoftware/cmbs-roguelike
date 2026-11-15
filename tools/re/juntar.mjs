// JUNTA a forca de um .btt na forca de outro — compor em vez de replicar.
//
// A replicacao (copiar uma sub-arvore dentro do mesmo arquivo) trava o jogo em 15 de 33
// doadores e nunca achei o porque. autor notou que o TRANSPLANTE, que troca a cauda inteira de
// um arquivo pela de outro, nunca falha — e propos o meio-termo: um .btt por formacao, juntados
// um a um. E o que este arquivo faz, e funciona.
//
// A diferenca esta em quanto se recalcula. O transplante nao recalcula nada: leva o bloco
// inteiro, ja coerente. A replicacao mexe no meio de um bloco e obriga a refazer ids, contagens
// e ligacoes. A juncao fica no meio: dois blocos coerentes, e so o cabecalho e os ids da parte
// que entra precisam de conta.
//
// ANATOMIA DA CAUDA (o que foi preciso descobrir para isto funcionar):
//
//   [marcador][cabecalho de 15 bytes][registro 1][registro 2]...[rodape]
//
//   cabecalho:  +5  A (u32)         cresce um valor fixo por formacao; vale 16 + a soma das
//                                   contribuicoes, o que fecha: 2 x 8041 - 16 = 16066, o valor
//                                   que o editor gravou ao comprar o segundo Combined Arms
//               +9  unidades (u16)
//               +11 formacoes vermelhas (u16)
//               +13 formacoes azuis (u16)
//
//   rodape:     comeca no ULTIMO token do fluxo (codigo 0xd3, 0xd7...), 60 a 70 bytes de selo
//               que muda a cada save. Tem que continuar no fim.
//
// E o detalhe que custou dois arquivos travados: **o registro comeca em off+2**, que e onde
// mora o token de cabecalho; os dois bytes anteriores pertencem ao registro de tras. Copiando a
// partir de `marcador+15` eu pegava um byte antes disso e ainda inseria um 00 para "abrir
// espaco" ao token, e o token acabava em off+0. O jogo lia tudo deslocado e morria — inclusive
// numa juncao de dois registros so.
//
// Uso:  node juntar.mjs <destino.btt> <fonte.btt> <saida.btt>
import { ler as lerArquivo, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';

export const cabecalho = (d, m) => ({
  A: d.cru.readUInt32LE(m + 5),
  unidades: d.cru.readUInt16LE(m + 9),
  vermelhas: d.cru.readUInt16LE(m + 11),
  azuis: d.cru.readUInt16LE(m + 13),
});

// O rodape comeca no ultimo token do fluxo.
const inicioDoRodape = (d) => d.tokens[d.tokens.length - 1].pos;

export function juntar(caminhoDestino, caminhoFonte, caminhoSaida) {
  const dest = lerArquivo(caminhoDestino), fonte = lerArquivo(caminhoFonte);
  const md = marcador(dest).pos, mf = marcador(fonte).pos;
  const cd = cabecalho(dest, md), cf = cabecalho(fonte, mf);

  const rd = inicioDoRodape(dest), rf = inicioDoRodape(fonte);
  const Rd = registros(dest.cru).sort((a, b) => a.off - b.off);
  const Rf = registros(fonte.cru).sort((a, b) => a.off - b.off);
  if (!Rd.length || !Rf.length) throw new Error('um dos arquivos nao tem forca');

  const ini = Rf[0].off + 2;                       // inicio VERDADEIRO do primeiro registro
  const proximoId = Math.max(...Rd.map((r) => r.id)) + 1;
  const bloco = Buffer.from(fonte.cru.subarray(ini, rf));
  Rf.forEach((r, k) => {
    const o = r.off + 3 - ini;
    if (o >= 0 && o + 4 <= bloco.length) bloco.writeUInt32LE(proximoId + k, o);
  });

  const antes = dest.cru.subarray(0, rd), rodape = dest.cru.subarray(rd);
  const cru = Buffer.concat([antes, bloco, rodape]);
  const emenda = antes.length, dF = emenda - ini, dR = emenda + bloco.length - rd;
  const tokens = [
    ...dest.tokens.filter((t) => t.pos < rd),
    { pos: emenda, cod: 0x07 },                    // o cabecalho que o primeiro registro nao tinha
    ...fonte.tokens.filter((t) => t.pos >= ini && t.pos < rf).map((t) => ({ pos: t.pos + dF, cod: t.cod })),
    ...dest.tokens.filter((t) => t.pos >= rd).map((t) => ({ pos: t.pos + dR, cod: t.cod })),
  ].sort((a, b) => a.pos - b.pos);

  cru.writeUInt32LE(cd.A + cf.A - 16, md + 5);
  cru.writeUInt16LE(cd.unidades + cf.unidades, md + 9);
  cru.writeUInt16LE(cd.vermelhas + cf.vermelhas, md + 11);
  cru.writeUInt16LE(cd.azuis + cf.azuis, md + 13);

  const b = Buffer.concat([Buffer.from([dest.esc, 0x00]), codificar({ cru, tokens }, dest.esc)]);
  reconstruir(caminhoDestino, caminhoSaida, (x, k) => (k === 1 ? b : x));

  // conferencia no arquivo GRAVADO
  const v = lerArquivo(caminhoSaida);
  const mv = marcador(v).pos, cv = cabecalho(v, mv);
  const Rv = registros(v.cru).sort((a, b) => a.off - b.off);
  const porPos = indiceDeTokens(v.tokens);
  if (Rv.length !== Rd.length + Rf.length)
    throw new Error(`gravado com ${Rv.length} registros, esperava ${Rd.length + Rf.length}`);
  const ids = Rv.map((r) => r.id).sort((a, b) => a - b);
  const buraco = ids.findIndex((x, i) => i && x !== ids[i - 1] + 1);
  if (buraco > 0) throw new Error(`ids com buraco em ${ids[buraco - 1]} -> ${ids[buraco]}`);
  const emendado = Rv.find((r) => r.id === proximoId);
  inicioDoRegistro(v.cru, porPos, emendado.off);   // lanca se o token de cabecalho ficou torto
  return { registros: Rv.length, ids: `${ids[0]}..${ids[ids.length - 1]}`, cabecalho: cv };
}

const EH_MAIN = process.argv[1] && /[\\/]juntar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [dest, fonte, saida] = process.argv.slice(2);
  if (!dest || !fonte || !saida) {
    console.log('uso: node juntar.mjs <destino.btt> <fonte.btt> <saida.btt>');
    console.log('     caminhos sem barra sao procurados em Game Files/Scenarios');
  } else {
    const p = (x) => (/[\\/]/.test(x) ? x : S + x);
    const r = juntar(p(dest), p(fonte), p(saida));
    console.log(`${saida}: ${r.registros} registros, ids ${r.ids}`);
    console.log(`   A=${r.cabecalho.A}  unidades=${r.cabecalho.unidades}  ` +
                `vermelhas=${r.cabecalho.vermelhas}  azuis=${r.cabecalho.azuis}`);
  }
}
