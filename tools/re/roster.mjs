// ROSTER DE CAMPANHA (secao 111): o bloco LZ que o save de campanha carrega logo depois da copia
// do cabecalho da campanha. E o estado que o jogo persiste entre batalhas — cada unidade core
// com os seus soldados por nome e um byte de ESTADO ao fim da batalha — mais os textos do script,
// o [PLAYER FORCE] e, no fim, o resultado de cada batalha jogada.
//
// Expandido (escape do proprio bloco, primeiro byte = esc):
//   [~180 B opacos][u32 4][4 textos: u16 len | texto][48 B][u32 playerForce: 1 red, 0 blue]
//   [titulos do briefing: "Situation", "Mission", ...][unidades...][u32 batalhasJogadas]
//   [por batalha: u16 ? | u8 nivel 0..8 | u8 venceu]
// Unidade: ... [u32 CORE ID][u16 tipo][8 B][05 04 03 00][u32 nSoldados][4 B] e os soldados,
// cada um `[12 B][u16 len][Sobrenome][u8 ESTADO][cauda variavel]`. ESTADO: 0/1 vivo, 2/3 baixa
// (2 x 3 e ferido x morto NAO fecham com o AAR; hipotese em aberto na 111.3).
//
// Ha dois escritores aqui, e a diferenca importa:
//   `escreverEstados`  remenda o fluxo ESCAPADO. Nao mexe em tamanho e e o mais conservador, mas
//                      nao pode gravar 0 (zero solto num fluxo em que zeros sao tokens), entao o
//                      melhor que consegue e 1 — ferido leve.
//   `reforcar`         reescreve o bloco EXPANDIDO e recodifica com `codificarComoJogo`, o mesmo
//                      caminho do `crescerRoster`. Grava 0 = sao, que e o que o reforco deve fazer.
import fs from 'node:fs';
import { descomprimir, comprimirLiterais } from './lz.mjs';
import { pecaDoPar, blocoDaIrma } from './pecas.mjs';
import { cabecalhoDoBloco, decodificar, expandir, codificarComoJogo } from './escape.mjs';
import { anatomiaDoSave } from './cam.mjs';
import { comAtributos, comEquipe, unidadesDoCore } from './roster_cam.mjs';

export const NIVEIS = ['Total Defeat', 'Major Defeat', 'Tactical Defeat', 'Minor Defeat', 'Draw', 'Minor Victory', 'Tactical Victory', 'Major Victory', 'Total Victory'];
// O gerador de nomes do jogo deixa escapar um ")" no fim (25/10/2026, campanha UKR: "Romanyuk)", lider do 3rd Team, saiu
// ferido na b1 e, pulado por esta leitura, nunca foi oferecido para reposicao). Medido em 132 transicoes: e o unico
// caractere fora das letras que um nome traz; abrir o padrao a qualquer imprimivel pega lixo ("iC hB", "Yqt;L").
export const NOME = /^[A-Za-z](?:[A-Za-z'\-]{1,23}|[A-Za-z'\-]{1,22}\))$/;
const RESERVADOS = /^(Situation|Mission|Friendly|Enemy|Plan|Notes)/;
const ASSINATURA = Buffer.from([0x05, 0x04, 0x03]);   // o 4o byte varia (secao 111.21)

// Localiza o bloco do roster no save: primeiro `u32 tam | LZ` do resto que expande com "Situation".
export function expandirBloco(lz) {
  const h = cabecalhoDoBloco(lz); const d = decodificar(lz, h.esc, h.inicio, lz.length, h.atalhos);
  return { exp: Buffer.from(expandir(Buffer.from(d.cru), d.tokens).completo), esc: h.esc };
}

// O BLOCO TEM DE PARECER UM ROSTER, nao so conter a palavra "Situation".
//
// Achar o bloco e varrer o resto do save procurando um `u32 tam` que descomprima — e QUALQUER
// deslocamento pode passar por acaso. Enquanto o roster era pequeno isso nunca deu problema; depois
// que o reforco reescreve o bloco com literais ele cresce de 6 KB para quase 1 MB, e um candidato
// falso oito bytes antes do certo passou a descomprimir em algo que continha "Situation" — o app
// leu o bloco errado e estourou lendo um tamanho de texto que nao existia (o erro que o autor viu
// ao comprar o Apache: "offset out of range... Received 44937").
//
// A checagem: o bloco expandido tem de ter os quatro textos com tamanhos que cabem nele e pelo
// menos um bloco de unidade com contagem plausivel. E barato porque so roda no candidato que ja
// passou pelo "Situation".
function pareceRoster(lz) {
  let exp;
  try { exp = expandirBloco(lz).exp; } catch { return false; }
  const t0 = exp.indexOf(Buffer.from([0x04, 0, 0, 0]));
  if (t0 < 0) return false;
  let o = t0 + 4;
  for (let k = 0; k < 4; k++) {
    if (o + 2 > exp.length) return false;
    const L = exp.readUInt16LE(o);
    if (L > 4000 || o + 2 + L > exp.length) return false;
    o += 2 + L;
  }
  if (exp.indexOf('Situation', 0, 'latin1') < 0) return false;
  for (let q = exp.indexOf(ASSINATURA, 0); q >= 0; q = exp.indexOf(ASSINATURA, q + 4)) {
    const n = exp.readUInt32LE(q + 4);
    if (q >= 15 && n >= 0 && n <= 60) return true;
  }
  return false;
}

export function localizarRoster(caminho) {
  const a = anatomiaDoSave(caminho); const resto = a.b.subarray(a.restoIni);
  const recusados = [];
  for (let p = 0; p + 8 < Math.min(resto.length, 400000); p++) {
    const t = resto.readUInt32LE(p); if (t < 500 || p + 4 + t > resto.length) continue;
    let lz;
    try { lz = Buffer.from(descomprimir(resto.subarray(p + 4, p + 4 + t), 0).saida); } catch { continue; }
    if (lz.indexOf('Situation', 0, 'latin1') < 0) continue;
    if (!pareceRoster(lz)) { recusados.push(p); continue; }
    return { anatomia: a, pos: a.restoIni + p, tam: t, lz, recusados };
  }
  throw new Error(`roster nao encontrado no save${recusados.length ? ` (${recusados.length} candidato(s) tinham "Situation" mas nao a forma de um roster)` : ''}`);
}


// Soldados na ordem do bloco (buffer qualquer: expandido ou escapado — os nomes sao iguais nos dois).
export function soldadosDoBloco(buf) {
  const out = [];
  for (let o = 2; o + 4 < buf.length; o++) {
    const L = buf.readUInt16LE(o - 2); if (L < 3 || L > 24 || o + L >= buf.length) continue;
    const s = buf.toString('latin1', o, o + L); if (!NOME.test(s) || RESERVADOS.test(s)) continue;
    out.push({ o, nome: s, estado: buf[o + L], posEstado: o + L }); o += L;
  }
  // O SOBRENOME DE DUAS LETRAS (08/11/2026, autor: "alguns soldados estao voltando feridos. Isso so acontece com
  // americanos"). O "Su" da Squad (Rifle) #1 da Stryker TF (core 289) era pulado pelo `L < 3`: nunca curado (entrou na b10
  // ferido) e, sem ele, o reset dava a cada homem depois dele a arma da vaga anterior. Duas letras so entram com cerca:
  // dentro do trecho de uma unidade (`05 04 03` + u32 n), so enquanto ela tem menos homens visiveis que n, nome
  // maiuscula+minuscula e a forma do registro (estado <= 3, `00`, classe 2..8). Em 1.154 saves: Su, Ha e Le, cada um
  // completando a unidade dele; "JP", "AZ", "ki", "Of" ficam de fora. No buffer escapado o n nao e legivel e nada entra.
  const assin = [];
  for (let q = buf.indexOf(ASSINATURA, 0); q >= 0; q = buf.indexOf(ASSINATURA, q + 4)) {
    if (q >= 15 && q + 8 <= buf.length) { const n = buf.readUInt32LE(q + 4); if (n <= 60) assin.push({ q, n }); }
  }
  const extras = [];
  assin.forEach(({ q, n }, k) => {
    const fim = k + 1 < assin.length ? assin[k + 1].q : buf.length;
    let vis = out.filter((x) => x.o > q && x.o < fim).length;
    for (let o = q + 8; vis < n && o + 4 < fim; o++) {
      if (buf.readUInt16LE(o - 2) !== 2) continue;
      const s = buf.toString('latin1', o, o + 2), e = o + 2;
      if (!/^[A-Z][a-z]$/.test(s) || buf[e] > 3 || buf[e + 1] !== 0 || buf[e + 2] < 2 || buf[e + 2] > 8) continue;
      extras.push({ o, nome: s, estado: buf[e], posEstado: e }); vis++; o += 2;
    }
  });
  if (extras.length) { out.push(...extras); out.sort((a, b) => a.o - b.o); }
  return out;
}

// A CAUDA DO SOLDADO: o inventario (secao 113.1).
//
//   [cabeca][u32 n][n x 3 B][rabo]
//
// A cabeca tem 15 bytes no caso comum e cresce em quem carrega mais de uma arma (15, 19, 20, 23,
// 27 medidos). O primeiro par depois do `00` inicial e a ARMA, em `u8 CLASSE | u8 ITEM`:
//
//   classe 02  arma pessoal   (fuzil, metralhadora de esquadrao, fuzil de precisao)
//   classe 03  arma de guarnicao — so aparece onde a unidade tem uma: Grenade Launcher Team
//              (03 26), Squad (Weapons) (03 11)
//   classe 08  SEM ARMA — e o `08 00` do homem saqueado da 111.14
//
// O rabo tem 20 bytes quando ha um `d0` no penultimo byte e 14 quando nao ha (10 e 16 aparecem em
// poucos casos). Medida sobre 3977 homens de 38 saves: esta leitura consome 97,2% das caudas ate o
// ultimo byte, e das que sobram 100 de 111 sao caudas de mais de 100 B — fatia errada do coletor,
// nao gramatica. Falta nomear os itens: os nomes das armas nao estao no executavel, entao ou saem
// dos .brz ou da tela.
const RABOS = [20, 16, 14, 12, 10, 8, 6];
export function lerCauda(cauda) {
  const b = Buffer.from(cauda);
  const arma = b.length >= 3 ? { classe: b[1], item: b[2] } : null;
  // QUEM LIDERA. O bit 0x80 do byte 7 marca o homem que comanda, e o 0x40 junto separa duas
  // especies: em 832 unidades de todos os saves, 372 tem um so `0xc0` e 336 um so `0x80` — 85%
  // tem exatamente um marcado. Num esquadrao dizimado a marca esta no SOBREVIVENTE (o core 51 do
  // save do autor perdeu oito de nove e o unico de pe e quem a carrega), entao ela acompanha quem
  // manda agora, nao quem mandava. Unidade pequena (tripulacao, dupla) as vezes nao tem nenhum.
  const chefia = b.length >= 8 ? (b[7] & 0xc0) : 0;
  const lidera = chefia !== 0;
  const chefeDaUnidade = chefia === 0xc0;
  // ONDE A CABECA COMECA: DEPOIS DO VETOR DE MUNICAO, e nao onde a busca casar primeiro (E81).
  //
  // Esta funcao procurava o comeco das listas varrendo byte a byte e ficando com a primeira posicao
  // que parseasse ate o fim da cauda. Com o teto antigo de 12 entradas por lista isso escondia
  // inventario: o RPK do 3rd Squad do autor carregava DUAS listas, uma de 13 granadas e outra de 3,
  // e a de 13 era rejeitada pelo teto — a busca escorregava para a de 3, que por acaso tambem fecha
  // no fim da cauda. O app lia 3 granadas onde o homem tinha 16, o painel do jogo mostrava 25 onde
  // eu somava 19, e o refit "aparava" a lista errada. Foi o autor quem viu: "acho que tem mais coisa
  // nesse inventario que nao aparece na tela".
  //
  // A cabeca e deterministica — o vetor de municao (113.6) diz onde acaba — e so quando ela nao
  // fecha e que se volta a varrer. O teto sobe de 12 para 60: 12 nao e uma medida, e um chute, e
  // um homem com 13 granadas existe.
  const MAX_ENTRADAS = 60;
  const parse = (cabeca, rabo) => {
    let p = cabeca; const listas = [];
    while (p + 4 + rabo <= b.length) {
      const n = b.readUInt32LE(p);
      if (n > MAX_ENTRADAS || p + 4 + 3 * n + rabo > b.length) return null;
      listas.push([...Array(n)].map((_, k) => [b[p + 4 + 3 * k], b[p + 5 + 3 * k], b[p + 6 + 3 * k]]));
      p += 4 + 3 * n;
      if (p + rabo === b.length) return listas;
    }
    return null;
  };
  const paiol = paiolDe(b);
  const certa = paiol ? paiol.off + 2 + 4 * paiol.n : null;
  if (certa !== null) {
    for (const rabo of RABOS) {
      const listas = parse(certa, rabo);
      if (listas) return { ok: true, arma, lidera, chefeDaUnidade, cabeca: certa, cabecaCerta: true, listas, rabo, bytes: b.length };
    }
  }
  for (const rabo of RABOS) {
    for (let cabeca = 8; cabeca + 4 + rabo <= b.length; cabeca++) {
      const listas = parse(cabeca, rabo);
      if (listas) return { ok: true, arma, lidera, chefeDaUnidade, cabeca, cabecaCerta: false, listas, rabo, bytes: b.length };
    }
  }
  return { ok: false, arma, lidera, chefeDaUnidade, bytes: b.length };
}

