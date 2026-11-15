// O "prefixo" nunca foi um prefixo: e um BYTE DE ESCAPE, declarado no byte 0 do bloco.
//
//   <esc> 00   -> um byte literal de valor <esc>
//   <esc> XX   -> um token estrutural de codigo XX (XX != 0)
//   qualquer outro byte -> ele mesmo, literal
//
// Isso explica de uma vez os "registros invisiveis" e os "cabecalhos anomalos" que travaram
// meio projeto: o id 6506 = 0x196a, num arquivo com esc = 0x6a, e gravado como
// 6a 00 19 00 00 — cinco bytes para um u32. O extrator lia os bytes crus e via lixo.
//
// E resolve o transplante entre mapas: o esc e escolhido por arquivo, entao a cauda de um
// template e o mapa de outro arquivo falam "linguas" diferentes. Decodificar e recodificar
// com o esc do alvo traduz sem chute nenhum — a codificacao e posicional e auto-descritiva.
//
// Formato do fluxo decodificado: um Buffer de dados cru + a lista de posicoes (no fluxo cru)
// onde havia token, com o codigo. Guardar assim (em vez de uma lista de itens) mantem o
// consumo de memoria baixo e deixa o resto do projeto ler o fluxo cru com offsets normais.

// ATALHOS (descoberto em 03/09/2026 gerando a biblioteca): o byte 1 do bloco NAO e "o codigo do
// primeiro item" — e o NUMERO DE ATALHOS, e os n bytes seguintes sao os proprios atalhos. Cada
// atalho e um byte, escolhido entre os ausentes dos dados, e vale por um token pelo INDICE: o 1o
// e `esc 02`, o 2o e `esc 03`, o 3o e `esc 04`.
//
// RLE (06/09/2026, secao 111.30): o token NAO e "N zeros". `esc N v` e o byte v repetido N+1
// vezes — N copias pelo token e a propria copia literal v que vem logo atras. Com v = 00 as duas
// leituras coincidem (era o caso de todos os tokens dos gabaritos, por isso a regra dos zeros
// validou), mas 92 dos 360 mapas de QB de fabrica trazem `atalho v` com v != 0, e o editor grava
// `esc 03 ff` nos predios: o decodificador antigo devolvia `00 00 v` onde o jogo le `v v v`, e a
// batalha gerada sobre esses mapas travava em "Read Data" a 70%. Aqui o atalho 0 vira dois bytes
// `v v` no cru (mesma largura de antes, offsets preservados) e `expandir` repete o literal que
// segue o token em vez de zeros.
export function cabecalhoDoBloco(bl) {
  const n = bl[1];
  if (n > 3) throw new Error("bloco com " + n + " atalhos: a tabela so tem 3 sequencias conhecidas");
  return { esc: bl[0], atalhos: [...bl.subarray(2, 2 + n)], inicio: 2 + n };
}

export function decodificar(buf, esc, ini = 0, fim = buf.length, atalhos = []) {
  const cru = Buffer.allocUnsafe((fim - ini) * 2);
  const tokens = [];              // { pos: indice no fluxo cru, cod: byte }
  let n = 0, p = ini;
  // o valor que o proximo elemento do fluxo bruto produz (e o byte repetido pelo atalho 0)
  const valorEm = (q) => {
    if (q >= fim) return 0;
    const b = buf[q];
    if (b === esc) return buf[q + 1] === 0 ? esc : 0;   // `esc 00` e o literal esc; token atras de token nao ocorre
    return atalhos.includes(b) ? valorEm(q + 1) : b;
  };
  while (p < fim) {
    const b = buf[p];
    if (b === esc) {
      if (p + 1 >= fim) throw new Error("escape solto no fim (posicao " + p + ")");
      const cod = buf[p + 1];
      if (cod === 0) cru[n++] = esc;            // literal do proprio byte de escape
      else {
        tokens.push({ pos: n, cod });           // token: repete `cod` vezes o literal que vem atras
        // O BYTE ATRAS DE UM TOKEN E SEMPRE LITERAL, mesmo igual ao escape (05/10/2026): token atras de token nao
        // ocorre, e o jogo grava `esc N esc` para N+1 copias do proprio byte de escape (Town-Water 275 Assault, esc
        // = 'y', rotulo "Zhorstokyy" = `... k 79 01 79 12 13`). Em 9 de 1.129 arquivos; nunca `esc N esc 00`. Lido
        // como token, o segundo escape inventava 18 bytes e deslocava o resto do mapa.
        if (p + 2 < fim && buf[p + 2] === esc) { cru[n++] = esc; p += 3; continue; }
      }
      p += 2; continue;
    }
    const k = atalhos.indexOf(b);
    if (k === 0) { const v = valorEm(p + 1); cru[n++] = v; cru[n++] = v; p++; continue; }
    if (k === 1) { tokens.push({ pos: n, cod: 0x03 }); p++; continue; }
    if (k === 2) { tokens.push({ pos: n, cod: 0x04 }); p++; continue; }
    cru[n++] = b; p++;
  }
  return { cru: cru.subarray(0, n), tokens };
}

export function codificar({ cru, tokens }, esc) {
  const partes = [];
  let ant = 0;
  const emitir = (a, z) => {
    // um trecho cru: todo byte igual ao novo esc precisa virar <esc> 00
    let ini = a;
    for (let p = a; p < z; p++) {
      if (cru[p] !== esc) continue;
      if (p > ini) partes.push(cru.subarray(ini, p));
      partes.push(Buffer.from([esc, 0x00]));
      ini = p + 1;
    }
    if (z > ini) partes.push(cru.subarray(ini, z));
  };
  for (const t of tokens) {
    emitir(ant, t.pos);
    partes.push(Buffer.from([esc, t.cod]));
    ant = t.pos;
    // o literal atras do token vai cru mesmo sendo o esc (`esc N esc`, como o jogo grava; ver decodificar)
    if (cru[t.pos] === esc && t.pos < cru.length) { partes.push(Buffer.from([esc])); ant = t.pos + 1; }
  }
  emitir(ant, cru.length);
  return Buffer.concat(partes);
}

