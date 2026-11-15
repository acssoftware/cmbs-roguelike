// O ENVELOPE DOS MAPAS REAIS — tudo o que eu ESCREVO num mapa, medido nos mapas que o jogo escreveu.
//
// O primeiro Mucuge (04/09, FORMATO 94) travou o carregamento: formato aceito, motor preso. A medida
// de entao olhou cinco grandezas. Esta olha todas as que o escritor controla, porque "dentro do
// envelope" so quer dizer alguma coisa se o envelope cobrir o que eu mexo:
//
//   elevacao     relevo total, degrau maximo entre vizinhos (4 e 8), fracao de tiles com flag manual,
//                valores de flag vistos, e o DEGRAU SOB CONSTRUCAO (casa em cima de barranco)
//   construcoes  contagem, pares ortogonalmente vizinhos, casa em tile de estrada, andares
//   grade        valores de terreno, tipos de estrada, valores de foliage, landmarks (quantos, tamanho)
//
// E no fim passa um arquivo MEU pela mesma regua e diz em que ele sai do envelope.
//
//   node tools/re/envelope_mapas.mjs                       mede e grava research/envelope_mapas.json
//   node tools/re/envelope_mapas.mjs --conferir <a.btt>    mede e confere um arquivo contra o envelope
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerMapa, lerGrade } from './mapa.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const G = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const SAIDA = path.join(RAIZ, 'research/envelope_mapas.json');

// As grandezas de UM mapa. `null` quando a leitura nao e segura (a regiao de IA nao confirma a grade).
export function medir(caminho) {
  const m = lerMapa(caminho);
  if (!m.iaConfere || m.fimGrade == null) return null;
  const { c, W, H } = m;
  const g = lerGrade(m);
  // A camada de elevacao e COLUNA A COLUNA — `x*H + y` (FORMATO 71.1). A primeira versao deste censo
  // leu linha a linha e mediu "degrau mediano de 12 m entre vizinhos" nos mapas REAIS: era leitura
  // embaralhada, e foi esse numero impossivel que entregou o erro de ordem do escritor.
  const eOff = m.fimGrade;
  const dm = (x, y) => c.readUInt16LE(eOff + 4 * (x * H + y));
  const fl = (x, y) => c.readUInt16LE(eOff + 4 * (x * H + y) + 2);

  let min = Infinity, max = -Infinity, degrau4 = 0, degrau8 = 0, manuais = 0;
  const flags = {};
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = dm(x, y); if (v < min) min = v; if (v > max) max = v;
    const f = fl(x, y); flags[f] = (flags[f] || 0) + 1; if (f & 1) manuais++;
    if (x + 1 < W) degrau4 = Math.max(degrau4, Math.abs(v - dm(x + 1, y)));
    if (y + 1 < H) degrau4 = Math.max(degrau4, Math.abs(v - dm(x, y + 1)));
    if (x + 1 < W && y + 1 < H) degrau8 = Math.max(degrau8, Math.abs(v - dm(x + 1, y + 1)));
    if (x > 0 && y + 1 < H) degrau8 = Math.max(degrau8, Math.abs(v - dm(x - 1, y + 1)));
  }
  degrau8 = Math.max(degrau8, degrau4);

  const terreno = {}, estrada = {}, foliage = {};
  let tilesEstrada = 0, tilesFoliage = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = g.tile(x, y);
    terreno[t.tipo] = (terreno[t.tipo] || 0) + 1;
    if (t.estrada) { estrada[t.estrada] = (estrada[t.estrada] || 0) + 1; tilesEstrada++; }
    if (t.foliage) { foliage[t.foliage] = (foliage[t.foliage] || 0) + 1; tilesFoliage++; }
  }

  // construcoes: vizinhanca, estrada debaixo, barranco debaixo
  const ocup = new Set(); const casas = [];
  for (const b of m.construcoes) {
    if (b.tileX < 0 || b.tileX >= W || b.tileY < 0 || b.tileY >= H) continue;
    ocup.add(b.tileX + ',' + b.tileY); casas.push(b);
  }
  let vizinhas = 0, emEstrada = 0, degrauSobCasa = 0, andaresMax = 0;
  for (const b of casas) {
    const { tileX: x, tileY: y } = b;
    if (ocup.has((x + 1) + ',' + y)) vizinhas++;
    if (ocup.has(x + ',' + (y + 1))) vizinhas++;
    if (g.tile(x, y).estrada) emEstrada++;
    andaresMax = Math.max(andaresMax, b.count || 0);
    const v = dm(x, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      degrauSobCasa = Math.max(degrauSobCasa, Math.abs(v - dm(nx, ny)));
    }
  }

  const rotulos = (m.landmarks || []);
  return {
    W, H, tiles: W * H,
    relevoM: (max - min) / 10, elevMinM: min / 10, elevMaxM: max / 10,
    degrau4M: degrau4 / 10, degrau8M: degrau8 / 10, manualPct: 100 * manuais / (W * H), manuais, flags,
    construcoes: casas.length, casasVizinhas: vizinhas, casasEmEstrada: emEstrada, degrauSobCasaM: degrauSobCasa / 10, andaresMax,
    densidadeCasas: 10000 * casas.length / (W * H),
    terreno, estrada, foliage, estradaPct: 100 * tilesEstrada / (W * H), foliagePct: 100 * tilesFoliage / (W * H),
    rotulos: rotulos.length, rotuloMax: rotulos.reduce((a, r) => Math.max(a, (r.texto || r.nome || '').length), 0),
  };
}