// ONDE MORA O VETOR DE MUNICAO (113.6, E60). A cabeca e `[00][A1][00][A2][00][flags][?]` e o
// `u16 nMun` vem em +9 — MENOS quando o bit 0x20 das flags esta ligado: ai ha um byte a mais
// (sempre `01`; 161 homens em 272 saves, todos com o bit, nenhum sem ele) e o nMun vem em +10.
// O app lia esse `01 00` como "um item" num granadeiro americano, via um par fantasma (item 768,
// qtd 0) e inseria os pares novos no meio do `u32 n3` — "Out of memory" a 5% na batalha 4 da
// EASY2. Todo leitor e todo escritor do vetor passam por aqui. So a classe de arma 2..5 ou 8 e um
// registro de homem; o registro compacto de 17 B (classe 0, byte 6 != 0) nao tem vetor nenhum.
export function posPaiol(buf, ini) { return ini + 9 + ((buf[ini + 7] & 0x20) ? 1 : 0); }
export function paiolDe(cauda) {
  if (!cauda || cauda.length < 12 || cauda[0] !== 0 || cauda[3] !== 0 || cauda[6] !== 0) return null;
  // classe 7 = o TUBO do morteiro (118.5): o homem que o carrega tem o mesmo vetor, com o HE e a fumaca do
  // tubo (82mm 285/286 no 2B14). Fora da lista, o reset de fabrica nunca os repunha (30/09).
  if (![2, 3, 4, 5, 7, 8].includes(cauda[1])) return null;
  const off = posPaiol(cauda, 0);
  if (off + 2 > cauda.length) return null;
  const n = cauda.readUInt16LE(off);
  if (n > 20 || off + 2 + n * 4 > cauda.length) return null;
  const pares = [];
  for (let k = 0; k < n; k++) pares.push({ item: cauda.readUInt16LE(off + 2 + k * 4), qtd: cauda.readUInt16LE(off + 4 + k * 4) });
  return { off, n, pares };
}

// A GRANADA NAO ESTA NO VETOR DE MUNICAO (113.7, E67). O painel de uma unidade escreve uma linha
// "Grenade N" e NAO existe item nenhum do vetor que de N: as granadas sao as entradas de 3 bytes das
// listas do rabo, uma entrada por granada — os dois primeiros bytes dizem o TIPO e o terceiro e
// sempre 0. Conferido por aritmetica em dois prints da `ZZ ARMAS UKR T1`:
//
//   core 213 (Squad (Recon), 6 homens)  3+3+3+2+3+3 = 17  e o painel diz "Grenade 17"
//   core   7 (HQ Support Team, 6 homens) 3+3+3+3+3+1 = 16  e o painel diz "Grenade 16"
//
// O TIPO E POR EXERCITO, como o id de arma (118.1): `1,2` e `1,4` nas unidades ucranianas e `1,1` e
// `1,3` nas americanas que entraram na EASY2 com o batalhao recrutado.
//
// RESSALVA HONESTA: nos dois casos provados cada homem tinha UMA lista. Ha homens com duas (o
// portador do AT-7 tem `1,2` numa e `1,5` noutra), e o que a segunda lista guarda nao esta provado —
// pode ser granada de outro tipo ou outra categoria de tralha. Por isso `granadasDe` devolve o total
// E a conta por tipo e por lista: quem for usar decide o que somar.
// REPOR GRANADA (113.7, E67/E69). Cresce o registro em 3 bytes por granada: sobe o `u32 n3` da
// PRIMEIRA lista e insere as entradas no fim dela. A mecanica e a da insercao de par de municao
// (113.3, E37) — o registro pode crescer, nunca encolher —, e o mesmo cuidado vale: o plano e
// calculado na posicao ORIGINAL e aplicado de tras para frente.
//
// So a PRIMEIRA lista. Ha homens com duas (o portador do AT-7 tem `1,2` numa e `1,5` noutra) e o
// que a segunda guarda nao esta provado; mexer nela seria escrever no escuro.
//
// `porHomem[i] = { '1,2': 3, '1,4': 1 }` e o ALVO por tipo. Quem ja tem o alvo nao e tocado.
export function reporGranadas(caminho, saida, porHomem) {
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);
  const caudas = recortarCaudas(exp);

  const planos = [];
  caudas.forEach((d, i) => {
    const alvo = porHomem instanceof Map ? porHomem.get(i) : porHomem[i];
    // SO A LEITURA DETERMINISTICA (01/10). A varredura de reserva "fecha" a gramatica em lugar errado:
    // no ultimo tripulante de um veiculo a cauda recortada engole o fim do bloco, e com o quadro de
    // abates depois do ff ff (110.13) ela leu quatro "granadas" — [37,0,255] [255,2,0] [72,0,1]
    // [0,94,5], as baixas inimigas, o proprio ff ff e os abates do T-90AM #2 da RUS1. O aparo cortou os
    // 12 B e a batalha 6 morreu a 5% com "Out of memory". Lista que nao comeca logo depois do vetor de
    // municao, ou cauda de mais de 100 B (recorte errado, 113.1), nao se escreve.
    if (!alvo || !d.ok || !d.listas?.length || !d.cabecaCerta || d.cauda.length > 100) return;
    // TODAS AS LISTAS CONTAM (E81). O homem pode ter mais de uma, e o que ele carrega e a soma: o
    // RPK do 3rd Squad do autor tinha 13 numa e 3 na outra. Contar so a primeira fazia o aparo
    // trabalhar contra um numero menor do que o real e deixar o excesso de pe.
    const tem = {};
    for (const lista of d.listas) for (const g of lista) { const k = `${g[0]},${g[1]}`; tem[k] = (tem[k] || 0) + 1; }
    const novas = [], tirar = {};
    for (const [tipo, qtd] of Object.entries(alvo)) {
      const [a, b] = tipo.split(',').map(Number);
      const falta = Number(qtd) - (tem[tipo] || 0);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 255 || b < 0 || b > 255) continue;
      for (let k = 0; k < falta; k++) novas.push([a, b, 0]);
      if (falta < 0) tirar[tipo] = -falta;          // acima da dotacao: volta para ela (E78)
    }
    // O EXCESSO SAI PELO FIM — da ULTIMA lista para a primeira, que e a ordem inversa da em que a
    // granada catada entrou. As que ficam mantem o terceiro byte, seja ele o que for, e cada lista
    // continua sendo a sua: o numero de listas nao muda, so o conteudo.
    const sobra = { ...tirar };
    const ficam = d.listas.map((l) => [...l]);
    for (let li = ficam.length - 1; li >= 0; li--) {
      const mantidas = [];
      for (let k = ficam[li].length - 1; k >= 0; k--) {
        const g = ficam[li][k], chave = `${g[0]},${g[1]}`;
        if (sobra[chave] > 0) { sobra[chave]--; continue; }
        mantidas.unshift(g);
      }
      ficam[li] = mantidas;
    }
    // As novas entram no fim da PRIMEIRA lista, que e onde o caminho provado em jogo as poe (E67).
    ficam[0] = [...ficam[0], ...novas];
    const antesTotal = d.listas.reduce((a, l) => a + l.length, 0);
    const depoisTotal = ficam.reduce((a, l) => a + l.length, 0);
    if (antesTotal === depoisTotal && !novas.length) return;
    // A regiao inteira das listas, do primeiro contador ao fim da ultima.
    const posN = d.ini + d.cabeca;
    const tamAntes = d.listas.reduce((a, l) => a + 4 + 3 * l.length, 0);
    if (exp.readUInt32LE(posN) !== d.listas[0].length) return;   // a conta nao fecha: nao mexo
    planos.push({ i, nome: d.nome, posN, ini: posN, fim: posN + tamAntes, n: antesTotal, novas, ficam, total: depoisTotal });
  });
  if (!planos.length) return { homens: 0, granadas: 0, detalhe: [] };

  // A LISTA E REESCRITA INTEIRA, de tras para frente. Antes isto so sabia ACRESCENTAR (colava os
  // bytes novos no fim e somava ao contador); com o aparo (E78) a lista pode encolher, e escrever o
  // trecho inteiro faz os dois casos pelo mesmo caminho — as que ficam na ordem original, as novas
  // no fim, exatamente onde ficavam.
  let novo = Buffer.from(exp);
  for (const p of [...planos].sort((a, b) => b.ini - a.ini)) {
    // cada lista com o seu contador, na ordem: `[u32 n][n x 3B]` repetido
    const pedacos = [];
    for (const lista of p.ficam) {
      const cab = Buffer.alloc(4); cab.writeUInt32LE(lista.length);
      const corpo = Buffer.alloc(lista.length * 3);
      lista.forEach(([a, b, c], k) => { corpo[k * 3] = a; corpo[k * 3 + 1] = b; corpo[k * 3 + 2] = c || 0; });
      pedacos.push(cab, corpo);
    }
    novo = Buffer.concat([novo.subarray(0, p.ini), Buffer.concat(pedacos), novo.subarray(p.fim)]);
  }

  const cresceu = planos.reduce((a, p) => a + (p.total - p.n) * 3, 0);
  if (novo.length !== exp.length + cresceu) {
    throw new Error(`a reposicao mudou ${novo.length - exp.length} bytes e devia mudar ${cresceu}`);
  }

  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  // CONFERENCIA NO ARQUIVO GRAVADO. A granada mora no MESMO lugar que a gramatica usa para achar o
  // fim da cauda, entao um erro aqui nao aparece como granada errada: aparece como cauda ilegivel —
  // e cauda ilegivel foi o que ja tirou a arma e a municao da tela do jogador (119).
  const antes = lerRoster(caminho), depois = lerRoster(saida);
  if (antes.soldados.length !== depois.soldados.length) throw new Error('a reposicao mudou o numero de homens');
  const mexeu = depois.soldados.filter((s, i) => s.estado !== antes.soldados[i].estado);
  if (mexeu.length) throw new Error(`a reposicao mexeu no estado de ${mexeu.length} homens`);
  const novasCaudas = caudasDoRoster(saida);
  const legiveis = (l) => l.filter((x) => x.ok).length;
  if (legiveis(novasCaudas) < legiveis(caudas)) {
    throw new Error(`a reposicao deixou ${legiveis(caudas) - legiveis(novasCaudas)} caudas ilegiveis`);
  }
  for (const p of planos) {
    const g = granadasDe(novasCaudas[p.i]);
    const lido = g ? g.listas.reduce((a, l) => a + l.length, 0) : null;
    if (lido !== p.total) {
      throw new Error(`${p.nome}: as listas ficaram com ${lido ?? 'nada'} granadas e deviam ter ${p.total}`);
    }
  }

  return {
    homens: planos.length,
    granadas: planos.reduce((a, p) => a + p.novas.length, 0),
    tirou: planos.reduce((a, p) => a + (p.n - p.ficam.length), 0),
    cresceu,
    detalhe: planos.map((p) => ({ indice: p.i, nome: p.nome, de: p.n, para: p.total })),
  };
}

