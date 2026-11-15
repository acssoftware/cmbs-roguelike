// A DOTACAO DE GRANADA DE CADA VAGA, colhida dos saves que o JOGO escreveu.
//
// A granada nao esta no vetor de municao (FORMATO 113.7): cada uma e uma entrada de 3 bytes nas
// listas do rabo do soldado, com o tipo nos dois primeiros bytes. Ninguem repunha granada porque
// ninguem sabia que ela estava ali — o refil do app mexe no vetor.
//
// POR QUE POR VAGA E NAO POR ARMA. A municao segue a ARMA ("quem leva PKM leva 7,62x54R", E54). A
// granada nao: medido em 309 saves e 9.992 homens, a moda por arma da mao 1 explica 58% dos homens
// e a moda por (tipo da unidade, vaga) explica 73%. Faz sentido — granada e carga de PAPEL na
// esquadra, nao de arma. Entao a tabela e a mesma forma do `toe_armas.json`: tipo -> vaga.
//
// E O NUMERO E O PERCENTIL 90, nem a moda nem o maximo. Medido em 242 combinacoes (tipo, vaga, tipo
// de granada) com 10+ portadores: em 86% delas o maximo E a moda, e nas outras o maximo estoura a
// moda em 3x a 7x. Os dois extremos erram por motivos opostos e conhecidos:
//
//   - a MODA erra para baixo, porque metade dos saves e de tropa que ja lutou (o `9221|4` tem moda
//     2 e teto 10: a moda ali e desgaste, nao dotacao);
//   - o MAXIMO erra para cima, porque o jogo REDISTRIBUI granada de baixa — o `9221|0` tem moda 1,
//     p90 4 e maximo 7, e repor 7 daria ao fuzileiro o bolso de tres mortos.
//
// O p90 coincide com o maximo onde os dois concordam e apara o catador. Soma das dotacoes: moda 500,
// p90 549, maximo 595. Os zeros ficam fora da conta (quem nao leva aquele tipo nao vota), senao o
// desgaste do save pos-batalha derrubaria a dotacao de quem leva.
//
//   node tools/re/granadas.mjs [--gravar]     -> research/toe_granadas.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerRoster, caudasDoRoster, granadasDe } from './roster.mjs';
import { DO_APP } from './toe_armas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
export const TABELA = path.join(RAIZ, 'research/toe_granadas.json');

// Os tipos de verdade, medidos: `1,1` e `1,3` do lado americano, `1,2` e `1,4` do ucraniano/russo.
// O resto (`0,0`, `255,2`, `72,0`, `0,56`, `1,5`...) sao 18 entradas em 9.992 homens — cauda mal
// recortada, nao tipo de granada. Repor lixo seria escrever lixo, entao a colheita filtra.
export const TIPOS = new Set(['1,1', '1,2', '1,3', '1,4']);

export const p90 = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.9 * s.length))]; };

export function colher(pasta = SALVOS) {
  const arquivos = [];
  const anda = (dir) => {
    let itens; try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) anda(p);
      else if (it.name.toLowerCase().endsWith('.bts') && !DO_APP.test(it.name)) arquivos.push(p);
    }
  };
  anda(pasta);

  const obs = new Map();       // "tipo|vaga|granada" -> quantidades vistas (sem os zeros)
  const porUnidade = new Map(); // tipo -> total de granadas de cada unidade inteira vista
  let saves = 0, homens = 0;
  for (const p of arquivos) {
    let r, c; try { r = lerRoster(p); c = caudasDoRoster(p); } catch { continue; }
    saves++;
    for (const u of r.unidades) {
      if (u.tipo == null) continue;
      let total = 0, inteira = !!u.soldados.length;
      u.soldados.forEach((s, vaga) => {
        const d = c[s.indice];
        if (!d || !d.ok) { inteira = false; return; }
        const g = granadasDe(d); if (!g) { inteira = false; return; }
        homens++;
        total += g.total;
        for (const [t, n] of Object.entries(g.porTipo)) {
          if (!TIPOS.has(t) || !n) continue;
          const k = `${u.tipo}|${vaga}|${t}`;
          if (!obs.has(k)) obs.set(k, []);
          obs.get(k).push(n);
        }
      });
      if (inteira) {
        if (!porUnidade.has(u.tipo)) porUnidade.set(u.tipo, []);
        porUnidade.get(u.tipo).push(total);
      }
    }
  }

  // O TETO DA UNIDADE. Somar o p90 de cada vaga da o total da unidade MAIS BEM EQUIPADA que ja
  // apareceu — medido: no tipo 9221 a soma das vagas da 40 e o maximo observado numa unidade e 40,
  // enquanto a unidade tipica traz 15 e a bem suprida 20. Dar 40 nao e repor, e premiar. Entao a
  // forma vem das vagas e a QUANTIDADE vem daqui: o p90 do total observado por unidade inteira.
  const teto = {};
  for (const [tipo, v] of porUnidade) if (v.length) teto[tipo] = p90(v);

  const tabela = {};
  for (const [k, v] of obs) {
    const [tipo, vaga, t] = k.split('|');
    tabela[tipo] = tabela[tipo] || {};
    tabela[tipo][vaga] = tabela[tipo][vaga] || {};
    // Com poucos portadores o percentil nao quer dizer nada, e ai o maximo e a melhor aposta: e o
    // unico numero que ao menos alguem levou de fato.
    tabela[tipo][vaga][t] = v.length >= 10 ? p90(v) : Math.max(...v);
  }
  return { saves, homens, tabela, teto };
}

