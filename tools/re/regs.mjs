// O modelo de registro no fluxo DECODIFICADO (ver escape.mjs e secao 29 do FORMATO).
//
// Um registro e achado pelo padrao universal [exercito] 60 00: o campo-base "off" fica 14
// bytes antes dele, o id em off+3, a presenca em off+7, exercito/raridade em off+14, o tipo
// em (off+17, off+18). No cru isso vale SEMPRE — era no fluxo escapado que os campos
// escorregavam, porque um escape no meio do registro empurra tudo o que vem depois.
import fs from 'fs';

const EXS = new Set([0x14, 0x15, 0x16, 0x17, 0x24, 0x25, 0x26, 0x27, 0x34, 0x35, 0x36, 0x37]);
export const CABECA = new Set([0x19, 0x0b, 0x1a, 0x18, 0x1f]);   // 0x1f: formacoes de artilharia autopropulsada (Platoon/Battery (Self-Propelled Howitzer [medium])), secao 111.16
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
let CAT = null;
export function catalogo() {
  if (!CAT) CAT = JSON.parse(fs.readFileSync(new URL('../../research/tipos_confirmados.json', import.meta.url), 'utf8'));
  return CAT;
}

// O terceiro byte do padrao nao e sempre 0x00: ha registros com [exercito] 60 01. Sao raros
// (9 no `BSBP 03 Trial`, nenhum no template do gerador), mas existir e o bastante para o
// leitor perder unidade — foi assim que os ids 11..16 daquele cenario sumiram da minha lista
// enquanto apareciam na tela Units do editor.
//
// O 0x60 do meio tambem nao e fixo: e o byte +15, que carrega o ESTADO DO VEICULO (secao 40).
// 0x60 e "OK" e vale para quase todo registro, mas basta por uma formacao como Immobilized no
// editor para ela gravar 0x40 e sumir inteira do leitor — foi o que aconteceu com os 44
// registros do Tank 31 quando mudei o estado deles em jogo.
//
// So que aceitar qualquer estado de saida nao serve: 0x00 casa com dados do mapa e traz 1661
// registros fantasmas. O segundo passo por isso e duplamente cercado — so procura entre o
// primeiro e o ultimo registro estrito, e so aceita candidato cujo id caiba entre os ids dos
// vizinhos estritos. Os ids crescem junto com o offset (uma unica quebra em 6597 registros da
// vitrine), enquanto todo fantasma que vi tinha id na casa dos milhoes.
const ESTADOS = new Set([0x00, 0x20, 0x40, 0x80]);

