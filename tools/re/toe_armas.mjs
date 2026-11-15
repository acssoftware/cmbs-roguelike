// O EQUIPAMENTO DE FABRICA: que arma cada VAGA do TO&E carrega.
//
// O reforco devolve o homem de pe (E27) e armado (E30), e a arma que ele recebe nao deve ser a que
// ele juntou no campo na batalha passada — deve ser a da vaga dele na tabela de organizacao. O
// autor foi direto ao ponto: "prefiro resetar todo o equipamento do esquadrao para os padroes
// originais".
//
// A vaga e a POSICAO do homem dentro do bloco da unidade (secao 111.20 / E7: os slots sao as vagas
// do TO&E, numeradas, com `ff ff` no ultimo). Entao a tabela e:
//
//   tipo da unidade (u16) -> [ {classe, item} por posicao ]
//
// Ela e colhida dos saves que existem na maquina: para cada (tipo, posicao) vale a arma MAIS COMUM
// entre os homens que ainda tem uma. Um saqueado (classe 08) nao vota, e por isso uma batalha
// sangrenta nao envenena a tabela — sobra sempre alguem inteiro naquela vaga em algum outro save.
//
// A MUNICAO ENTRA JUNTO, e a historia dela e uma correcao: eu tinha lido o painel do E30 como
// "o resupply do jogo enche o paiol" e estava errado — o autor mostrou um esquadrao entrando na
// batalha 2 com 229 balas de 5.45 enquanto o vizinho tinha 1.938. O percentual de ressuprimento da
// campanha estava em zero (110.6) e, mesmo corrigido, nao reabastece um save que ja foi escrito.
//
// Entao a carga cheia tambem vem daqui: `tipo -> vaga -> {item: quantidade}`, pelo MAXIMO visto,
// porque um homem so anda com menos do que a dotacao depois de atirar, nunca com mais. Escrever a
// quantidade cabe no lugar (`u16`), ao contrario de ACRESCENTAR item, que mudaria o tamanho do
// registro — o que derrubou o jogo no E28 e no E29.
//
// uso: node toe_armas.mjs [--gravar]   (grava research/toe_armas.json)
import fs from 'node:fs';
import path from 'node:path';
import { lerRoster, caudasDoRoster, paiolDe } from './roster.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const SALVOS = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games';
export const TABELA = path.join(RAIZ, 'research/toe_armas.json');

