// A FORCA QUE MOSTRA OS PARES QUE FALTAM — a versao dirigida.
//
// `forca_armas.mjs` monta uma copia de cada TIPO nunca amostrado: serve para descobrir arma nova,
// e foi ela que rendeu a classe 5 inteira em 09/09. O problema de hoje e outro e mais estreito: os
// pares que sobraram JA aparecem em saves, so que sempre na forca da IA, onde o `=` nao cicla e nao
// ha painel para ler. Nao preciso de tipo novo; preciso dos MESMOS tipos do meu lado.
//
// Entao o caminho e ao contrario: dos saves sai quem carrega cada par pendente (tipo da unidade e
// vaga), a ponte de tipos (`tipos_ponte.json`) traduz o `u16 tipo` do roster para o par `[val, tab]`
// da biblioteca, e daqui sai a compra folha a folha — uma unidade por tipo, nada de formacao
// inteira. Resultado: batalha pequena, que carrega depressa e cabe no orcamento.
//
//   node tools/re/forca_pares.mjs RU               mostra a forca
//   node tools/re/forca_pares.mjs RU --gravar      escreve research/forca_pares_RU.json
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster, caudasDoRoster } from './roster.mjs';
import { DO_APP } from './toe_armas.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const R = JSON.parse(fs.readFileSync(path.join(RAIZ, 'app/data/rules.json'), 'utf8'));

// a escada (30/10): os creditos iniciais sao a razao do preset padrao x o primeiro degrau
const INICIAL = await (async () => { const C = await import(new URL('../../app/src/campaign.mjs', import.meta.url)); return C.startingCredits(C.rules()); })();
const C = await import(`file:///${RAIZ.replace(/\\/g, '/')}/app/src/catalog.mjs`);
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';

const NACAO = (process.argv[2] || 'RU').toUpperCase();
const nomes = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/armas.json'), 'utf8')).armas;
const ponte = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/tipos_ponte.json'), 'utf8')).ponte;

// ------------------------------------------------ 1. quem carrega o que, nos saves
const arquivos = [];
const anda = (dir) => {
  let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of itens) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) anda(p);
    else if (it.name.toLowerCase().endsWith('.bts') && !DO_APP.test(it.name)) arquivos.push(p);
  }
};
anda(SALVOS);

const pendente = (p) => p && !nomes[p] && /^[2345]\/\d+$/.test(p);
const porPar = new Map();      // par -> Map(tipo -> {vezes, nome})
for (const p of arquivos) {
  let r, c; try { r = lerRoster(p); c = caudasDoRoster(p); } catch { continue; }
  for (const u of r.unidades) {
    if (u.tipo == null) continue;
    for (const s of u.soldados) {
      const d = c[s.indice]; if (!d?.cauda || d.cauda.length < 6) continue;
      for (const arma of [`${d.cauda[1]}/${d.cauda[2]}`, `${d.cauda[4]}/${d.cauda[5]}`]) {
        if (!pendente(arma)) continue;
        if (!porPar.has(arma)) porPar.set(arma, new Map());
        const m = porPar.get(arma);
        m.set(u.tipo, { vezes: (m.get(u.tipo)?.vezes || 0) + 1, nome: ponte[u.tipo]?.nome || `tipo ${u.tipo}` });
      }
    }
  }
}

// So os pares que a ponte sabe levar a uma unidade DESTE exercito.
const daNacao = (tipo) => (ponte[tipo]?.nacao || null) === NACAO;
const alvos = [];
for (const [par, tipos] of [...porPar].sort()) {
  const bons = [...tipos].filter(([t]) => ponte[t] && daNacao(t)).sort((a, b) => b[1].vezes - a[1].vezes);
  alvos.push({ par, tipos: bons.map(([t, v]) => ({ tipo: Number(t), par: ponte[t].par, nome: v.nome, vezes: v.vezes })) });
}
console.log(`${NACAO}: ${alvos.length} pares sem nome nos saves`);
for (const a of alvos) {
  console.log(`  ${a.par.padEnd(6)} ${a.tipos.length ? a.tipos.slice(0, 3).map((t) => `${t.nome} (tipo ${t.tipo} = ${t.par}, ${t.vezes}x)`).join(' · ') : '— nenhum tipo desta nacao na ponte'}`);
}

// ------------------------------------------------ 2. onde comprar cada tipo, na biblioteca
const querPar = new Set();
for (const a of alvos) for (const t of a.tipos) querPar.add(t.par);

