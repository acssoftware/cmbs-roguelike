// PODAR uma formacao: marcar subformacoes como AUSENTES (secao 67).
//
// O Delete do editor sobre uma subformacao nao remove nada: liga o bit 0x80 do byte +7 no
// registro dela e em TODOS os registros da sua subarvore (medido em `A0 P0` -> `A0 P1`: 2o pelotao
// e seus 7 filhos, 0x01->0x81, 0x43->0xc3, 0x02->0x82, 0x0a->0x8a). Ids, custo, N e contador de
// filhos ficam iguais; clicar de novo desliga o bit. Na arvore do editor a subformacao aparece
// acinzentada; no jogo, nao existe.
//
// Os bytes de flag sao literais (nunca zero), entao o patch e feito na corrente compactada sem
// tocar em token algum — o mesmo caminho de `atributos.mjs`.
import { ler } from './transplante.mjs';
import { registros, indiceDeTokens, subArvore } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

// Subformacoes diretas de uma formacao de topo (indice `topo` em R): [{i, e, nome, ordem}].
export function filhas(cru, tokens, R, topo) {
  const p = indiceDeTokens(tokens);
  let fim; try { fim = subArvore(cru, p, R, topo); } catch { fim = R.length; }
  const out = []; const contagem = {};
  let i = topo + 1;
  while (i < fim) {
    if (!R[i].form) { i++; continue; }
    let e; try { e = subArvore(cru, p, R, i); } catch { e = i + 1; }
    const nome = R[i].nm || '?'; contagem[nome] = (contagem[nome] || 0) + 1;
    out.push({ i, e, nome, ocorrencia: contagem[nome] });
    i = e;
  }
  return out;
}

