// MONTA uma batalha: seleciona formacoes do template, REPLICA as que faltam e mascara o resto.
//
// As duas operacoes finalmente convivem, agora que o fluxo e decodificado (escape.mjs):
//   - selecao/mascara: bit 0x80 no byte off+7 de tudo que nao entra;
//   - replicacao: copia do span do doador com ids novos, emendada como IRMA de topo logo
//     depois dele, mais um no contador de formacoes de topo do lado.
//
// A replicacao azul, que fracassou em toda tentativa anterior, so falhava porque os ids novos
// eram gravados no fluxo escapado: um id como 8042 = 0x1F6A num arquivo com esc 0x6a virava
// escape solto e deslocava o arquivo inteiro (secao 29).
import { ler } from './transplante.mjs';
import { marcador, raizDoLado } from './transplante.mjs';
import { registros, span, indiceDeTokens, inicioDoRegistro } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';
import fs from 'fs';

// quais doadores realmente replicam, medido em jogo (research/replicacao_testada.json)
const TESTADOS = JSON.parse(fs.readFileSync(new URL('../../research/replicacao_testada.json', import.meta.url), 'utf8'));

const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';

// 4 Combined Arms americanos contra 6 batalhoes de tanque russos. O template tem DOIS
// Combined Arms comprados (609 e 6399) e UM Tank 31 (5325): faltam 2 azuis e 5 vermelhos.
export const PLANO = {
  template: 'ZZ QBSMALL ALL add manual 2.btt',
  saida: 'ZZ QB 4CA 6T31 v4.btt',
  manter: [
    { ini: 609, fim: 770, nm: 'Battalion (Combined Arms) #1' },
    { ini: 6399, fim: 6560, nm: 'Battalion (Combined Arms) #2' },
    { ini: 5325, fim: 5368, nm: 'Battalion (Tank 31)' },
  ],
  replicar: [
    { ini: 6399, fim: 6560, copias: 2, army: 0x17, nm: 'Combined Arms (azul)' },
    { ini: 5325, fim: 5368, copias: 5, army: 0x27, nm: 'Tank 31 (vermelho)' },
  ],
};

