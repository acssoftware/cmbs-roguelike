// O RUMO DAS UNIDADES (02/10). Cada unidade posicionada leva um ELEMENTO de 17 B (FORMATO 97/110):
// `marcador | f32 rumo | f32 x | f32 y | u32 ref`, e o esquadrao dividido em times tem um elemento por
// time (`SEP ELEMENTO`). O gerador so escrevia x e y; o rumo ficava o da biblioteca, 0 em quase todos
// os registros — e todo veiculo inimigo olhava para o mesmo lado (autor: "para a direita da zona").
//
// Aqui: ler os rumos de um lado, e reescreve-los no lugar (4 bytes, sem mudar tamanho), conferindo
// no arquivo GRAVADO que o numero de registros, as posicoes e os rumos sao os planejados.
//
//   node tools/re/rumo.mjs <arquivo.btt>        lista centroide e rumos de cada lado
import { abrirCompleto } from './anexar2.mjs';
import { posicaoDoElemento } from './core.mjs';
import { arvore } from './extras.mjs';
import { codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

// marcador: nibble baixo 0, alto 0x10 (posicionado) e/ou 0x80 (embarcado); rumo em radianos, pequeno
const plausivel = (c, o, teto = 10) => {
  if (o + 13 > c.length || (c[o] & 0x0f) !== 0 || (c[o] & 0x60) !== 0) return false;
  const x = c.readFloatLE(o + 5), y = c.readFloatLE(o + 9), r = c.readFloatLE(o + 1);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r) && Math.abs(r) <= teto && x > 0 && y > 0 && x < 20000 && y < 20000;
};

// Os elementos de um registro: o primeiro pela forma (`core.posicaoDoElemento`), os seguintes
// enquanto `SEP + elemento` ainda for um elemento plausivel e couber no registro.
function elementos(c, r, fim) {
  const e = posicaoDoElemento(c, r, fim);
  // o primeiro vem da forma do registro: o rumo nele pode ser qualquer coisa que alguem escreveu
  if (e == null || !plausivel(c, e, 1e6)) return [];
  const out = [e];
  for (let q = e + 17; out.length < 8 && q + 1 + 13 <= fim && plausivel(c, q + 1); q += 18) out.push(q + 1);
  return out;
}

// Unidades posicionadas dos dois lados: { lado, i, nome, veiculo, elementos: [{ o, rumo, x, y }] }.
export function lerRumos(arquivo) {
  const X = abrirCompleto(arquivo); const c = X.completo;
  const out = [];
  const A = arvore(X);
  for (const lado of ['azul', 'vermelho']) {
    const anda = (n) => {
      if (n.r.form) { n.filhos.forEach(anda); return; }
      const fim = X.R[n.i + 1] ? X.R[n.i + 1].c : c.length;
      const els = elementos(c, n.r, fim).map((o) => ({ o, rumo: c.readFloatLE(o + 1), x: c.readFloatLE(o + 5), y: c.readFloatLE(o + 9) }));
      if (els.length) out.push({ lado, i: n.i, nome: n.r.nm || '', ausente: !!n.r.ausente, elementos: els });
    };
    (A[lado] || []).forEach(anda);
  }
  return out;
}

// so quem vai para o mapa: o ausente fica empilhado no primeiro tile da zona e puxaria o centro
// O rumo que aponta de `de` para `para`, em radianos no intervalo [0, 2pi): o leitor de registros
// (`core.rumoLimpo`) so aceita rumo >= 0 — nenhum dos 490 arquivos medidos tinha negativo.
export const rumoPara = (de, para) => { const a = Math.atan2(para.y - de.y, para.x - de.x); return a < 0 ? a + 2 * Math.PI : a; };

export const centroide = (us) => {
  const ps = us.filter((u) => !u.ausente).flatMap((u) => u.elementos);
  if (!ps.length) return null;
  return { x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length };
};

// `quer(unidade, elemento)` devolve o rumo novo (f32) ou null para deixar como esta.
export function escreverRumos(entrada, saida, quer) {
  const X = abrirCompleto(entrada); const c = Buffer.from(X.completo);
  const antes = lerRumos(entrada);
  const plano = [];
  for (const u of antes) for (const e of u.elementos) {
    const r = quer(u, e);
    if (r == null || !Number.isFinite(r)) continue;
    c.writeFloatLE(r, e.o + 1);
    plano.push({ i: u.i, o: e.o, rumo: c.readFloatLE(e.o + 1) });
  }
  reconstruir(entrada, saida, (b, k) => (k === 1 ? codificarComoJogo(c, X.d.esc) : b));

  // conferencia no arquivo gravado
  const V = abrirCompleto(saida);
  if (V.R.length !== X.R.length) throw new Error(`rumo: ${X.R.length} registros viraram ${V.R.length}`);
  const depois = lerRumos(saida);
  const porI = new Map(depois.map((u) => [u.i, u]));
  for (const u of antes) {
    const v = porI.get(u.i);
    if (!v || v.elementos.length !== u.elementos.length) throw new Error(`rumo: ${u.nome} (registro ${u.i}) perdeu elementos`);
    u.elementos.forEach((e, k) => { if (v.elementos[k].x !== e.x || v.elementos[k].y !== e.y) throw new Error(`rumo: ${u.nome} mudou de posicao`); });
  }
  const porO = new Map(depois.flatMap((u) => u.elementos.map((e) => [e.o, e.rumo])));
  for (const p of plano) if (porO.get(p.o) !== p.rumo) throw new Error(`rumo: o registro ${p.i} nao le de volta o rumo escrito`);
  return { elementos: plano.length, unidades: new Set(plano.map((p) => p.i)).size };
}

const EH_MAIN = process.argv[1] && /[\\/]rumo\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const us = lerRumos(process.argv[2]);
  for (const lado of ['azul', 'vermelho']) {
    const l = us.filter((u) => u.lado === lado);
    const rs = new Map(); l.forEach((u) => u.elementos.forEach((e) => { const k = e.rumo.toFixed(3); rs.set(k, (rs.get(k) || 0) + 1); }));
    const cg = centroide(l);
    console.log(`${lado}: ${l.length} unidades (${l.filter((u) => !u.ausente).length} presentes), ${l.reduce((a, u) => a + u.elementos.length, 0)} elementos; centroide ${cg ? `(${cg.x.toFixed(0)}, ${cg.y.toFixed(0)})` : '-'}; rumos ${JSON.stringify([...rs].sort((a, b) => b[1] - a[1]).slice(0, 6))}`);
  }
}