// ONDE A FORCA COMECA. Logo antes dela ha uma tabela periodica (02 00 xx xx yy yy 00 ...) em que
// os valores caem, as vezes, exatamente no desenho [exercito] 60 00 do padrao de registro — no
// UKR Mech Infantry [BMP] isso rendeu 11 registros russos fantasmas com ids na casa dos bilhoes,
// e o marcador, que escolhia o ultimo candidato antes do "primeiro registro", ia junto. A ancora
// forte e o padrao de exercito com K (u32 em off-1) e id (u32 em off+3) pequenos e um byte do
// cabecalho da forca a 25 bytes (cabecalho padrao) ou 19 (cabecalho curto, secao 54.2) do padrao —
// que era sempre 00 e e, na verdade, o Electronic Warfare Strength (0..3, 17/10/2026; ver abaixo).
// O MINIMO DA FORCA (E169, 07/10/2026): num arquivo salvo pelo editor atual (versao 9b) a grade renumerada e o lixo dos
// trailers de IA tem desenhos que passam por esta ancora (`14 80 00` na grade do Village-Hills 300, `37 80 00` num
// trailer do Village-Forest 057r). A forca nunca comeca antes do fim da regiao de IA: `transplante.ler` calcula essa
// posicao (na corrente crua) para os arquivos de versao nova e a guarda aqui, associada ao proprio buffer `cru`.
export const MINIMO_FORCA = new WeakMap();
export function inicioDaForca(cru) {
  for (let p = Math.max(40, (MINIMO_FORCA.get(cru) ?? 0) + 14); p + 5 <= cru.length; p++) {
    // Mesmo motivo da passada estrita: 0x60 e OK e 0x80 e Dismounted, e a forca pode comecar por
    // uma formacao desmontada. Exigir 0x60 aqui fazia o inicio da forca ser achado depois dela, e
    // tudo o que vinha antes sumia — 118 registros de 328 num teste.
    if (!EXS.has(cru[p]) || (cru[p + 1] !== 0x60 && cru[p + 1] !== 0x80) || cru[p + 2] > 0x01) continue;
    const off = p - 14, id = cru.readUInt32LE(off + 3), k = cru.readUInt32LE(off - 1);
    if (id < 1 || id > 5000 || k < 1 || k > 500) continue;
    // GUERRA ELETRONICA (17/10/2026, gabaritos do autor): o byte sondado e o Blue EW Strength (m+3) no azul-primeiro
    // (p-25) e no cabecalho curto (p-19), ou o Red (m+4) quando N0 = 0 tokeniza A2..N3 — vale 0..3 (None..Strong), nao
    // mais sempre 0. Com "=== 0" um Blue EW ligado jogava a ancora para depois da forca (323 registros em vez de 710).
    // Tolerar 0..3 nos dois pontos: medido em 271 arquivos, nenhum candidato novo antes da forca (a defesa e id, K e
    // MINIMO_FORCA). Exigir o 00 do cabecalho em p-28 nao serve: nos cenarios dos devs (desc `00 04 00 00`) ele esta
    // DENTRO da corrida tokenizada do marcador (BSBP 01 Honor, Cry Havoc, Platoon House Aleksandra).
    if (cru[p - 25] > 3 && cru[p - 19] > 3) continue;
    return off;
  }
  return -1;
}

export function registros(cru) {
  const cat = catalogo();
  const varrer = (ini, fim, aceita) => {
    const R = [];
    for (let p = Math.max(14, ini); p + 5 <= fim; p++) {
      if (!EXS.has(cru[p]) || !aceita(cru[p + 1]) || cru[p + 2] > 0x0f) continue;   // p+2 = off+16 = GRUPO DE IA (0..15 = grupos 1..16, secao 70); era > 1 e escondia unidades dos grupos 3+
      const off = p - 14, tab = cru[off + 18], val = cru[off + 17];
      if (cru.readUInt32LE(off + 3) > 0xffff) continue;   // id implausivel: padrao `xx 60 0n` dentro de um registro (2 falsos positivos na biblioteca ao liberar o grupo)
      R.push({
        off, id: cru.readUInt32LE(off + 3), tab, val,
        army: cru[p] >> 4, form: CABECA.has(tab),
        nm: cat.tabelas[hx(tab)]?.[hx(val)] || null,
        ausente: !!(cru[off + 7] & 0x80),
        veiculo: cru[p + 1] >> 5,
      });
    }
    return R;
  };
  const inicio = Math.max(14, inicioDaForca(cru));
  // `+15` e o Vehicle Status (secao 40): 0x60 = OK, 0x80 = Dismounted, e 0x00/0x20/0x40 sao os
  // estados de dano. A passada ESTRITA so aceitava 0x60, e por isso o leitor era CEGO a toda
  // unidade desmontada: ela caia na passada frouxa, que so recupera registro cujo id esteja entre
  // dois estritos — um pelotao inteiro desmontado sumia. Um gabarito do autor (um pelotao de
  // engenheiros salvo montado e desmontado) mostrou isso: 11 registros no montado, 9 no mesmo
  // arquivo desmontado. Desmontado e uma escolha de projeto como OK, nao um dano, e entra no
  // estrito; os estados de dano ficam na passada frouxa, onde sempre estiveram.
  const estrito = varrer(inicio, cru.length, (b) => b === 0x60 || b === 0x80);
  if (estrito.length < 2) return estrito;

  const anterior = (off) => { // ultimo estrito antes de off, por busca binaria
    let a = 0, b = estrito.length - 1, r = -1;
    while (a <= b) { const m = (a + b) >> 1; if (estrito[m].off < off) { r = m; a = m + 1; } else b = m - 1; }
    return r;
  };
  const extras = varrer(estrito[0].off, estrito[estrito.length - 1].off + 20, (b) => ESTADOS.has(b))
    .filter((r) => {
      const i = anterior(r.off);
      const ant = estrito[i], seg = estrito[i + 1];
      return ant && seg && ant.id < r.id && r.id < seg.id;
    });
  return extras.length ? [...estrito, ...extras].sort((a, b) => a.off - b.off) : estrito;
}

