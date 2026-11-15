// AGRUPAR: atribuir GRUPO DE IA a unidades (secao 70).
//
// Na tela Units, F1..F8 (duas vezes para 9..16) sobre uma unidade ou formacao grava, em cada
// UNIDADE da subarvore, o byte +16 do registro = grupo - 1 (medido no `AA TESTE.btt` do autor:
// [A2] -> 1, [A3] -> 2, [A8] -> 7, [A15] -> 14). Registros de formacao nao mudam: o `[A2]` na
// formacao e o `[A*]` no batalhao sao derivados dos filhos. O byte fica entre o estado 0x60 e o
// par de tipo, sempre literal na compactada: patch direto, como `podar`.
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, subArvore } from './regs.mjs';
import { codificar, expandir } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import { filhas } from './podar.mjs';

export const GRUPO_OFF = 16;

// `regras`: [{grupo, nome?, ocorrencia?, unidade?}]. Sem `nome`/`unidade`: a formacao inteira.
// `nome` = subformacao direta (como em podar); `unidade` = nome de unidade dentro da formacao,
// `ocorrencia` conta a partir de 1 dentro da subarvore escolhida.
export function agrupar(entrada, saida, formacao, regras) {
  const d = ler(entrada); const cru = Buffer.from(d.cru);
  const R = registros(cru).sort((a, b) => a.off - b.off);
  const p = indiceDeTokens(d.tokens);
  const topos = []; { let i = 0; while (i < R.length) { if (!R[i].form) { i++; continue; } let e; try { e = subArvore(cru, p, R, i); } catch { e = i + 1; } topos.push(i); if (e <= i) break; i = e; } }
  const topo = typeof formacao === 'number' ? topos[formacao] : topos.find((t) => (formacao instanceof RegExp ? formacao : new RegExp(formacao, 'i')).test(R[t].nm || ''));
  if (topo === undefined) throw new Error(`formacao de topo nao achada: ${formacao}`);
  let fimTopo; try { fimTopo = subArvore(cru, p, R, topo); } catch { fimTopo = R.length; }
  const subs = filhas(cru, d.tokens, R, topo);
  const feitos = [];
  for (const r of regras) {
    const g = +r.grupo; if (!(g >= 1 && g <= 16)) throw new Error(`grupo fora de 1..16: ${JSON.stringify(r)}`);
    let ini = topo, fim = fimTopo, rotulo = R[topo].nm;
    if (r.nome) {
      const s = subs.find((x) => x.nome.toLowerCase() === String(r.nome).toLowerCase() && x.ocorrencia === (r.ocorrencia || 1));
      if (!s) throw new Error(`subformacao nao achada: ${JSON.stringify(r)} (ha: ${subs.map((x) => x.nome + '#' + x.ocorrencia).join(', ')})`);
      ini = s.i; fim = s.e; rotulo = `${s.nome}#${s.ocorrencia}`;
    }
    let n = 0;
    if (r.unidade) {
      let k = 0, achou = false;
      for (let i = ini; i < fim; i++) { if (R[i].form || (R[i].nm || '').toLowerCase() !== String(r.unidade).toLowerCase()) continue; k++; if (k === (r.ocorrencia || 1) || (r.nome && !r.ocorrenciaUnidade && false)) { cru[R[i].off + GRUPO_OFF] = g - 1; n = 1; achou = true; rotulo = `${R[i].nm}#${k}`; break; } }
      if (!achou) throw new Error(`unidade nao achada: ${JSON.stringify(r)}`);
    } else {
      for (let i = ini; i < fim; i++) { if (R[i].form) continue; cru[R[i].off + GRUPO_OFF] = g - 1; n++; }
    }
    feitos.push(`${rotulo} -> grupo ${g} (${n} unidades)`);
  }
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, k) => (k === 1 ? b : x));
  return { feitos };
}

// Le os grupos de um arquivo: [{id, nome, grupo}] so das unidades.
export function grupos(caminho) {
  const d = ler(caminho); const R = registros(d.cru).sort((a, b) => a.off - b.off);
  return R.filter((r) => !r.form).map((r) => ({ id: r.id, nome: r.nm, grupo: d.cru[r.off + GRUPO_OFF] + 1 }));
}

