// TESTE do core.mjs (secao 111.16). Tres provas, todas contra arquivos do jogo:
//   1. GABARITO: marcarCore(V5) x CAMPAIGN IMPORTED (o mesmo batalhao importado pelo editor).
//      Compara a cauda de cada registro (do fim do conteudo ate `04 03`) e o bit 0 de +11.
//   2. IDEMPOTENCIA: marcar um arquivo que ja e core devolve o arquivo intacto, byte a byte.
//   3. VARREDURA: fimDoConteudo em todo registro de Scenarios, TESTING e assets/qb_assault —
//      conta as formas e as falhas (o esperado e so o punhado de registros que o proprio parser
//      inventa dentro do terreno, sem nome de catalogo).
// uso: node core_teste.mjs [--varredura]
import fs from 'node:fs';
import path from 'node:path';
import { marcarCore, fimDoConteudo } from './core.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { verificarForca, arvore } from './extras.mjs';

const G = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const ASSETS = path.resolve(import.meta.dirname, '../../assets/qb_assault');
const TMP = path.join(process.env.TEMP || '.', 'cmbs_core_teste');
const hex = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();
fs.mkdirSync(TMP, { recursive: true });
let falhou = false;
const conta = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${msg}`); if (!ok) falhou = true; };

// 1. GABARITO
{
  const V5 = G + 'Scenarios/US MECH PLT vs RU 3PLT QBSMALL V5.btt', CI = G + 'TESTING/CAMPAIGN IMPORTED.btt';
  const OUT = path.join(TMP, 'v5_core.btt');
  const rel = marcarCore(V5, OUT);
  const O = abrirCompleto(OUT), C = abrirCompleto(CI), V = abrirCompleto(V5);
  const v = verificarForca(OUT), A = arvore(O);
  conta(v.ok && A.azul.length === 1 && A.vermelho.length === 4, `verificarForca(V5 CORE) ok=${v.ok} erros=${v.erros.length}; arvore azul ${A.azul.length} verm ${A.vermelho.length}`);
  conta(O.completo.length === V.completo.length + 5 * V.R.length, `tamanho do bloco: ${V.completo.length} + 5x${V.R.length} = ${O.completo.length}`);
  const caudas = (X) => X.R.map((r, k) => { const fim = X.R[k + 1] ? X.R[k + 1].c : X.completo.length; let z = fim - 1; while (z > r.c && X.completo[z] === 0) z--;
    const { fim: fc } = fimDoConteudo(X.completo, r, fim); return { nm: r.nm, cauda: X.completo.subarray(fc, z + 1), b11: X.completo[r.c + 11] }; });
  const co = caudas(O), cc = caudas(C); let iguais = 0; const dif = [];
  for (let k = 0; k < co.length - 1; k++) {   // o ultimo tem o rodape aleatorio do arquivo colado na cauda
    if (co[k].cauda.equals(cc[k].cauda) && (co[k].b11 & 1) === (cc[k].b11 & 1)) iguais++;
    else if (dif.length < 4) dif.push(`[${k}] ${co[k].nm}: nosso ${hex(co[k].cauda)} | CI ${hex(cc[k].cauda).slice(0, 60)}`);
  }
  // [200] e o Bradley que o editor gravou torto no CI (34 B de lixo antes da posicao): nao ha o que casar
  conta(iguais >= co.length - 2, `caudas iguais ao CAMPAIGN IMPORTED: ${iguais}/${co.length - 1} (${JSON.stringify(rel.tipos)})`);
  for (const d of dif) console.log('      ' + d);
}

// 2. IDEMPOTENCIA
for (const f of ['TESTING/ZZ DINAMICA 01 RED CORE.btt', 'TESTING/ZZ DINAMICA 01 BLUE CORE.btt', 'TESTING/CAMPAIGN IMPORTED.btt', 'Scenarios/ZZ DINAMICA 01.btt', 'Scenarios/ZZ DINAMICA G1B.btt']) {
  if (!fs.existsSync(G + f)) { console.log(`--   ${f} nao esta na pasta do jogo`); continue; }
  const out = path.join(TMP, 'idem.btt'); let rel;
  try { rel = marcarCore(G + f, out); } catch (e) { conta(false, `${f}: ${e.message}`); continue; }
  conta(rel.marcados === 0 && fs.readFileSync(G + f).equals(fs.readFileSync(out)), `${f}: ja core (${rel.jaCore} registros), saida identica`);
}
{ // marcar duas vezes uma forca nao-core: a segunda passagem nao mexe
  const p1 = path.join(TMP, 'd1.btt'), p2 = path.join(TMP, 'd2.btt');
  marcarCore(G + 'Scenarios/US MECH PLT vs RU 3PLT QBSMALL V5.btt', p1); const r2 = marcarCore(p1, p2);
  conta(r2.marcados === 0 && fs.readFileSync(p1).equals(fs.readFileSync(p2)), `marcar duas vezes: a 2a passagem nao muda nada`);
}

// 4. CRESCIMENTO: marcar uma forca nao-core cresce o bloco EXATAMENTE 5 bytes por registro. E o
//    que denuncia uma cauda gravada em cima do conteudo. O gabarito sozinho nao bastou: o V5 nao
//    tem formacao com lista de tipos, e era justamente essa que encolhia (secao 112.3). Aqui a
//    prova roda sobre as 196 fontes da biblioteca, onde toda forma aparece.
{
  const LIB = G + '../LIB/';
  const arquivos = fs.existsSync(LIB) ? fs.readdirSync(LIB).filter((f) => /\.btt$/i.test(f)) : [];
  const out = path.join(TMP, 'crescimento.btt');
  let ok = 0; const maus = [], recusadas = [];
  for (const f of arquivos) {
    try {
      const A = abrirCompleto(LIB + f); marcarCore(LIB + f, out); const B = abrirCompleto(out);
      const sobra = B.completo.length - A.completo.length - 5 * A.R.length;
      if (sobra === 0) ok++; else maus.push(`${f}: ${sobra > 0 ? '+' : ''}${sobra} bytes em ${A.R.length} registros`);
    } catch (e) { recusadas.push(`${f}: ${e.message.slice(0, 60)}`); }   // recusar e certo; corromper nao
  }
  conta(arquivos.length > 0 && !maus.length, `crescimento +5 por registro em ${ok}/${arquivos.length - recusadas.length} fontes marcaveis (${recusadas.length} recusadas pelo marcarCore)`);
  for (const m of maus.slice(0, 8)) console.log('      ' + m);
  for (const r of recusadas.slice(0, 4)) console.log('      recusada  ' + r);
}

// 3. VARREDURA
if (process.argv.includes('--varredura')) {
  const lista = [];
  for (const d of [G + 'Scenarios', G + 'TESTING', ASSETS]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (/\.btt$/i.test(f)) lista.push(path.join(d, f));
  const tipos = {}; const falhas = []; let regs = 0, arqs = 0;
  for (const f of lista) {
    let X; try { X = abrirCompleto(f); } catch { continue; } arqs++;
    for (let k = 0; k < X.R.length; k++) {
      const r = X.R[k]; regs++;
      try { const i = fimDoConteudo(X.completo, r, X.R[k + 1] ? X.R[k + 1].c : X.completo.length); tipos[i.kind] = (tipos[i.kind] || 0) + 1; }
      catch { falhas.push({ f: path.basename(f), k, nm: r.nm }); }
    }
  }
  // O que nao se le, e por que: o parser inventa registros dentro do terreno (ficam sem nome de
  // catalogo) e um punhado de arquivos tem registros mal formados — os BISS V3* sairam da minha
  // bissecao a bisturi, e o Dueling Shashkas tem um registro que o parser ancora torto.
  const SABIDOS = [/^BISS V3/, /^ZZ ASINTORF ALL\.btt$/, /^ZZ LRS RPO 2\.btt$/, /^Dueling Shashkas\.btt$/];
  const comNome = falhas.filter((x) => x.nm);
  const novas = comNome.filter((x) => !SABIDOS.some((re) => re.test(x.f)));
  console.log(`\nvarredura: ${arqs} arquivos, ${regs} registros`);
  console.log('formas: ' + JSON.stringify(tipos));
  console.log(`falhas: ${falhas.length} = ${falhas.length - comNome.length} sem nome + ${comNome.length - novas.length} sabidas + ${novas.length} novas`);
  for (const x of novas.slice(0, 10)) console.log(`      ${x.f} [${x.k}] ${x.nm}`);
  conta(novas.length === 0, `nenhuma falha nova (sabidas: BISS V3*, ZZ ASINTORF ALL, ZZ LRS RPO 2, Dueling Shashkas)`);
}

console.log(falhou ? '\nRESULTADO: FALHOU' : '\nRESULTADO: ok');
process.exit(falhou ? 1 : 0);
