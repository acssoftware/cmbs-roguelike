// A DOTACAO DE FABRICA POR EXERCITO (plano de reset de equipamento, 28/09).
//
// O refit de hoje sai de tabelas indexadas so pelo `u16 tipo` do roster e colhidas com "o maior ja
// visto": o cartucho de Javelin que o app deu a dois engenheiros russos da RUS1 era SAQUE — em
// 06/09 engenheiros russos pegaram Javelins de americanos mortos numa campanha mista, o jogo gravou
// isso na virada, e a colheita tomou como dotacao. Duas medidas corrigem:
//
//   1. A MODA por vaga, so de esquadrao inteiro (a regra do `dotacao.mjs`, E80): saque e minoria.
//   2. A CHAVE COM EXERCITO: `exercito|tipo`. O save nao diz o exercito no roster, mas a batalha
//      embutida diz — cada registro tem o byte +14 e a cauda core com o id (medido: 147/147 na RUS1,
//      919/919 na EASY2, 238/238 numa campanha de tres exercitos).
//
// E a fonte ideal: as campanhas de colheita "ZZ FAB", batalha 1 terminada em cessar-fogo no turno 0.
// Sem tiro nao ha saque nem gasto — todo homem esta como a fabrica o entregou, e todo veiculo com a
// lista cheia. Elas entram sempre; os outros saves, so se limpos pela regra do E80.
//
//   node tools/re/fabrica.mjs               relatorio de cobertura
//   node tools/re/fabrica.mjs --gravar      escreve research/fabrica.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lerRoster, caudasDoRoster, paiolDe, granadasDe } from './roster.mjs';
import { anatomiaDoSave } from './cam.mjs';
import { abrirCompleto } from './anexar2.mjs';
import { fimDoConteudo } from './core.mjs';
import { blocosDoSave, lerRabo, lerLancadores } from './toe_veiculos.mjs';
import { arvore } from './extras.mjs';
import { classificar } from './dotacao.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
export const TABELA = path.join(RAIZ, 'research/fabrica.json');
const EXERCITO = { 1: 'US', 2: 'RU', 3: 'UKR' };
export const DE_COLHEITA = /^ZZ FAB /i;