// DISTRIBUIR um lado inteiro pelos grupos que o plano de IA do mapa usa (secoes 84-85).
// Subformacao a subformacao, em rodizio: a 1a vai a grupos[0], a 2a a grupos[1], ... Pelotoes
// ficam inteiros no mesmo grupo (e o que o plano espera) e a proporcao sai sozinha. Unidades
// soltas direto sob a formacao de topo vao a grupos[0]. O lado e POSICIONAL (secao 68): as
// K_azul primeiras formacoes de topo sao azuis.
export function distribuirPorLado(entrada, saida, lado, gruposLista) {
  if (!gruposLista || !gruposLista.length) throw new Error('lista de grupos vazia');
  const d = ler(entrada); const cru = Buffer.from(d.cru);
  const R = registros(cru).sort((x, y) => x.off - y.off);
  const p = indiceDeTokens(d.tokens);
  const { completo, mapa } = expandir(d.cru, d.tokens);
  const inv = new Map(); mapa.forEach((o, i) => { if (o >= 0 && !inv.has(o)) inv.set(o, i); });
  const kAzul = completo.readUInt32LE(inv.get(marcador(d).pos) + 13);
  const topos = [];
  { let i = 0; while (i < R.length) { if (!R[i].form) { i++; continue; } let e; try { e = subArvore(cru, p, R, i); } catch { e = i + 1; } topos.push({ i, e }); if (e <= i) break; i = e; } }
  const meus = topos.filter((t, n) => (n < kAzul) === (lado === 'azul'));
  let k = 0; const porGrupo = {}; const feitos = [];
  const marca = (j, g) => { cru[R[j].off + GRUPO_OFF] = g - 1; porGrupo[g] = (porGrupo[g] || 0) + 1; };
  // FOLHAS: as subformacoes mais profundas (sem subformacao dentro) sao a unidade de distribuicao —
  // pelotoes, baterias, secoes. Assim 3 pelotoes viram 3 grupos, mesmo dentro de uma companhia.
  const fimDe = (i) => { try { return subArvore(cru, p, R, i); } catch { return i + 1; } };
  const folhas = (i, e, out) => { let j = i + 1, temSub = false; while (j < e) { if (R[j].form) { temSub = true; folhas(j, fimDe(j), out); j = fimDe(j); } else j++; } if (!temSub) out.push({ i, e, nome: R[i].nm }); return temSub; };
  for (const t of meus) {
    const fl = []; folhas(t.i, t.e, fl);
    const cobertos = new Set();
    for (const s of fl) {
      // folha AUSENTE (podada, secao 67) nao entra no rodizio: senao pelotoes desativados consomem grupos
      if (![...Array(s.e - s.i).keys()].some((q) => !R[s.i + q].form && !R[s.i + q].ausente)) { for (let j = s.i; j < s.e; j++) cobertos.add(j); continue; }
      const g = gruposLista[k % gruposLista.length]; k++;
      let n = 0;
      for (let j = s.i; j < s.e; j++) { cobertos.add(j); if (R[j].form) continue; marca(j, g); n++; }
      feitos.push(`${s.nome}->G${g}(${n})`);
    }
    for (let j = t.i + 1; j < t.e; j++) { if (cobertos.has(j) || R[j].form) continue; marca(j, gruposLista[0]); }
  }
  const b = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(entrada, saida, (x, i) => (i === 1 ? b : x));
  return { porGrupo, feitos, formacoes: meus.length };
}

const EH_MAIN = process.argv[1] && /[\\/]agrupar\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [ent, sai, form, ...rs] = process.argv.slice(2);
  if (!ent) console.log('uso: node agrupar.mjs <ent.btt> <sai.btt> <formacao(regex)> <grupo|nome#k=grupo|unidade:nome#k=grupo>...\n     node agrupar.mjs <arq.btt>   (lista os grupos)');
  else if (!sai) { const g = grupos(ent); const h = {}; g.forEach((u) => { h[u.grupo] = (h[u.grupo] || 0) + 1; }); console.log('unidades por grupo:', JSON.stringify(h)); g.filter((u) => u.grupo > 1).forEach((u) => console.log(`  id ${u.id} ${u.nome} -> grupo ${u.grupo}`)); }
  else {
    const regras = rs.map((s) => { const [alvo, g] = s.includes('=') ? s.split('=') : [null, s]; if (!alvo) return { grupo: +g }; const un = alvo.startsWith('unidade:'); const [nome, k] = alvo.replace(/^unidade:/, '').split('#'); return un ? { unidade: nome, ocorrencia: +(k || 1), grupo: +g } : { nome, ocorrencia: +(k || 1), grupo: +g }; });
    const r = agrupar(ent, sai, form, regras); console.log(r.feitos.join('\n'));
  }
}