export function montar(plano) {
  const d = ler(S + plano.template);
  const R = registros(d.cru);
  const maxId = Math.max(...R.map((x) => x.id));
  console.log(`${plano.template}: ${R.length} registros, ids ${R[0].id}..${maxId}, esc 0x${d.esc.toString(16)}`);

  // ---- contagens de topo, lidas ANTES de qualquer emenda --------------------------------
  const m = marcador(d);
  const lados = new Map();
  for (const r of plano.replicar) {
    if (lados.has(r.army)) { lados.get(r.army).copias += r.copias; continue; }
    const raiz = raizDoLado(d.cru.subarray(m.pos), r.army);
    if (!raiz) throw new Error(`raiz do exercito 0x${r.army.toString(16)} nao achada`);
    lados.set(r.army, { pos: m.pos + raiz.pos, n: raiz.n, id: raiz.id, copias: r.copias });
  }

  // ---- spans e copias --------------------------------------------------------------------
  // manter: null significa NAO mascarar nada — a batalha fica com o template inteiro visivel.
  const manter = new Set();
  for (const f of plano.manter || []) {
    const sp = span(d.cru, d.tokens, R, f.ini, f.fim);
    sp.dentro.forEach((x) => manter.add(x.id));
    console.log(`   mantida: ${f.nm} — ids ${f.ini}..${f.fim} (${sp.dentro.length} registros)`);
  }

  // O ID NAO E UM ROTULO LIVRE: a cada 256 registros o serializador muda a forma do cabecalho.
  // Os 27 registros sem token de cabecalho do template tem id 1 (a raiz) e 256, 512, 768 ...
  // 6656 — todos os multiplos de 256. Entao a forma de um registro esta amarrada ao VALOR do
  // seu id, e uma copia so e valida se os multiplos de 256 cairem nas MESMAS posicoes
  // relativas que no doador. Basta alinhar a base: idBase = doador.ini (mod 256).
  //
  // Isso fecha a serie de fracassos do Combined Arms. O CA2 (6399..6560) contem o id 6400; as
  // copias iam para 6919..7080 (nenhum multiplo) e 7091..7252 (o 7168 na posicao errada). Ja
  // o Engineer (517..560) e o Tank 31 (5325..5368) nao tem multiplo nenhum, e as copias deles
  // tambem nao — por isso passaram.
  const alinhar = (minimo, base) => minimo + (((base % 256) - (minimo % 256)) + 256) % 256;
  let idLivre = maxId + 100;
  const emendas = [];
  for (const r of plano.replicar) {
    const sp = span(d.cru, d.tokens, R, r.ini, r.fim);
    const porPos = indiceDeTokens(d.tokens);
    // Se um doador pode ser replicado NAO E CALCULAVEL (secao 32): 33 doadores testados em
    // jogo, 18 copiam e 15 travam, e nenhuma propriedade da sub-arvore separa os dois grupos.
    // Nem porte (229 registros copiam, 37 travam), nem tipo (dois Motor Rifle [BMP] russos
    // identicos de nome, um copia e o outro nao). So a lista empirica vale.
    if (!r.forcar) {
      const conhecido = TESTADOS.doadores.find((x) => x.id === r.ini);
      if (!conhecido)
        throw new Error(`${r.nm}: doador ${r.ini} nunca foi testado em jogo. Rode tools/re/lote_doadores.mjs ${r.ini} ` +
          `e carregue o arquivo no editor; depois anote o resultado em research/replicacao_testada.json.`);
      if (!conhecido.copiavel)
        throw new Error(`${r.nm}: o doador ${r.ini} (${conhecido.nome}) esta na lista dos que TRAVAM o jogo. ` +
          `Use outro exemplar do mesmo tipo, se houver.`);
    }
    const especiais = sp.dentro.filter((x) => !porPos.has(x.off - 2) && !porPos.has(x.off + 2));
    for (const e of especiais)
      if (e.id % 256 !== 0) throw new Error(`registro ${e.id} sem cabecalho mas nao e multiplo de 256`);
    for (let c = 0; c < r.copias; c++) {
      idLivre = alinhar(idLivre, sp.dentro[0].id);
      const buf = Buffer.from(d.cru.subarray(sp.ini, sp.fim));
      sp.dentro.forEach((x, k) => {
        const novo = idLivre + k;
        if ((novo % 256 === 0) !== (x.id % 256 === 0))
          throw new Error(`id ${x.id} -> ${novo}: fronteira de 256 fora de lugar`);
        buf.writeUInt32LE(novo, x.off + 3 - sp.ini);
        if (r.mascarada) buf[x.off + 7 - sp.ini] |= 0x80;  // diagnostico: copia invisivel
        else buf[x.off + 7 - sp.ini] &= ~0x80;             // a copia entra presente
      });
      const tk = d.tokens.slice(sp.kIni, sp.kFim).map((t) => ({ pos: t.pos - sp.ini, cod: t.cod }));
      // Por padrao a copia entra logo depois do doador, como irma. Mas o editor, ao duplicar
      // formacoes GRANDES, pos as copias no FIM DA SECAO DO LADO — as duas de Combined Arms
      // foram parar logo antes do primeiro registro vermelho. `fimDoLado` reproduz isso.
      let posEmenda = sp.fim;
      if (r.posicao === 'fimDoLado') {
        const ordem = [...R].sort((a, b) => a.off - b.off);
        const quebra = ordem.findIndex((x, k) => k > 0 && x.id <= ordem[k - 1].id);
        const alvo = r.army === 0x17 ? ordem[quebra] : null;   // inicio da secao vermelha
        posEmenda = alvo ? inicioDoRegistro(d.cru, indiceDeTokens(d.tokens), alvo.off).pos : d.cru.length;
      }
      emendas.push({ pos: posEmenda, buf, tk, idIni: idLivre, idFim: idLivre + sp.dentro.length - 1, nm: r.nm });
      idLivre += sp.dentro.length + 10;
    }
    console.log(`   replicada: ${r.nm} x${r.copias} — doador ids ${r.ini}..${r.fim}, span ${sp.fim - sp.ini} bytes`);
  }
  // ---- mascara: tudo que nao entra, e so o que o catalogo reconhece -----------------------
  const mascarar = plano.manter ? R.filter((x) => x.nm && !manter.has(x.id)) : [];
  const cru = Buffer.from(d.cru);
  mascarar.forEach((x) => { cru[x.off + 7] |= 0x80; });

  // ---- emendas, da maior posicao para a menor --------------------------------------------
  emendas.sort((a, b) => b.pos - a.pos);
  let corpo = cru, toks = d.tokens.slice();
  for (const e of emendas) {
    corpo = Buffer.concat([corpo.subarray(0, e.pos), e.buf, corpo.subarray(e.pos)]);
    const kCorte = toks.findIndex((t) => t.pos >= e.pos);
    const k = kCorte < 0 ? toks.length : kCorte;
    toks = [
      ...toks.slice(0, k),
      ...e.tk.map((t) => ({ pos: t.pos + e.pos, cod: t.cod })),
      ...toks.slice(k).map((t) => ({ pos: t.pos + e.buf.length, cod: t.cod })),
    ];
  }

  // As contagens de topo so podem ser gravadas DEPOIS das emendas: a raiz vermelha mora
  // adiante da regiao azul no fluxo, entao uma copia azul empurra a posicao dela. Reachar a
  // raiz no fluxo ja emendado e, de quebra, uma conferencia — o valor lido tem de ser o
  // mesmo de antes.
  {
    const mm = marcador({ cru: corpo, tokens: toks });
    for (const [army, l] of lados) {
      const raiz = raizDoLado(corpo.subarray(mm.pos), army);
      if (!raiz) throw new Error(`raiz 0x${army.toString(16)} sumiu depois das emendas`);
      if (raiz.n !== l.n || raiz.id !== l.id)
        throw new Error(`raiz 0x${army.toString(16)}: id ${raiz.id}/n ${raiz.n}, esperava ${l.id}/${l.n}`);
      corpo.writeUInt32LE(l.n + l.copias, mm.pos + raiz.pos);
    }
  }

  const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru: corpo, tokens: toks }, d.esc)]);
  reconstruir(S + plano.template, S + plano.saida, (b, i) => (i === 1 ? bloco : b));

  // ---- verificacao, sempre no arquivo gerado ---------------------------------------------
  const v = ler(S + plano.saida);
  if (!v.cru.equals(corpo)) throw new Error('cru do gerado divergente');
  if (v.tokens.length !== toks.length) throw new Error(`tokens: ${v.tokens.length} vs ${toks.length}`);
  const RV = registros(v.cru);
  const novos = emendas.reduce((t, e) => t + (e.idFim - e.idIni + 1), 0);
  if (RV.length !== R.length + novos) throw new Error(`registros: ${RV.length} vs ${R.length + novos}`);
  const ids = RV.map((x) => x.id), dup = [...new Set(ids.filter((x, k) => ids.indexOf(x) !== k))];
  if (dup.length) throw new Error(`ids duplicados: ${dup.slice(0, 10).join(', ')}`);
  const mV = marcador(v);
  for (const [army, l] of lados) {
    const r2 = raizDoLado(v.cru.subarray(mV.pos), army);
    if (!r2 || r2.n !== l.n + l.copias) throw new Error(`contagem 0x${army.toString(16)}: ${r2?.n}, esperava ${l.n + l.copias}`);
    console.log(`   contagem de topo 0x${army.toString(16)}: ${l.n} -> ${r2.n}`);
  }

  const vis = RV.filter((x) => x.form && !x.ausente && x.nm);
  const conta = new Map();
  vis.forEach((x) => conta.set(x.nm, (conta.get(x.nm) || 0) + 1));
  console.log(`\n${plano.saida} gerado`);
  console.log(`   ${RV.length} registros (${novos} novos), ${mascarar.length} mascarados, nenhum id duplicado`);
  console.log(`   formacoes visiveis: ${vis.length}`);
  [...conta].sort((a, b) => b[1] - a[1]).forEach(([nm, n]) => console.log(`      ${n}x ${nm}`));
  return { RV, vis };
}

