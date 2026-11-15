// A LISTA DE LEITURA: que save abrir, que unidade selecionar e que homem apontar.
//
// `research/armas.json` diz o que ja tem nome e o que falta. O que falta so vira nome de uma
// maneira: abrir um save onde aquele par `classe/item` esta na mao de alguem, selecionar a unidade
// dele e passar o mouse no icone do homem para o jogo escrever o rotulo vermelho.
//
// Este script faz a ponte entre as duas coisas. Para cada save da maquina, ele procura os pares
// pendentes e imprime a unidade inteira — porque O CASAMENTO NAO E POR POSICAO (jogo.ps1/COMO.md):
// o painel divide esquadra em times A/B e o roster nao, entao o que fecha a conta e o CONJUNTO. Com
// o multiconjunto do roster ao lado do multiconjunto de rotulos da tela, o par desconhecido e o que
// sobra depois de tirar as armas que todo mundo tem.
//
// O sobrenome vai junto por um motivo pratico: e a unica coisa que aparece nas duas telas e permite
// confirmar que a unidade selecionada no jogo e mesmo a unidade lida no roster.
//
//   node tools/re/armas_alvos.mjs                     todos os saves, agrupado por save
//   node tools/re/armas_alvos.mjs "<save.bts>"        so um save
//   node tools/re/armas_alvos.mjs --por-par           agrupado por par pendente (onde achar cada um)
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster, caudasDoRoster } from './roster.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
const DO_APP = /\[B\d+|\(rebuilt|\(curado|\(rearmado|\(antes do conserto/i;

function candidatos() {
  const out = [];
  const anda = (dir) => {
    let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) anda(p);
      else if (it.name.toLowerCase().endsWith('.bts') && !DO_APP.test(it.name)) out.push(p);
    }
  };
  anda(SALVOS);
  return out;
}

const armas = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/armas.json'), 'utf8'));
const nomeado = new Set(Object.keys(armas.armas || {}));
const pend = new Set(Object.keys(armas.pendentes || {}).filter((k) => /^\d+\/\d+$/.test(k)));
// Classe 8 e homem saqueado, sem arma: nao e par pendente, e ausencia de par.
const conta = (p) => p && p.classe !== 8;
const chaveDe = (p) => `${p.classe}/${p.item}`;

// E ITEM 0 NAO E ARMA, E LEITURA FORA DE FASE. `errado.bts` e `MVSC - TRANSITION BTT2.bts` sao
// saves que o app escreveu com as caudas emendadas (E29): neles TODO homem sai `0/0` e o ultimo de
// cada unidade sai `5/0`, `6/0`, `9/0` — o recorte pegou o proximo cabecalho, nao o inventario.
// Uma unidade em que mais da metade dos homens da item 0 nao tem nada a dizer sobre arma.
const forageiro = (homens) => homens.filter((h) => h.arma && h.arma.item === 0).length * 2 > homens.length;

const ponte = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/tipos_ponte.json'), 'utf8')).ponte;
const nomeDoTipo = (t) => (ponte[t] ? ponte[t].nome : `tipo ${t}`);

const alvo = process.argv.find((a) => a.toLowerCase().endsWith('.bts'));
const POR_PAR = process.argv.includes('--por-par');
const arquivos = alvo ? [alvo] : candidatos();

const porPar = new Map();
let comAlvo = 0;
for (const f of arquivos) {
  let roster, caudas;
  try { roster = lerRoster(f); caudas = caudasDoRoster(f); } catch { continue; }
  const linhas = [];
  roster.unidades.forEach((u, iu) => {
    const homens = u.soldados.map((s, vaga) => ({ vaga, nome: s.nome, arma: caudas[s.indice]?.arma }));
    if (forageiro(homens)) return;
    const faltando = homens.filter((h) => conta(h.arma) && !nomeado.has(chaveDe(h.arma)));
    if (!faltando.length) return;
    const conjunto = homens.map((h) => (h.arma ? chaveDe(h.arma) : '-')).join(' ');
    linhas.push({ iu, u, homens, faltando, conjunto });
    for (const h of faltando) {
      const k = chaveDe(h.arma);
      if (!porPar.has(k)) porPar.set(k, []);
      porPar.get(k).push({ save: path.basename(f), coreId: u.coreId, tipo: u.tipo, vaga: h.vaga, n: u.soldados.length, nome: h.nome, conjunto });
    }
  });
  if (!linhas.length) continue;
  comAlvo++;
  if (POR_PAR) continue;
  console.log(`\n${path.basename(f)}`);
  for (const l of linhas) {
    const marca = l.faltando.map((h) => `${chaveDe(h.arma)} (homem ${h.vaga + 1}/${l.u.soldados.length} ${h.nome})`).join(', ');
    console.log(`   core ${String(l.u.coreId).padStart(4)}  ${nomeDoTipo(l.u.tipo).slice(0, 40).padEnd(41)}${marca}`);
    console.log(`             conjunto: ${l.conjunto}`);
  }
}

if (POR_PAR) {
  const chaves = [...porPar.keys()].sort((a, b) => {
    const [ca, ia] = a.split('/').map(Number); const [cb, ib] = b.split('/').map(Number);
    return ca - cb || ia - ib;
  });
  for (const k of chaves) {
    const onde = porPar.get(k);
    const cand = (armas.pendentes || {})[k];
    console.log(`\n${k}${pend.has(k) ? '  (tem candidato)' : ''}${cand ? `  ${cand.candidatos.join(' | ')}` : ''}`);
    const vistos = new Set();
    for (const o of onde) {
      const id = `${o.save}|${o.coreId}`;
      if (vistos.has(id)) continue;
      vistos.add(id);
      console.log(`   ${o.save.padEnd(28)} core ${String(o.coreId).padStart(4)}  ${nomeDoTipo(o.tipo).slice(0, 34).padEnd(35)}homem ${o.vaga + 1}/${o.n} ${o.nome}`);
      console.log(`   ${' '.repeat(28)} conjunto: ${o.conjunto}`);
    }
  }
}

console.log(`\n${arquivos.length} saves lidos, ${comAlvo} com par pendente; ${porPar.size} pares distintos sem nome`);
