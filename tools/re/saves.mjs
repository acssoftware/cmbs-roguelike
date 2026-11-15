// LEITOR DE SAVE GAME (.bts) — secoes 95 e 99. Le o estado dos SOLDADOS de uma partida salva.
//
// Container: o mesmo do .btt (magic, cabecalho, BMP), mas depois do BMP vem `u16 len | nome do
// save | 24 B de campos (data, duracao...)` e a cadeia de blocos LZ: bloco 0 = estrutura do
// briefing (138 B), bloco 1 = o estado inteiro (~2,4 MB comprimido -> ~16 MB COMPLETO). Os
// "tokens" da camada de escape sao corridas de zeros (`esc n 00` = n+1 zeros), nao marcadores:
// todo offset abaixo e no fluxo COMPLETO, como no .btt.
//
// O REGISTRO DO SOLDADO. Ancora: o SOBRENOME em ASCII (`u16 len | Nome`). Os offsets sao contados
// a partir do FIM do nome — e a peca que faltava (secao 99) e que **o registro CRESCE 4 BYTES
// quando o homem e atingido**: entram 4 zeros em +42 e tudo o que vem depois anda 4. O byte que
// eu usava como "vivo" (+50) era, nas baixas, outro campo que calhava de valer 0. O teste certo e
// o INSTANTE DO FERIMENTO:
//
//   +0    u8    patente/papel — tambem separa os lados: US 1/2/4, RU 6/7
//   +10   u32   id do time (fireteam), repetido em +14
//   +26   u32   id do soldado; +30 outro id (= +26 + 1)
//   +38   u32   INSTANTE DO FERIMENTO em ms (0 = nunca atingido). Valor plausivel (1 s .. 50 min)
//               = BAIXA. Turno = ceil(t / 60000).
//   [+42  u32   4 bytes zero, presentes SO nas baixas — o deslocamento]
//   +42/46 u32  id dinamico (muda entre saves tambem nos ilesos)
//   +50/54 u32  1
//   +54/58 3 floats  POSICAO (x, y, z em metros); (-99,-99,-99) = sem posicao
//   +66/70 12 B  trio de cores/segundo trio
//   +78/82 float ~1.0
//   +82/86 12 B  vetor pequeno (direcao/velocidade)
//   +94/98 0x0b | u16 n | n x (u16 item, u16 qtd)   inventario de municao (tamanho variavel:
//               nada depois disso pode ser lido por offset fixo)
//
// CONFERIDO CONTRA SEIS AAR (autor carregou cada save e encerrou a partida para ler o relatorio):
//   deployment 0 | turno 2  0 | turno 3  2 (0 US, 2 RU) | turno 4  3 (1, 2) | turno 5  8 (5, 3)
//   final 97 (23, 74)  — todos exatos.
// Na batalha anterior da 62 de 63 (falta a unica baixa americana que o AAR chama de "missing").
//
// A EQUIPE. Os soldados de um time sao contiguos no arquivo e vem depois do registro do time.
// Do inicio do primeiro soldado: -115 u32 = indice do primeiro soldado na lista global (1-based);
// -58 u8: bit 0x80 aceso = time ANIQUILADO (todos os homens sao baixa).
//
// MORTO x FERIDO NAO ESTA NO ARQUIVO — provado (secao 100). autor encerrou os saves dos turnos
// 3, 4 e 5 e leu o AAR de cada um: no turno 3 os dois russos (Bershadskiy e Oleynikov) sao MORTOS;
// no turno 4 um deles e FERIDO e o americano Earley e MORTO; no turno 5 o Earley e FERIDO. Os
// registros desses homens sao BYTE A BYTE IDENTICOS entre esses saves (0 bytes mudam): o rotulo
// muda sem que nada mude no soldado. O CM decide morto x ferido x desaparecido quando a batalha
// ACABA, a partir de outro estado (ou de um sorteio com a semente do save — encerrar o MESMO save
// duas vezes da o mesmo AAR). O que da para ler aqui e QUEM E BAIXA, e isso e exato.
//
// Correlacao nao confirmada: as 4 baixas do save final sem o marcador `07 xx yy 00` sao as 4 que o
// AAR chama de "Men Missing" (e nos turnos 3-5, sem desaparecidos no AAR, toda baixa tem marcador).
// Como o rotulo e decidido no fim, trate isso como pista, nao como regra.
import { readdirSync } from 'node:fs';
import { abrir } from './ext.mjs';
import { descomprimir } from './lz.mjs';
import { decodificar, cabecalhoDoBloco, expandir } from './escape.mjs';

