// Extrai os registros de unidade de um cenario .btt do Combat Mission.
//
// COMO FOI DESCOBERTO (experimento controlado no editor do jogo, dois cenarios):
//   1. Abrir um cenario no editor, salvar sem mudancas (A), deletar UMA unidade, salvar (B).
//   2. O BLOCO 1 do container (terreno + briefings) fica IDENTICO byte a byte entre A e B
//      -> toda informacao de unidade esta no BLOCO 2.
//   3. O bloco 2 se REORDENA a cada gravacao (prefixo comum de 2 bytes entre A e B), entao
//      a analise tem de ser por CONTEUDO, nunca por posicao.
//   4. Comparando janelas de 12 bytes presentes em A e ausentes em B, aparece o registro.
//
// ESTRUTURA DO REGISTRO
//   <prefixo> <tam> 00 | u32 id | ...campos... | [u16 tam + nome customizado]
//
//   O <prefixo> NAO e constante do formato: muda a cada gravacao do arquivo.
//   No August Morning e 0x36; no Going to Town, 0x56; no mesmo Going to Town
//   original de fabrica, 0x6B. Por isso `detectarPrefixo()` o descobre por analise.
//
// VERIFICACAO
//   August Morning  A: 218 registros / 183 IDs  ->  B: 217 / 182   (apagado "Cpl Mark Ezra")
//   Going to Town   A: 319 registros / 297 IDs  ->  B: 318 / 296   (apagado um Sniper Team)
//   Nos dois casos some exatamente um registro e um ID.
import fs from 'fs';
import { descomprimirDoContainer, descomprimir } from './lz.mjs';
import { abrir, lerListaStrings } from './ext.mjs';

export const TAM_MAX = 16;          // <tam> observado na faixa 1..16
export const ID_MIN = 50, ID_MAX = 20000;
export const TIPO_MIN = 500, TIPO_MAX = 10000;   // faixa observada dos IDs de tipo

// Tipos confirmados por experimento controlado no editor (ver cabecalho)
export const TIPOS_CONHECIDOS = {
  3387: 'Main Battle Tank (M1A2 SEP Abrams)',
  3375: 'Fire Support Vehicle (M7A3 BFIST Bradley (ERA))',
};

export function blocoUnidades(arquivo) {
  const r = abrir(arquivo);
  if (r) {
    const L = lerListaStrings(r.b, r.bmpFim);
    if (L) {
      const d = descomprimirDoContainer(r.b, L.fim);
      if (d.blocos.length > 1) return Buffer.from(d.blocos[1].saida);
    }
  }
  return blocoUnidadesSemMapa(arquivo);
}

// Cenario salvo SEM MAPA (mapa em branco): 51 KB em vez de 1,1 MB, mesma ordem de batalha.
// A localizacao normal do bloco parte da secao de terreno, que aqui nao existe. Como o
// arquivo e pequeno, da para achar a cadeia por busca: o inicio valido e aquele em que a
// sequencia [u32 tamanho][fluxo] fecha exatamente no fim do arquivo. O bloco de unidades
// e o ultimo da cadeia.
export function blocoUnidadesSemMapa(arquivo) {
  const b = fs.readFileSync(arquivo);
  if (b.length < 64 || b.length > 4 * 1024 * 1024) return null;
  for (let o = 16; o < 512; o++) {
    let p = o, n = 0;
    while (p + 4 < b.length) {
      const tam = b.readUInt32LE(p);
      if (tam <= 0 || p + 4 + tam > b.length) break;
      p += 4 + tam; n++;
      if (n > 8) break;
    }
    if (p !== b.length || !n) continue;
    let q = o, ultimo = null;
    for (let i = 0; i < n; i++) {
      const tam = b.readUInt32LE(q);
      ultimo = descomprimir(b.subarray(q + 4, q + 4 + tam), 0).saida;
      q += 4 + tam;
    }
    if (ultimo && ultimo.length > 1000) return Buffer.from(ultimo);
  }
  return null;
}

// O byte de prefixo varia por gravacao. Escolhe o que rende mais IDs distintos plausiveis.
export function detectarPrefixo(bloco) {
  let melhor = null;
  for (let pref = 0; pref < 256; pref++) {
    const ids = new Set();
    let total = 0;
    for (let tam = 1; tam <= TAM_MAX; tam++) {
      const p = Buffer.from([pref, tam, 0]);
      let i = 0;
      while ((i = bloco.indexOf(p, i)) !== -1) {
        if (i + 7 <= bloco.length) {
          const id = bloco.readUInt32LE(i + 3);
          if (id > ID_MIN && id < ID_MAX) { ids.add(id); total++; }
        }
        i++;
      }
    }
    if (total < 20) continue;
    if (!melhor || ids.size > melhor.idsDistintos) melhor = { prefixo: pref, registros: total, idsDistintos: ids.size };
  }
  return melhor;
}