// O registro comeca no seu TOKEN de cabecalho: em off+2 na forma comum, em off-2 na variante
// que carrega o contador de filhos. Quando ha token dos dois lados (1077 casos num template
// de 6597 registros), decide o conteudo: na variante com contador o u32 em off-1 fica entre
// 1 e 400, e nos ambiguos ele nunca e plausivel — ali o token de off-2 e campo final do
// registro anterior. Os dois bytes antes do token pertencem ao registro anterior.
export function indiceDeTokens(tokens) {
  const m = new Map();
  tokens.forEach((t, i) => { if (!m.has(t.pos)) m.set(t.pos, i); });
  return m;
}

export function inicioDoRegistro(cru, porPos, off) {
  const comContador = porPos.has(off - 2) && (() => { const n = cru.readUInt32LE(off - 1); return n > 0 && n < 400; })();
  if (comContador) return { pos: off - 2, k: porPos.get(off - 2), variante: 'contador' };
  if (porPos.has(off + 2)) return { pos: off + 2, k: porPos.get(off + 2), variante: 'comum' };
  if (porPos.has(off - 2)) return { pos: off - 2, k: porPos.get(off - 2), variante: 'contador?' };
  throw new Error(`registro em ${off}: sem token de cabecalho em off-2 nem off+2`);
}

// Registro de cabecalho ESPECIAL: os 27 que nao tem token em off-2 nem off+2. Todos tem id 1
// ou multiplo de 256, e usam outro layout — no id 6400, o token da variante com contador esta
// em off+1 e a contagem de filhos e um byte em off+2 (valia 11, os 11 filhos diretos do
// Combined Arms, batendo com o irmao CA1, que e legivel pelo caminho normal).
export function especial(porPos, r) {
  return !porPos.has(r.off - 2) && !porPos.has(r.off + 2);
}

// O contador de filhos de uma formacao mora no PRIMEIRO FILHO dela.
// REGRA DE ENCHIMENTO entre registros (secoes 66, 98): quantos zeros ate o id seguinte, contando
// os 3 de cabeca, em funcao do que termina o registro anterior. Unidades CORE (secao 110.1)
// terminam em `04 03` e levam 6 — a regra antiga, so pelo ultimo byte, pedia 9 e reprovava
// todo arquivo importado de campanha. `fim` e exclusivo: a posicao logo depois do ultimo byte
// nao-zero do registro.
// Zeros entre o fim de um registro e o id do seguinte (contando os 3 zeros de cabeca), pela regra
// da secao 53: cauda `04 03` de formacao -> 6; ultimo byte 0x02 -> 8; 0x40..0x46 -> 13; outro -> 9.
//
// EXCECAO MEDIDA NOS CENARIOS DOS DEVS (E52, 13/09): o REGISTRO CURTO — aeronave, drone, bateria
// off-map, 24 B com os 3 zeros de cabeca, sem posicao — e SEMPRE seguido de 9 zeros, seja qual for
// o ultimo byte dele (Raven terminando em 0x45, Apache em 0x42, M119A3 em 0x46: 9 nos 27 cenarios).
// A regra dos 13 vale para o registro com posicao, cujo ultimo byte e o do float de Y. O Orlan-10
// composto como 6o topo azul (ultimo byte 0x42) levava 13 zeros e o jogo travava; como ULTIMO topo
// nao travava, porque a fronteira azul/vermelho tem caminho proprio. Para aplicar a excecao a
// funcao precisa saber onde o registro comeca: `inicio` (offset dos 3 zeros de cabeca); sem ele,
// a regra antiga.
export function regraDeEnchimento(c, fim, inicio = null) {
  const b = c[fim - 1];
  if (b === 0x03 && c[fim - 2] === 0x04) return 6;
  if (inicio !== null && inicio >= 0 && fim - inicio <= 24) return 9;
  return b === 0x02 ? 8 : (b >= 0x40 && b <= 0x46 ? 13 : 9);
}

