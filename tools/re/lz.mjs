// Descompressor do codec LZ77/LZSS do Combat Mission (Engine 4)
// Engenharia reversa de CM Shock Force 2.exe:
//   codificador   0x6DB740
//   decodificador 0x6DBDB0
//   tabela de codigos (codigo, largura) em 0xB731B8, indices 1..33
//   tabela de decodificacao 0xE53B00 — construida em runtime, aqui reconstruida
//
// Formato:
//   - fluxo de bits CONTINUO, MSB-first (o buffer de 1 KB do jogo e so uma janela
//     deslizante de leitura; nao ha blocos independentes)
//   - janela LZ: buffer circular de 16 KB (mascara 0x3FFF)
//   - simbolo 1        = literal, seguido de 8 bits crus
//   - simbolos 2..33   = correspondencia, o indice E o comprimento
//   - distancia: se largura < 13, le `largura` bits;
//                senao le 1 bit de escape -> 1: le 9 bits | 0: le `largura` bits
//   - distancia 0 encerra o fluxo
//   - apos cada simbolo:  total += comprimento
//                         while (largura < 14 && total >= (1<<largura)-1) largura++

export const TABELA = [
  null,
  [0, 2], [2, 2], [6, 3], [14, 4], [4, 4], [30, 5], [14, 5], [12, 5],
  [62, 6], [30, 6], [26, 6], [126, 7], [62, 7], [54, 7], [254, 8], [126, 8],
  [110, 8], [510, 9], [254, 9], [222, 9], [1022, 10], [511, 10], [446, 10],
  [2046, 11], [1021, 11], [895, 11], [894, 11], [4094, 12], [2041, 12],
  [2040, 12], [8191, 13], [8190, 13], [5, 4],
];

export const LITERAL = 1;
export const LARGURA_SIMBOLO_MAX = 13;
export const LARGURA_DIST_MAX = 14;
export const JANELA = 1 << 14;          // 16 KB
export const MASCARA = JANELA - 1;      // 0x3FFF

export function montarTabelaDecod() {
  const t = new Uint8Array(1 << (LARGURA_SIMBOLO_MAX + 1));
  for (let s = 1; s < TABELA.length; s++) {
    const [cod, larg] = TABELA[s];
    t[(1 << larg) | cod] = s;
  }
  return t;
}

export function verificarPrefixo() {
  const bits = (c, w) => c.toString(2).padStart(w, '0');
  const cods = [];
  for (let s = 1; s < TABELA.length; s++) cods.push({ s, b: bits(TABELA[s][0], TABELA[s][1]) });
  const conflitos = [];
  for (const a of cods) for (const b of cods)
    if (a.s !== b.s && b.b.startsWith(a.b)) conflitos.push(`${a.s}(${a.b}) prefixo de ${b.s}(${b.b})`);
  return conflitos;
}

class Bits {
  constructor(buf, off) { this.b = buf; this.pos = off * 8; }
  bit() {
    const i = this.pos >> 3;
    if (i >= this.b.length) return -1;
    const v = (this.b[i] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }
  ler(n) { let v = 0; for (let k = 0; k < n; k++) { const x = this.bit(); if (x < 0) return -1; v = (v << 1) | x; } return v; }
}

const TAB = montarTabelaDecod();

function lerSimbolo(br) {
  let acc = br.ler(2);
  if (acc < 0) return -1;
  for (let larg = 2; larg <= LARGURA_SIMBOLO_MAX; larg++) {
    const s = TAB[(1 << larg) | acc];
    if (s && TABELA[s][1] === larg) return s;
    if (larg === LARGURA_SIMBOLO_MAX) break;
    const b = br.bit();
    if (b < 0) return -1;
    acc = (acc << 1) | b;
  }
  return -1;
}

// Descomprime a partir de `off`. `limite` corta a saida (0 = sem limite).
export function descomprimir(buf, off, limite = 0) {
  const br = new Bits(buf, off);
  const jan = new Uint8Array(JANELA);
  const saida = [];
  let esc = 0, total = 0, largura = 1, simbolos = 0;
  for (;;) {
    const s = lerSimbolo(br);
    if (s < 0) return { saida: Uint8Array.from(saida), total, simbolos, fim: 'bits acabaram' };
    let comp;
    if (s === LITERAL) {
      const b = br.ler(8);
      if (b < 0) return { saida: Uint8Array.from(saida), total, simbolos, fim: 'bits acabaram' };
      saida.push(b); jan[esc] = b; esc = (esc + 1) & MASCARA;
      comp = 1;
    } else {
      let dist;
      if (largura < 13) dist = br.ler(largura);
      else {
        const flag = br.bit();
        if (flag < 0) return { saida: Uint8Array.from(saida), total, simbolos, fim: 'bits acabaram' };
        dist = flag ? br.ler(9) : br.ler(largura);
      }
      if (dist < 0) return { saida: Uint8Array.from(saida), total, simbolos, fim: 'bits acabaram' };
      if (dist === 0) return { saida: Uint8Array.from(saida), total, simbolos, fim: 'terminador' };
      let src = (esc - dist) & MASCARA;
      for (let k = 0; k < s; k++) {
        const b = jan[(src + k) & MASCARA];
        saida.push(b); jan[esc] = b; esc = (esc + 1) & MASCARA;
      }
      comp = s;
    }
    total += comp; simbolos++;
    while (largura < LARGURA_DIST_MAX && total >= (1 << largura) - 1) largura++;
    if (limite && saida.length >= limite) return { saida: Uint8Array.from(saida), total, simbolos, fim: 'limite' };
  }
}

const EH_MAIN = process.argv[1] && /[\\/]lz\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const c = verificarPrefixo();
  console.log(`tabela: ${TABELA.length - 1} simbolos | ${c.length ? 'CONFLITOS: ' + c.join(', ') : 'livre de prefixo: OK'}`);
}


