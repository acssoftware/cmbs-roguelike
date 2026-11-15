// Parser de save (.bts) do Combat Mission + descompressao da cadeia de blocos
import fs from 'fs';
import { descomprimirDoContainer } from './lz.mjs';
const MAGIC = Buffer.from('372e13d0a5f9c4c89b8d7061b2e5f64a', 'hex');
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export function abrirSave(file) {
  const b = fs.readFileSync(file);
  if (!b.subarray(0, 16).equals(MAGIC)) return null;
  let o = 0x2f;
  const ln = b.readUInt16LE(o); o += 2;
  const nomeBatalha = b.toString('latin1', o, o + ln); o += ln;
  o += 6;                                   // 6 bytes zerados
  const ls = b.readUInt16LE(o); o += 2;
  const nomeSave = b.toString('latin1', o, o + ls); o += ls;
  const S = o;                              // 01 + 4 zeros, campos comecam em S+5
  const base = S + 5;
  const campos = {
    mes: b[base], ano: b.readUInt16LE(base + 1), dia: b[base + 4],
    minutosDoDia: b.readUInt16LE(base + 5), duracaoMin: b.readUInt16LE(base + 7),
    largura: b.readUInt16LE(base + 13), altura: b.readUInt16LE(base + 15),
  };
  campos.hora = `${String(Math.floor(campos.minutosDoDia / 60)).padStart(2,'0')}:${String(campos.minutosDoDia % 60).padStart(2,'0')}`;
  campos.mesNome = MESES[campos.mes];
  return { b, nomeBatalha, nomeSave, base, campos };
}

export function descomprimirSave(file) {
  const s = abrirSave(file);
  if (!s) return null;
  const d = descomprimirDoContainer(s.b, s.base);
  return { ...s, ...d };
}

const EH_MAIN = process.argv[1] && /[\\/]bts\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  for (const f of process.argv.slice(2)) {
    const r = descomprimirSave(f);
    if (!r) { console.log(`${f}: nao e save CM`); continue; }
    const c = r.campos;
    console.log(`\n${f.split(/[\/]/).pop()}`);
    console.log(`  batalha="${r.nomeBatalha}" save="${r.nomeSave}" base=0x${r.base.toString(16)}`);
    console.log(`  ${c.dia}/${c.mesNome}/${c.ano} ${c.hora} ${c.duracaoMin}min  mapa ${c.largura}x${c.altura}`);
    console.log(`  ${r.blocos.length} blocos: ${r.blocos.map(x=>`${x.tamComprimido}->${x.saida.length}`).join(', ')}`);
    console.log(`  total descomprimido: ${r.bytes} bytes`);
  }
}

// O bloco 1 do save e a ficha da batalha em texto puro (strings com prefixo u16).
// Vem em pares rotulo/valor, seguidos das secoes Attacker e Defender.
export function lerFicha(bloco1) {
  const b = Buffer.from(bloco1);
  const itens = [];
  let o = 0;
  while (o + 2 <= b.length) {
    const L = b.readUInt16LE(o);
    if (L > 0 && L < 80 && o + 2 + L <= b.length) {
      const s = b.toString('latin1', o + 2, o + 2 + L);
      if (/^[\x20-\x7e]+$/.test(s)) { itens.push(s); o += 2 + L; continue; }
    }
    o++;
  }
  const f = { geral: {}, atacante: {}, defensor: {} };
  let alvo = f.geral, rotulo = null;
  const ROTULOS = new Set(['Battle Type','Battle Size','Length of Battle','Map Selection',
    'Year','Month','Daylight','Weather','Ground Condition','Rarity','Service','Combat Force',
    'Unit Purchase','Map Preview','Electronic Warfare Strength','Force Adjustment']);
  f.mapa = itens.find((x) => /.btt$/i.test(x)) || null;   // varre tudo: o mapa vem no rodape
  let vistos = 0;
  for (const s of itens) {
    // apos as duas secoes de lado, os rotulos se repetem no rodape: para por ali
    if (s === 'Battle Type' && ++vistos > 1) break;
    if (s === 'Attacker') { alvo = f.atacante; rotulo = null; continue; }
    if (s === 'Defender') { alvo = f.defensor; rotulo = null; continue; }
    if (/\.btt$/i.test(s)) { f.mapa = s; continue; }
    if (ROTULOS.has(s)) { rotulo = s; continue; }
    if (s.trim() === '') continue;
    if (rotulo) { alvo[rotulo] = s; rotulo = null; }
    else {
      // secoes de lado nao repetem rotulos: preenche na ordem conhecida
      // o defensor nao tem Force Adjustment na interface do jogo
      const ordem = alvo === f.atacante
        ? ['Service','Combat Force','Unit Purchase','Map Preview','Electronic Warfare Strength','Force Adjustment']
        : ['Service','Combat Force','Unit Purchase','Map Preview','Electronic Warfare Strength'];
      const prox = ordem.find((k) => !(k in alvo));
      if (alvo !== f.geral && prox) alvo[prox] = s;
    }
  }
  return f;
}