// O ALVO de um homem: o que a vaga dele leva cheia. Sem linha na tabela, ninguem repoe nada — chute
// aqui viraria granada inventada no bolso de quem nunca teve.
export function alvoDe(tabela, tipo, vaga) {
  const t = tabela?.[tipo]?.[vaga];
  return t && Object.keys(t).length ? { ...t } : null;
}

// O PLANO DE UMA UNIDADE: a forma vem das vagas, a quantidade respeita o teto do tipo.
//
// `homens` = [{ indice, vaga, atual: { '1,2': 3 } }] na ordem do roster. Devolve
// `{ [indice]: { '1,2': alvo } }` so para quem muda, ja com o teto aplicado: enche vaga por vaga, na
// ordem, e para quando o total da unidade chega no teto.
//
// `aparar` (E78) e a regra do autor — "nao devemos carregar munição e armas obtidas da batalha de um
// mapa para outro" — do outro lado: quem esta ACIMA da dotacao volta a ela. So dos tipos de granada
// que a dotacao da vaga CONHECE: a tabela e o p90 de 296 saves e pode nao listar um tipo raro, e
// zerar o que ela nao conhece tiraria do homem uma granada que talvez seja dele de fabrica. Os dez
// homens acima da dotacao no save dele eram todos de tipo conhecido (`1,2` e `1,4`).
// `exatos` (E81): os tipos cuja dotacao veio da tabela de FABRICA (`dotacao.json`), medida em save
// que o app nunca tocou. Para esses, o tipo de granada que a vaga NAO lista vale zero — a fabrica
// nao da nenhum, entao o que o homem tem foi catado. Para os tipos que so a colheita antiga conhece
// (p90 de 296 saves, que pode nao listar um tipo raro) a regra continua conservadora: so se apara o
// que a dotacao conhece, porque zerar o desconhecido tiraria do homem o que talvez seja dele.
export function planoDaUnidade({ tabela, teto, exatos }, tipo, homens, { aparar = false } = {}) {
  const exato = aparar && !!exatos && (exatos.has ? exatos.has(String(tipo)) : (exatos[tipo] !== undefined));
  // O TETO SO EXISTE PARA QUEM SO ENCHE. Ele guarda contra a soma das vagas (p90 + p90 + …) dar um
  // esquadrao impossivel. Com o aparo ligado o alvo de cada vaga e exato e a soma deles JA e o teto
  // — e manter o antigo faz o contrario do que ele promete: o esquadrao que voltou da batalha com
  // mais granadas do que cabe ja comeca acima do limite, nada e reposto, so aparado, e ele entra na
  // batalha seguinte com CINCO onde a fabrica da quinze.
  const limite = aparar ? Infinity : (teto?.[tipo] ?? teto?.[String(tipo)] ?? Infinity);
  let total = homens.reduce((s, h) => s + Object.values(h.atual || {}).reduce((a, b) => a + b, 0), 0);
  const plano = {};
  for (const h of homens) {
    const alvo = alvoDe(tabela, tipo, h.vaga);
    if (!alvo) continue;
    const dele = {};
    for (const [t, n] of Object.entries(alvo)) {
      const tem = h.atual?.[t] || 0;
      let falta = n - tem;
      if (falta < 0) { if (aparar) dele[t] = n; continue; }
      if (falta === 0) continue;
      if (total + falta > limite) falta = Math.max(0, limite - total);
      if (!falta) continue;
      total += falta;
      dele[t] = tem + falta;
    }
    // o tipo que a vaga nao lista: com dotacao de fabrica, vale zero
    if (exato) for (const t of Object.keys(h.atual || {})) if (!(t in alvo) && h.atual[t] > 0) dele[t] = 0;
    if (Object.keys(dele).length) plano[h.indice] = dele;
  }
  return plano;
}

const ehMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehMain) {
  const { saves, homens, tabela, teto } = colher();
  const tipos = Object.keys(tabela).length;
  const vagas = Object.values(tabela).reduce((a, x) => a + Object.keys(x).length, 0);
  console.log(`${saves} saves, ${homens} homens, ${tipos} tipos de unidade, ${vagas} vagas com dotacao, ${Object.keys(teto).length} tipos com teto`);

  const exemplo = Object.entries(tabela).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length).slice(0, 6);
  for (const [tipo, vagasDoTipo] of exemplo) {
    const linha = Object.entries(vagasDoTipo).map(([v, t]) => `${v}:${Object.entries(t).map(([k, n]) => `${k}x${n}`).join('+') || '-'}`).join('  ');
    console.log(`  tipo ${tipo.padStart(6)}  ${linha}`);
  }

  if (process.argv.includes('--gravar')) {
    fs.writeFileSync(TABELA, JSON.stringify({
      nota: 'A dotacao de granada por (tipo da unidade, vaga), colhida dos saves que o JOGO escreveu: o MAXIMO visto em cada vaga, por tipo de granada (FORMATO 113.7). A granada nao esta no vetor de municao — e uma entrada de 3 bytes nas listas do rabo — e por isso o refil nunca a repunha. Refazer com `node tools/re/granadas.mjs --gravar`.',
      saves, homens, teto, tabela,
    }, null, 1) + '\n');
    console.log(`\ngravado ${TABELA}`);
  }
}
