// A PONTE ENTRE OS DOIS CATALOGOS DE TIPO.
//
// O jogo identifica o tipo de uma unidade de dois jeitos, e eles NAO sao o mesmo numero:
//
//   na biblioteca (.btt)   o par `(+17, +18)` — `type: [val, tab]` na arvore que o app le
//   no roster da campanha  um `u16 tipo` (secao 111), que e o que a colheita de armas indexa
//
// Enquanto ninguem precisou juntar os dois, tudo bem. Mas para planejar quais formacoes comprar
// para VER uma arma que falta e preciso dizer "esta formacao contem o tipo 2054, que nunca foi
// amostrado" — e do lado da biblioteca so existe `[6,8]`. Juntar por NOME nao serve: ha 26
// `Headquarters Team` diferentes.
//
// A ponte sai das campanhas do proprio autor, sem tocar no jogo. O estado da campanha guarda, por
// unidade, `coreId` E o par da biblioteca; o roster de um save da mesma campanha guarda, pelo mesmo
// `coreId`, o `tipo` do jogo. O coreId e a dobradica.
//
// A prova de que o casamento e o certo nao e o numero de coincidencias: e a CONSISTENCIA. Um par de
// (save, campanha) errado casa coreIds por acaso e produz um mesmo `tipo` apontando para pares
// diferentes. So entra no arquivo o que for unanime.
//
//   node tools/re/tipos_ponte.mjs            mostra o que sairia
//   node tools/re/tipos_ponte.mjs --gravar   escreve research/tipos_ponte.json
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster } from './roster.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const CAMPANHAS = path.join(RAIZ, 'app/campaigns');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
const SAIDA = path.join(RAIZ, 'research/tipos_ponte.json');

function saves() {
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

const campanhas = [];
for (const d of fs.readdirSync(CAMPANHAS)) {
  const p = path.join(CAMPANHAS, d, 'state.json');
  if (!fs.existsSync(p)) continue;
  let s; try { s = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  const porCore = new Map();
  for (const u of s.units || []) if (u.coreId !== null && u.coreId !== undefined && u.type) porCore.set(u.coreId, { par: u.type.join(','), nome: u.name, nacao: u.nation });
  if (porCore.size) campanhas.push({ slug: d, nome: s.name, porCore });
}
console.log(`${campanhas.length} campanhas com coreId e par da biblioteca`);

// Cada (save, campanha) propoe um conjunto de casamentos, e o perigo e casar com a campanha errada:
// os coreId comecam em 1 e sao densos, entao uma campanha de 38 unidades e SUBCONJUNTO de qualquer
// roster maior e casa 100% por acaso. Foi o que aconteceu na primeira tentativa — 152 pares, e um
// mesmo tipo apontando para nove pares diferentes.
//
// A exigencia certa e igualdade de CONJUNTO nos dois sentidos: o roster tem exatamente os coreId da
// campanha, nem um a mais nem um a menos. Um subconjunto nao passa.
const propostas = [];
for (const f of saves()) {
  let roster; try { roster = lerRoster(f); } catch { continue; }
  const doRoster = roster.unidades.filter((u) => u.coreId !== undefined && u.tipo !== undefined);
  if (doRoster.length < 20) continue;
  const meus = new Set(doRoster.map((u) => u.coreId));
  for (const c of campanhas) {
    if (meus.size !== c.porCore.size) continue;
    if ([...meus].some((k) => !c.porCore.has(k))) continue;
    propostas.push({ save: path.basename(f), campanha: c.slug, n: doRoster.length,
      pares: doRoster.map((u) => ({ tipo: u.tipo, ...c.porCore.get(u.coreId) })) });
  }
}
console.log(`${propostas.length} pares (save, campanha) com o MESMO conjunto de coreId`);
for (const p of [...propostas].sort((a, b) => b.n - a.n).slice(0, 6)) {
  console.log(`   ${p.campanha} <- ${p.save} (${p.n} unidades)`);
}

// A tabela, com voto: `tipo -> par`. Um tipo que receber dois pares diferentes e descartado inteiro,
// porque um deles esta errado e nao ha como saber qual.
const votos = new Map();
for (const p of propostas) {
  for (const x of p.pares) {
    if (!votos.has(x.tipo)) votos.set(x.tipo, new Map());
    const urna = votos.get(x.tipo);
    urna.set(x.par, (urna.get(x.par) || 0) + 1);
  }
}
const tabela = {};
const brigados = [];
for (const [tipo, urna] of votos) {
  if (urna.size === 1) {
    const [par, n] = [...urna][0];
    const exemplo = propostas.flatMap((p) => p.pares).find((x) => x.tipo === tipo);
    // O ` #1` e rotulo de tela que o `directoryFrom` cola no nome; no catalogo ele so atrapalha.
    tabela[tipo] = { par, nome: String(exemplo.nome).replace(/\s+#\d+$/, ''), nacao: exemplo.nacao, votos: n };
  } else brigados.push({ tipo, opcoes: [...urna.entries()] });
}
console.log(`\n${Object.keys(tabela).length} tipos do roster amarrados ao par da biblioteca, sem discordancia`);
if (brigados.length) {
  console.log(`${brigados.length} descartados por discordancia:`);
  for (const b of brigados.slice(0, 6)) console.log(`   tipo ${b.tipo}: ${b.opcoes.map(([p, n]) => `${p} (${n})`).join(' vs ')}`);
}

console.log('\nos dez primeiros:');
for (const [tipo, v] of Object.entries(tabela).slice(0, 10)) {
  console.log(`   ${String(tipo).padStart(6)} = [${v.par}]  ${v.nacao || '?'} ${v.nome}`);
}

if (process.argv.includes('--gravar')) {
  fs.writeFileSync(SAIDA, JSON.stringify({
    nota: 'Ponte entre o `u16 tipo` do roster de campanha (secao 111, que a colheita de armas indexa) e o par `[val, tab]` da biblioteca (+17/+18). Sai do coreId, que os dois lados carregam: o estado da campanha tem coreId -> par, o roster de um save da mesma campanha tem coreId -> tipo. So entra o que nao teve discordancia entre todos os saves. Refazer com `node tools/re/tipos_ponte.mjs --gravar`.',
    tipos: Object.keys(tabela).length,
    fontes: propostas.map((p) => `${p.campanha} <- ${p.save}`),
    ponte: tabela,
  }, null, 1) + '\n');
  console.log(`\n-> ${SAIDA}`);
}
