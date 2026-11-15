// A DOTACAO DE FABRICA, colhida so do que o app nunca tocou (E80).
//
// Por que existe: `toe_armas.json` guarda, por vaga, o MAIOR carregamento ja visto, e
// `toe_granadas.json` guarda o p90 por vaga. As duas medidas somam maximos de saves diferentes — e
// desde que o refit passou a repor, os saves de onde elas saem ja descendem do proprio refit. O
// resultado, medido no esquadrao do autor:
//
//                          5.45mm   granadas   reparticao das granadas
//   fabrica (City 023)      2020       15       2 3 3 2 2 3
//   o que o app entregou    2298       17       5 1 0 1 10 0
//
// Um homem com DEZ granadas onde a fabrica da duas. No jogo, o peso e por SOLDADO: e assim que um
// esquadrao perde Fast, Quick e Assault com o total parecendo quase certo.
//
// O QUE CONTA COMO LIMPO. Nao e "save que o jogo escreveu" — todo save de campanha depois da
// primeira virada ja carrega o que o app escreveu antes. E tambem nao e o nome do arquivo: `City
// 023.bts` parece um cenario solto e traz dentro as batalhas `CMBSDC EASY2 A/B`. A regra que funciona
// usa o que esta DENTRO do arquivo:
//
//   - save sem batalha de campanha nenhuma (partida rapida, cenario) -> limpo, sempre;
//   - save de campanha -> limpo so se for mais antigo que o PRIMEIRO arquivo que o app escreveu
//     naquela campanha (isto e, a batalha 1, antes de existir refit).
//
// E so esquadrao INTEIRO ensina (todo mundo em estado 0): quem tem baixa ja teve a municao
// redistribuida pelo jogo entre os que sobraram.
//
// A medida e a MODA por (tipo, vaga) — nao o maximo, nao a media. A dotacao e um valor exato que o
// jogo escreve igual toda vez; o que varia e o gasto, e o gasto so tira. A moda por vaga aguenta
// squads meio gastos que por acaso entraram na conta.
//
//   node tools/re/dotacao.mjs             mostra o que sairia
//   node tools/re/dotacao.mjs --gravar    escreve research/dotacao.json
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster, caudasDoRoster, paiolDe, granadasDe } from './roster.mjs';
import { anatomiaDoSave as saveAnatomy } from './cam.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
export const TABELA = path.join(RAIZ, 'research/dotacao.json');
const DO_APP = /\[B\d+|\(rebuilt|\(curado|\(rearmado|\(antes do conserto|resupplied|replaced|granted-|rearmed-|unloot-|grenades-/i;

function candidatos() {
  const out = [];
  const anda = (dir) => {
    let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) anda(p);
      else if (it.name.toLowerCase().endsWith('.bts')) out.push(p);
    }
  };
  anda(SALVOS);
  return out;
}

// Separa os saves em limpos e sujos pela regra acima. Devolve tambem o porque, para o relatorio.
export function classificar(arquivos = candidatos()) {
  const fichas = [];
  for (const p of arquivos) {
    let a; try { a = saveAnatomy(p); } catch { continue; }
    const campanha = (a.batalhas || []).map((b) => b.nome).sort().join('|');
    fichas.push({ p, nome: path.basename(p), campanha, quando: fs.statSync(p).mtimeMs, doApp: DO_APP.test(path.basename(p)) });
  }
  // o primeiro arquivo do app de cada campanha e a fronteira
  const fronteira = new Map();
  for (const f of fichas) {
    if (!f.campanha || !f.doApp) continue;
    if (!fronteira.has(f.campanha) || f.quando < fronteira.get(f.campanha)) fronteira.set(f.campanha, f.quando);
  }
  for (const f of fichas) {
    if (f.doApp) { f.limpo = false; f.porque = 'escrito pelo app'; continue; }
    if (!f.campanha) { f.limpo = true; f.porque = 'sem campanha (partida rapida ou cenario)'; continue; }
    const lim = fronteira.get(f.campanha);
    f.limpo = lim === undefined || f.quando < lim;
    f.porque = f.limpo ? 'campanha antes do primeiro refit' : 'campanha depois do primeiro refit';
  }
  return fichas;
}

const moda = (valores) => {
  const urna = new Map();
  for (const v of valores) { const k = JSON.stringify(v); urna.set(k, (urna.get(k) || 0) + 1); }
  const [k, n] = [...urna].sort((a, b) => b[1] - a[1])[0];
  return { valor: JSON.parse(k), votos: n, total: valores.length, opcoes: urna.size };
};

export function colher(fichas = classificar()) {
  const porVaga = new Map();          // `${tipo}|${vaga}` -> [{municao, granadas, arma, arma2}]
  let lidos = 0, esquadroes = 0;
  for (const f of fichas) {
    if (!f.limpo) continue;
    let roster, caudas;
    try { roster = lerRoster(f.p); caudas = caudasDoRoster(f.p); } catch { continue; }
    lidos++;
    for (const u of roster.unidades) {
      // so esquadrao INTEIRO: com baixa, o jogo ja repartiu o paiol entre os que sobraram
      if (!u.soldados.length || !u.soldados.every((s) => s.estado === 0)) continue;
      esquadroes++;
      u.soldados.forEach((s, vaga) => {
        const d = caudas[s.indice];
        const c = d?.cauda;
        if (!c || c.length < 8) return;
        const municao = {};
        for (const m of paiolDe(c)?.pares || []) if (m.qtd > 0) municao[m.item] = m.qtd;
        const g = granadasDe(d);
        const chave = `${u.tipo}|${vaga}`;
        if (!porVaga.has(chave)) porVaga.set(chave, []);
        porVaga.get(chave).push({
          municao, granadas: g?.porTipo || {},
          arma: c[1] === 8 ? null : `${c[1]}/${c[2]}`, arma2: c[4] === 8 ? '8/0' : `${c[4]}/${c[5]}`,
        });
      });
    }
  }
  return { porVaga, lidos, esquadroes };
}

export function apurar({ porVaga }, { minimo = 2 } = {}) {
  const tipos = {};
  for (const [chave, obs] of porVaga) {
    if (obs.length < minimo) continue;
    const [tipo, vaga] = chave.split('|');
    const mun = moda(obs.map((o) => o.municao));
    const gr = moda(obs.map((o) => o.granadas));
    const arma = moda(obs.map((o) => o.arma));
    const arma2 = moda(obs.map((o) => o.arma2));
    tipos[tipo] = tipos[tipo] || {};
    tipos[tipo][vaga] = {
      municao: mun.valor, granadas: gr.valor,
      arma: arma.valor, arma2: arma2.valor,
      vistos: obs.length, acordo: Number((mun.votos / mun.total).toFixed(2)), acordoGranada: Number((gr.votos / gr.total).toFixed(2)),
    };
  }
  return tipos;
}

// A leitura, no formato que o refit usa: `{ tipo: { vaga: { municao, granadas, arma, arma2 } } }`.
export function issueTable(arquivo = TABELA) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  return bruto.tipos || {};
}

if (process.argv[1] && process.argv[1].endsWith('dotacao.mjs')) {
  const fichas = classificar();
  const limpos = fichas.filter((f) => f.limpo);
  console.log(`${fichas.length} saves: ${limpos.length} limpos, ${fichas.length - limpos.length} nao`);
  const porque = new Map();
  for (const f of fichas) porque.set(f.porque, (porque.get(f.porque) || 0) + 1);
  for (const [k, n] of porque) console.log(`   ${String(n).padStart(4)}  ${k}`);
  const c = colher(fichas);
  const tipos = apurar(c);
  const vagas = Object.values(tipos).reduce((a, v) => a + Object.keys(v).length, 0);
  console.log(`\n${c.lidos} saves limpos lidos, ${c.esquadroes} unidades inteiras; ${Object.keys(tipos).length} tipos, ${vagas} vagas`);
  const alvo = process.argv.find((a) => /^\d+$/.test(a));
  if (alvo && tipos[alvo]) {
    console.log(`\ntipo ${alvo}:`);
    let tm = 0, tg = 0;
    for (const [v, l] of Object.entries(tipos[alvo])) {
      const m = Object.entries(l.municao).map(([i, q]) => `${i}=${q}`).join(' ');
      const g = Object.values(l.granadas).reduce((a, b) => a + b, 0);
      tm += l.municao[1] || 0; tg += g;
      console.log(`   vaga ${v}  ${String(l.arma).padEnd(6)} + ${String(l.arma2).padEnd(6)}  ${m.padEnd(30)} granadas ${g}  (${l.vistos} obs, acordo ${l.acordo}/${l.acordoGranada})`);
    }
    console.log(`   TOTAL item 1: ${tm}   granadas: ${tg}`);
  }
  const duvidosas = Object.entries(tipos).flatMap(([t, vs]) => Object.entries(vs).filter(([, l]) => l.acordo < 0.5).map(([v, l]) => `${t}/${v} (${l.acordo})`));
  if (duvidosas.length) console.log(`\nvagas em que a moda tem menos de metade dos votos: ${duvidosas.length} — ${duvidosas.slice(0, 8).join(', ')}`);
  if (process.argv.includes('--gravar')) {
    fs.writeFileSync(TABELA, JSON.stringify({
      nota: 'A dotacao de FABRICA por vaga do TO&E, colhida so de saves que o app nunca tocou: partida rapida/cenario (sem batalha de campanha dentro) ou campanha ANTES do primeiro arquivo do app. So esquadrao inteiro vota, e a medida e a MODA — nao o maximo, que somava maximos de saves diferentes e inflava o esquadrao a cada batalha (E76/E80). Refazer com: node tools/re/dotacao.mjs --gravar',
      saves: c.lidos, unidades: c.esquadroes, tipos,
    }, null, 1) + '\n');
    console.log(`\n-> ${TABELA}`);
  }
}