// SO VOTA O QUE O JOGO ESCREVEU. A primeira colheita saiu envenenada pelos arquivos do proprio app
// — inclusive o do E29, com as caudas emendadas — e deu a um esquadrao ucraniano armas que nenhum
// companheiro dele carrega. O que o app escreve tem marca no nome (`[B02]`, `(rebuilt 1)`,
// `(curado)`) e mora em `app/campaigns`; nada disso entra.
export const DO_APP = /\[B\d+|\(rebuilt|\(curado|\(rearmado|\(antes do conserto/i;
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

// A CARGA CHEIA de cada vaga: `[u16 nMun][nMun x (u16 item | u16 quantidade)]` dentro do registro
// (113.2). Aqui vale o MAXIMO visto, nao a moda — um homem so anda com menos do que a dotacao
// depois de atirar, nunca com mais, entao o maior numero e o que o TO&E manda.
function municaoDe(cauda) {
  return paiolDe(cauda)?.pares || [];   // o vetor nem sempre esta em +9 (113.6)
}

// AS DUAS MAOS, e por que a segunda precisa da distribuicao inteira e nao so do vencedor (E78).
//
// O autor: "nao devemos carregar munição e armas obtidas da batalha de um mapa para outro". Para
// desfazer isso e preciso saber o que e da vaga — e a MAO 2 nao tem uma resposta unica. Medido em
// 316 saves e 11 692 homens armados:
//
//   8/0 em 6291 deles                 mao vazia (classe 08, item 0)
//   tipo 9221 vaga 1                  `2/44 + 4/16` (120) | `2/44 + 4/15` (70) | `2/44 + 8/15` (69)
//   tipo 2054 vaga 0                  `2/31 + 2/24` (76) | `2/24 + 2/31` (36)  — o MESMO par, trocado
//
// Ou seja: o lanca-foguetes descartavel muda de modelo de esquadrao para esquadrao (RPG-22 numa,
// RPG-26 na outra) e a ORDEM das maos nao e fixa. Entao o vencedor por vaga nao serve para reescrever
// a mao 2 — trocaria um RPG-22 legitimo por um RPG-26. O que serve e o CONJUNTO do que ja foi visto
// naquela vaga: arma que nenhum homem daquela vaga jamais carregou nao e dela, e so essa volta para
// a dotacao. Por isso a tabela guarda `mao1` e `mao2` inteiras, com os votos.
const NADA = '8/0';
const maoDe = (c, i) => (c && c.length >= 8 && c[0] === 0 && c[3] === 0 ? `${c[i]}/${c[i + 1]}` : null);

// A colheita: `{ tipo: { posicao: { "classe/item": votos } } }` mais a carga por item.
export function colher(arquivos = candidatos()) {
  const votos = new Map();
  const maos = new Map();
  const cargas = new Map();
  let lidos = 0, homens = 0;
  for (const f of arquivos) {
    let roster, caudas;
    try { roster = lerRoster(f); caudas = caudasDoRoster(f); } catch { continue; }
    lidos++;
    for (const u of roster.unidades) {
      u.soldados.forEach((s, vaga) => {
        const arma = caudas[s.indice]?.arma;
        if (!arma || arma.classe === 0x08) return;   // saqueado nao vota
        homens++;
        // as duas maos, cada uma com sua urna
        const c = caudas[s.indice]?.cauda;
        for (const [qual, chave] of [['mao1', maoDe(c, 1)], ['mao2', maoDe(c, 4)]]) {
          if (!chave) continue;
          // CLASSE 0 NAO VOTA. Ela nao existe no jogo: e a marca do defeito da E73, em que a arma
          // lembrada saia `undefined/undefined` e o Buffer gravava zero. Oito homens do save do
          // autor ficaram assim, o jogo os re-salvou, e sem este corte o `0/0` entraria na tabela
          // como se fosse arma de fabrica — e a colheita legitimaria o proprio erro.
          if (chave.startsWith('0/')) continue;
          // o saqueado guarda o ITEM do que levaram (8/24): a classe 08 so vota como MAO VAZIA
          const voto = chave.startsWith('8/') ? NADA : chave;
          if (!maos.has(u.tipo)) maos.set(u.tipo, new Map());
          const porVaga = maos.get(u.tipo);
          if (!porVaga.has(vaga)) porVaga.set(vaga, { mao1: new Map(), mao2: new Map() });
          const urna = porVaga.get(vaga)[qual];
          urna.set(voto, (urna.get(voto) || 0) + 1);
        }
        if (!votos.has(u.tipo)) votos.set(u.tipo, new Map());
        const porVaga = votos.get(u.tipo);
        if (!porVaga.has(vaga)) porVaga.set(vaga, new Map());
        const urna = porVaga.get(vaga);
        const chave = `${arma.classe}/${arma.item}`;
        urna.set(chave, (urna.get(chave) || 0) + 1);

        if (!cargas.has(u.tipo)) cargas.set(u.tipo, new Map());
        const cargaVaga = cargas.get(u.tipo);
        if (!cargaVaga.has(vaga)) cargaVaga.set(vaga, new Map());
        const cheia = cargaVaga.get(vaga);
        for (const m of municaoDe(caudas[s.indice]?.cauda)) {
          cheia.set(m.item, Math.max(cheia.get(m.item) || 0, m.qtd));
        }
      });
    }
  }
  return { votos, maos, cargas, lidos, homens, arquivos: arquivos.length };
}

// O vencedor de cada vaga, com a margem — `{ tipo: [{arma, votos, total}] }`.
export function apurar(votos, cargas = new Map(), maos = new Map()) {
  const out = {};
  for (const [tipo, porVaga] of votos) {
    const vagas = [...porVaga.keys()].sort((a, b) => a - b);
    out[tipo] = vagas.map((v) => {
      const urna = [...porVaga.get(v).entries()].sort((a, b) => b[1] - a[1]);
      const total = urna.reduce((a, [, n]) => a + n, 0);
      const carga = cargas.get(tipo)?.get(v);
      const m = maos.get(tipo)?.get(v);
      const emOrdem = (urnaM) => Object.fromEntries([...(urnaM || new Map())].sort((a, b) => b[1] - a[1]));
      return {
        vaga: v, arma: urna[0][0], votos: urna[0][1], total, opcoes: urna.length,
        municao: carga ? Object.fromEntries([...carga.entries()].sort((a, b) => a[0] - b[0])) : {},
        mao1: emOrdem(m?.mao1), mao2: emOrdem(m?.mao2),
      };
    });
  }
  return out;
}

// A leitura, para quem so quer usar: `{ tipo: { vaga: {classe, item} } }`.
export function lerTabela(arquivo = TABELA) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const out = {};
  for (const [tipo, vagas] of Object.entries(bruto.tipos)) {
    out[tipo] = {};
    for (const v of vagas) {
      const [classe, item] = v.arma.split('/').map(Number);
      // `mao1`/`mao2`: o que ja foi visto naquela vaga, com os votos (E78). Sem elas — arquivo de
      // antes — quem le nao apara arma nenhuma, que e o comportamento de sempre.
      out[tipo][v.vaga] = { classe, item, municao: v.municao || {}, mao1: v.mao1 || null, mao2: v.mao2 || null };
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('toe_armas.mjs')) {
  const c = colher();
  const tipos = apurar(c.votos, c.cargas, c.maos);
  // A MUNICAO NAO E RECOLHIDA POR PADRAO (E76). Ela sai do MAXIMO visto por vaga, e isso so vale
  // enquanto os saves forem de forcas que o app nunca engordou: desde a batalha 2 da EASY2 os saves
  // que o JOGO escreveu ja descendem de refits que somavam maximos de reparticoes diferentes (um
  // esquadrao chegou a 12037 tiros contra 2298 de dotacao), e recolher agora gravaria isso como
  // dotacao. Entao a municao do arquivo que ja existe e mantida, e so as ARMAS sao refeitas.
  // `--recolher-municao` refaz tudo, para quando houver uma base de saves limpa.
  if (!process.argv.includes('--recolher-municao')) {
    let velho = null;
    try { velho = JSON.parse(fs.readFileSync(TABELA, 'utf8')).tipos; } catch { /* primeira colheita */ }
    let mantidas = 0;
    for (const [tipo, vagas] of Object.entries(tipos)) {
      const antes = new Map((velho?.[tipo] || []).map((v) => [v.vaga, v.municao]));
      for (const v of vagas) if (antes.has(v.vaga)) { v.municao = antes.get(v.vaga); mantidas++; }
    }
    console.log('municao mantida do arquivo anterior em ' + mantidas + ' vagas (--recolher-municao refaz)');
  }
  const nVagas = Object.values(tipos).reduce((a, v) => a + v.length, 0);
  const duvidosas = Object.entries(tipos).flatMap(([t, vs]) => vs.filter((v) => v.votos / v.total < 0.6).map((v) => ({ tipo: t, ...v })));
  console.log(`${c.lidos} saves com roster de ${c.arquivos} arquivos; ${c.homens} homens armados`);
  console.log(`${Object.keys(tipos).length} tipos, ${nVagas} vagas`);
  console.log(`vagas em que a arma mais comum tem menos de 60% dos votos: ${duvidosas.length}`);
  for (const d of duvidosas.slice(0, 8)) console.log(`   tipo ${d.tipo} vaga ${d.vaga}: ${d.arma} com ${d.votos}/${d.total} (${d.opcoes} opcoes)`);
  if (process.argv.includes('--gravar')) {
    fs.writeFileSync(TABELA, JSON.stringify({
      nota: 'Equipamento de fabrica por vaga do TO&E: tipo da unidade -> posicao do homem no bloco -> arma (classe/item), municao ({item: carga cheia}) e as duas maos com os votos (mao1/mao2, E78: arma que nunca foi vista naquela vaga nao e dela e volta para a dotacao; a mao 2 varia de esquadrao para esquadrao, entao so o CONJUNTO serve, nao o vencedor). 8/0 na mao 2 e mao vazia. So votam os saves que o JOGO escreveu — os do app envenenam a tabela. A municao e mantida do arquivo anterior salvo com --recolher-municao (E76). Refazer com: node tools/re/toe_armas.mjs --gravar',
      saves: c.lidos, homens: c.homens, tipos,
    }, null, 1) + '\n');
    console.log(`-> ${TABELA}`);
  }
}