export function granadasDe(cauda) {
  const d = cauda && cauda.listas ? cauda : lerCauda(cauda?.cauda || cauda);
  if (!d || !d.ok) return null;
  const listas = (d.listas || []).map((l) => l.map((t) => ({ tipo: `${t[0]},${t[1]}`, terceiro: t[2] })));
  const porTipo = {};
  for (const l of listas) for (const g of l) porTipo[g.tipo] = (porTipo[g.tipo] || 0) + 1;
  return { total: listas.reduce((s, l) => s + l.length, 0), listas, porTipo };
}

// As caudas de um save inteiro, ja recortadas e lidas. O recorte vai do byte depois do ESTADO ate o
// `u16` de tamanho do proximo nome — ou ate o inicio do proximo bloco de unidade, o que vier antes,
// senao a cauda do ultimo homem de um esquadrao engole o cabecalho do esquadrao seguinte.
// ONDE CADA CAUDA COMECA E ACABA, no bloco JA EXPANDIDO. Saiu de dentro do `caudasDoRoster` quando
// a reposicao de granada (113.7) precisou das MESMAS fronteiras para escrever: ler por um caminho e
// escrever por outro e como o app descobriu o vetor de municao em +9 (E60) — duas contas do mesmo
// campo, uma delas errada.
export function recortarCaudas(exp) {
  const blocos = [];
  for (let q = exp.indexOf(ASSINATURA, 0); q >= 0; q = exp.indexOf(ASSINATURA, q + 4)) {
    const n = exp.readUInt32LE(q + 4);
    if (n >= 0 && n <= 60 && q >= 15) blocos.push({ ini: q - 15, tipo: exp.readUInt16LE(q - 11) });
  }
  const sold = soldadosDoBloco(exp);
  const proximoBloco = (o) => { const x = blocos.find((y) => y.ini > o); return x ? x.ini : exp.length; };
  const dono = (o) => { let u = null; for (const x of blocos) { if (x.ini < o) u = x; else break; } return u; };
  return sold.map((s, i) => {
    const ini = s.posEstado + 1;
    const fim = Math.max(ini, Math.min(sold[i + 1] ? sold[i + 1].o - 2 : exp.length, proximoBloco(s.o)));
    return {
      indice: i, nome: s.nome, estado: s.estado, tipo: dono(s.o)?.tipo ?? null, ini, fim,
      cauda: exp.subarray(ini, fim),
      ...lerCauda(exp.subarray(ini, fim)),
    };
  });
}

export function caudasDoRoster(caminho) {
  const loc = localizarRoster(caminho);
  const { exp } = expandirBloco(loc.lz);
  return recortarCaudas(exp);
}

export function lerRoster(caminho) {
  const loc = localizarRoster(caminho); const { exp } = expandirBloco(loc.lz);
  // textos: `u32 4` seguido de quatro `u16 len | texto`
  const t0 = exp.indexOf(Buffer.from([0x04, 0, 0, 0])); const textos = []; let o = t0 + 4;
  for (let k = 0; k < 4; k++) { const L = exp.readUInt16LE(o); textos.push(exp.toString('latin1', o + 2, o + 2 + L)); o += 2 + L; }
  // Entre o fim dos textos e "Situation" ha 57 bytes fixos: o AAR DA ULTIMA BATALHA, 24 bytes por
  // lado (azul, depois vermelho): `u32 mortos | u32 feridos | u32 desaparecidos | u16 tanques |
  // u16 blindados | u16 outros veiculos | u16 aeronaves | u32 pontos` — zeros enquanto nao houve
  // batalha; depois o byte [PLAYER FORCE] (1 red, 0 blue), 2 zeros, um byte 01 na transicao,
  // 3 zeros, `9b 00`. Medido em 111.13: E2 = azul 18/18/0/1/0/0/0/0, vermelho 16/14/0/0/4/0/0/0 —
  // o AAR da batalha 1 ao pe da letra, com morto e ferido SEPARADOS (o save de batalha nunca teve,
  // secao 100); E3 = azul 1/1 e 1000 pontos, vermelho 4/1 e 3 blindados.
  const sit = exp.indexOf('Situation', 0, 'latin1') - 2;
  const playerForce = exp[sit - 9] === 1 ? 'red' : 'blue';
  const lado = (b) => ({ mortos: exp.readUInt32LE(b), feridos: exp.readUInt32LE(b + 4), desaparecidos: exp.readUInt32LE(b + 8),
    tanques: exp.readUInt16LE(b + 12), blindados: exp.readUInt16LE(b + 14), outrosVeiculos: exp.readUInt16LE(b + 16), aeronaves: exp.readUInt16LE(b + 18), pontos: exp.readUInt32LE(b + 20) });
  const aar = sit - o === 57 ? { azul: lado(o), vermelho: lado(o + 24) } : null;
  // unidades pela assinatura `05 04 03 00 | u32 n`; os soldados de uma unidade sao os que ficam
  // ENTRE a sua assinatura e a seguinte — uma unidade core nao instanciada na batalha (apagada,
  // off-map) tem n nominal e nenhum soldado nomeado
  const sold = soldadosDoBloco(exp); const assin = [];
  let q = exp.indexOf(ASSINATURA, o);
  while (q >= 0) { const n = exp.readUInt32LE(q + 4); if (n >= 0 && n <= 60 && q >= 15) assin.push(q); q = exp.indexOf(ASSINATURA, q + 4); }
  // O `indice` e a posicao do homem na lista PLANA — a mesma que `escreverEstados` usa para
  // decidir quem volta. Sem ele nao da para dizer de que esquadrao e cada baixa.
  const unidades = assin.map((q, k) => {
    const n = exp.readUInt32LE(q + 4), fimU = assin[k + 1] ?? exp.length;
    const meus = sold.map((s, i) => ({ s, i })).filter((x) => x.s.o > q && x.s.o < fimU).slice(0, n);
    return { coreId: exp.readUInt32LE(q - 15), tipo: exp.readUInt16LE(q - 11), n, soldados: meus.map(({ s, i }) => ({ indice: i, nome: s.nome, estado: s.estado, vivo: s.estado <= 1 })), pos: q };
  });
  // resultado: sufixo `u32 batalhasJogadas | por batalha (u16 0, u8 nivel, u8 venceu)`. O u16
  // zerado faz parte da regra: o DEPLOYMENT (nenhuma batalha) tem lixo plausivel no lugar.
  const resultados = []; const fim = exp.length;
  for (let nb = 1; nb <= 30; nb++) {
    const base = fim - 4 * nb - 4; if (base < 0) break;
    if (exp.readUInt32LE(base) !== nb) continue;
    const lidos = [];
    for (let k = 0; k < nb; k++) { const e = base + 4 + 4 * k; const nivel = exp[e + 2], venceu = exp[e + 3];
      if (exp.readUInt16LE(e) !== 0 || nivel > 8 || venceu > 1) { lidos.length = 0; break; }
      lidos.push({ nivel, rotulo: NIVEIS[nivel], venceu: venceu === 1 }); }
    if (lidos.length === nb) { resultados.push(...lidos); break; }
  }
  const total = sold.length, vivos = sold.filter((s) => s.estado <= 1).length;
  return { arquivo: caminho, textos, playerForce, aar, unidades, soldados: sold.map((s) => ({ nome: s.nome, estado: s.estado })), total, vivos, baixas: total - vivos, resultados, batalhasJogadas: resultados.length, pos: loc.pos, tam: loc.tam };
}

// REFORCO POR HOMEM: `decide(soldado, indice)` devolve o estado novo (1 = vivo) ou undefined.
// Patch no fluxo escapado (sem recodificar), LZ reescrita com literais, u32 tam novo.
export function escreverEstados(caminho, decide, saida) {
  const loc = localizarRoster(caminho); const lz = Buffer.from(loc.lz);
  const sold = soldadosDoBloco(lz); let mudados = 0;
  sold.forEach((s, i) => {
    const novo = decide(s, i); if (novo === undefined || novo === s.estado) return;
    if (novo === 0) throw new Error('nao grave estado 0 no fluxo escapado (zero solto); use 1 para vivo');
    lz[s.posEstado] = novo; mudados++;
  });
  const comp = comprimirLiterais(lz); const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  const out = Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]);
  fs.writeFileSync(saida, out);
  return { mudados, tamanho: out.length, soldados: sold.length };
}