export function lerSave(caminho) {
  const r = abrir(caminho); if (!r) throw new Error('nao e um arquivo do CMBS');
  const b = r.b; const len = b.readUInt16LE(r.bmpFim); const nome = b.toString('latin1', r.bmpFim + 2, r.bmpFim + 2 + len);
  const campos = b.subarray(r.bmpFim + 2 + len, r.bmpFim + 2 + len + 24);
  let o = r.bmpFim + 2 + len + 24; const blocos = [];
  while (o + 4 < b.length) { const t = b.readUInt32LE(o); if (t <= 0 || o + 4 + t > b.length) break; blocos.push(Buffer.from(descomprimir(b.subarray(o + 4, o + 4 + t), 0).saida)); o += 4 + t; }
  const bl = blocos[1]; const h = cabecalhoDoBloco(bl);
  const d = decodificar(bl, h.esc, h.inicio, bl.length, h.atalhos);
  const completo = Buffer.from(expandir(Buffer.from(d.cru), d.tokens).completo);
  return { nome, campos, esc: h.esc, blocos: blocos.map((x) => x.length), completo };
}

// O byte +0 nao e "patente": e o PAPEL do homem, e a numeracao e por nacao — 1..5 no lado americano
// (5 = tripulante de tanque: os 4 do Abrams), 6..10 no russo (10 = tripulante do T-90). Foi por
// tratar {1,2,4} e {6,7} como lista fechada que o leitor perdia justamente as tripulacoes dos
// tanques que o gerador insere como extras (secao 106). A cerca que vale e ESTRUTURAL: papel
// plausivel e o id do time repetido em +10 e +14.
const NOME = /^[\x20-\x7e]{2,24}$/;
const PAPEL_MAX = 15;
// Teto do id de equipe na cerca do soldado. Era 500, o que bastava para uma batalha (a V2 vai a
// 95), mas os cenarios-catalogo `ZZ US/RU ALL` compram a ordem de batalha inteira e passam de mil
// equipes. A cerca forte e o id repetido em +10 e +14; este teto so poda ruido.
const TIME_MAX = 20000;
const ladoDoPapel = (p) => (p >= 1 && p <= 5 ? 'US' : p >= 6 && p <= 10 ? 'RU' : p >= 11 && p <= 15 ? 'UKR' : '?');
const T_MIN = 1000, T_MAX = 3000000;     // 1 s .. 50 min: fora disso o +38 nao e instante de ferimento