// ---- Localizacao do fluxo dentro do container ----
// Depois do bloco de campos vem:
//    base+0 .. base+18   campos (mes, ano, dia, hora, duracao, dimensoes)
//    base+19             u32 com o tamanho do fluxo comprimido
//    base+23             inicio do fluxo
// Offset fixo, verificado em 27/27 cenarios do CMBS.
export const DELTA_FLUXO = 23;
export const OFF_TAMANHO = 19;

// Le a CADEIA de blocos: [u32 tamanho][fluxo] [u32 tamanho][fluxo] ...
export function descomprimirDoContainer(buf, baseCampos, maxBlocos = 64) {
  let o = baseCampos + OFF_TAMANHO;
  const blocos = [];
  while (o + 4 < buf.length && blocos.length < maxBlocos) {
    // Normalmente o u32 de tamanho vem direto. Em alguns arquivos (cenarios do CMSF2)
    // ha um separador de 2 bytes entre blocos. Verificado em 14/14 arquivos: com o
    // separador, a cadeia fecha exatamente no fim do arquivo.
    let tam = buf.readUInt32LE(o), ini = o + 4;
    if (tam <= 0 || ini + tam > buf.length) {
      if (o + 6 > buf.length) break;
      tam = buf.readUInt32LE(o + 2); ini = o + 6;
      if (tam <= 0 || ini + tam > buf.length) break;
    }
    const d = descomprimir(buf.subarray(ini, ini + tam), 0);
    blocos.push({ inicio: ini, tamComprimido: tam, saida: d.saida, fim: d.fim, simbolos: d.simbolos });
    o = ini + tam;
  }
  const total = Buffer.concat(blocos.map((b) => Buffer.from(b.saida)));
  return { blocos, saida: total, bytes: total.length };
}

// ---- Codificador "somente literais" ----
// Nao comprime (expande ~1,25x): cada byte vira 10 bits = codigo do simbolo 1 ("00")
// seguido dos 8 bits do byte. Termina com um simbolo de correspondencia + distancia 0.
// Serve para reescrever um arquivo sem implementar o compressor real.
class EscritorBits {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  escrever(valor, largura) {
    for (let i = largura - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((valor >> i) & 1);
      if (++this.n === 8) { this.bytes.push(this.acc & 0xff); this.acc = 0; this.n = 0; }
    }
  }
  finalizar() {
    if (this.n) { this.acc <<= (8 - this.n); this.bytes.push(this.acc & 0xff); this.acc = 0; this.n = 0; }
    return Buffer.from(this.bytes);
  }
}

export function comprimirLiterais(dados) {
  const w = new EscritorBits();
  const [codLit, largLit] = TABELA[LITERAL];       // (0, 2)
  let total = 0, largura = 1;
  for (const b of dados) {
    w.escrever(codLit, largLit);
    w.escrever(b, 8);
    total += 1;
    while (largura < LARGURA_DIST_MAX && total >= (1 << largura) - 1) largura++;
  }
  // terminador: qualquer simbolo de correspondencia seguido de distancia 0
  const [codM, largM] = TABELA[2];
  w.escrever(codM, largM);
  if (largura < 13) w.escrever(0, largura);
  else { w.escrever(0, 1); w.escrever(0, largura); }   // bit de escape 0 + distancia
  return w.finalizar();
}
