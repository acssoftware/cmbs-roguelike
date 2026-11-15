// Explora o cabecalho estendido que vem DEPOIS do BMP embutido
import fs from 'fs';
const MAGIC = Buffer.from('372e13d0a5f9c4c89b8d7061b2e5f64a', 'hex');
const ok = (s) => /^[\x20-\x7e]*$/.test(s);

import { bmpIntegro } from './bmp_integro.mjs';
export function abrir(file) {
  const b = fs.readFileSync(file);
  if (!b.subarray(0, 16).equals(MAGIC)) return null;
  // localiza o bloco de strings do cabecalho (nome + descricao) e o BMP
  for (let o = 0x24; o <= 0x3a; o++) {
    const ln = b.readUInt16LE(o);
    if (ln > 200 || o + 2 + ln + 2 > b.length) continue;
    const nome = b.toString('latin1', o + 2, o + 2 + ln);
    if (!ok(nome) || (ln > 0 && !/[A-Za-z]/.test(nome))) continue;
    const p = o + 2 + ln, ld = b.readUInt16LE(p);
    if (ld > 8000 || p + 2 + ld > b.length) continue;
    const desc = b.toString('latin1', p + 2, p + 2 + ld);
    if (!/^[\x20-\x7e\r\n\t]*$/.test(desc)) continue;
    const fim = p + 2 + ld;
    // Depois da descricao vem um u32 com o TAMANHO da imagem de briefing, e so entao o BMP.
    // Cenario sem imagem grava zero ali e nao tem BMP nenhum — e o caso dos arquivos com
    // todas as formacoes de um exercito, que sao so ordem de batalha. Exigir o BMP fazia o
    // leitor recusar esses arquivos inteiros.
    if (b.readUInt32LE(fim) === 0) return { b, nome, desc, bmpIni: fim + 4, bmpFim: fim + 4, tituloEm: o, descEm: p, fimDesc: fim };
    for (let i = fim; i < fim + 8; i++) {
      if (b[i] !== 0x42 || b[i + 1] !== 0x4d) continue;
      if (b.readUInt32LE(i + 10) !== 54) continue;
      const w = b.readInt32LE(i + 18), h = b.readInt32LE(i + 22);
      if (w <= 0 || h <= 0 || b.readUInt16LE(i + 28) !== 24) continue;
      const bmpFim = i + 54 + Math.ceil(w * 3 / 4) * 4 * h;
      return { b, nome, desc, bmpIni: i, bmpFim, tituloEm: o, descEm: p, fimDesc: fim };
    }
  }
  return null;
}

// O CABECALHO DA LISTA (17/10/2026): titulo, descricao e a imagem que o jogo mostra na lista de cenarios, na tela de
// saved game (o save herda o cabecalho da batalha) e, num .cam, na lista de campanhas — o mesmo formato nos dois:
//   u16 len | titulo | u16 len | descricao (CRLF) | u32 tamanho | BMP 24 bits (cerca de 170x170)
// `novo` = { titulo, descricao, bmp } (o que faltar fica). Nada depois da imagem guarda posicao: o resto so desloca.
export function escreverCabecalho(arquivo, novo = {}, saida = arquivo) {
  const r = abrir(arquivo); if (!r) throw new Error(`${arquivo}: cabecalho nao reconhecido`);
  const titulo = novo.titulo ?? r.nome, descricao = String(novo.descricao ?? r.desc).replace(/\r?\n/g, '\r\n');
  if (!titulo.length || titulo.length > 64 || !ok(titulo)) throw new Error(`titulo invalido: "${titulo}" (1 a 64 caracteres ASCII)`);
  if (descricao.length > 8000 || !/^[\x20-\x7e\r\n\t]*$/.test(descricao)) throw new Error('descricao invalida (ASCII, ate 8000)');
  let bmp = r.b.subarray(r.bmpIni, r.bmpFim);
  if (novo.bmp) {
    // a conferencia inteira e a mesma do briefing (29/10, bmp_integro): um BMP vazio dava RangeError aqui
    const motivo = bmpIntegro(novo.bmp);
    if (motivo) throw new Error(`a imagem do cabecalho: ${motivo}`);
    bmp = novo.bmp;
  }
  const u16 = (n) => { const x = Buffer.alloc(2); x.writeUInt16LE(n); return x; };
  const u32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32LE(n); return x; };
  const t = Buffer.from(titulo, 'latin1'), d = Buffer.from(descricao, 'latin1');
  const fora = Buffer.concat([r.b.subarray(0, r.tituloEm), u16(t.length), t, u16(d.length), d, u32(bmp.length), bmp, r.b.subarray(r.bmpFim)]);
  // num temporario, conferido, e so entao no lugar (29/10): uma releitura errada nao deixa o arquivo pela metade
  const tmp = `${saida}.cabecalho.tmp`;
  fs.writeFileSync(tmp, fora);
  const lido = abrir(tmp);
  if (!lido || lido.nome !== titulo || lido.desc !== descricao || !lido.b.subarray(lido.bmpIni, lido.bmpFim).equals(bmp)) { fs.rmSync(tmp, { force: true }); throw new Error('o cabecalho gravado nao le de volta'); }
  fs.renameSync(tmp, saida);
  return { titulo, descricao, imagem: [bmp.readInt32LE(18), bmp.readInt32LE(22)], delta: fora.length - r.b.length };
}

// Le a lista de strings que segue o BMP; devolve tambem onde ela termina
export function lerListaStrings(b, ini) {
  for (let pre = 0; pre <= 8; pre++) {
    let o = ini + pre;
    if (o + 4 > b.length) break;
    const n = b.readUInt32LE(o);
    if (n < 0 || n > 64) continue;
    o += 4;
    const strs = [];
    let bom = true;
    for (let k = 0; k < n; k++) {
      if (o + 2 > b.length) { bom = false; break; }
      const L = b.readUInt16LE(o);
      if (L < 1 || L > 64 || o + 2 + L > b.length) { bom = false; break; }
      const s = b.toString('latin1', o + 2, o + 2 + L);
      if (!/^[\x20-\x7e]+$/.test(s)) { bom = false; break; }
      strs.push(s); o += 2 + L;
    }
    if (bom && strs.length === n) return { pre, n, strs, fim: o };
  }
  return null;
}

const EH_MAIN = process.argv[1] && /ext.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  for (const f of process.argv.slice(2)) {
    const r = abrir(f);
    if (!r) { console.log(`${f}: nao parseou`); continue; }
    const L = lerListaStrings(r.b, r.bmpFim);
    console.log(`\n=== ${f.split(/[\/]/).pop()} ===`);
    console.log(`  BMP ${r.bmpIni}..${r.bmpFim}`);
    if (!L) { console.log('  lista de strings: NAO reconhecida'); continue; }
    console.log(`  prefixo ${L.pre} bytes | ${L.n} strings: ${L.strs.map(s=>JSON.stringify(s)).join(' ')}`);
    console.log(`  campos comecam em ${L.fim}: ${r.b.subarray(L.fim, L.fim + 40).toString('hex').replace(/(..)/g,'$1 ')}`);
  }
}