export function soldados(completo, fracIni = 0.85) {
  const c = completo; const out = []; const cont = {};
  for (let o = Math.floor(fracIni * c.length); o + 5 < c.length; o++) {
    // 08/11/2026: o sobrenome de duas letras ("Su", US) tambem e soldado; so maiuscula+minuscula, e a cerca estrutural abaixo
    const L = c.readUInt16LE(o); if (L < 2 || L > 24 || o + 2 + L > c.length) continue;
    const s = c.toString('latin1', o + 2, o + 2 + L); if (!NOME.test(s) || (L === 2 && !/^[A-Z][a-z]$/.test(s))) continue;
    const f = o + 2 + L;
    // cerca ESTRUTURAL contra falso positivo: papel plausivel e id de time repetido em +10 e +14
    const papel = c[f], time = c.readUInt32LE(f + 10);
    if (papel < 1 || papel > PAPEL_MAX) continue;
    if (time === 0 || time >= TIME_MAX || time !== c.readUInt32LE(f + 14)) continue;
    cont[s] = (cont[s] || 0) + 1;
    const tHit = c.readUInt32LE(f + 38);
    // BAIXA = o registro tem a INSERCAO de 4 bytes (o campo `01` sai de +50 para +54) E um instante
    // de ferimento plausivel. So a insercao nao basta (3 homens a tem com instante de 81..214 ms e o
    // AAR nao os conta); so o instante tampouco — ele marca QUALQUER tiro que acertou o homem, some
    // depois, e no turno 2 marcava 2 homens que o AAR dava como ilesos.
    const insercao = c.readUInt32LE(f + 50) === 0 && c.readUInt32LE(f + 54) === 1;
    const baixa = insercao && tHit >= T_MIN && tHit <= T_MAX;
    const q = f + (insercao ? 4 : 0);                               // quadro comum: as baixas andam 4
    const pos = [c.readFloatLE(q + 54), c.readFloatLE(q + 58), c.readFloatLE(q + 62)];
    const inv = []; if (c[q + 94] === 0x0b) { const n = c.readUInt16LE(q + 95); for (let i = 0; i < n && i < 40; i++) inv.push({ item: c.readUInt16LE(q + 97 + 4 * i), qtd: c.readUInt16LE(q + 99 + 4 * i) }); }
    // marcador de fim de registro `07 xx yy 00`: as baixas SEM ele foram os "Men Missing" do AAR
    let marc = null; if (baixa) for (let p = q + 94; p < q + 260; p++) if (c[p] === 0x07 && c[p + 3] === 0 && c[p + 1] < 0x20) { marc = p; break; }
    // SOCORRIDO (secao 105): quando outro esquadrao passa por cima do caido e faz a animacao de
    // medic, o corpo sai do mapa e o esquadrao RECOLHE A MUNICAO — no arquivo, a lista de itens do
    // caido fica VAZIA. Conferido com o caso que autor marcou na tela: Macmullen e Landry, do time
    // 55, esvaziam exatamente no turno 13, o turno em que ele os socorreu.
    const socorrido = baixa && inv.length === 0;
    out.push({ nome: s, chave: s + '#' + cont[s], off: o, fim: f, patente: papel, papel, insercao, marcador: marc, semMarcador: baixa && !marc, socorrido,
      lado: ladoDoPapel(papel), time, id: c.readUInt32LE(f + 26),
      baixa, tHitMs: baixa ? tHit : 0, turnoHit: baixa ? Math.ceil(tHit / 60000) : null,
      semPosicao: pos.every((v) => Math.abs(v + 99) < 0.01), pos, inventario: inv });
  }
  return out;
}

// POSICAO REAL da equipe: trio de floats em -103 do primeiro soldado, precedido de 0x40 (o mesmo
// campo que localiza os veiculos, secao 101). Diferente da posicao do registro do SOLDADO, que e a
// ultima posicao conhecida (fica -99 enquanto o inimigo nao o viu).
const posBoa = (c, p) => { const x = c.readFloatLE(p), y = c.readFloatLE(p + 4), z = c.readFloatLE(p + 8);
  return c[p - 1] === 0x40 && x > 0 && x < 3000 && y > 0 && y < 3000 && z > -10 && z < 60; };
export function posicaoDaEquipe(c, ini) {
  if (posBoa(c, ini - 103)) return [c.readFloatLE(ini - 103), c.readFloatLE(ini - 99), c.readFloatLE(ini - 95)];
  for (let p = ini - 200; p < ini - 20; p++) if (posBoa(c, p)) return [c.readFloatLE(p), c.readFloatLE(p + 4), c.readFloatLE(p + 8)];
  return null;
}

// Agrupa por time e le o cabecalho do time (que precede o primeiro soldado dele).
export function equipes(completo, S = null) {
  const c = completo; const L = (S || soldados(completo)).slice().sort((a, b) => a.off - b.off);
  const m = new Map(); for (const s of L) { if (!m.has(s.time)) m.set(s.time, []); m.get(s.time).push(s); }
  return [...m].map(([id, homens]) => {
    const ini = Math.min(...homens.map((s) => s.off));
    const baixas = homens.filter((s) => s.baixa);
    const pos = posicaoDaEquipe(c, ini);
    return { id, ini, lado: homens[0].lado, homens, n: homens.length, baixas: baixas.length,
      socorridos: baixas.filter((s) => s.socorrido).length,
      primeiro: c.readUInt32LE(ini - 115), aniquilado: !!(c[ini - 58] & 0x80), pos,
      tile: pos ? [Math.floor(pos[0] / 8), Math.floor(pos[1] / 8)] : null,
      turnos: [...new Set(baixas.map((s) => s.turnoHit))].sort((a, b) => a - b) };
  }).sort((a, b) => a.ini - b.ini);
}

