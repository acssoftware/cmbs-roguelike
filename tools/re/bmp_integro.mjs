// O BMP QUE PODE ENTRAR NUM ARQUIVO DO JOGO (29/10/2026, autor: "imagens cosmeticas corrompidas ou ausentes nao podem
// comprometer o app nem o jogo"). O cabecalho da lista (170x170) e as imagens do briefing (224x224, 702x224, 952x350) vao
// byte a byte para dentro do .btt/.cam, e o jogo le w*h*3 pixels de onde o cabecalho do BMP diz. Um BMP truncado com o
// cabecalho intacto passava (o briefing so conferia o cabecalho) e o jogo leria alem do bloco. Aqui a conferencia inteira:
// 'BM', pixels em 54 (cabecalho BITMAPINFOHEADER de 40), 24 bits, sem compressao, largura e altura positivas (de baixo
// para cima, como o jogo grava), comprimento exato e, quando pedido, o tamanho exato da tela.
// Devolve null quando o BMP e integro, senao o motivo numa frase.
export function bmpIntegro(b, tamanho = null) {
  if (!Buffer.isBuffer(b) || b.length === 0) return 'empty file';
  if (b.length < 54) return `only ${b.length} bytes, not a BMP`;
  if (b.subarray(0, 2).toString('latin1') !== 'BM') return 'not a BMP';
  if (b.readUInt32LE(10) !== 54 || b.readUInt32LE(14) !== 40) return 'the BMP header is not the plain 54-byte one';
  const w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28), comp = b.readUInt32LE(30);
  if (bpp !== 24) return `${bpp} bits per pixel, the game takes 24`;
  if (comp !== 0) return 'compressed BMP';
  if (w <= 0 || h <= 0) return `${w}x${h}: needs a positive width and a bottom-up height`;
  const esperado = 54 + Math.ceil((w * 3) / 4) * 4 * h;
  if (b.length !== esperado) return `${b.length} bytes for a ${w}x${h} picture that takes ${esperado} (truncated or padded)`;
  if (tamanho && (w !== tamanho[0] || h !== tamanho[1])) return `${w}x${h}, the screen takes ${tamanho[0]}x${tamanho[1]}`;
  return null;
}
