// TROCAR OS LADOS DE UM MAPA (17/10/2026, Hills-Farmland 282: o autor desenhou o plano com o azul no leste, e o mapa
// tem o azul no oeste). Troca tudo o que e por lado, para o mapa ficar o espelho coerente:
//   - a PINTURA DO SETUP (3 bits altos do byte 4 de cada tile; 1..3 azul, 4..6 vermelho): v <-> v +- 3;
//   - os 10 PLANOS DE IA (5 azuis <-> 5 vermelhos);
//   - as 30 VAGAS de objetivo (0..14 azuis <-> 15..29 vermelhas; o lado e so a posicao);
//   - os SUPPORT TARGETS: missao e tiles trocam por indice, os 4 B de params ficam com o lado (sao por indice e por
//     lado, alvosDeApoio). Lados com contagens diferentes: erro, nao adivinha.
// Trocar duas vezes devolve a corrente original byte a byte.
import { pecas, escrever } from './mapa_escrever.mjs';
import { indexarGrade } from './mapa.mjs';
import { decodificar, codificar, alvosDeApoio, codificarAlvos } from './ia_escrever.mjs';

export function trocarLados(base, saida) {
  const p = pecas(base); const m = p.m;
  const off = m.offsets || indexarGrade(m.c, m.gridStart, m.W, m.H).offsets;
  const grade = Buffer.from(p.grade); let pintados = 0;
  for (let t = 0; t < m.W * m.H; t++) {
    const o = off[t] - m.gridStart + 4; const v = grade[o] >> 5; if (!v) continue;
    const nv = v <= 3 ? v + 3 : v - 3; if (nv < 1 || nv > 6) throw new Error(`tile ${t}: tinta ${v} sem par`);
    grade[o] = (grade[o] & 0x1f) | (nv << 5); pintados++;
  }
  const d = decodificar(base);
  [d.azul, d.vermelho] = [d.vermelho, d.azul];
  if (d.vagas.length !== 30) throw new Error(`${d.vagas.length} vagas, esperava 30`);
  d.vagas = [...d.vagas.slice(15), ...d.vagas.slice(0, 15)];
  const L = alvosDeApoio(d);
  if (L.length === 2) {
    const [A, V] = L; if (A.alvos.length !== V.alvos.length) throw new Error(`alvos: ${A.alvos.length} azuis e ${V.alvos.length} vermelhos`);
    A.alvos.forEach((a, k) => { const b = V.alvos[k]; [a.missao, b.missao] = [b.missao, a.missao]; [a.tiles, b.tiles] = [b.tiles, a.tiles]; });
    d.cauda = codificarAlvos(L);
  } else if (L.length) throw new Error(`alvos de ${L.length} lado(s)`);
  escrever(base, saida, { grade, resto: codificar(d) });
  return { pintados, alvos: L.map((x) => x.alvos.length) };
}

// UNIFICAR OS SETUPS DE UM LADO (17/10/2026, Dueling Balalaikas: cada lado tinha duas pinturas com um vao entre elas):
// por lado, a caixa da pintura, e todo tile sem agua dentro dela recebe o menor valor do lado (azul 1, vermelho 4).
// Unificar duas vezes devolve a corrente identica. Nada mais do arquivo muda.
export function unificarSetup(base, saida) {
  const p = pecas(base); const m = p.m;
  const off = m.offsets || indexarGrade(m.c, m.gridStart, m.W, m.H).offsets;
  const grade = Buffer.from(p.grade);
  const valor = (t) => grade[off[t] - m.gridStart + 4] >> 5;
  const lados = [{ nome: 'azul', de: 1, ate: 3 }, { nome: 'vermelho', de: 4, ate: 6 }]; const resumo = [];
  for (const L of lados) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const valores = new Set();
    for (let t = 0; t < m.W * m.H; t++) { const v = valor(t); if (v < L.de || v > L.ate) continue; valores.add(v); const x = t % m.W, y = (t / m.W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!valores.size) { resumo.push(`${L.nome}: sem pintura`); continue; }
    const novo = Math.min(...valores); let pintados = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = y * m.W + x; const o = off[t] - m.gridStart + 4;
      const v = grade[o] >> 5; const doLado = v >= L.de && v <= L.ate;
      if (!doLado && (v || AGUA.has(grade[o - 4] & 0x7f))) continue;   // o vao recebe tinta, a agua e a tinta do outro lado nao
      if (doLado && v === novo) continue;
      grade[o] = (grade[o] & 0x1f) | (novo << 5); pintados++;
    }
    resumo.push(`${L.nome}: valores ${[...valores].sort().join('+')} -> ${novo}, caixa x${x0}-${x1} y${y0}-${y1}, ${pintados} tiles`);
  }
  escrever(base, saida, { grade });
  return { resumo };
}
// agua no byte de tipo (a mesma lista de ia_doutrina.feicoes: Marsh, Water, Deep Ford, Shallow Ford, Deep Marsh)
const AGUA = new Set([17, 28, 30, 40, 45]);

const EH_MAIN = process.argv[1] && /[\\/]trocar_lados\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const unificar = process.argv.includes('--unificar');
  const [base, saida] = process.argv.slice(2).filter((a) => a !== '--unificar');
  if (!base || !saida) { console.log('uso: node tools/re/trocar_lados.mjs [--unificar] "<base.btt>" "<saida.btt>"'); process.exit(1); }
  if (unificar) { const r = unificarSetup(base, saida); console.log(`${saida}: ${r.resumo.join(' | ')}`); }
  else { const r = trocarLados(base, saida); console.log(`${saida}: ${r.pintados} tiles de setup trocados, alvos ${r.alvos.join('/')}`); }
}
