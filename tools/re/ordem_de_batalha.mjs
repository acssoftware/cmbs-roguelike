// A ORDEM DE BATALHA de um exercito, lida de um arquivo que compra tudo.
//
// autor montou tres cenarios com todas as formacoes disponiveis de cada exercito — `ZZ UKR
// ALL`, `ZZ US ALL` e `ZZ RU ALL` —, e eles sao o catalogo que faltava: dizem quais formacoes
// existem, o que cada uma leva dentro e com que equipamento. Sao arquivos pequenos, sem mapa
// grande e sem imagem de briefing (foi por causa da imagem ausente que o leitor os recusava,
// ver a correcao em ext.mjs).
//
// O que sai daqui:
//   - as formacoes de topo, cada uma com sua sub-arvore de unidades
//   - o inventario de tipos: cada (tab,val) com quantas vezes aparece, a raridade e o par
//     familia/modelo dos blocos de equipamento (secao 41)
//
// Os nomes vem do catalogo `tipos_confirmados.json`; nada disso esta escrito no arquivo, que
// nao guarda uma unica string para as unidades.
import fs from 'fs';
import { ler as lerArquivo } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';

const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
export const tipoDe = (r) => hx(r.tab) + ',' + hx(r.val);

export function ler(arquivo) {
  const d = lerArquivo(arquivo);
  const R = registros(d.cru).sort((a, b) => a.off - b.off);
  const porPos = indiceDeTokens(d.tokens);
  const fimDe = R.map((r, i) => {
    if (i + 1 >= R.length) return null;
    try { return inicioDoRegistro(d.cru, porPos, R[i + 1].off).pos; } catch { return null; }
  });

  const unidade = (r, i) => {
    const f = fimDe[i];
    return {
      id: r.id, tipo: tipoDe(r), nome: r.nm, army: r.army,
      raridade: d.cru[r.off + 14] & 0x0f,
      ausente: r.ausente,
      familia: f !== null ? d.cru.readUInt16LE(f - 4) : null,
      modelo: f !== null ? d.cru.readUInt16LE(f - 2) : null,
    };
  };

  // formacoes de topo: anda pela lista consumindo cada sub-arvore inteira
  const formacoes = [];
  for (let i = 0; i < R.length; ) {
    if (!R[i].form) { i++; continue; }
    const fim = subArvore(d.cru, porPos, R, i);
    const dentro = [];
    for (let k = i + 1; k < fim; k++) if (!R[k].form) dentro.push(unidade(R[k], k));
    formacoes.push({ ...unidade(R[i], i), unidades: dentro.length, sub: fim - i, composicao: resumir(dentro) });
    i = fim > i ? fim : i + 1;
  }

  // inventario global
  const inv = new Map();
  R.forEach((r, i) => {
    const k = tipoDe(r);
    if (!inv.has(k)) inv.set(k, { tipo: k, nome: r.nm, formacao: r.form, n: 0, ...unidade(r, i) });
    inv.get(k).n++;
  });

  return { arquivo, registros: R.length, formacoes, inventario: [...inv.values()].sort((a, b) => b.n - a.n) };
}

function resumir(unidades) {
  const m = new Map();
  for (const u of unidades) {
    const k = u.tipo;
    if (!m.has(k)) m.set(k, { tipo: k, nome: u.nome, n: 0 });
    m.get(k).n++;
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

const EH_MAIN = process.argv[1] && /[\\/]ordem_de_batalha\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  const [arquivo, quanto] = process.argv.slice(2);
  if (!arquivo) {
    console.log('uso: node ordem_de_batalha.mjs <arquivo.btt> [formacoes|inventario|json]');
  } else {
    const caminho = /[\\/]/.test(arquivo) ? arquivo : S + arquivo;
    const r = ler(caminho);
    if (quanto === 'json') {
      const nome = arquivo.replace(/\.btt$/i, '').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
      const saida = new URL(`../../research/ordem_${nome}.json`, import.meta.url);
      fs.writeFileSync(saida, JSON.stringify(r, null, 1));
      console.log(`${r.formacoes.length} formacoes, ${r.inventario.length} tipos -> research/ordem_${nome}.json`);
    } else if (quanto === 'inventario') {
      console.log(`${arquivo}: ${r.inventario.length} tipos`);
      for (const x of r.inventario)
        console.log(`   ${x.tipo}  x${String(x.n).padStart(3)}  rar ${x.raridade}  ` +
                    `${String(x.familia ?? '-').padStart(6)}/${String(x.modelo ?? '-').padEnd(6)} ${x.nome || '(sem nome no catalogo)'}`);
    } else {
      console.log(`${arquivo}: ${r.formacoes.length} formacoes de topo, ${r.registros} registros`);
      for (const f of r.formacoes)
        console.log(`   id ${String(f.id).padStart(5)}  ${String(f.unidades).padStart(3)} unidades  ` +
                    `${f.ausente ? '(mascarada) ' : ''}${f.nome || f.tipo}`);
    }
  }
}
