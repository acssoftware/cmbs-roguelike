// ANEXAR times avulsos e veiculos unicos a uma formacao ja composta.
//
// ATENCAO (secao 56): NAO CONFIAVEL. Uma aplicacao carrega em jogo; DUAS travam, sem causa
// visivel nos bytes. O gerador nao usa mais isto — anexo e fonte de biblioteca com extras
// embutidos. Fica so como ferramenta de pesquisa.
//
// No editor, um Breach Team ou um Truck so existem DENTRO de uma formacao: entram como ultimos
// filhos diretos dela, o contador do primeiro filho sobe, e o batalhao ganha o bit 0x20 no byte
// +7. Aqui a fonte e um arquivo "base + anexo" gerado no editor (ex.: `ZZ ADD RU2.btt`), de onde
// se copiam os N ultimos registros para o fim da sub-arvore da formacao alvo no destino.
//
// O token de cabeca do primeiro registro anexado obedece a regra da secao 53 (byte anterior), e
// o da formacao que vier DEPOIS do anexo tambem precisa ser recalculado — o anexo termina em
// 0x42 e pede 0xc onde antes cabia 0x7. Aprovado em jogo em 03/09/2026 (Breach Team + Ural no
// Motor Rifle, com Combined Arms e Mech antes e nada depois).
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { acharA, codigoDaCabeca } from './compor.mjs';

// Recalcula o codigo de TODAS as cabecas de formacao de topo (menos a primeira da forca).
export function recalcularCabecas(cru, tokens) {
  const R = registros(cru).sort((a, b) => a.off - b.off);
  const p = indiceDeTokens(tokens);
  let i = 0, trocas = 0;
  while (i < R.length) {
    if (!R[i].form) { i++; continue; }
    let e; try { e = subArvore(cru, p, R, i); } catch { e = i + 1; }
    if (i > 0) {
      try { const x = inicioDoRegistro(cru, p, R[i].off); const c = codigoDaCabeca(cru[x.pos - 1]);
            if (tokens[x.k].cod !== c) { tokens[x.k].cod = c; trocas++; } } catch { /* sem token: primeira da forca */ }
    }
    if (e <= i) break; i = e;
  }
  return trocas;
}

// Anexa os N ultimos registros de `fonte` a formacao de topo de `destino` cujo nome casa `alvoRe`.
export function anexar(caminhoDestino, caminhoFonte, caminhoSaida, alvoRe, n = 2) {
  const D = ler(caminhoDestino), A = ler(caminhoFonte);
  const pd = indiceDeTokens(D.tokens), pa = indiceDeTokens(A.tokens);
  const Rd = registros(D.cru).sort((a, b) => a.off - b.off), Ra = registros(A.cru).sort((a, b) => a.off - b.off);
  const extras = Ra.slice(-n);
  const s0 = inicioDoRegistro(A.cru, pa, extras[0].off).pos, s1 = A.tokens[A.tokens.length - 1].pos;

  // fim da sub-arvore do alvo no destino = inicio da proxima formacao de topo, ou o rodape
  let i = 0, iT = -1, fimT = null, topo = 0;
  while (i < Rd.length) {
    if (!Rd[i].form) { i++; continue; }
    let e; try { e = subArvore(D.cru, pd, Rd, i); } catch { e = i + 1; }
    if (iT < 0 && (typeof alvoRe === 'number' ? topo === alvoRe : alvoRe.test(Rd[i].nm || ''))) { iT = i; fimT = e; }
    topo++;
    if (e <= i) break; i = e;
  }
  if (iT < 0) throw new Error('formacao alvo nao encontrada');
  const rd = D.tokens[D.tokens.length - 1].pos;
  const ponto = fimT < Rd.length ? inicioDoRegistro(D.cru, pd, Rd[fimT].off).pos : rd;

  const bloco = Buffer.from(A.cru.subarray(s0, s1));
  const cru = Buffer.concat([D.cru.subarray(0, ponto), bloco, D.cru.subarray(ponto)]);
  const tokens = [
    ...D.tokens.filter((t) => t.pos < ponto),
    ...A.tokens.filter((t) => t.pos >= s0 && t.pos < s1).map((t) => ({ pos: t.pos - s0 + ponto, cod: t.cod })),
    ...D.tokens.filter((t) => t.pos >= ponto).map((t) => ({ pos: t.pos + bloco.length, cod: t.cod })),
  ].sort((a, b) => a.pos - b.pos);

  // IDs: os registros existentes NAO mudam (compor tambem nunca renumera o que ja esta la — ids
  // sao referenciados por outros campos, e renumerar tudo ao inserir no meio derrubou TM, TN e TP
  // em 03/09/2026). Os anexos recebem os ids seguintes ao maior existente.
  let proximo = Math.max(...Rd.map((r) => r.id)) + 1;
  for (const r of extras) { const o = ponto + (r.off - s0); cru.writeUInt32LE(proximo++, o + 3); }
  const Rn = registros(cru).sort((a, b) => a.off - b.off);
  const alvo = Rn[iT];
  cru[alvo.off + 7] |= 0x20;                                            // formacao com anexos
  cru.writeUInt32LE(cru.readUInt32LE(Rn[iT + 1].off - 1) + n, Rn[iT + 1].off - 1);   // contador do 1o filho
  const aD = acharA(D.cru, Rd, marcador(D).pos);
  cru.writeUInt32LE(aD.v + 52 * n, aD.pos);                             // A (custo em pontos, aproximado)
  cru.writeUInt32LE(Rn.filter((r) => !r.form).length, aD.pos + 4);      // N
  const trocas = recalcularCabecas(cru, tokens);

  const b = Buffer.concat([Buffer.from([D.esc, 0x00]), codificar({ cru, tokens }, D.esc)]);
  reconstruir(caminhoDestino, caminhoSaida, (x, k) => (k === 1 ? b : x));
  return { anexados: extras.map((r) => r.nm), alvo: alvo.nm, registros: Rn.length, cabecasRecalculadas: trocas };
}