// REFORCO DE VERDADE: o homem volta SAO e ARMADO (secao 116).
//
// `escreverEstados` acima escreve no fluxo ESCAPADO, onde um zero solto vira token — por isso ele
// recusa o estado 0 e o app vinha gravando 1. Mas 1 e "ferido leve": o autor viu os esquadroes
// voltarem inteiros e machucados, e alguns homens sem arma nenhuma.
//
// As duas metades ja tinham sido provadas em jogo e nunca foram juntadas no app:
//   E4B  estado 0 = sao, escrito no bloco EXPANDIDO e recodificado (o caminho daqui);
//   E4C  o socorro esvazia o inventario do caido (secao 105) e reviver nao devolve a arma —
//        quem volta desarmado recebe a cauda de um companheiro sao da mesma unidade.
//
// A cauda tem tamanho variavel, entao o bloco e remontado em pedacos em vez de remendado no lugar.
//
// O REARME CUSTOU DOIS "OUT OF MEMORY" E A LICAO E UMA SO: nao se emenda cauda. O E28 clonou a
// cauda inteira, o E29 clonou so a frente dela, e o jogo recusou os dois. A leitura byte a byte
// explicou por que: o registro do homem tem contadores proprios (`u16 nMun`, `u32 n3`) e o ultimo
// homem de cada unidade ainda carrega o `ff ff` que fecha as vagas do TO&E, com rabo de 14 ou 18 em
// vez de 20. Hoje o rearme escreve DOIS BYTES no lugar — classe e item da arma — e o bloco sai com
// o mesmo tamanho que entrou; a conferencia no fim desta funcao recusa a gravacao se mudar.
//
// `armas` (opcional) e a MEMORIA DE QUEM CARREGAVA O QUE: `{ indice: {classe, item} }`. Quando o
// app sabe qual era a arma daquele homem numa batalha anterior, ela vale mais que qualquer palpite;
// sem ela vale a arma mais comum da unidade.
export function reforcar(caminho, saida, indices, { rearmar = true, armas = null } = {}) {
  const alvos = new Set(indices);
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);

  const blocos = [];
  for (let q = exp.indexOf(ASSINATURA, 0); q >= 0; q = exp.indexOf(ASSINATURA, q + 4)) {
    const n = exp.readUInt32LE(q + 4);
    if (n >= 0 && n <= 60 && q >= 15) blocos.push(q - 15);
  }
  const proximoBloco = (o) => { const x = blocos.find((y) => y > o); return x === undefined ? exp.length : x; };
  const brutos = soldadosDoBloco(exp);
  const sold = brutos.map((x, i) => {
    const ini = x.posEstado + 1;
    const proximoHomem = brutos[i + 1] ? brutos[i + 1].o - 2 : exp.length;
    return {
      ...x, i, ini,
      fim: Math.max(ini, Math.min(proximoHomem, proximoBloco(x.o))),
      unidade: blocos.filter((b2) => b2 < x.o).pop() ?? -1,
    };
  });

  const cauda = (x) => exp.subarray(x.ini, x.fim);
  const semArma = (x) => { const c = cauda(x); return c.length >= 3 && c[1] === 0x08; };

  // A ARMA DA UNIDADE: a mais COMUM entre os companheiros que ainda tem uma. O que manda e a
  // contagem — duas pessoas com o mesmo fuzil dizem qual e o fuzil do esquadrao —, e o bit de
  // comando so desempata para baixo, porque o chefe costuma levar coisa diferente do resto.
  const armaDaUnidade = (todos, x, cauda1) => {
    const conta = new Map();
    for (const y of todos) {
      if (y.unidade !== x.unidade || y === x) continue;
      const c = cauda1(y);
      if (c.length < 3 || c[1] === 0x08) continue;
      const chave = `${c[1]}/${c[2]}`;
      const a = conta.get(chave) || { classe: c[1], item: c[2], peso: 0 };
      a.peso += c.length > 7 && (c[7] & 0xc0) ? 6 : 10;
      conta.set(chave, a);
    }
    return [...conta.values()].sort((p, q) => q.peso - p.peso)[0] || null;
  };

  const pedacos = []; let cursor = 0;
  const feitos = [];
  for (const x of sold) {
    const reforcar1 = alvos.has(x.i);
    const estado = reforcar1 ? 0 : x.estado;
    let minha = cauda(x);
    let rearmado = false; let dele = false;
    if (reforcar1 && rearmar && semArma(x)) {
      // DOIS BYTES, NO LUGAR. Emendar cauda derrubou o jogo duas vezes (E28 com a cauda inteira,
      // E29 com so a frente dela), e a leitura byte a byte explicou: o registro nao e um bloco
      // solto que se troca por outro. O ULTIMO HOMEM DE CADA UNIDADE carrega o `ff ff` que fecha as
      // vagas do TO&E (o mesmo terminador do E7) e por isso tem rabo de 14 ou 18 em vez de 20 — o
      // Skidmore e um desses. Qualquer emenda ali move o terminador de lugar.
      //
      // O saqueado nao perde estrutura: ele continua com o registro inteiro e so a arma virou
      // `08 00`. Entao devolver a arma e escrever CLASSE e ITEM por cima, sem mover um byte.
      // Municao nao vem junto (a lista tem tamanho proprio) — quem repoe isso e o resupply do jogo
      // na virada da batalha.
      const pedida = armas ? (armas instanceof Map ? armas.get(x.i) : armas[x.i]) : null;
      // ARMA LEMBRADA SO VALE SE FOR ARMA. O teste era so `!== 0x08`, e um `{classe: NaN}` vindo de
      // uma linha de tabela lida errado passou por ele: o Buffer gravou NaN como zero e o homem
      // entrou em campo com `0/0`, sem arma nenhuma no painel (E73). Classe util e 1..7.
      const vale = pedida && Number.isInteger(pedida.classe) && Number.isInteger(pedida.item)
        && pedida.classe > 0 && pedida.classe < 8 && pedida.item >= 0 && pedida.item <= 255;
      const lembrada = vale ? pedida : null;
      const arma = lembrada || armaDaUnidade(sold, x, cauda);
      if (arma) {
        minha = Buffer.from(minha);
        minha[1] = arma.classe; minha[2] = arma.item;
        rearmado = true; dele = !!lembrada;
      }
    }
    if (reforcar1) feitos.push({ indice: x.i, nome: x.nome, de: x.estado, para: estado, rearmado, armaDele: dele });
    pedacos.push(exp.subarray(cursor, x.posEstado), Buffer.from([estado]), minha);
    cursor = x.fim;
  }
  pedacos.push(exp.subarray(cursor));
  const novo = Buffer.concat(pedacos);

  // A TRAVA QUE CUSTOU DOIS "OUT OF MEMORY": o reforco escreve por cima e nao move nada. Se o bloco
  // mudou de tamanho, alguem voltou a emendar cauda — nao grava (E28, E29).
  if (novo.length !== exp.length) {
    throw new Error(`o reforco mudou o tamanho do bloco: ${exp.length} -> ${novo.length} — foi assim que o jogo disse "Out of memory" no E28 e no E29`);
  }

  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  // Conferencia no arquivo GRAVADO: todo alvo tem de estar de pe e com arma, e ninguem mais pode
  // ter mudado de estado.
  const v = lerRoster(saida);
  if (v.soldados.length !== sold.length) throw new Error(`o reforco mudou o numero de homens: ${sold.length} -> ${v.soldados.length}`);
  const vCaudas = caudasDoRoster(saida);
  for (const f of feitos) {
    if (v.soldados[f.indice].estado !== 0) throw new Error(`${f.nome} devia voltar sao e o arquivo diz estado ${v.soldados[f.indice].estado}`);
    const c = vCaudas[f.indice];
    if (f.rearmado && (c?.arma?.classe === 0x08 || !(c?.arma?.classe > 0 && c.arma.classe < 8))) throw new Error(`${f.nome} continuou sem arma depois do reforco: classe ${c?.arma?.classe}`);
    void c;
  }
  const mexidosDemais = v.soldados.filter((x, i) => !alvos.has(i) && x.estado !== sold[i].estado);
  if (mexidosDemais.length) throw new Error(`o reforco mexeu em ${mexidosDemais.length} homens que ninguem pediu`);

  // O QUE DERRUBOU O JOGO NO E28, checado no arquivo gravado: os quatro bytes proprios de cada
  // homem (os que ficam logo antes dos seis zeros e do `d0`) nao podem ter ficado repetidos.
  const proprio = (c2) => (c2 && c2.length >= 12 ? c2.subarray(c2.length - 12, c2.length - 8).toString('hex') : null);
  const antesDist = new Set(sold.map((x) => proprio(exp.subarray(x.ini, x.fim))).filter(Boolean));
  const depoisDist = new Set(vCaudas.map((x) => proprio(x.cauda)).filter(Boolean));
  if (depoisDist.size < antesDist.size) {
    throw new Error(`o reforco repetiu o campo proprio de algum homem: ${antesDist.size} valores distintos viraram ${depoisDist.size} — foi isto que derrubou o jogo no E28`);
  }

  return { reforcados: feitos.length, rearmados: feitos.filter((f) => f.rearmado).length, comArmaPropria: feitos.filter((f) => f.armaDele).length, soldados: sold.length, homens: feitos };
}

// REABASTECER: a municao volta a dotacao da vaga (secao 110.6 / 113.2).
//
// A campanha manda ressuprimento zero (era o modelo que o app clonava), e mesmo com o percentual
// corrigido o jogo nao reabastece um save que ja foi escrito: a municao da batalha seguinte foi
// congelada no roster quando a transicao foi gravada. Entao o app repoe.
//
// So a QUANTIDADE e escrita — `u16`, no lugar, sem mexer em tamanho. Acrescentar um item que o
// homem nao tem mudaria o tamanho do registro, e foi isso que derrubou o jogo no E28 e no E29:
// quem perdeu a lista inteira (o saqueado) fica com a arma e sem paiol proprio ate a proxima
// batalha que o jogo mesmo montar.
//
// `porHomem`: `{ indice: { item: quantidade } }`. Item que o homem nao carrega e ignorado.
//
// `exato` (E76): a quantidade pedida e a quantidade escrita, PARA CIMA OU PARA BAIXO. E o que o
// refil por unidade (`poolLoads`) precisa: o paiol de um esquadrao e um bolo so que o jogo reparte
// como quer, entao por o esquadrao na dotacao e tirar de um homem o que se da a outro. Continua
// sendo um `u16` escrito no lugar — nada muda de tamanho — e o minimo e 1: par com quantidade zero
// o jogo nunca escreveu (ele apaga o par), entao este escritor tambem nao escreve.
export function reabastecer(caminho, saida, porHomem, { fracao = 1, exato = false } = {}) {
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);
  const brutos = soldadosDoBloco(exp);

  const novo = Buffer.from(exp);
  const feitos = [];
  brutos.forEach((x, i) => {
    const alvo = porHomem instanceof Map ? porHomem.get(i) : porHomem[i];
    if (!alvo) return;
    const ini = x.posEstado + 1;
    if (!paiolDe(novo.subarray(ini, Math.min(novo.length, ini + 64)))) return;   // registro que a gramatica nao entende
    const posN = posPaiol(novo, ini);
    const n = novo.readUInt16LE(posN);
    if (n > 20 || posN + 2 + n * 4 > novo.length) return;
    let mexidos = 0, antes = 0, depois = 0;
    for (let k = 0; k < n; k++) {
      const o = posN + 2 + k * 4;
      const item = novo.readUInt16LE(o);
      const cheio = alvo[item];
      if (!Number.isInteger(cheio) || cheio < 0 || cheio > 65535) continue;
      const tinha = novo.readUInt16LE(o + 2);
      if (!exato && tinha >= cheio) continue;                // ja esta cheio (ou passou disso)
      // `fracao` e o percentual de ressuprimento da campanha: 1 devolve a dotacao inteira, 0.5
      // devolve metade do que falta, 0 nao devolve nada. No modo exato vale para os dois lados.
      const alvoQtd = exato
        ? Math.max(1, tinha + Math.round((cheio - tinha) * fracao))
        : Math.min(cheio, tinha + Math.round((cheio - tinha) * fracao));
      if (exato ? alvoQtd === tinha : alvoQtd <= tinha) continue;
      novo.writeUInt16LE(alvoQtd, o + 2);
      mexidos++; antes += tinha; depois += alvoQtd;
    }
    if (mexidos) feitos.push({ indice: i, nome: x.nome, itens: mexidos, de: antes, para: depois });
  });

  if (novo.length !== exp.length) throw new Error(`o reabastecimento mudou o tamanho do bloco: ${exp.length} -> ${novo.length}`);

  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  // Conferencia no arquivo gravado: ninguem pode ter perdido municao, e o numero de homens e o
  // estado de cada um continuam os mesmos.
  const antesR = lerRoster(caminho), depoisR = lerRoster(saida);
  if (antesR.soldados.length !== depoisR.soldados.length) throw new Error('o reabastecimento mudou o numero de homens');
  const mexeu = depoisR.soldados.filter((s, i) => s.estado !== antesR.soldados[i].estado);
  if (mexeu.length) throw new Error(`o reabastecimento mexeu no estado de ${mexeu.length} homens`);

  return { homens: feitos.length, itens: feitos.reduce((a, f) => a + f.itens, 0), balas: feitos.reduce((a, f) => a + (f.para - f.de), 0), detalhe: feitos };
}

