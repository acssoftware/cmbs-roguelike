// ENXERTAR UMA FORMACAO NO FIM DE UMA FORCA — sem mover nada do que ja esta la (secao 125).
//
// O problema que isto resolve: recrutar uma formacao reconstruia a forca inteira do zero, e a
// unidade ANEXADA (`pick.extras`, E51) e escrita pelo gerador depois de todas as formacoes. A
// formacao nova entrava antes dela, os anexos andavam, e o core id — que E O ID DO REGISTRO, porque
// `core.marcarCore` grava `r.id` na cauda — trocava de dono. A guarda do `growCoreForce` recusava,
// com razao, e o jogador ficava sem poder recrutar enquanto tivesse um anexo na forca.
//
// Aqui nada e reconstruido: os registros da fonte entram NO FIM do bloco, com ids `max + 1` em
// diante (a mesma regra do editor que o `extras.inserirRegistro` ja usa), e o prefixo do arquivo —
// tudo o que vem antes do primeiro registro novo — sai byte a byte igual ao original. O que muda no
// cabecalho sao tres numeros: `N` (unidades), `A` (custo) e o contador de topos do lado.
//
// Depois disto, `core.marcarCore` marca so os registros novos: os antigos ja tem cauda core e ele
// os pula (`jaCore`).
//
//   node tools/re/enxerto.mjs <forca.btt> <fonte.btt> <saida.btt>
import fs from 'node:fs';
import { abrirCompleto } from './anexar2.mjs';
import { cabecalho } from './lados.mjs';
import { arvore, verificarForca } from './extras.mjs';
import { fimDoConteudo } from './core.mjs';
import { regraDeEnchimento } from './regs.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

// Onde o bloco de registros acaba e comeca o rodape: a primeira corrida de 32 zeros ou mais a
// partir do ultimo registro (a mesma definicao do `anexar2`, que nao a exporta).
const fimDosRegistros = (c, desde) => {
  for (let i = desde; i < c.length; i++) {
    if (c[i] !== 0) continue;
    let z = 0; while (i + z < c.length && c[i + z] === 0) z++;
    if (z >= 32) return i;
    i += z;
  }
  return c.length;
};

// O BLOCO DA FONTE INTEIRO, verbatim, so com os ids reescritos.
//
// Copiar registro a registro e repor o enchimento pela regra parecia mais limpo e estava errado: o
// CONTADOR DE FILHOS de uma formacao nao mora no registro, mora no enchimento que vem depois dele
// (o u32 que termina antes dos tres zeros de cabeca do primeiro filho, 110.1). Refazendo o
// enchimento, o contador sumia — a Section (Forward Observer) entrou com zero filhos e os dois
// times viraram formacoes de topo soltas (4 topos onde deviam ser 2). Copiando o bloco como esta,
// a estrutura interna vem junto, e reescrever um id nao muda tamanho nenhum.
function blocoDaFonte(F, primeiroId) {
  const c = F.completo, R = F.R;
  const ini = R[0].c;
  const ult = R[R.length - 1];
  const { fim } = fimDoConteudo(c, ult, c.length);
  const bloco = Buffer.from(c.subarray(ini, fim));
  R.forEach((r, k) => bloco.writeUInt32LE(primeiroId + k, r.c - ini + 3));
  return bloco;
}