// `ausentes`: lista de { nome, ocorrencia?, ausentes? } (aninhado: poda dentro da subformacao) ou de
// indices 1-based entre as subformacoes diretas. `formacao`: RegExp/string do nome da formacao de
// topo (ou indice). `ausentesUnidades`: RegExp/string — UNIDADES (nao formacoes) cujo nome casa
// recebem o mesmo bit 0x80, em toda a formacao (e o Delete do editor numa unidade solta).
export function podar(entrada, saida, formacao, ausentes, ausentesUnidades = null, ausentesSoltas = null) {
  const d = ler(entrada); const cru = Buffer.from(d.cru);
  const R = registros(cru).sort((a, b) => a.off - b.off);
  const p = indiceDeTokens(d.tokens);
  const topos = []; { let i = 0; while (i < R.length) { if (!R[i].form) { i++; continue; } let e; try { e = subArvore(cru, p, R, i); } catch { e = i + 1; } topos.push(i); if (e <= i) break; i = e; } }
  const topo = typeof formacao === 'number' ? topos[formacao] : topos.find((t) => (formacao instanceof RegExp ? formacao : new RegExp(formacao, 'i')).test(R[t].nm || ''));
  if (topo === undefined) throw new Error(`formacao de topo nao achada: ${formacao}`);
  const marcados = [];
  // Mascara as unidades DIRETAS de um trecho [inicio, fim) — fora dos registros em `dentro` (as
  // sub-formacoes aninhadas) e fora de qualquer registro de formacao. `sel` e RegExp/string sobre
  // o nome, ou uma LISTA DE ORDINAIS (1-based, na ordem do arquivo, so entre as unidades diretas):
  // por nome nao da para tirar 1 dos 3 "Squad (Rifle)" de um pelotao, e e isso que a defesa por
  // baldes precisa (E46). Devolve quantas marcou.
  const mascararDiretas = (inicio, fim, dentro, sel) => {
    const ordinais = Array.isArray(sel) ? new Set(sel.map(Number)) : null;
    const re = ordinais ? null : (sel instanceof RegExp ? sel : new RegExp(sel, 'i'));
    let n = 0, ord = 0;
    for (let k = inicio; k < fim; k++) {
      if (dentro.has(k) || R[k].form) continue;
      ord++;
      if (ordinais ? !ordinais.has(ord) : !re.test(R[k].nm || '')) continue;
      if (cru[R[k].off + 7] & 0x80) continue;
      cru[R[k].off + 7] |= 0x80; n++;
    }
    return n;
  };
  const rotuloSel = (sel) => (Array.isArray(sel) ? `#${sel.join(',')}` : `/${(sel instanceof RegExp ? sel : new RegExp(sel, 'i')).source}/`);
  const podarEm = (indice, lista, rotuloPai) => {
    const subs = filhas(cru, d.tokens, R, indice);
    for (const a of lista || []) {
      const alvo = typeof a === 'number' ? subs[a - 1]
        : subs.find((s) => s.nome.toLowerCase() === String(a.nome).toLowerCase() && s.ocorrencia === (a.ocorrencia || 1));
      if (!alvo) throw new Error(`subformacao nao achada em ${rotuloPai}: ${JSON.stringify(a)} (ha: ${subs.map((s) => s.nome + '#' + s.ocorrencia).join(', ')})`);
      if (a.ausentes || a.ausentesUnidades) {   // aninhado: poda DENTRO, mantem a subformacao
        if (a.ausentes) podarEm(alvo.i, a.ausentes, `${alvo.nome}#${alvo.ocorrencia}`);
        if (a.ausentesUnidades) {   // so as unidades DIRETAS desta subformacao (fora das sub-subformacoes)
          const dentro = new Set(); for (const f of filhas(cru, d.tokens, R, alvo.i)) for (let k = f.i; k < f.e; k++) dentro.add(k);
          const n = mascararDiretas(alvo.i + 1, alvo.e, dentro, a.ausentesUnidades);
          marcados.push(`${alvo.nome}#${alvo.ocorrencia}: unidades soltas ${rotuloSel(a.ausentesUnidades)} (${n})`);
        }
        continue;
      }
      for (let k = alvo.i; k < alvo.e; k++) cru[R[k].off + 7] |= 0x80;
      marcados.push(`${rotuloPai ? rotuloPai + ' > ' : ''}${alvo.nome}#${alvo.ocorrencia} (${alvo.e - alvo.i} registros)`);
    }
    return subs;
  };
  const subs = podarEm(topo, ausentes, '');
  if (ausentesSoltas) {   // so as unidades SOLTAS do topo (fora de qualquer subformacao direta)
    let fimTopo; try { fimTopo = subArvore(cru, p, R, topo); } catch { fimTopo = R.length; }
    const dentro = new Set(); for (const f of subs) for (let k = f.i; k < f.e; k++) dentro.add(k);
    const n = mascararDiretas(topo + 1, fimTopo, dentro, ausentesSoltas);
    marcados.push(`unidades soltas do topo ${rotuloSel(ausentesSoltas)} (${n})`);
  }
  if (ausentesUnidades) {
    const re = ausentesUnidades instanceof RegExp ? ausentesUnidades : new RegExp(ausentesUnidades, 'i');
    let fimTopo; try { fimTopo = subArvore(cru, p, R, topo); } catch { fimTopo = R.length; }
    let n = 0; for (let k = topo + 1; k < fimTopo; k++) { if (R[k].form || !re.test(R[k].nm || '')) continue; if (cru[R[k].off + 7] & 0x80) continue; cru[R[k].off + 7] |= 0x80; n++; }
    marcados.push(`unidades /${re.source}/ (${n})`);
  }
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? b : x));
  return { marcados, subformacoes: subs.map((s) => s.nome + '#' + s.ocorrencia) };
}

const EH_MAIN = process.argv[1] && /[\\/]podar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [ent, sai, form, ...aus] = process.argv.slice(2);
  if (!ent) console.log('uso: node podar.mjs <ent.btt> <sai.btt> <formacao(regex)> <n|nome#k>...');
  else { const lista = aus.map((a) => (/^\d+$/.test(a) ? +a : { nome: a.split('#')[0], ocorrencia: +(a.split('#')[1] || 1) })); const r = podar(ent, sai, form, lista); console.log(`marcados ausentes: ${r.marcados.join(' | ')}\nsubformacoes: ${r.subformacoes.join(', ')}`); }
}