// ACRESCENTAR UM ITEM DE MUNICAO AO HOMEM QUE NAO TEM ONDE RECEBER (E37, em teste).
//
// `reabastecer` so escreve quantidade em cima de um par que ja existe. Quem perdeu a lista inteira
// fica de fora — e sao 9 dos 105 homens do save do autor, quatro deles BAIXAS SAQUEADAS. Quando ele
// paga 30 creditos para repor uma, o homem volta com a arma da vaga e com zero bala.
//
// Consertar exige inserir `[u16 item][u16 qtd]` e incrementar o `u16 n` — ou seja, o registro do
// soldado CRESCE, que e o que o E28 e o E29 nao conseguiram fazer. Mas os dois SUBSTITUIAM a cauda
// de um homem pela de outro; isto aqui insere quatro bytes dentro do vetor e nao mexe em mais nada.
// E o bloco do roster ja cresce sem problema quando `crescerRoster` acrescenta unidades (E14A).
//
// ATE O E37 RESPONDER, isto nao entra em nenhum caminho do app: e chamado so pelo experimento.
//
// `porHomem`: `{ indice: { item: quantidade } }` — so os itens que o homem AINDA NAO TEM entram.
export function inserirMunicao(caminho, saida, porHomem) {
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);
  const brutos = soldadosDoBloco(exp);

  // As insercoes sao calculadas na posicao ORIGINAL e aplicadas de tras para frente, para que um
  // deslocamento nao mova a posicao da insercao seguinte.
  const planos = [];
  brutos.forEach((x, i) => {
    const alvo = porHomem instanceof Map ? porHomem.get(i) : porHomem[i];
    if (!alvo) return;
    const ini = x.posEstado + 1;
    if (!paiolDe(exp.subarray(ini, Math.min(exp.length, ini + 64)))) return;   // registro que a gramatica nao entende
    const posN = posPaiol(exp, ini);
    const n = exp.readUInt16LE(posN);
    if (n > 20 || posN + 2 + n * 4 > exp.length) return;
    const tem = new Set();
    for (let k = 0; k < n; k++) tem.add(exp.readUInt16LE(posN + 2 + k * 4));
    const novos = Object.entries(alvo)
      .map(([item, qtd]) => [Number(item), Number(qtd)])
      .filter(([item, qtd]) => !tem.has(item) && Number.isInteger(item) && Number.isInteger(qtd) && qtd >= 0 && qtd <= 65535);
    if (!novos.length) return;
    planos.push({ i, nome: x.nome, posN, fimVetor: posN + 2 + n * 4, n, novos });
  });
  if (!planos.length) return { homens: 0, itens: 0, detalhe: [] };

  let novo = Buffer.from(exp);
  for (const p of [...planos].sort((a, b) => b.fimVetor - a.fimVetor)) {
    const extra = Buffer.alloc(p.novos.length * 4);
    p.novos.forEach(([item, qtd], k) => { extra.writeUInt16LE(item, k * 4); extra.writeUInt16LE(qtd, k * 4 + 2); });
    novo = Buffer.concat([novo.subarray(0, p.fimVetor), extra, novo.subarray(p.fimVetor)]);
    novo.writeUInt16LE(p.n + p.novos.length, p.posN);
  }

  const cresceu = planos.reduce((a, p) => a + p.novos.length * 4, 0);
  if (novo.length !== exp.length + cresceu) {
    throw new Error(`a insercao cresceu ${novo.length - exp.length} bytes e devia crescer ${cresceu}`);
  }

  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  // Conferencia no arquivo gravado: mesmos homens, mesmos estados, e a municao nova esta la.
  const antes = lerRoster(caminho), depois = lerRoster(saida);
  if (antes.soldados.length !== depois.soldados.length) throw new Error('a insercao mudou o numero de homens');
  const mexeu = depois.soldados.filter((s, i) => s.estado !== antes.soldados[i].estado);
  if (mexeu.length) throw new Error(`a insercao mexeu no estado de ${mexeu.length} homens`);
  const caudas = caudasDoRoster(saida);
  for (const p of planos) {
    const n = paiolDe(caudas[p.i].cauda)?.n;
    if (n !== p.n + p.novos.length) throw new Error(`${p.nome}: o vetor ficou com ${n} itens e devia ter ${p.n + p.novos.length}`);
  }

  return { homens: planos.length, itens: planos.reduce((a, p) => a + p.novos.length, 0), cresceu, detalhe: planos.map((p) => ({ indice: p.i, nome: p.nome, de: p.n, para: p.n + p.novos.length, itens: p.novos })) };
}

// TIRAR DO PAIOL O QUE A VAGA NAO LEVA (plano de reset, 28/09) — o inverso da insercao.
//
// "Nada do que se ganha em batalha atravessa" (autor, 20/09): o cartucho de Javelin que um engenheiro
// russo pegou do chao, o calibre de uma arma que ele largou. Ate aqui o refit so escrevia quantidade,
// no minimo 1, porque encolher o registro nunca tinha sido tentado — o E28/E29 derrubaram o jogo
// SUBSTITUINDO a cauda, e o E37 provou que o vetor cresce. Aqui o vetor encolhe 4 bytes por par, o
// `n` desce, e a conferencia exige o encolhimento exato. A prova em jogo e a sessao T2 do plano.
//
// `porHomem`: `{ indice: [item, item...] }`.
export function removerMunicao(caminho, saida, porHomem) {
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);
  const brutos = soldadosDoBloco(exp);
  const planos = [];
  brutos.forEach((x, i) => {
    const alvo = porHomem instanceof Map ? porHomem.get(i) : porHomem[i];
    if (!alvo || !alvo.length) return;
    const ini = x.posEstado + 1;
    if (!paiolDe(exp.subarray(ini, Math.min(exp.length, ini + 64)))) return;
    const posN = posPaiol(exp, ini);
    const n = exp.readUInt16LE(posN);
    if (n > 20 || posN + 2 + n * 4 > exp.length) return;
    const tirar = new Set(alvo.map(Number));
    const sai = [];
    for (let k = 0; k < n; k++) if (tirar.has(exp.readUInt16LE(posN + 2 + k * 4))) sai.push(k);
    if (!sai.length) return;
    planos.push({ i, nome: x.nome, posN, n, sai, itens: sai.map((k) => exp.readUInt16LE(posN + 2 + k * 4)) });
  });
  if (!planos.length) return { homens: 0, itens: 0, detalhe: [] };

  let novo = Buffer.from(exp);
  // Os contadores PRIMEIRO, nas posicoes originais: escrever nao desloca nada, e cortar desloca — o
  // corte de um homem anterior move o contador do seguinte (foi o erro da primeira versao).
  for (const p of planos) novo.writeUInt16LE(p.n - p.sai.length, p.posN);
  // depois os cortes, de tras para frente, para que um nao desloque o outro
  const cortes = planos.flatMap((p) => p.sai.map((k) => ({ p, o: p.posN + 2 + k * 4 }))).sort((a, b) => b.o - a.o);
  for (const c of cortes) novo = Buffer.concat([novo.subarray(0, c.o), novo.subarray(c.o + 4)]);

  const encolheu = cortes.length * 4;
  if (novo.length !== exp.length - encolheu) throw new Error(`a remocao encolheu ${exp.length - novo.length} bytes e devia encolher ${encolheu}`);

  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  const antes = lerRoster(caminho), depois = lerRoster(saida);
  if (antes.soldados.length !== depois.soldados.length) throw new Error('a remocao mudou o numero de homens');
  if (depois.soldados.some((s, i) => s.estado !== antes.soldados[i].estado)) throw new Error('a remocao mexeu no estado de algum homem');
  const caudas = caudasDoRoster(saida);
  for (const p of planos) {
    const v = paiolDe(caudas[p.i].cauda);
    if (!v || v.n !== p.n - p.sai.length || v.pares.some((x) => p.itens.includes(x.item))) throw new Error(`${p.nome}: o vetor nao ficou como devia`);
  }
  return { homens: planos.length, itens: cortes.length, encolheu, detalhe: planos.map((p) => ({ indice: p.i, nome: p.nome, de: p.n, para: p.n - p.sai.length, itens: p.itens })) };
}

// DEVOLVER A ARMA QUE FOI EMBORA (E54): classe e item das DUAS armas, escritos no lugar.
//
// O metralhador do autor entrou na batalha 2 de pistola. O que o save conta (113.5): quando a PKM
// secou, o jogo trouxe a pistola (2/43) para a arma 1 e mandou a PKM para a arma 2, apagando o par
// do 7,62x54R; depois o socorro levou a PKM do ferido, e sobrou `2/43 + 8/0` com 48 de 9mm. O
// reforco nao alcanca esse homem (ele TEM arma) e o refil so enchia quem tinha o vetor vazio.
//
// A escrita e a mesma que o reforco provou em jogo desde o E30: bytes 1-2 (arma 1) e 4-5 (arma 2)
// da cabeca, por cima, sem mover nada — a trava de tamanho no fim recusa qualquer outra coisa.
//
// `porHomem`: `{ indice: { classe, item, classe2?, item2? } }`.
export function devolverArmas(caminho, saida, porHomem) {
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);
  const brutos = soldadosDoBloco(exp);

  const novo = Buffer.from(exp);
  const feitos = [];
  brutos.forEach((x, i) => {
    const alvo = porHomem instanceof Map ? porHomem.get(i) : porHomem[i];
    if (!alvo) return;
    const ini = x.posEstado + 1;
    if (ini + 11 > novo.length) return;
    // a forma da cabeca (113.2): [00][A1][00][A2][00][flags] — os tres zeros conferem antes de escrever
    if (novo[ini] !== 0 || novo[ini + 3] !== 0 || novo[ini + 6] !== 0) return;
    const de = `${novo[ini + 1]}/${novo[ini + 2]} + ${novo[ini + 4]}/${novo[ini + 5]}`;
    if (Number.isInteger(alvo.classe) && Number.isInteger(alvo.item)) { novo[ini + 1] = alvo.classe; novo[ini + 2] = alvo.item; }
    if (Number.isInteger(alvo.classe2) && Number.isInteger(alvo.item2)) { novo[ini + 4] = alvo.classe2; novo[ini + 5] = alvo.item2; }
    const para = `${novo[ini + 1]}/${novo[ini + 2]} + ${novo[ini + 4]}/${novo[ini + 5]}`;
    if (para !== de) feitos.push({ indice: i, nome: x.nome, de, para });
  });
  if (!feitos.length) return { homens: 0, detalhe: [] };

  if (novo.length !== exp.length) throw new Error(`a devolucao da arma mudou o tamanho do bloco: ${exp.length} -> ${novo.length}`);

  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  // Conferencia no arquivo gravado: mesmos homens, mesmos estados, e cada arma devolvida esta la.
  const antes = lerRoster(caminho), depois = lerRoster(saida);
  if (antes.soldados.length !== depois.soldados.length) throw new Error('a devolucao da arma mudou o numero de homens');
  const mexeu = depois.soldados.filter((s, i) => s.estado !== antes.soldados[i].estado);
  if (mexeu.length) throw new Error(`a devolucao da arma mexeu no estado de ${mexeu.length} homens`);
  const caudas = caudasDoRoster(saida);
  for (const f of feitos) {
    const c = caudas[f.indice]?.cauda;
    const agora = c && c.length >= 6 ? `${c[1]}/${c[2]} + ${c[4]}/${c[5]}` : '?';
    if (agora !== f.para) throw new Error(`${f.nome}: devia ficar com ${f.para} e o arquivo diz ${agora}`);
  }
  return { homens: feitos.length, detalhe: feitos };
}

// OS BYTES DE EQUIPAMENTO DO HOMEM (plano de 28/09, fase 3). Escreve no lugar, sem mudar tamanho:
//   mais8      o byte +8 da cauda inteiro (0x08/0x10 = cargas de demolicao, 0x80 = ?)
//   ligar7 / desligar7   bits do byte +7 (flags); 0x20 e proibido, muda a gramatica (113.6)
// `porHomem = { indice: { mais8?, ligar7?, desligar7? } }`. Confere relendo o arquivo gravado.
export function escreverBytesDoHomem(caminho, saida, porHomem) {
  const loc = localizarRoster(caminho);
  const { exp, esc } = expandirBloco(loc.lz);
  const brutos = soldadosDoBloco(exp);
  const novo = Buffer.from(exp);
  const feitos = [];
  brutos.forEach((x, i) => {
    const alvo = porHomem instanceof Map ? porHomem.get(i) : porHomem[i];
    if (!alvo) return;
    const ini = x.posEstado + 1;
    if (novo[ini] !== 0 || novo[ini + 3] !== 0 || novo[ini + 6] !== 0) throw new Error(`${x.nome}: cabeca fora da forma (113.2), nao escrevo`);
    if (((alvo.ligar7 || 0) | (alvo.desligar7 || 0)) & 0x20) throw new Error('o bit 0x20 de +7 muda a gramatica da cauda: proibido');
    const de = [novo[ini + 7], novo[ini + 8]];
    if (Number.isInteger(alvo.mais8)) novo[ini + 8] = alvo.mais8;
    if (alvo.ligar7) novo[ini + 7] |= alvo.ligar7;
    if (alvo.desligar7) novo[ini + 7] &= ~alvo.desligar7 & 0xff;
    feitos.push({ indice: i, nome: x.nome, de, para: [novo[ini + 7], novo[ini + 8]] });
  });
  if (novo.length !== exp.length) throw new Error('a escrita mudou o tamanho do bloco');
  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));
  const antes = caudasDoRoster(caminho), depois = caudasDoRoster(saida);
  if (antes.length !== depois.length) throw new Error('a escrita mudou o numero de homens');
  for (let i = 0; i < antes.length; i++) {
    const f = feitos.find((x) => x.indice === i);
    const a = Buffer.from(antes[i].cauda), d = Buffer.from(depois[i].cauda);
    if (f) { a[7] = f.para[0]; a[8] = f.para[1]; }
    if (!a.equals(d)) throw new Error(`${antes[i].nome}: a cauda mudou alem do pedido`);
  }
  return { homens: feitos.length, detalhe: feitos };
}