// ENXERTA todos os registros de `fonte` no fim do bloco de `alvo`.
//
// `lado` diz de quem e o topo novo: 'azul' quando o bloco unico do arquivo e azul (K_azul > 0), que
// e o caso da forca core depois do `extractSide`. Um arquivo de dois lados pede o contador do lado
// certo — e por isso o enxerto so aceita bloco unico por enquanto: a forca core e isso, e inventar
// o caso de dois lados sem gabarito seria escrever no escuro.
export function enxertar(alvo, fonte, saida) {
  const X = abrirCompleto(alvo); const c0 = X.completo; const R = X.R;
  const h = cabecalho(X);
  const A = arvore(X);
  if (h.kAzul && h.kVerm) throw new Error('enxerto so em forca de um lado so (esta tem os dois)');
  if (!R.length) throw new Error('forca vazia');

  const F = abrirCompleto(fonte); const hf = cabecalho(F); const AF = arvore(F);
  if (!F.R.length) throw new Error(`${fonte}: sem registros`);
  if (AF.topos.length !== 1) throw new Error(`${fonte}: ${AF.topos.length} formacoes de topo, esperava uma`);
  if (!F.R[0].form) throw new Error(`${fonte}: o primeiro registro nao e formacao`);

  const primeiroId = Math.max(...R.map((r) => r.id)) + 1;
  const bloco = blocoDaFonte(F, primeiroId);

  // O corte: o fim do ultimo registro do alvo. Dali para a frente vem o rodape do bloco, que volta
  // inteiro depois do enxerto. O enchimento do ultimo registro ANTIGO segue a regra dele (o mesmo
  // calculo do `extras.inserirRegistro` no caso "sem proximo").
  const ultimo = R[R.length - 1];
  const corte = fimDosRegistros(c0, ultimo.c);
  const antes = regraDeEnchimento(c0, corte, ultimo.c) - 3;

  const partes = [c0.subarray(0, corte), Buffer.alloc(antes), bloco, c0.subarray(corte)];
  const c = Buffer.concat(partes);

  // Os tres numeros do cabecalho: unidades, custo e topos do lado.
  const unidadesNovas = F.R.filter((r) => !r.form).length;
  c.writeUInt32LE(h.N + unidadesNovas, X.m + 9);
  c.writeUInt32LE(h.A + hf.A, X.m + 5);
  if (h.kAzul) c.writeUInt32LE(h.kAzul + 1, X.m + 13);
  else c.writeUInt32LE(h.kVerm + 1, X.m + 17);

  reconstruir(alvo, saida, (b, k) => (k === 1 ? codificarComoJogo(c, X.d.esc) : b));

  // Conferencia dura: o prefixo intacto, os ids antigos no lugar, os novos no fim, e a forca de pe.
  const V = abrirCompleto(saida);
  if (V.R.length !== R.length + F.R.length) throw new Error(`gravado com ${V.R.length} registros, esperava ${R.length + F.R.length}`);
  // O invariante NAO e "o arquivo todo ate o corte": o cabecalho muda de proposito (N, A, topos).
  // E "os registros que ja estavam la", do primeiro ao ultimo byte do ultimo: nenhum deles pode ter
  // sido tocado — nem o conteudo, nem o enchimento entre eles.
  if (!V.completo.subarray(R[0].c, corte).equals(c0.subarray(R[0].c, corte))) throw new Error('o enxerto mexeu num registro que ja estava la');
  const antesIds = R.map((r) => r.id).join(),
    depoisIds = V.R.slice(0, R.length).map((r) => r.id).join();
  if (antesIds !== depoisIds) throw new Error('os ids antigos mudaram');
  const ok = verificarForca(saida);
  if (!ok.ok) throw new Error(`verificarForca reprovou: ${ok.erros.slice(0, 3).join(' | ')}`);
  const AV = arvore(V);
  return {
    registros: V.R.length, novos: F.R.length, unidades: unidadesNovas,
    ids: [primeiroId, primeiroId + F.R.length - 1],
    topos: AV.topos.length, N: cabecalho(V).N, A: cabecalho(V).A,
    avisos: ok.avisos.length,
  };
}

const EH_MAIN = process.argv[1] && /[\\/]enxerto\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [alvo, fonte, saida] = process.argv.slice(2);
  if (!alvo || !fonte || !saida) { console.log('uso: node tools/re/enxerto.mjs <forca.btt> <fonte.btt> <saida.btt>'); process.exit(1); }
  console.log(JSON.stringify(enxertar(alvo, fonte, saida), null, 1));
}