// OBJETIVOS (secao 103). Ficam no comeco do bloco, duas vezes (uma lista por lado):
//   u16 pontos | 0x02 | u16 len | nome | 4 B | u32 nTiles | nTiles x (u32 x, u32 y)
// Sao DEFINICAO, nao estado: os bytes sao identicos em saves com placares diferentes. Quem controla
// cada objetivo o CM resolve no fim da batalha, como o resto do AAR (secao 100).
export function objetivos(completo, limite = 20000) {
  const c = completo; const out = [];
  for (let p = 2; p < limite; p++) {
    const L = c.readUInt16LE(p); if (L < 6 || L > 40) continue;
    const s = c.toString('latin1', p + 2, p + 2 + L);
    if (!/^[A-Za-z][A-Za-z0-9 ()\[\]-]+$/.test(s) || !/\(/.test(s)) continue;
    const f = p + 2 + L; const n = c.readUInt32LE(f + 4); if (n < 1 || n > 5000) continue;
    const tiles = new Set(); let minX = 1e9, maxX = 0, minY = 1e9, maxY = 0;
    for (let i = 0; i < n; i++) { const x = c.readUInt32LE(f + 8 + 8 * i), y = c.readUInt32LE(f + 12 + 8 * i);
      tiles.add(x + ',' + y); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    out.push({ off: p, nome: s, pontos: c.readUInt16LE(p - 2), nTiles: n, tiles, caixa: [minX, minY, maxX, maxY] });
    p = f + 8 + 8 * n;
  }
  // a lista vem duplicada (uma por lado): devolve so a primeira metade, com o total de pontos
  const meio = Math.floor(out.length / 2) || out.length;
  return out.slice(0, meio);
}

// Quem esta DENTRO de cada objetivo no momento do save (equipes com pelo menos um homem de pe).
// Nao reproduz o placar do AAR — o CM guarda quem tomou o objetivo por ultimo e conta parametros
// como "Attkr at Objs" —, mas diz onde a batalha terminou.
// `minHomens`: uma equipe reduzida a UM homem nao segura o objetivo. Calibrado com dois casos —
// na TESTE 2 (turnos 3 a 5) o time 9 russo, 2 de 2 vivos, valeu os 150 pontos de City West; na
// TESTE 4 o time 51 americano, 1 de 5 vivos, estava dentro do Railroad Station e o AAR deu 0 x 0.
// Nao achei campo de moral que explicasse (os floats do soldado nao separam esse time dos sadios).
export function ocupacao(completo, S = null, { minHomens = 2 } = {}) {
  const c = completo; const L = S || soldados(completo); const E = equipes(c, L); const O = objetivos(c);
  const vivas = E.filter((e) => e.n - e.baixas >= minHomens && e.tile);
  return O.map((o) => {
    const dentro = { US: [], RU: [] };
    for (const e of vivas) if (o.tiles.has(e.tile.join(','))) dentro[e.lado]?.push(e.id);
    return { nome: o.nome, pontos: o.pontos, nTiles: o.nTiles, US: dentro.US, RU: dentro.RU,
      dono: dentro.US.length && !dentro.RU.length ? 'US' : dentro.RU.length && !dentro.US.length ? 'RU' : dentro.US.length ? 'disputado' : 'vazio' };
  });
}

// VEICULOS (secao 101). A lista de veiculos vem DEPOIS dos soldados, um registro de ~585-627 B por
// veiculo, na ordem da arvore do .btt. Offsets a partir da POSICAO (3 floats x, y, z):
//   +12.. floats de orientacao
//   +53   u8   ESTADO: 0x00 intacto, 0x4c destruido (Bradley 188 no turno 4, 188 e 198 no final)
//   +54   u8   0x60
//   +55   u32  id do time A BORDO (0 = ninguem: a tripulacao desembarcou/saltou)
//   +59   u32  id do time da TRIPULACAO dona — e o que liga o veiculo a tripulacao e, pela ordem,
//              a unidade do .btt
//   +63   u8   contador que muda entre saves
// A municao fica ~170 B ANTES da posicao (lista `u16 item, u16 qtd`: 25 mm, TOW, 7,62 coaxial).
// O registro destruido troca o bloco de subsistemas por uma lista de efeitos (floats pequenos —
// incendio) e fica 36 B mais curto.
// Localizacao: pela assinatura `60 | u32 aBordo | u32 dono` com dono = id de um time cujos homens sao
// todos tripulantes (patente 4 nos US); procurada depois do ultimo soldado.
export function veiculos(completo, S = null) {
  const c = completo; const L = S || soldados(completo); const E = equipes(completo, L);
  const fimSold = Math.max(...L.map((s) => s.off)) + 200;
  // TRIPULACAO nao se reconhece pelo papel (4 = Bradley, 5 = Abrams, 10 = T-90...): tenta-se achar o
  // registro do veiculo de TODO time; quem tem um e tripulacao. Antes, a lista fixa `papel === 4`
  // escondia justamente os tanques que o gerador insere como extras (secao 106).
  const trips = E;
  const out = [];
  for (const e of trips) {
    const dono = Buffer.alloc(4); dono.writeUInt32LE(e.id);
    let p = fimSold, achado = null;
    while ((p = c.indexOf(dono, p)) !== -1) {                       // p = +59
      const base = p - 59; const aBordo = c.readUInt32LE(base + 55);
      // +54 e um bitfield 0x6x (0x60, 0x64, 0x66 vistos): so os 4 bits altos sao assinatura. Como a
      // busca varre TODOS os times (secao 106), o estado e a posicao tambem entram na cerca — sem
      // elas um esquadrao de sapadores ganhava "veiculo" por acaso.
      const est = c[base + 53]; const x = c.readFloatLE(base), y = c.readFloatLE(base + 4), z = c.readFloatLE(base + 8);
      const posOk = (x === 0 || (x > 0 && x < 3000)) && (y === 0 || (y > 0 && y < 3000)) && Math.abs(z) < 300;
      if ((c[base + 54] & 0xf0) === 0x60 && [0x00, 0x20, 0x4c, 0xcc].includes(est) && (aBordo === 0 || aBordo === e.id) && posOk) { achado = base; break; }
      p++;
    }
    if (achado === null) continue;                                  // time sem veiculo: infantaria
    // +75 float MOBILIDADE: 1.0 no deployment, degrada com o uso (0,7-1,0 nos intactos) e e 0.0 no
    // Bradley que a tela mostra "Immobilized" (batalha 1, time 59, conferido por autor) — e no 188,
    // destruido por artilharia; o destruido a tiros de torre (batalha 1) fica em 0,8: e a mobilidade
    // em si, nao "esta morto"
    // ESTADO em +53: 0x00 ok | 0x20 em movimento (posicao zerada) | 0x4c destruido, parte da
    // tripulacao escapou | 0xcc destruido com a tripulacao INTEIRA morta (o Abrams e o T-90 da
    // TESTE 4). Os dois ultimos contam como veiculo perdido no AAR.
    const mob = c.readFloatLE(achado + 75); const est = c[achado + 53];
    const destruido = (est & 0x4c) === 0x4c;
    out.push({ time: e.id, tripulacao: e, achado: true, anc: achado, pos: [c.readFloatLE(achado), c.readFloatLE(achado + 4), c.readFloatLE(achado + 8)],
      estado: est, flags54: c[achado + 54], aBordo: c.readUInt32LE(achado + 55), dono: c.readUInt32LE(achado + 59), destruido,
      tripulacaoMorta: est === 0xcc, emMovimento: est === 0x20, mobilidade: mob, imobilizado: !destruido && mob === 0 });
  }
  out.sort((a, b) => (a.anc || 0) - (b.anc || 0));
  // IMPACTOS: um veiculo que levou tiro guarda, no fim do proprio registro (que cresce), uma lista de
  // strings `u16 len | peca` ("hull", "turret", "skirt16", "interior"...) cada uma seguida de "heat
  // penetration decal". Le-se so ate o inicio do registro seguinte (a municao dele comeca ~180 B
  // antes da posicao), senao os decals do vizinho vem parar aqui.
  const ach = out.filter((v) => v.achado);
  ach.forEach((v, i) => {
    const fim = Math.min(ach[i + 1] ? ach[i + 1].anc - 180 : v.anc + 1500, c.length - 44); const decals = [];
    for (let q = v.anc + 400; q < fim; q++) { const L = c.readUInt16LE(q); if (L < 4 || L > 40) continue; const s = c.toString('latin1', q + 2, q + 2 + L); if (/^[a-z0-9 _]+$/i.test(s)) { decals.push(s); q += 1 + L; } }
    v.impactos = decals.filter((s) => !/decal/.test(s));
  });
  // DANO POR SUBSISTEMA (secao 101.2, E98): o painel DAMAGE da unidade.
  ach.forEach((v) => { const s = subsistemas(c, v.anc); v.subsistemas = s && s.confiavel ? s.itens : null; v.lugares = s ? s.lugares : null;
    v.danificados = s ? s.itens.filter((x) => x.dano > 0).length : null;
    v.destruidos = s ? s.itens.filter((x) => x.dano >= 1).length : null; });
  return out;
}

// O PAINEL "DAMAGE" DE UM VEICULO (secao 101.2, E98). Depois do bloco de assentos
// (`40 00 <u16> 00*6`, um por lugar) vem uma lista com UM ITEM POR SUBSISTEMA, sempre na mesma
// ordem para aquele tipo de veiculo (o painel ordena por dano, o arquivo nao):
//
//     intacto     `00 00 | u32`                      6 B
//     danificado  `80 <b> | f32 dano | u32`         10 B     dano 1.0 = o X vermelho da tela
//
// As ARMAS nao estao aqui: sao as entradas de 25 B `80 00 80 NN` que vem antes (quatro no Abrams:
// 120 mm, 12,7 mm, 7,62 mm e a coaxial), e por isso aparecem no topo do painel.
// A lista so existe depois do primeiro dano (no turno 1 o veiculo intacto nao tem nenhuma), o dano
// so cresce dentro da batalha, e a batalha seguinte comeca limpa (a regra do refit).
export function subsistemas(completo, anc) {
  const c = completo;
  // Os ASSENTOS sao uma CORRIDA de entradas `40 00 <u16> 00*6` de 10 B, uma por lugar, logo depois
  // do byte da variante. Pegar "o ultimo 40 00 que aparece" achava padrao solto no meio dos zeros e
  // comecava a lista 2 bytes adiante — num veiculo intacto (lista toda de zeros) isso mudava a
  // contagem. Acha-se a corrida: primeira entrada valida, e dali de 10 em 10 enquanto casar.
  const assento = (i) => c[i] === 0x40 && c[i + 1] === 0x00 && c[i + 4] === 0 && c[i + 5] === 0 && c[i + 6] === 0 && c[i + 7] === 0 && c[i + 8] === 0 && c[i + 9] === 0;
  // A ULTIMA corrida, nao a primeira: `40 00 ...` tambem casa por acaso dentro do bloco de armas.
  let ini = null, ultimo = null;
  for (let i = anc + 150; i < anc + 480 && i + 10 < c.length; i++) {
    if (!assento(i) || (ultimo !== null && i <= ultimo)) continue;
    ini = i; ultimo = i;
    while (assento(ultimo + 10)) ultimo += 10;
  }
  if (ini === null) return null;
  const lugares = (ultimo - ini) / 10 + 1;
  // ONDE A LISTA ACABA: logo depois dela vem `[u8 n]` e n entradas de 9 B que comecam em 0x03 (tres
  // no Abrams, seis no Bradley; pares consecutivos, parecem escotilhas). O item intacto comeca em
  // 0x00 e o danificado em 0x80, entao um contador de 1..24 seguido de n marcas 0x03 nao se
  // confunde com item nenhum — e esse o terminador. Sem ele a leitura passava do fim nos veiculos
  // que acabam em itens intactos (todo veiculo sem tiro), e a contagem saia errada.
  const contaDepois = (q) => {
    const n = c[q];
    if (n < 1 || n > 24 || q + 1 + 9 * n > c.length) return false;
    for (let k = 0; k < n; k++) if (c[q + 1 + 9 * k] !== 0x03) return false;
    return true;
  };
  let p = ultimo + 10; const itens = [];
  for (let k = 0; k < 40 && p + 10 < c.length; k++) {
    if (contaDepois(p)) break;
    if (c[p] === 0x80) { itens.push({ i: k, dano: c.readFloatLE(p + 2), b: c[p + 1], u: c.readUInt32LE(p + 6) }); p += 10; continue; }
    // intacto: `00 <b> | u32` — o `b` (0, 3, 6 vistos) nao e do dano, aparece nos dois casos
    if (c[p] === 0x00) { itens.push({ i: k, dano: 0, b: c[p + 1], u: c.readUInt32LE(p + 2) }); p += 6; continue; }
    break;
  }
  // `confiavel` = a lista fechou no contador do bloco seguinte. Sem isso a contagem nao vale.
  const fecha = contaDepois(p);
  return { ini: ultimo + 10 - anc, fim: p - anc, lugares, itens, fecha, confiavel: fecha || itens.some((x) => x.dano > 0) };
}

// RESULTADO DA BATALHA (secao 104). O CM nao guarda o placar (secao 103), mas ele se calcula:
//   pontos de um lado = soma dos objetivos em que ele tem unidade viva dentro e o inimigo nao;
//   V-score = razao entre os dois placares; o nivel sai da tabela dos nove niveis.
// Conferido contra os AAR de cessar-fogo dos turnos 3, 4 e 5 da TESTE 2 (RU 150 x US 0, "U.S. Army
// Minor Defeat"): bate nos tres, placar e rotulo.
//
// RENDICAO. Se um lado se rende, o vencedor leva TODOS os pontos. A rendicao da IA o jogo decide
// pelo estado (na TESTE 2 o russo, com 81% de baixas, se rendeu; na batalha 1, com 55%, nao) — e
// por isso `limiarRendicao` (fracao de baixas do lado) e um parametro, calibrado grosso em 0,7 com
// os dois casos que temos. A rendicao do JOGADOR e uma escolha humana e nao esta no arquivo: os
// saves em que autor encerrou nos primeiros turnos (o CM so libera cessar-fogo depois de alguns)
// sairam como rendicao dele, e isso o save nao tem como dizer.
const NIVEIS = [
  { nome: 'Total', v: 4.0, frac: 0.80 },
  { nome: 'Major', v: 2.5, frac: 0.55 },
  { nome: 'Tactical', v: 1.75, frac: 0.30 },
  { nome: 'Minor', v: 1.25, frac: 0 },
];
export function resultado(completo, { limiarRendicao = 0.7, S = null } = {}) {
  const c = completo; const L = S || soldados(c);
  const O = ocupacao(c, L); const possiveis = objetivos(c).reduce((t, o) => t + o.pontos, 0);
  const pts = { US: 0, RU: 0 };
  for (const o of O) if (o.dono === 'US' || o.dono === 'RU') pts[o.dono] += o.pontos;
  // rendicao estimada pelas baixas de cada lado
  const baixasDe = (lado) => { const h = L.filter((s) => s.lado === lado); return h.length ? h.filter((s) => s.baixa).length / h.length : 0; };
  const perdas = { US: baixasDe('US'), RU: baixasDe('RU') };
  let rendido = null;
  for (const lado of ['US', 'RU']) if (perdas[lado] >= limiarRendicao && perdas[lado] > perdas[lado === 'US' ? 'RU' : 'US']) rendido = lado;
  if (rendido) { const outro = rendido === 'US' ? 'RU' : 'US'; pts[outro] = possiveis; pts[rendido] = 0; }
  const [vencedor, perdedor] = pts.US >= pts.RU ? ['US', 'RU'] : ['RU', 'US'];
  const v = pts[perdedor] > 0 ? pts[vencedor] / pts[perdedor] : (pts[vencedor] > 0 ? Infinity : 1);
  const frac = possiveis ? pts[vencedor] / possiveis : 0;
  let nivel = 'Draw';
  if (v >= 1.25) nivel = (NIVEIS.find((n) => v >= n.v && frac >= n.frac) || { nome: 'Minor' }).nome;
  return { pontos: pts, possiveis, vScore: v, fracao: frac, nivel, vencedor: nivel === 'Draw' ? null : vencedor,
    rotulo: nivel === 'Draw' ? 'Draw' : `${vencedor} ${nivel} Victory / ${perdedor} ${nivel} Defeat`,
    objetivos: O, perdas, rendicaoEstimada: rendido };
}

// SOCORROS ENTRE DOIS SAVES: quem tinha itens e ficou sem — o evento de socorro, sem depender de o
// homem ter morrido com a municao vazia.
export function socorros(antes, depois) {
  const A = new Map(soldados(antes).map((s) => [s.chave, s])); const out = [];
  for (const s of soldados(depois)) { const a = A.get(s.chave); if (!a) continue;
    if (s.baixa && s.inventario.length === 0 && a.inventario.length > 0) out.push({ chave: s.chave, lado: s.lado, time: s.time, turnoHit: s.turnoHit, tinha: a.inventario }); }
  return out;
}

const EH_MAIN = process.argv[1] && /[\\/]saves\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const SV = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Saved Games/';
  const alvo = process.argv[2]; if (!alvo) { console.log('uso: node saves.mjs <arquivo.bts | nome na pasta Saved Games>'); process.exit(1); }
  const f = /[\\/]/.test(alvo) ? alvo : SV + alvo + (/\.bts$/i.test(alvo) ? '' : '.bts');
  const sv = lerSave(f); const S = soldados(sv.completo); const E = equipes(sv.completo, S);
  const por = (lado) => S.filter((s) => s.lado === lado);
  console.log(`${sv.nome}: completo ${sv.completo.length} B; ${S.length} soldados (US ${por('US').length}, RU ${por('RU').length}), ` +
    `${S.filter((s) => s.baixa).length} baixas (US ${por('US').filter((s) => s.baixa).length}, RU ${por('RU').filter((s) => s.baixa).length}), ${E.length} times`);
  for (const e of E) console.log(`  time ${String(e.id).padStart(2)} ${e.lado} ${e.n} homens, ${e.baixas} baixas${e.aniquilado ? ' [ANIQUILADO]' : ''}${e.turnos.length ? ' T' + e.turnos.join(',T') : ''}: ` +
    e.homens.map((s) => s.nome + (s.baixa ? `*T${s.turnoHit}` : '')).join(', '));
  const r = resultado(sv.completo, { S });
  if (r.objetivos.length) {
    console.log(`objetivos (${r.possiveis} pontos no total):`);
    for (const o of r.objetivos) console.log(`  ${o.nome.padEnd(28)} ${String(o.pontos).padStart(4)} pts, ${o.nTiles} tiles — dentro: US ${o.US.length ? o.US.join(',') : '-'} | RU ${o.RU.length ? o.RU.join(',') : '-'}  => ${o.dono}`);
    console.log(`RESULTADO: RU ${r.pontos.RU} x US ${r.pontos.US} de ${r.possiveis} | V-score ${r.vScore === Infinity ? 'inf' : r.vScore.toFixed(2)} | ${(100 * r.fracao).toFixed(0)}% dos pontos | ${r.rotulo}` +
      `${r.rendicaoEstimada ? `  (rendicao estimada de ${r.rendicaoEstimada}: ${(100 * r.perdas[r.rendicaoEstimada]).toFixed(0)}% de baixas)` : ''}`);
  }
  const V = veiculos(sv.completo, S);
  if (V.length) console.log(`veiculos: ${V.filter((v) => v.achado).length} de ${V.length} tripulacoes, ${V.filter((v) => v.destruido).length} destruidos`);
  for (const v of V) console.log(v.achado ? `  veiculo da tripulacao ${String(v.time).padStart(2)}: estado 0x${v.estado.toString(16).padStart(2, '0')}${v.destruido ? ' DESTRUIDO' : v.imobilizado ? ' IMOBILIZADO' : v.estado === 0x20 ? ' em movimento' : ''}${v.aBordo ? '' : ' [vazio]'} mob ${v.mobilidade.toFixed(2)} (${v.pos.map((x) => x.toFixed(0)).join(',')}) ${v.tripulacao.homens.map((s) => s.nome + (s.baixa ? '*' : '')).join(', ')}${v.impactos.length ? '  impactos: ' + v.impactos.join(',') : ''}` : `  veiculo da tripulacao ${v.time}: nao localizado`);
}