// coreId -> { exercito, nome, val, tab }, pela batalha embutida no save.
export function fichasDoSave(save) {
  const an = anatomiaDoSave(save);
  const b = fs.readFileSync(save);
  const out = new Map();
  an.batalhas.forEach((bat, k) => {
    const tmp = path.join(os.tmpdir(), `fab-${process.pid}-${k}.btt`);
    fs.writeFileSync(tmp, b.subarray(bat.ini, bat.ini + bat.tam));
    try {
      const X = abrirCompleto(tmp); const c = X.completo;
      // A FORMACAO-MAE de cada registro (01/10): o mesmo "Truck (Ural-4320)" leva carga diferente
      // conforme a formacao — 82mm no pelotao de morteiros 2B14, 120mm na bateria de 2B11 —, e a tabela
      // por nome cortava a do morteiro.
      const mae = new Map();
      try {
        const anda = (no, pai) => { if (!no.r.form) { mae.set(no.r.c, pai); return; } no.filhos.forEach((f) => anda(f, String(no.r.nm || '').replace(/ #\d+$/, ''))); };
        arvore(X).topos.forEach((t) => anda(t, null));
      } catch { /* sem arvore, sem formacao: a tabela fica por nome */ }
      X.R.forEach((r, i) => {
        if (r.form) return;
        let e; try { e = fimDoConteudo(c, r, X.R[i + 1] ? X.R[i + 1].c : c.length); } catch { return; }
        if (!e?.core) return;
        const id = c.readUInt32LE(e.fim), ex = EXERCITO[c[r.c + 14] >> 4];
        if (ex && !out.has(id)) out.set(id, { exercito: ex, nome: String(r.nm || '').replace(/ #\d+$/, ''), val: r.val, tab: r.tab, formacao: mae.get(r.c) || null });
      });
    } catch { /* batalha ilegivel: as unidades dela ficam sem ficha */ }
    fs.rmSync(tmp, { force: true });
  });
  return out;
}

const moda = (valores) => {
  const urna = new Map();
  for (const v of valores) { const k = JSON.stringify(v); urna.set(k, (urna.get(k) || 0) + 1); }
  const [k, n] = [...urna].sort((a, b) => b[1] - a[1])[0];
  return { valor: JSON.parse(k), votos: n, total: valores.length };
};

// As viradas das campanhas de colheita moram no projeto (`research/colheita_fab/`, fora do git: ~9 MB
// de save) e nao em Saved Games, para a tabela poder ser refeita depois que o jogo for limpo. Uma copia
// que ainda esteja em Saved Games nao conta duas vezes.
export const COLHEITA_DIR = path.join(RAIZ, 'research/colheita_fab');
export function fontes() {
  const lista = classificar().filter((f) => f.limpo || DE_COLHEITA.test(f.nome));
  let guardadas = [];
  try { guardadas = fs.readdirSync(COLHEITA_DIR).filter((n) => DE_COLHEITA.test(n) && n.toLowerCase().endsWith('.bts')); } catch { /* sem pasta */ }
  for (const n of guardadas) if (!lista.some((f) => f.nome === n)) lista.push({ p: path.join(COLHEITA_DIR, n), nome: n, limpo: true, porque: 'colheita guardada no projeto' });
  return lista;
}

export function colher(lista = fontes()) {
  const homens = new Map(), veiculos = new Map();
  let lidos = 0, esquadroes = 0, semFicha = 0;
  for (const f of lista) {
    let roster, caudas, fichas, blocos;
    try { roster = lerRoster(f.p); caudas = caudasDoRoster(f.p); fichas = fichasDoSave(f.p); blocos = blocosDoSave(f.p); } catch { continue; }
    lidos++;
    const colheita = DE_COLHEITA.test(f.nome);
    for (const u of roster.unidades) {
      const fi = fichas.get(u.coreId);
      if (!fi) { semFicha++; continue; }
      // os homens: so esquadrao INTEIRO ensina
      if (u.soldados.length && u.soldados.every((s) => s.estado === 0)) {
        esquadroes++;
        u.soldados.forEach((s, vaga) => {
          const d = caudas[s.indice]; const c = d?.cauda;
          if (!c || c.length < 8) return;
          const municao = {};
          for (const m of paiolDe(c)?.pares || []) if (m.qtd > 0) municao[m.item] = m.qtd;
          const k = `${fi.exercito}|${u.tipo}|${vaga}`;
          if (!homens.has(k)) homens.set(k, { nome: fi.nome, val: fi.val, tab: fi.tab, obs: [] });
          homens.get(k).obs.push({
            // so a leitura deterministica (01/10): a de reserva lia a lista de LANCADORES do veiculo, que
            // vem logo depois do ultimo tripulante, como granadas dele (o `4,16 x3` do Tigr)
            municao, granadas: (d?.cabecaCerta ? granadasDe(d)?.porTipo : null) || {},
            // O EQUIPAMENTO DO HOMEM (FORMATO 130): Night Vision (+8 0x80), cargas de demolicao (+8 0x08 = 2,
            // 0x10 = 4), Laser Designator (+7 0x08), Binoculars (+7 0x80, o lider)
            equip: { nv: !!(c[8] & 0x80), demo: ((c[8] & 0x08) ? 2 : 0) + ((c[8] & 0x10) ? 4 : 0), laser: !!(c[7] & 0x08), binoculo: !!(c[7] & 0x80) },
            // A CHEFIA (08/11): os dois bits de lider de +7 inteiros (0xc0 chefe da unidade, 0x40 lider de time, 0x80
            // binoculo sem o 0x40), para o reset devolver a chefia a vaga de fabrica quando o jogo a passou a outro
            // homem. Fora do `equip` para nao mexer na moda dele; so a colheita conta (num save limpo de campanha a
            // chefia ja pode ter andado).
            lider: c[7] & 0xc0,
            maos: [c[1] === 8 ? '8/0' : `${c[1]}/${c[2]}`, c[4] === 8 ? '8/0' : `${c[4]}/${c[5]}`].sort(),
            // a ordem conta para escrever: a arma em uso vem na mao 1 (113.5); o par ordenado e para comparar
            mao1: c[1] === 8 ? '8/0' : `${c[1]}/${c[2]}`,
            colheita,
          });
        });
      }
      // o veiculo: a lista inteira, so de colheita (fora dela o paiol ja foi gasto)
      if (!colheita) continue;
      const b = blocos.unidades.find((x) => x.coreId === u.coreId);
      if (!b) continue;
      let r; try { r = lerRabo(blocos.exp, b, null, true); } catch { continue; }
      // A PECA FORA DO MAPA (30/09): o registro sem tripulacao (46-54 B) le na forma `canhao` — HE, municao
      // especial e FUMACA do 2S3M1, do 2S19, do 2B11. Sem ele a fumaca gasta numa batalha nunca voltava. So
      // bloco pequeno: veiculo com a tripulacao fora do bloco tambem cai em `canhao`, e la a leitura e lixo.
      const v = (r || []).find((x) => x.forma === 'veiculo') || (b.bytes.length < 80 ? (r || []).find((x) => x.forma === 'canhao' && x.paiol?.length) : null);
      if (!v) continue;
      // PAIOL E CARGA SEPARADOS: o reabastecimento escreve so nos campos do paiol (`acharPaiol`), e a
      // carga (o que a maquina leva para a infantaria) e outra lista, com o mesmo item as vezes.
      const paiol = {}, carga = {};
      for (const x of v.paiol || []) paiol[x.item] = (paiol[x.item] || 0) + x.qtd;
      for (const x of v.carga || []) carga[x.item] = (carga[x.item] || 0) + x.qtd;
      // na colheita nada foi gasto: lista vazia e bloco sem paiol (infantaria, equipe), nao maquina
      if (!Object.keys(paiol).length && !Object.keys(carga).length) continue;
      const k = `${fi.exercito}|${fi.nome}`;
      if (!veiculos.has(k)) veiculos.set(k, []);
      // a ORDEM da carga conta para inserir (o jogo nao ordena: Bradley 2,4,497,517,14,57)
      // OS LANCADORES que ele leva para a infantaria (02/10, FORMATO 131), na ordem em que estao
      const lanc = lerLancadores(blocos.exp, b, v);
      veiculos.get(k).push({ paiol, carga, cargaOrdem: (v.carga || []).map((x) => x.item), paiolOrdem: (v.paiol || []).map((x) => x.item), formacao: fi.formacao || null, lancadores: lanc ? lanc.itens : null, terceira: lanc ? Object.fromEntries(lanc.terceira.map((x) => [x.item, x.qtd])) : null });
    }
  }
  return { homens, veiculos, lidos, esquadroes, semFicha };
}

export function apurar({ homens, veiculos }, { minimo = 2 } = {}) {
  const tipos = {}, maquinas = {};
  for (const [k, g] of homens) {
    // Da colheita, uma observacao ja basta: e a fabrica, sem gasto. Fora dela, a moda pede duas.
    const obs = g.obs.some((o) => o.colheita) ? g.obs.filter((o) => o.colheita) : g.obs;
    if (obs.length < (g.obs.some((o) => o.colheita) ? 1 : minimo)) continue;
    const [ex, tipo, vaga] = k.split('|');
    const chave = `${ex}|${tipo}`;
    tipos[chave] = tipos[chave] || { exercito: ex, tipo: Number(tipo), nome: g.nome, val: g.val, tab: g.tab, vagas: {} };
    const mun = moda(obs.map((o) => o.municao));
    // AS VARIANTES DA VAGA (28/09). A fabrica NAO entrega sempre o mesmo par: sorteia RPG-22 ou RPG-26
    // (`4/15` x `4/16`, 25 a 22 no UKR 9221 vaga 1) e o fuzil da tripulacao, e em alguns esquadroes os
    // homens vem uma posicao adiante (a minoria da vaga 1 e a maioria da vaga 0). Cada par de maos
    // visto na vaga e uma variante legitima, com a municao e as granadas que vieram COM ele — o
    // reset aceita o par do homem se for uma delas, e so volta a moda quando nao e.
    const porPar = new Map();
    for (const o of obs) { const p = o.maos.join(' + '); if (!porPar.has(p)) porPar.set(p, []); porPar.get(p).push(o); }
    // a chefia so pela colheita; sem colheita na variante, pelo binoculo (0x80) que o equip ja guarda
    const liderDe = (os) => { const col = os.filter((o) => o.colheita && Number.isInteger(o.lider)); return col.length ? moda(col.map((o) => o.lider)).valor : (moda(os.map((o) => o.equip || {})).valor?.binoculo ? 0x80 : 0); };
    const variantes = [...porPar.values()].sort((a, b) => b.length - a.length).map((os) => ({
      maos: os[0].maos, mao1: moda(os.map((o) => o.mao1)).valor, municao: moda(os.map((o) => o.municao)).valor,
      granadas: moda(os.map((o) => o.granadas)).valor, equip: moda(os.map((o) => o.equip || {})).valor, lider: liderDe(os), vistos: os.length,
    }));
    tipos[chave].vagas[vaga] = {
      maos: variantes[0].maos, mao1: variantes[0].mao1, municao: variantes[0].municao, granadas: variantes[0].granadas, equip: variantes[0].equip, lider: variantes[0].lider,
      vistos: obs.length, acordo: Number((mun.votos / mun.total).toFixed(2)), fonte: obs[0].colheita ? 'colheita' : 'saves limpos',
      variantes,
    };
  }
  for (const [k, obs] of veiculos) {
    const [ex, ...nome] = k.split('|');
    const comT = obs.filter((o) => o.terceira);
    maquinas[k] = { exercito: ex, nome: nome.join('|'), ...(comT.length ? { terceira: moda(comT.map((o) => o.terceira)).valor } : {}), paiol: moda(obs.map((o) => o.paiol)).valor, carga: moda(obs.map((o) => o.carga)).valor, paiolOrdem: moda(obs.map((o) => o.paiolOrdem)).valor, cargaOrdem: moda(obs.map((o) => o.cargaOrdem)).valor, vistos: obs.length };
    // OS LANCADORES: a moda e as VARIANTES vistas (o BTR-4E sai 4x RPG-22 ou 3x RPG-22 + RPG-26), no
    // geral e por formacao — a lista e por formacao como a carga (o Stryker do pelotao leva o Javelin).
    const comL = obs.filter((o) => Array.isArray(o.lancadores));
    if (comL.length) {
      const resumo = (os) => {
        const vs = new Map();
        for (const o of os) { const s = [...o.lancadores].sort(); const key = s.join(','); vs.set(key, { itens: o.lancadores, vistos: (vs.get(key)?.vistos || 0) + 1 }); }
        const lista = [...vs.values()].sort((a, b) => b.vistos - a.vistos);
        return { itens: lista[0].itens, variantes: lista.map((x) => x.itens), vistos: os.length };
      };
      maquinas[k].lancadores = resumo(comL);
      const lporF = new Map();
      for (const o of comL) { if (!o.formacao) continue; if (!lporF.has(o.formacao)) lporF.set(o.formacao, []); lporF.get(o.formacao).push(o); }
      const lDistintas = new Set([...lporF.values()].map((os) => resumo(os).itens.slice().sort().join(',')));
      if (lDistintas.size > 1) maquinas[k].lancadores.porFormacao = Object.fromEntries([...lporF].map(([f, os]) => [f, resumo(os)]));
    }
    // POR FORMACAO, quando a carga muda com ela: cada formacao-mae com a moda das suas observacoes.
    const porF = new Map();
    for (const o of obs) { if (!o.formacao) continue; if (!porF.has(o.formacao)) porF.set(o.formacao, []); porF.get(o.formacao).push(o); }
    const distintas = new Set([...porF.values()].map((os) => JSON.stringify(moda(os.map((o) => o.carga)).valor)));
    if (distintas.size > 1) {
      maquinas[k].porFormacao = Object.fromEntries([...porF].map(([f, os]) => [f, { carga: moda(os.map((o) => o.carga)).valor, cargaOrdem: moda(os.map((o) => o.cargaOrdem)).valor, vistos: os.length }]));
    }
  }
  return { tipos, maquinas };
}

export function lerFabrica(arquivo = TABELA) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return { tipos: {}, maquinas: {} }; }
}

const EH_MAIN = process.argv[1] && /[\\/]fabrica\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const lista = fontes();
  const col = colher(lista);
  const r = apurar(col);
  const porEx = {};
  for (const t of Object.values(r.tipos)) porEx[t.exercito] = (porEx[t.exercito] || 0) + 1;
  const porExM = {};
  for (const m of Object.values(r.maquinas)) porExM[m.exercito] = (porExM[m.exercito] || 0) + 1;
  console.log(`${lista.length} fontes (${lista.filter((f) => DE_COLHEITA.test(f.nome)).length} de colheita), ${col.lidos} lidas, ${col.esquadroes} esquadroes inteiros, ${col.semFicha} unidades sem ficha`);
  console.log(`tipos com dotacao: ${Object.keys(r.tipos).length} ${JSON.stringify(porEx)} | veiculos: ${Object.keys(r.maquinas).length} ${JSON.stringify(porExM)}`);
  if (process.argv.includes('--gravar')) {
    fs.writeFileSync(TABELA, JSON.stringify({ nota: 'Dotacao de fabrica por exercito|tipo (homens, por vaga) e exercito|nome (veiculos). Gerado por tools/re/fabrica.mjs.', gerado: new Date().toISOString(), ...r }, null, 1));
    console.log(`gravado ${TABELA}`);
  }
}
