// ATRIBUTOS DE UMA UNIDADE DO INIMIGO, PELO NOME (18/10/2026). `atributos.aplicar` escreve uma formacao inteira pelo id
// dela, que e como o gerador da a experiencia do tier a defesa. O tanque da escada (defense.tankLadder) pode sair mais
// experiente que o resto — um T-64 Veteran no meio de tropas Regular —, e entao a escrita precisa ser por UNIDADE.
//
// Os alvos sao as unidades (nao formacoes) do lado pedido com o nome pedido, achadas pela arvore posicional (secao 68,
// como `idsDoLado` do gerador); a escrita e a mesma de `atributos.aplicar`, por id, com conferencia no arquivo GRAVADO.
import { ler as lerArquivo } from './transplante.mjs';
import { registros } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { arvore } from './extras.mjs';
import { escreverCampos, decodificar } from './atributos.mjs';

// ids das unidades do lado com esse nome
export function idsPorNome(arquivo, lado, nome) {
  const A = arvore(abrirCompleto(arquivo)); const out = [];
  const anda = (n) => { if (!n.r.form && n.r.nm === nome) out.push(n.r.id); n.filhos.forEach(anda); };
  (lado === 'azul' ? A.azul : A.vermelho).forEach(anda);
  return out;
}

export function aplicarPorNome(arquivo, saida, lado, nome, campos) {
  const ids = new Set(idsPorNome(arquivo, lado, nome));
  if (!ids.size) throw new Error(`nenhuma unidade "${nome}" no lado ${lado}`);
  const d = lerArquivo(arquivo);
  const cru = Buffer.from(d.cru);
  const alvos = registros(cru).filter((x) => ids.has(x.id));
  if (!alvos.length) throw new Error(`as unidades "${nome}" do lado ${lado} nao estao nos registros`);
  const antes = alvos.map((x) => decodificar(cru, x.off));
  for (const x of alvos) escreverCampos(cru, x.off, campos);
  const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(arquivo, saida, (b, k) => (k === 1 ? bloco : b));

  // conferencia no arquivo GRAVADO, nunca no planejado
  const v = lerArquivo(saida);
  const RV = registros(v.cru).filter((x) => ids.has(x.id));
  const agora = RV.map((x) => decodificar(v.cru, x.off));
  for (const [campo, valor] of Object.entries(campos)) {
    const errado = agora.find((a) => a[campo] !== valor);
    if (errado) throw new Error(`${nome}: ${campo} gravado ${errado[campo]}, pedido ${valor}`);
  }
  return { registros: alvos.length, antes, agora };
}
