// TIRAR UNIDADES DE UMA FORCA — o espelho do enxerto (09/11/2026, bateria do limite da US).
//
// Por que: o CM Black Sea e um executavel de 32 bits e morre com ~4 GB de memoria virtual. Medido em jogo
// (09/11): linha de roster de dormente custa zero, mas UNIDADE AUSENTE NA BATALHA custa — um Squadron
// (Cavalry) inteiro desligado (107 unidades) derrubou a b12 do autor que carregava com 3,2 GB. A forca
// do autor carrega 411 dormentes de tres batalhoes comprados inteiros; tira-los da batalha e o que abre
// espaco.
//
// O editor nunca remove registro (o Delete liga o bit 0x80, FORMATO 10), entao isto nao tem gabarito do
// editor; tem a geometria que o enxerto e o `inserirRegistro` ja provaram:
//   - entre dois registros: conteudo, (regra - 3) zeros, e os 3 zeros de cabeca do seguinte;
//   - o contador de filhos de uma formacao e o u32 em (c - 1) do PRIMEIRO filho dela (110.1);
//   - na fronteira azul/vermelho: a regra INTEIRA de zeros, o u32 K_verm em (c - 1) do primeiro vermelho.
// Cortar uma sub-arvore S (registros i..fim-1), entao, e tirar [R[i].c, R[fim].c): o enchimento do
// registro anterior a S fica e passa a preceder R[fim] — inclusive quando o anterior e a mae e o que
// fica ali e o contador dela. Na fronteira vermelha o corte e [R[i].c + 3, R[fim].c - 1), que deixa a
// regra inteira do anterior e o K_verm. Os ids NAO mudam (sao explicitos no registro e o roster pareia
// por core id); N do cabecalho cai pelo numero de unidades tiradas.
//
// So tira sub-arvores do lado azul, nunca uma formacao de topo, e nunca o HQ de uma formacao que fica
// (o editor nao deixa apagar o Headquarters Team de um grupo com outras unidades, FORMATO 10).
//   node tools/re/remover.mjs <entrada.btt> <saida.btt> <id,id,...>
import fs from 'node:fs';
import { abrirCompleto } from './anexar2.mjs';
import { arvore, verificarForca } from './extras.mjs';
import { fimDoConteudo } from './core.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const EH_HQ = /\bHQ\b|Headquarters/i;

// Unidade ausente: bit 0x80 em +7, ou cauda core com presente = 0.
export function ausente(X, k) {
  const c = X.completo, r = X.R[k];
  if (c[r.c + 7] & 0x80) return true;
  let i; try { i = fimDoConteudo(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); } catch { return false; }
  return i.core ? c[i.fim + 4] !== 1 : false;
}

// O CORE ID mora na cauda (core.marcarCore), nao no id do registro: numa batalha os registros sao
// renumerados pelo gerador (o Platoon (LRS) core 1 e o registro 361). null quando nao ha cauda core.
export function coreIdDe(X, k) {
  const c = X.completo, r = X.R[k];
  let i; try { i = fimDoConteudo(c, r, X.R[k + 1] ? X.R[k + 1].c : c.length); } catch { return null; }
  return i.core ? c.readUInt32LE(i.fim) : null;
}

// As sub-arvores maximas a tirar: todas as unidades delas em `alvo` (Set de CORE ids) e ausentes.
export function planoDeRemocao(X, alvo) {
  const A = arvore(X); const cortes = [];
  // devolve true quando a sub-arvore inteira pode sair (e tem pelo menos uma unidade)
  const anda = (no) => {
    if (!no.r.form) return alvo.has(coreIdDe(X, no.i)) && ausente(X, no.i);
    const pode = no.filhos.map(anda);
    const unidades = (n) => (n.r.form ? n.filhos.reduce((s, f) => s + unidades(f), 0) : 1);
    if (no.filhos.length && pode.every(Boolean) && unidades(no) > 0) return true;
    // a formacao fica: os filhos que podem sair saem, menos o HQ dela
    no.filhos.forEach((f, k) => { if (pode[k] && !(k === 0 && !f.r.form && EH_HQ.test(f.r.nm || ''))) cortes.push({ no: f, mae: no }); });
    return false;
  };
  // O LADO DA FORCA CORE: o que tem cauda core (numa batalha o jogador pode estar no vermelho, e os ids
  // dos dois lados se repetem — tirar pelo id no lado errado apagava ausentes do inimigo).
  const temCore = (t) => { const l = []; const a = (n) => { if (n.r.form) n.filhos.forEach(a); else l.push(n.i); }; a(t);
    return l.some((k) => { try { return fimDoConteudo(X.completo, X.R[k], X.R[k + 1] ? X.R[k + 1].c : X.completo.length).core; } catch { return false; } }); };
  const lados = ['azul', 'vermelho'].filter((l) => A[l].some(temCore));
  if (lados.length !== 1) throw new Error(`forca core em ${lados.length} lados (${lados.join(', ')}): nao sei de qual tirar`);
  for (const t of A[lados[0]]) anda(t);
  return { A, cortes, lado: lados[0] };
}