export function extrairUnidades(bloco, prefixo) {
  if (prefixo === undefined) {
    const d = detectarPrefixo(bloco);
    if (!d) return [];
    prefixo = d.prefixo;
  }
  const regs = [];
  for (let tam = 1; tam <= TAM_MAX; tam++) {
    const p = Buffer.from([prefixo, tam, 0]);
    let i = 0;
    while ((i = bloco.indexOf(p, i)) !== -1) {
      if (i + 28 <= bloco.length) {
        // Duas variantes de cabecalho. A comum poe o id logo apos <prefixo> <tam> 00.
        // A outra intercala um u32 de contagem (registros de <tam> 3 e 4, um por grupo
        // da arvore). Sem tratar as duas, some um registro por formacao e o alinhamento
        // entre a ordem do arquivo e a ordem da tela sai deslocado.
        let id = bloco.readUInt32LE(i + 3), desloc = 0;
        if (!(id > ID_MIN && id < ID_MAX)) {
          const cand = bloco.readUInt32LE(i + 7);
          if (id < 64 && cand > ID_MIN && cand < ID_MAX) { id = cand; desloc = 4; }
        }
        if (id > ID_MIN && id < ID_MAX) {
          const u = {
            offset: i + desloc, offsetReg: i, desloc, tam, id,
            hierarquia: bloco.subarray(i + desloc + 9, i + desloc + 17).toString('hex'),
            tipo: i + desloc + 22 <= bloco.length ? bloco.readUInt16LE(i + desloc + 20) : null,
          };
          const Ln = bloco.readUInt16LE(i + desloc + 20);
          if (Ln > 0 && Ln < 64 && i + desloc + 22 + Ln <= bloco.length) {
            const s = bloco.toString('latin1', i + desloc + 22, i + desloc + 22 + Ln);
            if (/^[\x20-\x7e]+$/.test(s) && /[A-Za-z]{2}/.test(s)) u.nome = s;
          }
          regs.push(u);
        }
      }
      i++;
    }
  }
  return regs.sort((a, b) => a.offset - b.offset);
}

// Rotulos livres do bloco 2: objetivos, marcos do terreno, grupos e gatilhos de IA
export function extrairRotulos(bloco) {
  const out = [];
  let o = 0;
  while (o + 2 <= bloco.length) {
    const L = bloco.readUInt16LE(o);
    if (L > 2 && L < 64 && o + 2 + L <= bloco.length) {
      const s = bloco.toString('latin1', o + 2, o + 2 + L);
      if (/^[\x20-\x7e]+$/.test(s) && /[A-Za-z]{3}/.test(s)) { out.push({ offset: o, texto: s }); o += 2 + L; continue; }
    }
    o++;
  }
  return out;
}

export function analisar(arquivo) {
  const b = blocoUnidades(arquivo);
  if (!b) return null;
  const d = detectarPrefixo(b);
  if (!d) return { bloco2: b.length, prefixo: null, unidades: [], rotulos: extrairRotulos(b) };
  return {
    bloco2: b.length, prefixo: d.prefixo,
    unidades: extrairUnidades(b, d.prefixo),
    rotulos: extrairRotulos(b),
  };
}

const EH_MAIN = process.argv[1] && /[\\/]unidades\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  for (const f of process.argv.slice(2)) {
    const r = analisar(f);
    if (!r) { console.log(`${f}: nao parseou`); continue; }
    const ids = [...new Set(r.unidades.map((u) => u.id))].sort((a, b) => a - b);
    console.log(`\n### ${f.split(/[\\/]/).pop()}`);
    console.log(`  bloco 2: ${r.bloco2} bytes | prefixo 0x${(r.prefixo ?? 0).toString(16)}`);
    console.log(`  ${r.unidades.length} registros | ${ids.length} IDs distintos (${ids[0]}..${ids[ids.length - 1]})`);
    const nomeados = r.unidades.filter((u) => u.nome);
    if (nomeados.length) {
      console.log(`  ${nomeados.length} com nome customizado:`);
      nomeados.forEach((u) => console.log(`     id ${String(u.id).padStart(5)}  "${u.nome}"`));
    }
    const interessantes = r.rotulos.filter((x) => /^[A-Z]/.test(x.texto) && x.texto.length > 4);
    if (interessantes.length) console.log(`  rotulos: ${interessantes.slice(0, 10).map((x) => JSON.stringify(x.texto)).join(' ')}`);
  }
}