export function contagemDeFilhos(cru, porPos, R, i) {
  const p = R[i + 1];
  if (!p) return 0;
  // Layout CORE (secao 110.1): a cauda `04 03` da formacao e seguida de DOIS zeros e do contador,
  // e corridas de 2 nunca viram token — nao ha token em off-2 nem em off+2, e o caminho
  // "especial" lia o terceiro zero de cabeca como contagem (0). A assinatura `04 03 00 00`
  // antes do contador identifica o caso sem ambiguidade.
  const core = p.off >= 5 && cru[p.off - 5] === 0x04 && cru[p.off - 4] === 0x03 && cru[p.off - 3] === 0 && cru[p.off - 2] === 0;
  const n = core ? cru.readUInt32LE(p.off - 1)
          : especial(porPos, p) ? cru[p.off + 2]
          : porPos.has(p.off - 2) ? cru.readUInt32LE(p.off - 1)
          : 0;
  return n > 0 && n < 400 ? n : 0;
}

// A sub-arvore de verdade, andando pelos contadores. As faixas de id "obvias" enganam: o
// batalhao de engenheiros parecia ir de 517 a 608, mas 561 ja e um Platoon (LRS) de topo —
// copiar a faixa inteira levava DUAS formacoes de topo somando 1 na contagem do lado, e o
// jogo travava.
export function subArvore(cru, porPos, R, i) {
  const n = contagemDeFilhos(cru, porPos, R, i);
  if (!n) return i + 1;
  let k = i + 1;
  for (let q = 0; q < n && k < R.length; q++) k = R[k].form ? subArvore(cru, porPos, R, k) : k + 1;
  return k;
}

export function faixaDaFormacao(cru, tokens, R, id) {
  const porPos = indiceDeTokens(tokens);
  const ordem = [...R].sort((a, b) => a.off - b.off);
  const i = ordem.findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`formacao ${id} nao achada`);
  const fim = subArvore(cru, porPos, ordem, i);
  const dentro = ordem.slice(i, fim);
  return { ini: id, fim: dentro[dentro.length - 1].id, n: dentro.length,
           especiais: dentro.filter((x) => especial(porPos, x)).map((x) => x.id) };
}

// A sub-arvore comprada ocupa uma faixa CONTIGUA de ids, e o span de bytes vai do inicio da
// primeira ao inicio da primeira de fora. Devolve tambem os registros de dentro.
export function span(cru, tokens, R, ini, fim) {
  const porPos = indiceDeTokens(tokens);
  const dentro = R.filter((x) => x.id >= ini && x.id <= fim).sort((a, b) => a.off - b.off);
  if (dentro.length !== fim - ini + 1)
    throw new Error(`faixa ${ini}..${fim}: ${dentro.length} registros, esperava ${fim - ini + 1}`);
  const depois = R.filter((x) => x.off > dentro[dentro.length - 1].off).sort((a, b) => a.off - b.off)[0];
  if (!depois) throw new Error(`faixa ${ini}..${fim}: nao ha registro depois`);
  const a = inicioDoRegistro(cru, porPos, dentro[0].off);
  const b = inicioDoRegistro(cru, porPos, depois.off);
  if (b.pos <= a.pos) throw new Error(`faixa ${ini}..${fim}: fronteiras fora de ordem`);
  return { dentro, depois, ini: a.pos, fim: b.pos, kIni: a.k, kFim: b.k };
}