// Traduz um trecho ja codificado de um esc para outro. Idempotente quando os dois sao iguais,
// o que serve de teste de ida-e-volta.
export function traduzir(buf, de, para, ini = 0, fim = buf.length) {
  return codificar(decodificar(buf, de, ini, fim), para);
}

// O byte 0 do bloco declara o esc; o byte 1 e o numero de atalhos (ver cabecalhoDoBloco).
export function escDoBloco(bl) {
  return bl[0];
}

// A CORRENTE COMPLETA. `esc N` (N >= 3) nao e um marcador de largura zero: sao N BYTES iguais ao
// literal que vem logo atras (RLE, secao 111.30) — quase sempre zeros. A prova dos zeros esta na
// posicao das unidades (secao 59): na biblioteca `10 [3] 00 X Y` e no gabarito do QBLARGE
// `10 [9] 00 40 44` — 4 zeros de prefixo + X = 0.0 + Y = 768.0, os mesmos 20 bytes; a prova do
// valor esta nos predios (`esc 03 ff` = `ff ff ff ff`). Toda a leitura de campos por offset deve
// ser feita AQUI; a corrente compactada (`cru` + tokens) fica para escrever, porque o jogo emite
// exatamente essa forma.
//
// Devolve { completo, mapa } — `mapa[i]` e o offset no `cru` de onde veio o byte i da corrente
// completa (ou -1 para um byte expandido de token; nesse caso `tokenDe[i]` e o indice do token).
export function expandir(cru, tokens) {
  const ordenados = [...tokens].sort((a, b) => a.pos - b.pos);
  const partes = [], mapa = [], tokenDe = [];
  let k = 0, i = 0;
  const push = (b, origem, tok) => { partes.push(b); mapa.push(origem); tokenDe.push(tok); };
  while (i <= cru.length) {
    while (k < ordenados.length && ordenados[k].pos === i) {
      const n = ordenados[k].cod;                // esc 00 e literal (nunca vira token); 1 e 2 nao ocorrem
      const v = i < cru.length ? cru[i] : 0;     // o literal repetido (token no fim do fluxo: zeros)
      for (let z = 0; z < n; z++) push(v, -1, k);
      k++;
    }
    if (i === cru.length) break;
    push(cru[i], i, -1); i++;
  }
  return { completo: Buffer.from(partes), mapa, tokenDe };
}

// CODIFICACAO CANONICA a partir da corrente completa: toda corrida de >= 3 zeros vira `esc N`
// (N <= 255, encadeando se maior), o resto e literal, `esc` literal vira `esc 00`. O escape e um
// byte AUSENTE da corrente completa (como o jogo faz). Se o jogo aceitar um arquivo assim, o
// decodificador e generico e qualquer byte pode ser escrito na corrente completa (secao 62).
// NAO ACEITOU — e a secao 111.30 explica: `esc N` sem o literal atras faz o jogo repetir o byte
// de dados seguinte. Fica so como registro; para gravar use `codificarComoJogo`.
export function codificarCanonico(completo, escPreferido = null) {
  // o escape nao precisa estar ausente (ha `esc 00` para o literal): usa o byte MENOS frequente,
  // que minimiza os pares `esc 00`. Correntes grandes usam todos os 256 valores.
  let esc = escPreferido;
  if (esc === null) { const cnt = new Uint32Array(256); for (const b of completo) cnt[b]++; esc = 1; for (let b = 1; b < 256; b++) if (cnt[b] < cnt[esc]) esc = b; }
  const out = [esc, 0x00]; let i = 0;
  while (i < completo.length) {
    if (completo[i] === 0) { let n = 0; while (i + n < completo.length && completo[i + n] === 0) n++;
      if (n >= 3) { let r = n; while (r >= 3) { const k = Math.min(r, 255); out.push(esc, k); r -= k; } for (let z = 0; z < r; z++) out.push(0); }
      else for (let z = 0; z < n; z++) out.push(0);
      i += n; continue; }
    if (completo[i] === esc) out.push(esc, 0x00); else out.push(completo[i]);
    i++;
  }
  return Buffer.from(out);
}

// O CODIFICADOR DO JOGO (secao 63): corrida de k >= 4 bytes iguais v -> `esc (k-1)` + um `v`
// literal; corridas de 1..3 ficam literais; o byte de escape nos dados vira `esc 00`. Deduzido
// dos tokens em volta dos campos (posicao `[3] 00 X Y` = 4 zeros; cabecas `[7] 00` = 8; faixas
// `[4] 00` = 5, `[3] 00` = 4) e conferido byte a byte contra os blocos originais — inclusive os
// `esc 03 ff` dos predios, que a versao so-zeros gravava como quatro `ff` literais (111.30).
export function codificarComoJogo(completo, esc) {
  const out = [esc, 0x00]; let i = 0;
  const literal = (v) => { if (v === esc) out.push(esc, 0x00); else out.push(v); };
  while (i < completo.length) {
    const v = completo[i];
    let k = 1; while (i + k < completo.length && completo[i + k] === v) k++;
    let r = k;
    // atras do token o literal vai CRU, mesmo que seja o escape (a regra do jogo, ver `decodificar`)
    while (r >= 4) { const n = Math.min(r - 1, 255); out.push(esc, n, v); r -= n + 1; }
    for (let z = 0; z < r; z++) literal(v);
    i += k;
  }
  return Buffer.from(out);
}