export function removerUnidades(entrada, saida, ids) {
  const alvo = new Set([...ids].map(Number));
  const X = abrirCompleto(entrada); const c0 = X.completo, R = X.R;
  const plano = planoDeRemocao(X, alvo); const { A, cortes } = plano;
  const primVerm = A.vermelho.length ? R[A.vermelho[0].i] : null;
  const c = Buffer.from(c0);
  // contadores das maes (antes de cortar: os offsets sao do original)
  const porMae = new Map();
  for (const { mae } of cortes) porMae.set(mae.i, (porMae.get(mae.i) || 0) + 1);
  for (const [mi, n] of porMae) {
    const no = cortes.find((x) => x.mae.i === mi).mae; const pc = R[mi + 1].c - 1; const n0 = c.readUInt32LE(pc);
    if (n0 !== no.n) throw new Error(`contador de ${no.r.nm} (id ${no.r.id}): ${n0} no arquivo, ${no.n} na arvore`);
    c.writeUInt32LE(n0 - n, pc);
  }
  // os cortes, do fim para o comeco
  const faixas = cortes.map(({ no, mae }) => {
    const prox = R[no.fim];
    // a ULTIMA sub-arvore do arquivo: o conteudo do anterior encosta direto na corrida de zeros do rodape
    // (fimDosRegistros), entao sai tudo do fim do conteudo anterior ate o fim do conteudo dela.
    if (!prox) {
      if (mae.i === no.i - 1) throw new Error(`${no.r.nm} (id ${no.r.id}) e o primeiro e ultimo filho no fim do arquivo: nao previsto`);
      let a = R[no.i].c; while (c0[a - 1] === 0) a--;
      let b = R[R.length - 1].c; for (let i = b; i < c0.length; i++) { if (c0[i] !== 0) continue; let z = 0; while (i + z < c0.length && c0[i + z] === 0) z++; if (z >= 32) { b = i; break; } i += z; }
      return [a, b];
    }
    return primVerm && prox.c === primVerm.c ? [R[no.i].c + 3, prox.c - 1] : [R[no.i].c, prox.c];
  }).sort((a, b) => b[0] - a[0]);
  let buf = c;
  for (const [a, b] of faixas) buf = Buffer.concat([buf.subarray(0, a), buf.subarray(b)]);
  const tiradas = cortes.flatMap(({ no }) => { const l = []; const anda = (n) => { if (n.r.form) n.filhos.forEach(anda); else l.push(coreIdDe(X, n.i)); }; anda(no); return l; });
  const registros = cortes.reduce((s, { no }) => s + (no.fim - no.i), 0);
  buf.writeUInt32LE(buf.readUInt32LE(X.m + 9) - tiradas.length, X.m + 9);
  reconstruir(entrada, saida, (b, k) => (k === 1 ? codificarComoJogo(buf, X.d.esc) : b));

  const V = abrirCompleto(saida);
  if (V.R.length !== R.length - registros) throw new Error(`gravado com ${V.R.length} registros, esperava ${R.length - registros}`);
  const fora = new Set(tiradas); const ficou = R.filter((r) => !cortes.some(({ no }) => r === R[no.i] || (R.indexOf(r) > no.i && R.indexOf(r) < no.fim))).map((r) => r.id).join();
  if (ficou !== V.R.map((r) => r.id).join()) throw new Error('os registros que ficaram nao sao os esperados');
  const ok = verificarForca(saida);
  if (!ok.ok) throw new Error(`verificarForca reprovou: ${ok.erros.slice(0, 3).join(' | ')}`);
  return { lado: plano.lado, cortes: cortes.length, registros, unidades: tiradas.length, tiradas, pedidasNaoTiradas: [...alvo].filter((x) => !fora.has(x)).length, N: V.completo.readUInt32LE(V.m + 9), avisos: ok.avisos.length };
}

const EH_MAIN = process.argv[1] && /[\\/]remover\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [ent, sai, lista] = process.argv.slice(2);
  if (!ent || !sai || !lista) { console.log('uso: node tools/re/remover.mjs <entrada.btt> <saida.btt> <id,id,...>'); process.exit(1); }
  const r = removerUnidades(ent, sai, lista.split(',').map(Number));
  console.log(JSON.stringify({ ...r, tiradas: r.tiradas.length }, null, 1));
}