// CRESCER O ROSTER: unidades core que nao existiam quando a campanha comecou (secao 112.8).
//
// Provado em jogo pelo E14A. A lista de unidades do save e a mesma da 111.18 — `u32 QUANTAS` quatro
// bytes antes do primeiro bloco — e 132 dos 154 blocos do SMOKE-TEST nao tinham soldado nenhum, que
// e a forma de uma unidade core que o jogo nunca instanciou. Um bloco novo tem essa forma.
//
// O molde do `.cam` NAO serve: para o mesmo tipo ele tem 88 B e o save tem 117, porque o jogo
// reescreve o bloco quando a campanha comeca. O doador certo e um bloco sem soldado do PROPRIO
// save, com o core id trocado nos quatro primeiros bytes.
//
// A cauda do roster (o `u32 N` seguido de um u32 por unidade, no fim do bloco) NAO precisa crescer:
// o E14A passou com ela intacta.
//
// `novos`: [{ coreId, val, tab, nome? }]. `tabela`: research/tipos_roster.json, para levar o par
// (val, tab) do registro ao u16 de tipo que o bloco de roster usa.
// Os blocos SEM HOMENS que o jogo gravou nos saves de colheita de fabrica, um por tipo, terminados no
// `ff ff` do proprio jogo. Lidos uma vez por processo.
// A TABELA VERSIONADA (08/11/2026): a pasta de colheita (11 saves, ~10 MB) fica fora do git e fora do PACOTE, e sem ela
// nenhuma compra de artilharia, drone ou aeronave sem gemeo dormente entrava (o sandbox de QA, sem a pasta, recusou o
// AH-64E). Os blocos colhidos sao poucos e pequenos: `research/blocos_sem_homens.json` ({ blocos: { tipo: hex } }), gerado
// da pasta por `gravarBlocosSemHomens()` e lido no lugar dela. Sem a tabela, a pasta, como antes.
export const BLOCOS_SEM_HOMENS = new URL('../../research/blocos_sem_homens.json', import.meta.url);
// As familias de peca fora do mapa (byte baixo do u16 tipo do roster): 0x09 artilharia, 0x0a aeronave e drone. Linha sem
// homens, que o jogo fecha em `ff ff` + 6 zeros (blocos_sem_homens.json: todos os 62).
export const FAMILIAS_SEM_HOMENS = new Set([0x09, 0x0a]);
const FECHO_SEM_HOMENS = Buffer.from('ffff000000000000', 'hex');
// AERONAVE OU DRONE SEM BLOCO COLHIDO DO TIPO (13/11, o Shadow): os 28 blocos da familia 0x0a que o jogo gravou tem a mesma
// forma de 39 B e so mudam no tipo e nos atributos; o de outro tipo da familia serve com o tipo trocado (os atributos o
// `comAtributos`/`corrigirAtributos` regravam). Artilharia NAO: o paiol muda de tipo para tipo.
export function blocoDaFamilia(tipo) {
  if ((tipo & 0xff) !== 0x0a) return null;
  const irmao = [...doadoresDaColheita()].find(([t, b]) => (t & 0xff) === 0x0a && b.length === 39);
  if (!irmao) return null;
  const b = Buffer.from(irmao[1]); b.writeUInt16LE(tipo, 4); return b;
}
let colheitaCache = null;
export function doadoresDaColheita(pasta = new URL('../../research/colheita_fab/', import.meta.url)) {
  if (colheitaCache) return colheitaCache;
  try {
    const t = JSON.parse(fs.readFileSync(BLOCOS_SEM_HOMENS, 'utf8'));
    return (colheitaCache = new Map(Object.entries(t.blocos || {}).map(([k, hx]) => [Number(k), Buffer.from(hx, 'hex')])));
  } catch { /* sem a tabela: a pasta */ }
  return (colheitaCache = blocosDaPasta(pasta));
}
export function gravarBlocosSemHomens(pasta = new URL('../../research/colheita_fab/', import.meta.url)) {
  const m = blocosDaPasta(pasta);
  if (!m.size) throw new Error('a pasta de colheita nao deu nenhum bloco');
  const blocos = Object.fromEntries([...m].sort((a, b) => a[0] - b[0]).map(([k, b]) => [k, b.toString('hex')]));
  fs.writeFileSync(BLOCOS_SEM_HOMENS, JSON.stringify({ nota: 'Blocos de roster SEM HOMENS (artilharia, drone, aeronave) gravados pelo jogo nos saves de colheita de fabrica (research/colheita_fab), um por tipo (u16 do roster). Doador de crescerRoster quando o save nao tem um dormente do mesmo tipo. Gerado por tools/re/roster.mjs gravarBlocosSemHomens().', blocos }, null, 1) + '\n');
  colheitaCache = null;
  return m.size;
}
function blocosDaPasta(pasta) {
  const m = new Map();
  let arquivos = [];
  try { arquivos = fs.readdirSync(pasta).filter((f) => /\.bts$/i.test(f)); } catch { return m; }
  for (const f of arquivos) {
    const p = new URL(encodeURIComponent(f), pasta);
    try {
      const loc = localizarRoster(p);
      const { exp } = expandirBloco(loc.lz);
      const r = lerRoster(p);
      r.unidades.forEach((u, k) => {
        // so peca SEM HOMENS (n = 0): equipe dormente sem soldado tambem nao tem homem no bloco, mas usa o molde (08/11: 4 equipes
        // entravam aqui e colidiam entre exercitos no u16 tipo)
        if (u.n || u.soldados.length || m.has(u.tipo) || k + 1 >= r.unidades.length) return;
        const bl = Buffer.from(exp.subarray(u.pos - 15, r.unidades[k + 1].pos - 15));
        if (bl.length > 80 || bl.indexOf(Buffer.from([0xff, 0xff]), 18) < 0) return;
        m.set(u.tipo, bl);
      });
    } catch { /* um save ilegivel nao derruba os outros */ }
  }
  return m;
}

export function crescerRoster(entrada, saida, novos, tabela) {
  if (!novos.length) throw new Error('crescerRoster sem unidade nenhuma');
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);

  // A lista: o contador vem 4 bytes antes do primeiro bloco.
  let q = exp.indexOf(ASSINATURA, 0);
  while (q >= 0) { const n = exp.readUInt32LE(q + 4); if (n <= 60 && q >= 19) break; q = exp.indexOf(ASSINATURA, q + 4); }
  if (q < 0) throw new Error('roster sem lista de unidades');
  const ini = q - 15;
  const quantas = exp.readUInt32LE(ini - 4);
  if (quantas !== r.unidades.length) throw new Error(`o contador diz ${quantas} e a varredura acha ${r.unidades.length}: nao mexo num roster que nao entendo`);

  // O fim da lista e o comeco da cauda: o maior `u32 N` que fecha o bloco com N x u32.
  //
  // O QUE A CAUDA E (E58, 13/09): N = unidades ORIGINAIS da campanha + 1 + batalhas jogadas. Sao
  // um `2` por unidade de quando a campanha nasceu, um `0`, e um u32 por batalha (0x01080001,
  // 0x01040000...). Medido em 9 saves de 5 campanhas: EASY2 410 unidades -> N 411, 412, 413 nas
  // viradas 1, 2 e 3; MVSC 300 originais e 1103 no roster -> N 304. O app nao a estende quando
  // cresce o roster (E14A) e o jogo aceita — entao "N perto do numero de unidades" so vale ate o
  // primeiro crescimento: a EASY2 com 580 unidades e N 413 parava aqui na batalha 4 ("nao achei
  // onde a lista de unidades acaba"). A cauda se reconhece pela forma: uma corrida de 2s no
  // comeco, e no maximo uns poucos valores diferentes no fim.
  const cauda = inicioDaCauda(exp, ini);
  if (cauda === null) throw new Error('nao achei onde a lista de unidades acaba');

  // Doadores: um bloco SEM soldado por tipo.
  const doador = new Map();
  r.unidades.forEach((u, k) => {
    if (u.soldados.length || doador.has(u.tipo)) return;
    const a = u.pos - 15;
    const b = k + 1 < r.unidades.length ? r.unidades[k + 1].pos - 15 : cauda;
    doador.set(u.tipo, Buffer.from(exp.subarray(a, b)));
  });

  // O MOLDE COMO SEGUNDA OPCAO. Clonar um dormente do proprio save e o caminho preferido — e a
  // forma exata que o jogo mantem. Mas so serve para tipo que ja esteja na forca: autor comprou uma
  // bateria de M109A7 e parou, porque nao havia Paladin nenhum dormente para copiar.
  //
  // O molde do `.cam` (`tipos_roster.json`) existe para os 410 tipos. Comparando os 132 dormentes
  // deste save com o molde do mesmo tipo: 128 tem EXATAMENTE o mesmo tamanho, e a diferenca esta no
  // conteudo — o molde tem a cauda zerada e o save tem o estado que o jogo escreveu. Ou seja, o
  // molde e a versao em branco do mesmo bloco, e em branco e como o `.cam` entrega TODOS eles: o
  // jogo preenche na batalha 1. Usar o molde e pedir a ele que faca de novo o que ja faz.
  const porPar = new Map(tabela.filter((t) => t.bloco).map((t) => [`${t.val},${t.tab}`, t]));
  const jaTem = new Set(r.unidades.map((u) => u.coreId));
  const blocos = []; const feitos = [];
  for (const u of novos) {
    if (jaTem.has(u.coreId)) throw new Error(`o core id ${u.coreId} ja esta no roster`);
    // a peca fora do mapa com o par de um veiculo (25/11, tools/re/pecas.mjs): a categoria do registro decide a linha
    const peca = pecaDoPar(u.val, u.tab, u.categoria);
    const t = peca || porPar.get(`${u.val},${u.tab}`);
    if (!t) throw new Error(`sem molde de roster para val=${u.val} tab=${u.tab}${u.nome ? ` (${u.nome})` : ''}`);
    const molde = Buffer.from(t.bloco, 'hex');
    const tipo = molde.readUInt16LE(4);
    // A PECA SEM HOMENS NAO USA O MOLDE (01/10). Aeronave e artilharia fora do mapa tem molde de 39-42 B
    // sem terminador nenhum, e no save o jogo grava outra forma (`01 01 ... ff ff` no KA-52, o paiol
    // inteiro no obus). A RUS1 comprou KA-52, Su-24M2 e Orlan-10 e a batalha 6 morreu a 5% com "Out
    // of memory". Para esses, o doador e um bloco GRAVADO PELO JOGO do mesmo tipo, colhido nos saves de
    // fabrica (`research/colheita_fab`); o molde do .cam fica para a tropa, onde foi provado (E14A).
    // O SHADOW (13/11/2026): o molde do RQ-7B tem 43 B (os outros 28 drones e aeronaves tem 39) e passava pelo `<= 42`:
    // a linha entrou no save com 4 zeros a mais, o jogo leu tudo o que vinha depois dela deslocado (a linha-lixo de 60 MB
    // da b10/b11, e na b12 as 8 aeronaves novas: Out of memory). A peca fora do mapa se reconhece pela FAMILIA do tipo
    // (byte baixo 0x09 artilharia, 0x0a aeronave/drone), nao pelo tamanho do molde.
    const semHomens = molde.length <= 42 || FAMILIAS_SEM_HOMENS.has(tipo & 0xff);
    const daColheita = !doador.get(tipo) && semHomens ? (doadoresDaColheita().get(tipo) || blocoDaFamilia(tipo) || blocoDaIrma(peca, doadoresDaColheita())) : null;
    if (!doador.get(tipo) && semHomens && !daColheita) throw new Error(`sem bloco do jogo para ${u.nome || `tipo ${tipo}`} (unidade sem homens): o molde do .cam nao serve num save`);
    const d = doador.get(tipo) || daColheita;
    // O clone traz os atributos de quem doou o bloco — os da unidade comprada vem por cima (112.12).
    // e o lugar da unidade na formacao em cada vaga (E141), so no bloco em branco de tropa
    const b = semHomens ? comAtributos(Buffer.from(d || molde), u.atributos) : comEquipe(comAtributos(Buffer.from(d || molde), u.atributos), u.b8);
    b.writeUInt32LE(u.coreId, 0);
    blocos.push(b);
    feitos.push({ coreId: u.coreId, tipo, bytes: b.length, de: daColheita ? 'bloco do jogo (colheita)' : d ? 'dormente no save' : 'molde do .cam', nome: u.nome });
  }

  const cont = Buffer.alloc(4); cont.writeUInt32LE(quantas + blocos.length);
  const novoExp = Buffer.concat([
    exp.subarray(0, ini - 4), cont,
    exp.subarray(ini, cauda), Buffer.concat(blocos),
    exp.subarray(cauda),
  ]);

  const comp = comprimirLiterais(codificarComoJogo(novoExp, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  const out = Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]);
  fs.writeFileSync(saida, out);
  return { antes: quantas, depois: quantas + blocos.length, acrescentados: feitos, roster: novoExp.length, tamanho: out.length };
}

