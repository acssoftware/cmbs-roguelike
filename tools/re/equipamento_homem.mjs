// O EQUIPAMENTO DO HOMEM (plano de 28/09, fase 1). O painel do jogo mostra, numa grade de seis icones,
// itens que nao sao arma nem municao — "Night Vision 9", "Binoculars", "Breach Kit". Este modulo levanta
// os bytes candidatos de cada homem nos saves de colheita de fabrica:
//
//   +8 da cauda      0x80 em todo americano; nos russos so em reconhecimento/comando de UMA formacao;
//                    0x08/0x10 so em engenheiros  -> hipotese: Night Vision e itens de engenheiro
//   +7 & 0x3f        0x08 num homem das equipes de observacao  -> Laser Designator? Binoculars?
//   lista de 3 B     tipos raros (1,5 nas ATGM, 1,32/1,33 nos morteiros...) -> objetos carregados
//   +6 do bloco      01 nas equipes pequenas de comando
//
// So a leitura DETERMINISTICA da cauda conta (`cabecaCerta`, 01/10): a de reserva leu o quadro de abates
// de um tanque como granadas.
//
//   node tools/re/equipamento_homem.mjs --levantar        tabela por exercito
//   node tools/re/equipamento_homem.mjs --escolher        as unidades a olhar na tela, com a formacao
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster, caudasDoRoster, localizarRoster, expandirBloco } from './roster.mjs';
import { fichasDoSave, COLHEITA_DIR } from './fabrica.mjs';

const COMUNS = new Set(['1,1', '1,2', '1,3', '1,4']);

export function lerHomem(c) {
  const b = c.cauda;
  const tipos3 = {};
  if (c.ok && c.cabecaCerta) for (const l of c.listas || []) for (const t of l) { const k = `${t[0]},${t[1]}`; tipos3[k] = (tipos3[k] || 0) + 1; }
  return {
    mais8: b[8], flags: b[7] & 0x3f, chefe: b[7] & 0xc0,
    mao1: `${b[1]}/${b[2]}`, mao2: `${b[4]}/${b[5]}`,
    raros: Object.keys(tipos3).filter((k) => !COMUNS.has(k)).sort(),
    tipos3, confiavel: !!(c.ok && c.cabecaCerta),
  };
}

export function levantar(save) {
  const ro = lerRoster(save);
  const cd = caudasDoRoster(save);
  const fichas = fichasDoSave(save);
  const { exp } = expandirBloco(localizarRoster(save).lz);
  const out = [];
  for (const u of ro.unidades) {
    if (!u.soldados.length) continue;
    const fi = fichas.get(u.coreId) || {};
    const cab = exp.subarray(u.pos - 15, u.pos);
    const homens = u.soldados.map((s) => ({ indice: s.indice, nome: s.nome, ...lerHomem(cd[s.indice]) }));
    out.push({
      coreId: u.coreId, tipo: u.tipo, exercito: fi.exercito, nome: fi.nome, formacao: fi.formacao, val: fi.val, tab: fi.tab,
      u6: cab[6], u9: cab[9], homens,
      chefeNome: (homens.find((h) => h.chefe === 0xc0) || homens.find((h) => h.chefe) || homens[0]).nome,
      assinatura: assinatura(cab[6], homens),
    });
  }
  return out;
}

// O que pode produzir icone: +8, +7 baixo, objetos raros, +6. A mao 2 o painel ja explica.
export function assinatura(u6, homens) {
  const h = homens.map((x) => `${x.mais8.toString(16)}/${x.flags.toString(16)}${x.raros.length ? '/' + x.raros.join('+') : ''}`).sort();
  return `u6=${u6} ${h.join(' ')}`;
}

// Classes de interesse: a combinacao de traços que um homem pode ter (sem o +8=0x80 dos americanos, que
// todo mundo tem e vira so o controle).
export function tracos(u) {
  const t = new Set();
  for (const h of u.homens) {
    if (h.mais8 & 0x80) t.add('nv');
    if (h.mais8 & 0x08) t.add('b08');
    if (h.mais8 & 0x10) t.add('b10');
    if (h.mais8 & 0x67) t.add('b' + (h.mais8 & 0x67).toString(16));
    if (h.flags & 0x08) t.add('f08');
    if (h.flags & 0x17) t.add('f' + (h.flags & 0x17).toString(16));
    for (const r of h.raros) t.add('3b:' + r);
  }
  if (u.u6) t.add('u6');
  return [...t].sort();
}

export function escolher(unidades) {
  const porEx = {};
  for (const u of unidades) {
    if (!u.exercito) continue;
    const k = tracos(u).join(',');
    porEx[u.exercito] = porEx[u.exercito] || new Map();
    const m = porEx[u.exercito];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(u);
  }
  const out = {};
  for (const [ex, m] of Object.entries(porEx)) {
    out[ex] = [...m].map(([k, us]) => {
      // por classe: o tipo mais comum dela, e os outros tipos so como contagem
      const porNome = new Map();
      for (const u of us) porNome.set(u.nome, [...(porNome.get(u.nome) || []), u]);
      const [nome, deles] = [...porNome].sort((a, b) => b[1].length - a[1].length)[0];
      const u = deles[0];
      return { tracos: k || '(nenhum)', unidades: us.length, nome, formacao: u.formacao, coreId: u.coreId, outros: [...porNome.keys()].filter((x) => x !== nome).slice(0, 6) };
    }).sort((a, b) => b.unidades - a.unidades);
  }
  return out;
}

export function saves(pasta = COLHEITA_DIR) {
  return fs.readdirSync(pasta).filter((f) => /\.bts$/i.test(f)).map((f) => path.join(pasta, f));
}

const EH_MAIN = process.argv[1] && /[\\/]equipamento_homem\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const todas = saves().flatMap((s) => levantar(s));
  if (process.argv.includes('--escolher')) {
    for (const [ex, linhas] of Object.entries(escolher(todas))) {
      console.log(`\n== ${ex}: ${linhas.length} classes`);
      for (const l of linhas) console.log(`  ${String(l.unidades).padStart(4)}  [${l.tracos}]  ${l.nome}  <- ${l.formacao}${l.outros.length ? `  (tambem: ${l.outros.join(', ')})` : ''}`);
    }
  } else {
    const t = {};
    for (const u of todas) for (const h of u.homens) {
      const k = `${u.exercito}`; t[k] = t[k] || { homens: 0, mais8: {}, flags: {}, raros: {} };
      t[k].homens++; t[k].mais8[h.mais8.toString(16)] = (t[k].mais8[h.mais8.toString(16)] || 0) + 1;
      t[k].flags[h.flags.toString(16)] = (t[k].flags[h.flags.toString(16)] || 0) + 1;
      for (const r of h.raros) t[k].raros[r] = (t[k].raros[r] || 0) + 1;
    }
    console.log(JSON.stringify(t, null, 1));
  }
}