// Bateria de isolamento. O unico arquivo MASCARADO ja aprovado em jogo (ZZ QB 2CA 3T31) saiu
// do codigo antigo; o codigo novo so tem aprovacao para insercao SEM mascara (ZZ AZUL V3).
// Entao a primeira pergunta nao e o Combined Arms, e sim se a mascara nova presta.
const MANTER = [
  { ini: 609, fim: 770, nm: 'Combined Arms #1' },
  { ini: 6399, fim: 6560, nm: 'Combined Arms #2' },
  { ini: 5325, fim: 5368, nm: 'Tank 31' },
];
const T31 = { ini: 5325, fim: 5368, army: 0x27, nm: 'Tank 31 (vermelho)' };
const CA = { ini: 6399, fim: 6560, army: 0x17, nm: 'Combined Arms (azul)' };
const ENG = { ini: 517, fim: 560, army: 0x17, nm: 'Brigade Engineer (azul)' };

export const PLANOS = {
  // reproduz o unico masc+replicacao aprovado, agora pelo codigo novo
  t1: { saida: 'AA T1 REPRO 2CA 3T.btt', manter: MANTER, replicar: [{ ...T31, copias: 2 }] },
  // so mascara, sem replicar nada: isola a mascara pura
  t2: { saida: 'AA T2 SO MASCARA.btt', manter: MANTER, replicar: [] },
  // mascara + UMA copia de Combined Arms: isola o doador problematico
  t3: { saida: 'AA T3 3CA.btt', manter: MANTER, replicar: [{ ...CA, copias: 1 }] },
  // mascara + uma copia do doador que ja passou sem mascara: isola mascara x insercao azul
  t4: { saida: 'AA T4 ENG MASC.btt', manter: [...MANTER, { ini: 517, fim: 560, nm: 'Engineer' }], replicar: [{ ...ENG, copias: 1 }] },
  // sem mascara, so a copia de Combined Arms: isola o doador sem a mascara junto
  t5: { saida: 'AA T5 CA SEM MASC.btt', manter: null, replicar: [{ ...CA, copias: 1 }] },

  // O par que separa TAMANHO de FRONTEIRA DE 256. Os dois sao batalhoes azuis americanos de
  // porte parecido; um nao tem multiplo de 256 na faixa, o outro tem.
  //   t6: Brigade Engineer inteiro, 517..608 — 92 registros, SEM multiplo
  //   t7: Brigade Engineer [Stryker], 1716..1837 — 122 registros, COM o 1792
  // t6 passa e t7 trava => o registro de fronteira e o assassino, e alinhar nao basta.
  // os dois travam => o que pesa e o tamanho. os dois passam => e algo so do Combined Arms.
  t6: {
    saida: 'AA T6 ENG INTEIRO.btt',
    manter: [...MANTER, { ini: 517, fim: 608, nm: 'Engineer inteiro' }],
    replicar: [{ ini: 517, fim: 608, army: 0x17, copias: 1, nm: 'Engineer inteiro (92 regs, sem multiplo)' }],
  },
  t7: {
    saida: 'AA T7 ENG STRYKER.btt',
    manter: [...MANTER, { ini: 1716, fim: 1837, nm: 'Engineer Stryker' }],
    replicar: [{ ini: 1716, fim: 1837, army: 0x17, copias: 1, nm: 'Engineer Stryker (122 regs, com o 1792)' }],
  },
  // O PAR DECISIVO, agora com sub-arvore de verdade (o t6 falhou porque a faixa 517..608
  // engolia o Platoon (LRS) de topo do id 561 — duas formacoes somando 1 na contagem).
  //   t8: Battalion (Combined Arms [Task Force]) 771..971 — 201 registros, SEM especial
  //   t9: Battalion (Stryker Infantry) 1199..1366 — 168 registros, COM o especial 1280
  // t8 passa e t9 trava => o registro especial e a causa, e nao o tamanho nem o Combined Arms.
  t8: {
    saida: 'AA T8 CA TF LIMPO.btt',
    manter: [...MANTER, { ini: 771, fim: 971, nm: 'CA Task Force' }],
    replicar: [{ ini: 771, fim: 971, army: 0x17, copias: 1, nm: 'CA Task Force (201 regs, LIMPO)' }],
  },
  t9: {
    saida: 'AA T9 STRYKER ESP.btt',
    manter: [...MANTER, { ini: 1199, fim: 1366, nm: 'Stryker Infantry' }],
    replicar: [{ ini: 1199, fim: 1366, army: 0x17, copias: 1, nm: 'Stryker Infantry (168 regs, COM especial)' }],
  },
  // O t8 (201 registros, sem especial) travou, entao o registro especial esta inocente. Sobra
  // separar TAMANHO de UNIDADE DE APOIO: tudo que trava carrega TACP, morteiro e Fire Support
  // Team; o que passa (Engenheiros, Tank 31) nao carrega nada disso — so um drone Raven.
  //   t10: Company (Rifle) 35..68 — 34 registros, PEQUENA, COM Fire Support Team e observador
  //   t11: Reconnaissance Battalion [old] 5137..5210 — 74 registros, MEDIA, SEM apoio nenhum
  // t10 trava => e a unidade de apoio. t11 trava => e o tamanho.
  t10: {
    saida: 'AA TA CIA APOIO.btt',
    manter: [...MANTER, { ini: 35, fim: 68, nm: 'Company (Rifle)' }],
    replicar: [{ ini: 35, fim: 68, army: 0x17, copias: 1, nm: 'Company (Rifle) (34 regs, COM apoio)' }],
  },
  t11: {
    saida: 'AA TB RECON LIMPO.btt',
    manter: [...MANTER, { ini: 5137, fim: 5210, nm: 'Recon Battalion' }],
    replicar: [{ ini: 5137, fim: 5210, army: 0x27, copias: 1, nm: 'Recon Battalion (74 regs, SEM apoio)' }],
  },
  // O t10 (34 regs COM apoio) passou e o t11 (74 regs SEM apoio) travou: a unidade de apoio
  // esta inocente. E o total tambem nao explica — o ZZ QB 2CA 3T31, aprovado em jogo, somou
  // 88 registros. O que sobra e o tamanho de CADA copia: 44 passa, 74 trava.
  //   tc: CINCO copias do Tank 31 — +220 registros no total, mas 44 por copia
  //   td: UMA copia do Battalion (Tank 40) — 53 registros, 2033 bytes (logo abaixo de 2048)
  // tc passa => o eixo e o tamanho por copia, nao o total.
  tc: { saida: 'AA TC 5x T31.btt', manter: MANTER, replicar: [{ ...T31, copias: 5 }] },
  td: {
    saida: 'AA TD TANK40 53.btt',
    manter: [...MANTER, { ini: 1936, fim: 1988, nm: 'Tank 40' }],
    replicar: [{ ini: 1936, fim: 1988, army: 0x17, copias: 1, nm: 'Battalion (Tank 40) (53 regs, 2033 bytes)' }],
  },
  // DISCRIMINANTE. Todo doador aprovado tem menos de 2048 bytes escapados E menos de 128
  // tokens; todo reprovado passa das duas marcas. Este separa as duas hipoteses:
  //   te: Battalion (Artillery Brigade Antitank) 2901..2975 — 112 tokens (<128), 3006 bytes (>2048)
  // te trava => o limite e de BYTES. te passa => o limite e de TOKENS.
  //   tf: Battery (MANPADS) 3715..3759 — 45 registros, controle abaixo das duas marcas
  te: {
    saida: 'AA TE ART 112TOK.btt',
    manter: [...MANTER, { ini: 2901, fim: 2975, nm: 'Artillery Antitank' }],
    replicar: [{ ini: 2901, fim: 2975, army: 0x17, copias: 1, nm: 'Artillery Antitank (112 tokens, 3006 bytes)' }],
  },
  tf: {
    saida: 'AA TF MANPADS 45.btt',
    manter: [...MANTER, { ini: 3715, fim: 3759, nm: 'Battery MANPADS' }],
    replicar: [{ ini: 3715, fim: 3759, army: 0x17, copias: 1, nm: 'Battery (MANPADS) (45 regs, 1814 bytes)' }],
  },
  // O editor poe as copias GRANDES no fim da secao do lado, nao ao lado do doador.
  // tg repete o t3 (que travou) mudando SO isso.
  tg: {
    saida: 'AA TG CA FIM DO LADO.btt',
    manter: MANTER,
    replicar: [{ ...CA, copias: 1, posicao: 'fimDoLado', nm: 'Combined Arms no fim da secao azul' }],
  },
  // DIAGNOSTICO: copia o Combined Arms inteiro mas deixa a copia MASCARADA. Se o arquivo
  // abrir, o jogo consegue LER a estrutura de 162 registros novos e o problema esta em
  // CONSTRUIR as unidades. Se travar, o problema e a leitura.
  th: {
    saida: 'AA TH CA MASCARADO.btt',
    manter: MANTER,
    replicar: [{ ...CA, copias: 1, mascarada: true, nm: 'Combined Arms (copia invisivel)' }],
  },
  // Vitrine para ler os atributos na tela: um exemplar de cada tipo que interessa —
  // veiculo, artilharia fora do mapa, drone, helicoptero e aviao.
  vitrine: {
    saida: 'AA VITRINE.btt',
    manter: [
      { ini: 5325, fim: 5368, nm: 'Battalion (Tank 31) — veiculos' },
      { ini: 1842, fim: 1843, nm: 'Battery (Howitzer [heavy]) — artilharia' },
      { ini: 1848, fim: 1849, nm: 'Raven (RQ-11B) — drone' },
      { ini: 1854, fim: 1856, nm: 'Apache Longbow (AH-64D) — helicoptero' },
      { ini: 1869, fim: 1871, nm: 'Fighting Falcon (F-16CJ) — aviao' },
    ],
    replicar: [],
  },
  v4: PLANO,
};

const EH_MAIN = process.argv[1] && /[\\/]montar_batalha\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const nome = process.argv[2] || 'v4';
  const p = PLANOS[nome];
  if (!p) throw new Error(`plano '${nome}' nao existe; use: ${Object.keys(PLANOS).join(', ')}`);
  montar({ template: PLANO.template, ...p });
}