const candidatos = new Map();  // par [val,tab] -> [{file, key, price, nome, papel}]
for (const f of C.libraryForArmies([NACAO])) {
  let tree; try { tree = C.formationTree(f.file); } catch { continue; }
  const anda2 = (n) => {
    if (n.isFormation) { n.children.forEach(anda2); return; }
    const par = n.type.join(',');
    if (!querPar.has(par) || n.offMap) return;
    if (!candidatos.has(par)) candidatos.set(par, []);
    candidatos.get(par).push({ file: f.file, key: n.key, price: C.priceUnit(n, f.nation, R), nome: n.name, papel: C.roleOf(n.name, n.offMap, R) });
  };
  tree.roots.forEach(anda2);
}

// Um par pendente esta coberto quando QUALQUER um dos tipos que o carregam entra em campo.
const cobre = (a) => a.tipos.some((t) => candidatos.has(t.par));
const semCobertura = alvos.filter((a) => !cobre(a));
console.log(`\n${alvos.length - semCobertura.length} pares tem onde ser comprados${semCobertura.length ? `; FORA: ${semCobertura.map((a) => a.par).join(', ')}` : ''}`);

// Escolha gulosa por FONTE, como na forca_armas: menos arquivos, menos cabecalho arrastado.
const faltando = new Set(alvos.filter(cobre).map((a) => a.par));
const parDoAlvo = new Map();   // par [val,tab] -> [pares pendentes que ele resolve]
for (const a of alvos) for (const t of a.tipos) {
  if (!candidatos.has(t.par)) continue;
  if (!parDoAlvo.has(t.par)) parDoAlvo.set(t.par, new Set());
  parDoAlvo.get(t.par).add(a.par);
}

const escolha = new Map();     // file -> [candidato]
while (faltando.size) {
  let melhor = null;
  for (const [tipoPar, lista] of candidatos) {
    const ganho = [...(parDoAlvo.get(tipoPar) || [])].filter((p) => faltando.has(p)).length;
    if (!ganho) continue;
    const c = [...lista].sort((a, b) => a.price - b.price)[0];
    const bonus = escolha.has(c.file) ? 0.5 : 0;        // fonte ja escolhida sai de graca
    const nota = ganho + bonus;
    if (!melhor || nota > melhor.nota) melhor = { nota, ganho, c, tipoPar };
  }
  if (!melhor) break;
  if (!escolha.has(melhor.c.file)) escolha.set(melhor.c.file, []);
  escolha.get(melhor.c.file).push({ ...melhor.c, resolve: [...parDoAlvo.get(melhor.tipoPar)].filter((p) => faltando.has(p)) });
  for (const p of parDoAlvo.get(melhor.tipoPar)) faltando.delete(p);
}

const picks = [];
let unidades = 0, custo = 0;
for (const [file, lista] of escolha) {
  picks.push({ source: file, nation: NACAO, keep: lista.map((c) => c.key) });
  unidades += lista.length;
  custo += lista.reduce((a, c) => a + c.price, 0);
}
console.log(`\n${picks.length} fontes, ${unidades} unidades, ${custo} cr (orcamento ${INICIAL})`);
for (const [file, lista] of escolha) {
  console.log(`   ${file.replace(/\.btt$/, '')}`);
  for (const c of lista) console.log(`        ${String(c.price).padStart(4)} cr  ${c.nome.padEnd(42)} resolve ${c.resolve.join(', ')}`);
}
if (faltando.size) console.log(`\nficaram sem fonte: ${[...faltando].join(', ')}`);

if (process.argv.includes('--gravar')) {
  const saida = path.join(RAIZ, `research/forca_pares_${NACAO}.json`);
  fs.writeFileSync(saida, JSON.stringify({
    nota: `Forca dirigida aos pares classe/item que ainda nao tem nome no exercito ${NACAO}: dos saves sai quem os carrega, a ponte de tipos leva a biblioteca, e a compra e folha a folha. Pronta para POST /api/campaigns. Refazer com \`node tools/re/forca_pares.mjs ${NACAO} --gravar\`.`,
    nacao: NACAO, pares: alvos.map((a) => a.par), unidades, custo,
    corpo: { name: `ZZ PARES ${NACAO}`, armies: [NACAO], enemySide: NACAO === 'RU' ? 'US' : 'RU', enemyEffort: 0.5, rescueChance: 0, picks },
    detalhe: [...escolha.entries()].map(([file, lista]) => ({ file, unidades: lista.map((c) => ({ key: c.key, nome: c.nome, papel: c.papel, preco: c.price, resolve: c.resolve })) })),
    semCobertura: semCobertura.map((a) => a.par),
  }, null, 1) + '\n');
  console.log(`\n-> ${saida}`);
}