// AS VAGAS DOS BLOCOS EM BRANCO DE UMA CAMPANHA EM CURSO (05/10/2026, E141). O app gravava a equipe 1 em toda vaga
// (o molde), e o jogo so enche o bloco da unidade cujo lugar na formacao casa: as outras irmas nunca ganharam homens
// (E83). Num save, um bloco que o jogo ainda nao encheu tem as vagas do molde; so esses recebem o lugar certo
// (`comEquipe`). Os ja preenchidos ficam como estao. Mesmo tamanho; so o fluxo muda.
export function numerarVagas(entrada, saida, coreFile) {
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  const lugar = new Map(unidadesDoCore(coreFile).map((u) => [u.coreId, u.b8]));
  const novo = Buffer.from(exp); const mudados = [];
  r.unidades.forEach((u, k) => {
    if (u.soldados.length || !u.n || !lugar.has(u.coreId)) return;
    // em branco = sem soldado e com as vagas do molde (o 2o byte de cada uma e 0, 1, 2...). O veiculo vazio ja traz,
    // depois das vagas, o estado que o jogo gravou na batalha (E7): o tamanho nao serve de criterio.
    const a = u.pos - 15;
    for (let j = 0; j < u.n; j++) if (exp[a + 28 + 15 * j] !== j) return;
    const bloco = exp.subarray(a, a + 33 + 15 * u.n);
    const certo = comEquipe(Buffer.from(bloco), lugar.get(u.coreId));
    if (certo.equals(bloco)) return;
    certo.copy(novo, a); mudados.push(u.coreId);
  });
  if (!mudados.length) { fs.copyFileSync(entrada, saida); return { mudados }; }
  const comp = comprimirLiterais(codificarComoJogo(novo, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));
  return { mudados };
}

// O inicio da cauda do roster: o `u32 N` + N x u32 que fecha a lista (uma corrida de 2s e poucos valores no fim).
// A CAUDA MINIMA (10/11/2026): depois de uma batalha com o roster enxuto (campaign.enxugarEntrega, 101 linhas com uma cauda de
// 505), o jogo gravou a transicao com a cauda `N = 1 | 0` — nenhum 2, so o separador. Medido em ZZ B2 TRANSITION e ZZ TRIM
// TRANSITION. Sem achar essa forma a entrega seguinte parava. So vale quando a forma longa nao aparece, e com o separador 0
// logo depois do N (N ate 24: o 0 e um u32 por batalha).
export function inicioDaCauda(exp, minimo = 0) {
  for (let N = 4000; N >= 3; N--) {
    const b = exp.length - 4 * N - 4;
    if (b < minimo || exp.readUInt32LE(b) !== N) continue;
    let dois = 0; while (dois < N && exp.readUInt32LE(b + 4 + 4 * dois) === 2) dois++;
    if (dois >= 1 && N - dois <= 24) return b;
  }
  for (let N = 1; N <= 24; N++) {
    const b = exp.length - 4 * N - 4;
    if (b >= minimo && exp.readUInt32LE(b) === N && exp.readUInt32LE(b + 4) === 0) return b;
  }
  return null;
}

// O ROSTER QUE O JOGO ESCREVEU ALEM DO QUE ELE LE (08/11/2026, US b11). Na US o jogo so le as primeiras ~501 linhas, e ao
// gravar a transicao as linhas alem disso voltam erradas: depois da b11 as duas dormentes postas nas linhas 503-504 (534
// Raven, 574 Abrams) SUMIRAM e no lugar veio uma linha-lixo de 60,8 MB (core 1643286, tipo 1). Sem as duas linhas o jogo
// derruba a campanha (112.1). Aqui, contra a forca core: (1) linha de core id que a forca nao tem sai; (2) core da forca sem
// linha volta com a linha que tinha no ULTIMO SAVE ENTREGUE (`anterior`), no fim da lista (o `presentesNoAlcance` cuida do
// lugar depois); (3) linha da forca fora da forma (sem homens e sem o `ff ff`, ou maior que 4 KB sem homens) volta a do
// anterior. O contador acompanha; a cauda fica como esta (E14A).
// `fora` (10/11): as unidades que a entrega tira desta batalha (ausentes sem homem na linha, campaign.enxugarEntrega). Para o
// roster nao sao da forca: a linha delas sai (em `tiradas`, nao em `removidas`) e nunca e restaurada.
export function restaurarLinhas(entrada, saida, coreFile, anterior = null, { novos = [], fora = [] } = {}) {
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  const cauda = inicioDaCauda(exp);
  if (cauda === null) { fs.copyFileSync(entrada, saida); return { removidas: [], restauradas: [], trocadas: [], tiradas: [], erro: 'cauda do roster nao achada' }; }
  const tirar = new Set([...fora].map(Number));
  const daForca = new Set(unidadesDoCore(coreFile).map((u) => u.coreId).filter((id) => !tirar.has(id)));
  const blocos = r.unidades.map((u, k) => ({ coreId: u.coreId, n: u.n, ini: u.pos - 15, fim: k + 1 < r.unidades.length ? r.unidades[k + 1].pos - 15 : cauda }));
  // as linhas do save anterior, por core id
  const doAnterior = new Map();
  if (anterior && fs.existsSync(anterior)) {
    try {
      const ea = expandirBloco(localizarRoster(anterior).lz).exp; const ra = lerRoster(anterior); const ca = inicioDaCauda(ea);
      ra.unidades.forEach((u, k) => { const a = u.pos - 15, b = k + 1 < ra.unidades.length ? ra.unidades[k + 1].pos - 15 : ca; if (b - a > 0 && b - a < 200000) doAnterior.set(u.coreId, Buffer.from(ea.subarray(a, b))); });
    } catch { /* anterior ilegivel: so a remocao */ }
  }
  const estragada = (b) => { const bl = exp.subarray(b.ini, b.fim); return !b.n && (bl.length > 4096 || bl.indexOf(Buffer.from([0xff, 0xff]), 18) < 0); };
  const removidas = [], restauradas = [], trocadas = [], tiradas = [];
  const pedacos = [];
  const temLinha = new Set();
  for (const b of blocos) {
    if (tirar.has(b.coreId)) { tiradas.push(b.coreId); continue; }
    if (!daForca.has(b.coreId) || temLinha.has(b.coreId)) { removidas.push({ coreId: b.coreId, bytes: b.fim - b.ini }); continue; }
    temLinha.add(b.coreId);
    if (estragada(b) && doAnterior.has(b.coreId)) { pedacos.push(doAnterior.get(b.coreId)); trocadas.push({ coreId: b.coreId, antes: b.fim - b.ini, depois: doAnterior.get(b.coreId).length }); continue; }
    pedacos.push(exp.subarray(b.ini, b.fim));
  }
  // os recrutados desta virada ainda nao tem linha: o `crescerRoster` as poe depois
  const aCrescer = new Set(novos.map(Number));
  for (const id of daForca) {
    if (temLinha.has(id) || aCrescer.has(id)) continue;
    const bl = doAnterior.get(id);
    if (!bl) throw new Error(`o core ${id} ficou sem linha no roster que o jogo gravou e nao esta no save anterior: nao ha de onde restaura-la`);
    pedacos.push(bl); restauradas.push(id); temLinha.add(id);
  }
  if (!removidas.length && !restauradas.length && !trocadas.length && !tiradas.length) { fs.copyFileSync(entrada, saida); return { removidas, restauradas, trocadas, tiradas }; }
  const ini = blocos[0].ini;
  const cont = Buffer.alloc(4); cont.writeUInt32LE(temLinha.size);
  const novoExp = Buffer.concat([exp.subarray(0, ini - 4), cont, ...pedacos, exp.subarray(cauda)]);
  const comp = comprimirLiterais(codificarComoJogo(novoExp, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));
  const depois = lerRoster(saida);
  if (depois.unidades.length !== temLinha.size) throw new Error(`a restauracao deixou ${depois.unidades.length} linhas, esperava ${temLinha.size}`);
  return { removidas, restauradas, trocadas, tiradas, linhas: depois.unidades.length, roster: [exp.length, novoExp.length] };
}

// A LINHA SEM HOMENS QUE O JOGO ESCREVEU ESTRAGADA (08/11/2026, autor: ZZ ART US deu "Out of memory" a 5%). O pelotao de
// M777 (core 586) que o jogo recusou na b10 voltou no save da transicao com uma linha de 2.964.683 bytes no lugar de 54:
// 11 copias de um registro de soldado ("Worley", de outra unidade) e 197.587 registros vazios de 15 bytes. O app herdava a
// linha (a b11 de verdade tambem) e o jogo morria ao ler. Uma linha sem homens (n = 0) e limpa quando e curta (ate 80 B)
// e fecha no `ff ff` do jogo; a que nao e volta a forma limpa de uma irma do mesmo tipo neste save (o jogo a escreveu) ou,
// sem irma, o bloco colhido do tipo (blocos_sem_homens.json). Fica o core id; os atributos o `corrigirAtributos` regrava.
export function linhaSemHomensLimpa(bl) {
  if (!(bl.length <= 80 && bl.indexOf(Buffer.from([0xff, 0xff]), 18) >= 0)) return false;
  // a peca fora do mapa (artilharia, aeronave, drone) FECHA em `ff ff` + 6 zeros: nada depois (o Shadow de 43 B, 13/11)
  return !FAMILIAS_SEM_HOMENS.has(bl.readUInt16LE(4) & 0xff) || bl.subarray(-8).equals(FECHO_SEM_HOMENS);
}
// A linha de peca fora do mapa que so tem ZEROS depois do fecho (`ff ff` + 6 zeros) volta ao tamanho do jogo cortando-os;
// null quando nao e esse o defeito.
export function cortarSobraSemHomens(bl) {
  if (!FAMILIAS_SEM_HOMENS.has(bl.readUInt16LE(4) & 0xff)) return null;
  for (let f = bl.length - 8; f >= 18; f--) {
    if (!bl.subarray(f, f + 8).equals(FECHO_SEM_HOMENS)) continue;
    const resto = bl.subarray(f + 8);
    return resto.length && resto.every((x) => x === 0) ? Buffer.from(bl.subarray(0, f + 8)) : null;
  }
  return null;
}
export function sanearSemHomens(entrada, saida) {
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  const cauda = inicioDaCauda(exp);
  if (cauda === null) { fs.copyFileSync(entrada, saida); return { trocadas: [], erro: 'cauda do roster nao achada' }; }
  const blocos = r.unidades.map((u, k) => ({ coreId: u.coreId, tipo: u.tipo, n: u.n, ini: u.pos - 15, fim: k + 1 < r.unidades.length ? r.unidades[k + 1].pos - 15 : cauda }));
  const limpa = new Map();
  for (const b of blocos) if (!b.n && !limpa.has(b.tipo) && linhaSemHomensLimpa(exp.subarray(b.ini, b.fim))) limpa.set(b.tipo, exp.subarray(b.ini, b.fim));
  const trocadas = []; const pedacos = []; let p = 0;
  for (const b of blocos) {
    if (b.n || linhaSemHomensLimpa(exp.subarray(b.ini, b.fim))) continue;
    const cortada = cortarSobraSemHomens(exp.subarray(b.ini, b.fim));
    const modelo = cortada || limpa.get(b.tipo) || doadoresDaColheita().get(b.tipo) || blocoDaFamilia(b.tipo);
    if (!modelo) throw new Error(`a linha do core ${b.coreId} (tipo ${b.tipo}, sem homens) veio estragada do jogo (${b.fim - b.ini} bytes) e nao ha linha limpa do tipo para por no lugar`);
    const novo = Buffer.from(modelo); novo.writeUInt32LE(b.coreId, 0);
    pedacos.push(exp.subarray(p, b.ini), novo); p = b.fim;
    trocadas.push({ coreId: b.coreId, tipo: b.tipo, antes: b.fim - b.ini, depois: novo.length, de: cortada ? 'sobra cortada' : limpa.has(b.tipo) ? 'irma no save' : doadoresDaColheita().get(b.tipo) ? 'colheita' : 'familia' });
  }
  if (!trocadas.length) { fs.copyFileSync(entrada, saida); return { trocadas }; }
  pedacos.push(exp.subarray(p));
  const novoExp = Buffer.concat(pedacos);
  const comp = comprimirLiterais(codificarComoJogo(novoExp, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));
  const depois = lerRoster(saida);
  if (depois.unidades.length !== r.unidades.length) throw new Error(`o saneamento mudou o numero de linhas: ${r.unidades.length} -> ${depois.unidades.length}`);
  return { trocadas, roster: [exp.length, novoExp.length] };
}