const NUMERICAS = ['relevoM', 'elevMinM', 'elevMaxM', 'degrau4M', 'degrau8M', 'manualPct', 'manuais', 'construcoes', 'casasVizinhas', 'casasEmEstrada',
  'degrauSobCasaM', 'andaresMax', 'densidadeCasas', 'estradaPct', 'foliagePct', 'rotulos', 'rotuloMax', 'tiles'];
const pct = (v, q) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

export function envelope(medidas) {
  const env = { mapas: medidas.length, num: {}, terreno: {}, estrada: {}, foliage: {}, flags: {} };
  for (const k of NUMERICAS) {
    const v = medidas.map((m) => m[k]);
    env.num[k] = { min: Math.min(...v), p50: pct(v, 0.5), p90: pct(v, 0.9), p99: pct(v, 0.99), max: Math.max(...v) };
  }
  for (const campo of ['terreno', 'estrada', 'foliage', 'flags']) {
    for (const m of medidas) for (const [val, n] of Object.entries(m[campo])) {
      const e = (env[campo][val] = env[campo][val] || { mapas: 0, tiles: 0 });
      e.mapas++; e.tiles += n;
    }
  }
  return env;
}

// Em que um arquivo sai do envelope. Numerica: acima do maximo (ou abaixo do minimo onde importa).
// Categorica: valor que nenhum mapa real usa, ou que menos de 1% deles usa.
export function conferir(m, env) {
  const fora = [], raro = [];
  const acima = ['relevoM', 'degrau4M', 'degrau8M', 'manualPct', 'manuais', 'construcoes', 'casasVizinhas', 'casasEmEstrada', 'degrauSobCasaM', 'andaresMax', 'densidadeCasas', 'estradaPct', 'foliagePct', 'rotulos', 'rotuloMax', 'elevMaxM', 'tiles'];
  for (const k of acima) if (m[k] > env.num[k].max) fora.push(`${k}: ${+m[k].toFixed(2)} > maximo real ${+env.num[k].max.toFixed(2)} (p99 ${+env.num[k].p99.toFixed(2)})`);
  if (m.elevMinM < env.num.elevMinM.min) fora.push(`elevMinM: ${m.elevMinM} < minimo real ${env.num.elevMinM.min}`);
  for (const campo of ['terreno', 'estrada', 'foliage', 'flags']) {
    for (const [val, n] of Object.entries(m[campo])) {
      const e = env[campo][val];
      if (!e) fora.push(`${campo} ${val}: NENHUM mapa real usa (${n} tiles aqui)`);
      else if (e.mapas / env.mapas < 0.01) raro.push(`${campo} ${val}: so ${e.mapas} de ${env.mapas} mapas usam (${n} tiles aqui)`);
    }
  }
  return { fora, raro };
}

const ehMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehMain) {
  const pastas = [G + 'Quick Battle Maps/'];
  const arquivos = [];
  for (const p of pastas) for (const f of fs.readdirSync(p)) if (f.toLowerCase().endsWith('.btt')) arquivos.push(p + f);
  const medidas = []; let ilegiveis = 0;
  for (const f of arquivos) {
    let m = null; try { m = medir(f); } catch { m = null; }
    if (!m) { ilegiveis++; continue; }
    medidas.push({ arquivo: path.basename(f), ...m });
  }
  const env = envelope(medidas);
  console.log(`${arquivos.length} mapas de Quick Battle, ${medidas.length} lidos com seguranca, ${ilegiveis} fora`);
  console.log('\ngrandeza            min      p50      p90      p99      MAX');
  for (const k of NUMERICAS) { const e = env.num[k]; console.log(`${k.padEnd(16)} ${[e.min, e.p50, e.p90, e.p99, e.max].map((v) => String(+v.toFixed(2)).padStart(8)).join(' ')}`); }
  const top = (o) => Object.entries(o).sort((a, b) => b[1].mapas - a[1].mapas).map(([v, e]) => `${v}(${e.mapas})`).join(' ');
  console.log('\nterreno (valor(mapas)):', top(env.terreno));
  console.log('estrada (valor(mapas)):', top(env.estrada));
  console.log('foliage (valor(mapas)):', top(env.foliage));
  console.log('flags de elevacao (valor(mapas)):', top(env.flags));

  if (!process.argv.includes('--so-ler')) {
    fs.writeFileSync(SAIDA, JSON.stringify({ nota: 'Envelope do que o escritor de mapas controla, medido nos mapas de Quick Battle que o jogo escreveu. Refazer com `node tools/re/envelope_mapas.mjs`.', ...env }, null, 1) + '\n');
    console.log(`\n-> ${SAIDA}`);
  }

  const i = process.argv.indexOf('--conferir');
  if (i >= 0) for (const f of process.argv.slice(i + 1)) {
    const m = medir(f);
    console.log(`\n=== ${path.basename(f)}`);
    if (!m) { console.log('   ILEGIVEL pelos meus proprios leitores (a regiao de IA nao confirma a grade)'); continue; }
    const r = conferir(m, env);
    console.log(`   ${m.W}x${m.H}, relevo ${m.relevoM} m, degrau ${m.degrau4M}/${m.degrau8M} m, manual ${m.manualPct.toFixed(0)}%, ${m.construcoes} casas (${m.casasVizinhas} pares vizinhos, ${m.casasEmEstrada} em estrada, barranco sob casa ${m.degrauSobCasaM} m)`);
    console.log(r.fora.length ? '   FORA DO ENVELOPE:\n      ' + r.fora.join('\n      ') : '   dentro do envelope em tudo');
    if (r.raro.length) console.log('   raro:\n      ' + r.raro.join('\n      '));
  }
}
