// O PAIOL DE CADA UNIDADE DE UM SAVE, para conferir a olho o que a tela do jogo mostra.
//
// A E38 mostrou que a leitura por deslocamento fixo nao acha quase nada — o tamanho do bloco anda —,
// entao aqui, como na escrita, quem localiza o campo e o ID DO ITEM: varre-se o rabo procurando os
// itens que aquele veiculo sabe carregar. Os numeros que saem daqui sao os mesmos que o painel AMMO
// do jogo mostra; foi assim que o `item 92 = 314` do BMP-2 casou com o `30mm HE-I 314` da tela.
//
//   node tools/re/paiol_ver.mjs "<save.bts>" [slug]
//
// Com o slug de uma campanha, so as unidades em campo aparecem — que sao as que o refit toca.
import fs from 'node:fs';
import path from 'node:path';
import { blocosDoSave, lerTabela, acharPaiol, formaDoNome } from './toe_veiculos.mjs';

const RAIZ = path.resolve(import.meta.dirname, '../..');
const save = process.argv[2];
const slug = process.argv[3];
if (!save) { console.log('uso: node tools/re/paiol_ver.mjs "<save.bts>" [slug]'); process.exit(1); }

const tabela = lerTabela();
const limpo = (n) => String(n).replace(/\s+#\d+$/, '');

let emCampo = null;
let nomeDe = new Map();
if (slug) {
  const st = JSON.parse(fs.readFileSync(path.join(RAIZ, 'app/campaigns', slug, 'state.json'), 'utf8'));
  emCampo = new Set((st.units || []).filter((u) => u.present).map((u) => u.coreId));
  nomeDe = new Map((st.units || []).map((u) => [u.coreId, u.name]));
} else {
  // Sem campanha, o nome sai da ponte de tipos — ela cobre o que ja apareceu num roster do autor.
  try {
    const ponte = JSON.parse(fs.readFileSync(path.join(RAIZ, 'research/tipos_ponte.json'), 'utf8')).ponte;
    for (const [tipo, v] of Object.entries(ponte)) nomeDe.set(`tipo:${tipo}`, v.nome);
  } catch { /* sem ponte, so o que o slug der */ }
}

const b = blocosDoSave(save);
const exp = Buffer.from(b.exp);
console.log(`${path.basename(save)}: ${b.unidades.length} blocos${emCampo ? `, ${emCampo.size} em campo` : ''}`);

let achados = 0;
for (const u of b.unidades) {
  if (emCampo && !emCampo.has(u.coreId)) continue;
  const nome = limpo(nomeDe.get(u.coreId) || nomeDe.get(`tipo:${u.tipo}`) || '');
  const itens = nome && tabela[nome];
  if (!itens) continue;
  const paiol = acharPaiol(exp, u, itens, formaDoNome(nome));
  if (!paiol.length) { console.log(`   core ${String(u.coreId).padStart(4)}  ${nome.slice(0, 44).padEnd(45)}nada achado no rabo`); continue; }
  achados++;
  const partes = paiol.map((p) => `${p.item}: ${p.tem}/${p.max}${p.tem >= p.max ? ' CHEIO' : ''}`);
  // O que a lista tem e a tabela nao conhece, e o que a tabela conhece e ZEROU (saiu da lista):
  // os dois sao alcance, nao erro, e ficam a vista.
  const r = paiol.rabo;
  const outros = r.paiol.filter((s) => itens[s.item] === undefined).map((s) => `${s.item}: ${s.qtd}`);
  const carga = r.carga.map((s) => `${s.item}: ${s.qtd}`);
  console.log(`   core ${String(u.coreId).padStart(4)}  ${nome.slice(0, 44).padEnd(45)}${partes.join('   ')}`
    + (paiol.faltando.length ? `   ESGOTADO: ${paiol.faltando.join(', ')}` : '')
    + (outros.length ? `   (fora da tabela: ${outros.join(', ')})` : '')
    + (carga.length ? `   carga: ${carga.join(', ')}` : ''));
}
if (!achados) console.log('   nenhuma unidade com paiol conhecido — a tabela so cobre veiculo, canhao e tubo');