// AS LINHAS QUE O JOGO ENXERGA (08/11/2026, autor: "nao vejo o suporte aereo", US b11). Na US o jogo so ve as primeiras
// ~501 linhas do roster: o Apache comprado depois da b10 (linhas 503-504) e o F-16 de prova ficavam de fora (indice de
// apoio 0); a MESMA linha movida para a posicao 33 (ZZ PROVA AR P) apareceu. Linhas alem do limite carregam ate 508 (o
// teto, rules.rosterCap) e alem disso o jogo morre. Aqui toda linha de unidade PRESENTE na forca que esteja na posicao
// `limite` ou alem troca de lugar com a linha de uma unidade AUSENTE antes do limite (a mais perto dele). Nenhuma linha
// some; o contador e a cauda ficam iguais. Depois disso o `ordenarSemHomens` acerta a ordem dentro de cada tipo.
export function presentesNoAlcance(entrada, saida, coreFile, limite) {
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  if (!limite || r.unidades.length <= limite) { fs.copyFileSync(entrada, saida); return { movidas: [] }; }
  const presente = new Set(unidadesDoCore(coreFile).filter((u) => u.presente).map((u) => u.coreId));
  const cauda = inicioDaCauda(exp);
  if (cauda === null) { fs.copyFileSync(entrada, saida); return { movidas: [], erro: 'cauda do roster nao achada' }; }
  const blocos = r.unidades.map((u, k) => ({ coreId: u.coreId, ini: u.pos - 15, fim: k + 1 < r.unidades.length ? r.unidades[k + 1].pos - 15 : cauda }));
  const ordem = blocos.slice(); const movidas = [];
  let j = limite - 1;
  for (let k = limite; k < ordem.length; k++) {
    if (!presente.has(ordem[k].coreId)) continue;
    while (j >= 0 && presente.has(ordem[j].coreId)) j--;
    if (j < 0) throw new Error(`o roster nao tem linha ausente antes da posicao ${limite} para trocar com o core ${ordem[k].coreId}`);
    movidas.push({ coreId: ordem[k].coreId, de: k, para: j, trocouCom: ordem[j].coreId });
    [ordem[k], ordem[j]] = [ordem[j], ordem[k]]; j--;
  }
  if (!movidas.length) { fs.copyFileSync(entrada, saida); return { movidas }; }
  const ini = blocos[0].ini;
  const novoExp = Buffer.concat([exp.subarray(0, ini), ...ordem.map((b) => exp.subarray(b.ini, b.fim)), exp.subarray(cauda)]);
  if (novoExp.length !== exp.length) throw new Error('a troca de lugar mudou o tamanho do roster');
  const comp = comprimirLiterais(codificarComoJogo(novoExp, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));
  const depois = lerRoster(saida);
  if (depois.unidades.length !== r.unidades.length || depois.total !== r.total) throw new Error('a troca de lugar mudou o roster');
  return { movidas };
}

// REFUTADA NO MESMO DIA (08/11, noite): a regra da k-esima linha nao existe. No save de setup da b10 o Raven 582 (linha 500)
// entrou com 12 linhas AUSENTES do mesmo tipo antes dele; o 586 na linha 502 ficou fora porque o jogo so le as 501 primeiras
// (presentesNoAlcance, acima), e o P6 funcionou por mover a linha para a 359, nao pela ordem no tipo. O jogo pareia a linha
// pelo CORE ID. Esta funcao fica: e inocua (so troca linhas sem homens do mesmo tipo entre si) e toda entrega provada em
// jogo desde entao passou por ela.
// A ORDEM DAS LINHAS SEM HOMENS (08/11/2026, autor: "eu comprei a formacao de artilharia, mas nao veio no jogo", US b10).
// O jogo casa a peca fora do mapa com a linha do roster pela ORDEM DENTRO DO TIPO, nao pelo core id: a k-esima unidade
// presente do tipo T na batalha pega a k-esima linha do tipo T no roster. O Platoon (Howitzer [heavy]) comprado (core 586,
// 3 x M777A2) ganhou a linha no fim do roster, depois das duas linhas desligadas do mesmo tipo da Stryker TF (413, 414):
// a unidade casava com a linha do 413, desligado, e o jogo a descartava (indice de apoio 0, municao zerada). Provado com
// saves: ligar o 413 (P4) fez o 413 aparecer e o 586 continuar fora; so trocar a ordem do roster (586 antes de 413/414, P6)
// fez o 586 aparecer. Aqui, para cada tipo SEM HOMENS (n = 0: artilharia, aeronave, drone) com mais de uma linha, as linhas
// das unidades presentes na forca vem primeiro, na ordem da forca, e as desligadas depois, na ordem em que estavam. So os
// blocos desse tipo trocam de lugar entre si; o resto do roster, o contador e a cauda ficam iguais.
export function ordenarSemHomens(entrada, saida, coreFile) {
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  const core = unidadesDoCore(coreFile);
  const ordemCore = new Map(core.map((u, k) => [u.coreId, k]));
  const presente = new Set(core.filter((u) => u.presente).map((u) => u.coreId));
  // o fim de cada bloco: o inicio do seguinte; o do ultimo, o inicio da cauda (o `u32 N` + N x u32 que fecha a lista)
  const cauda = inicioDaCauda(exp);
  if (cauda === null) { fs.copyFileSync(entrada, saida); return { tipos: [], erro: 'cauda do roster nao achada' }; }
  const blocos = r.unidades.map((u, k) => ({ coreId: u.coreId, tipo: u.tipo, n: u.n, ini: u.pos - 15, fim: k + 1 < r.unidades.length ? r.unidades[k + 1].pos - 15 : cauda }));
  const porTipo = new Map();
  for (const b of blocos) if (!b.n) { if (!porTipo.has(b.tipo)) porTipo.set(b.tipo, []); porTipo.get(b.tipo).push(b); }
  const troca = new Map(); const tipos = [];
  for (const [tipo, lista] of porTipo) {
    if (lista.length < 2) continue;
    const ligados = lista.filter((b) => presente.has(b.coreId)).sort((a, b) => (ordemCore.get(a.coreId) ?? 1e9) - (ordemCore.get(b.coreId) ?? 1e9));
    const desligados = lista.filter((b) => !presente.has(b.coreId));
    const certa = [...ligados, ...desligados];
    if (certa.every((b, k) => b === lista[k])) continue;
    lista.forEach((vaga, k) => troca.set(vaga, certa[k]));
    tipos.push({ tipo, antes: lista.map((b) => b.coreId), depois: certa.map((b) => b.coreId) });
  }
  if (!troca.size) { fs.copyFileSync(entrada, saida); return { tipos }; }
  const pedacos = []; let p = 0;
  for (const b of blocos) {
    if (!troca.has(b)) continue;
    const novo = troca.get(b);
    pedacos.push(exp.subarray(p, b.ini), exp.subarray(novo.ini, novo.fim)); p = b.fim;
  }
  pedacos.push(exp.subarray(p));
  const novoExp = Buffer.concat(pedacos);
  if (novoExp.length !== exp.length) throw new Error('a ordem das linhas sem homens mudou o tamanho do roster');
  const comp = comprimirLiterais(codificarComoJogo(novoExp, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));
  return { tipos };
}

// CONSERTO DOS ATRIBUTOS DO ROSTER (112.12) numa campanha JA EM CURSO.
//
// O save carrega, por unidade core, uma copia dos fatores humanos — e ate hoje o app escrevia ali
// os do doador de onde o molde do tipo foi colhido. Campanha nova ja sai certa; esta funcao arruma
// a que ja esta rodando, lendo os atributos da forca core e regravando os quatro bytes e a
// lideranca de cada bloco. Nada mais e tocado: mesmo tamanho, mesmos soldados, mesma cauda.
export function corrigirAtributos(entrada, saida, coreFile) {
  const loc = localizarRoster(entrada);
  const { exp, esc } = expandirBloco(loc.lz);
  const r = lerRoster(entrada);
  const certo = new Map(unidadesDoCore(coreFile).map((u) => [u.coreId, u]));

  const novoExp = Buffer.from(exp);
  const mudados = []; const semDono = [];
  for (const u of r.unidades) {
    const p = u.pos - 15;
    const coreId = novoExp.readUInt32LE(p);
    const dono = certo.get(coreId);
    if (!dono) { semDono.push(coreId); continue; }
    const antes = Buffer.from(novoExp.subarray(p, p + 15));
    comAtributos(novoExp.subarray(p, p + 15), dono.atributos).copy(novoExp, p);
    if (!antes.equals(novoExp.subarray(p, p + 15))) mudados.push({ coreId, nome: dono.nome, atributos: dono.atributos });
  }
  if (novoExp.length !== exp.length) throw new Error('o conserto mudou o tamanho do roster');

  const comp = comprimirLiterais(codificarComoJogo(novoExp, esc));
  const t4 = Buffer.alloc(4); t4.writeUInt32LE(comp.length);
  const b = loc.anatomia.b;
  fs.writeFileSync(saida, Buffer.concat([b.subarray(0, loc.pos), t4, comp, b.subarray(loc.pos + 4 + loc.tam)]));

  // Conferencia no arquivo GRAVADO: as unidades e os soldados continuam la, e o que devia mudar mudou.
  const v = lerRoster(saida);
  if (v.unidades.length !== r.unidades.length) throw new Error(`o conserto mudou o roster de ${r.unidades.length} para ${v.unidades.length} unidades`);
  if (v.total !== r.total) throw new Error(`o conserto mudou o efetivo de ${r.total} para ${v.total} homens`);
  return { unidades: r.unidades.length, mudados: mudados.length, semDono: semDono.length, exemplos: mudados.slice(0, 5) };
}

const EH_MAIN = process.argv[1] && /[\\/]roster\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const f = process.argv[2]; if (!f) { console.log('uso: node roster.mjs <save de campanha.bts>'); process.exit(1); }
  const r = lerRoster(f);
  console.log(`${f}: jogador ${r.playerForce}; ${r.unidades.length} unidades, ${r.total} soldados, ${r.vivos} vivos, ${r.baixas} baixas; batalhas jogadas ${r.batalhasJogadas}: ${r.resultados.map((x) => x.rotulo + (x.venceu ? ' (venceu)' : '')).join(', ') || '-'}`);
  for (const u of r.unidades) console.log(`  core ${String(u.coreId).padStart(4)} tipo 0x${u.tipo.toString(16).padStart(4, '0')} ${String(u.n).padStart(2)} homens: ${u.soldados.map((s) => s.nome + (s.vivo ? '' : '*')).join(', ')}`);
}
