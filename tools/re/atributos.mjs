// Os sete atributos que o editor mostra embaixo da tela Units — le e escreve todos.
//
// Cada um foi decodificado do mesmo jeito: mudar UM campo no editor, salvar por cima, comparar
// o antes com o depois. Como o editor aplica o valor a formacao inteira quando se clica no
// titulo dela, cada rodada acende exatamente os 44 registros do batalhao usado de cobaia
// (Tank 31 da vitrine) e o offset que muda aparece sozinho.
//
// Os campos sao um FLUXO DE BITS, nao um byte cada. Isso so ficou claro no Headcount, que
// mudou +10 e +11 ao mesmo tempo e cujos valores nao fechavam em nenhum dos dois isolado:
//
//   +9   bits 7-5  experiencia      bits 4-2  motivacao        bits 1-0  ? (01 em tudo que vi)
//   +10  bits 7-5  fitness          bits 4-2  lideranca        bits 1-0  efetivo (2 bits altos)
//   +11  bit  7    efetivo (bit baixo)       bits 6-4  suprimento    bits 3-0  ?
//   +15  bits 7-5  estado do veiculo
//
// Toda escala anda do pior (0) para o melhor, e as listas do editor aparecem na ordem contraria,
// de cima para baixo. "Typical", o primeiro item de todas elas, nao tem valor proprio: e o
// PADRAO DE CADA UNIDADE, que o editor resolve na hora de salvar. Pus o Tank 31 inteiro em Green
// (44 registros no valor 1) e escolhi Typical: o jogo gravou 3 na cabeca, 2 na maioria das
// companhias, 1 numa e 3 noutra — um valor por unidade, nao um sentinela. Por isso nao ha
// "escrever Typical" aqui: ou se escreve um valor concreto, ou se deixa como esta, que num
// template comprado no editor ja e o tipico.
//
// Conferido em jogo campo a campo, e depois a leitura inteira bateu de uma vez numa unidade
// que eu nunca havia tocado: a bateria de obuses pesados marcava Veteran/Normal/Fit/0/Full/
// Full/OK na tela e os bits davam exatamente 3/2/2/2/4/5/3.
import { ler as lerArquivo } from './transplante.mjs';
import { registros, indiceDeTokens, subArvore } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

export const EXPERIENCIA = ['Conscript', 'Green', 'Regular', 'Veteran', 'Crack', 'Elite'];
export const MOTIVACAO = ['Poor', 'Low', 'Normal', 'High', 'Extreme', 'Fanatic'];
export const FITNESS = ['Unfit', 'Weakened', 'Fit'];
export const LIDERANCA = ['-2', '-1', '0', '+1', '+2'];
export const SUPRIMENTO = ['Severe', 'Scarce', 'Limited', 'Adequate', 'Full'];
export const EFETIVO = ['50%', '60%', '70%', '80%', '90%', 'Full'];
export const VEICULO = ['Burning', 'Destroyed', 'Immobilized', 'OK', 'Dismounted'];

// nome do campo -> escala, leitor e escritor. O efetivo atravessa a fronteira de +10 para +11.
const CAMPOS = {
  experiencia: { escala: EXPERIENCIA,
    ler: (c, o) => (c[o + 9] >> 5) & 7,
    pos: (c, o, v) => { c[o + 9] = (c[o + 9] & 0x1f) | (v << 5); } },
  motivacao: { escala: MOTIVACAO,
    ler: (c, o) => (c[o + 9] >> 2) & 7,
    pos: (c, o, v) => { c[o + 9] = (c[o + 9] & ~0x1c) | (v << 2); } },
  fitness: { escala: FITNESS,
    ler: (c, o) => (c[o + 10] >> 5) & 7,
    pos: (c, o, v) => { c[o + 10] = (c[o + 10] & 0x1f) | (v << 5); } },
  lideranca: { escala: LIDERANCA,
    ler: (c, o) => (c[o + 10] >> 2) & 7,
    pos: (c, o, v) => { c[o + 10] = (c[o + 10] & ~0x1c) | (v << 2); } },
  efetivo: { escala: EFETIVO,
    ler: (c, o) => ((c[o + 10] & 3) << 1) | (c[o + 11] >> 7),
    pos: (c, o, v) => { c[o + 10] = (c[o + 10] & ~3) | ((v >> 1) & 3); c[o + 11] = (c[o + 11] & 0x7f) | ((v & 1) << 7); } },
  suprimento: { escala: SUPRIMENTO,
    ler: (c, o) => (c[o + 11] >> 4) & 7,
    pos: (c, o, v) => { c[o + 11] = (c[o + 11] & ~0x70) | (v << 4); } },
  veiculo: { escala: VEICULO,
    ler: (c, o) => (c[o + 15] >> 5) & 7,
    pos: (c, o, v) => { c[o + 15] = (c[o + 15] & 0x1f) | (v << 5); } },
};
export const NOMES = Object.keys(CAMPOS);

// Escreve campos num registro ja localizado (`off` e a base do registro no buffer dado). E o tijolo
// que `aplicar` usa por formacao e que `experiencia.mjs` usa por unidade — a diferenca entre os dois
// e so QUEM entra na lista, nunca o jeito de escrever.
export function escreverCampos(buf, off, campos) {
  for (const [campo, valor] of Object.entries(campos)) {
    if (valor === undefined || valor === null) continue;
    if (!CAMPOS[campo]) throw new Error(`campo desconhecido: ${campo}. Use ${NOMES.join(', ')}`);
    CAMPOS[campo].pos(buf, off, indiceDe(campo, valor));
  }
  return buf;
}

export function decodificar(cru, off) {
  const r = {};
  for (const [nome, c] of Object.entries(CAMPOS)) {
    const v = c.ler(cru, off);
    r[nome] = c.escala[v] ?? `?${v}`;
  }
  return r;
}

// Aceita tambem o valor CRU de 0 a 7, para pesquisa: escrever um valor fora da escala e deixar
// o editor dizer como o chama foi o que mostrou que 6 e 7 aparecem na tela como "Typical" e que
// o jogo os preserva num save. O nome vem primeiro, senao a lideranca "0" viraria o valor 0
// (que e -2) em vez do 2.
const indiceDe = (campo, nome) => {
  const { escala } = CAMPOS[campo];
  const i = escala.findIndex((x) => x.toLowerCase() === String(nome).toLowerCase());
  if (i >= 0) return i;
  if (/^[0-7]$/.test(String(nome).trim())) return Number(nome);
  throw new Error(`${campo} invalido: ${nome}. Use ${escala.join(', ')} ou um valor cru de 0 a 7`);
};

// Aplica a uma formacao INTEIRA, como o editor faz quando se clica no titulo dela.
export function aplicar(arquivo, saida, idFormacao, campos) {
  const desconhecido = Object.keys(campos).find((k) => !CAMPOS[k]);
  if (desconhecido) throw new Error(`campo desconhecido: ${desconhecido}. Use ${NOMES.join(', ')}`);

  const d = lerArquivo(arquivo);
  const cru = Buffer.from(d.cru);
  const porPos = indiceDeTokens(d.tokens);
  const R = registros(cru).sort((a, b) => a.off - b.off);
  const i = R.findIndex((x) => x.id === idFormacao);
  if (i < 0) throw new Error(`formacao ${idFormacao} nao achada`);
  const alvos = R.slice(i, subArvore(cru, porPos, R, i));

  const antes = decodificar(cru, R[i].off);
  for (const [campo, valor] of Object.entries(campos)) {
    if (valor === undefined) continue;
    const v = indiceDe(campo, valor);
    for (const x of alvos) CAMPOS[campo].pos(cru, x.off, v);
  }
  const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(arquivo, saida, (b, k) => (k === 1 ? bloco : b));

  // conferencia no arquivo GRAVADO, nunca no planejado
  const v = lerArquivo(saida);
  const RV = registros(v.cru).sort((a, b) => a.off - b.off);
  const achado = RV.find((x) => x.id === idFormacao);
  if (!achado) throw new Error(`formacao ${idFormacao} sumiu do arquivo gravado`);
  return { registros: alvos.length, antes, agora: decodificar(v.cru, achado.off) };
}

const EH_MAIN = process.argv[1] && /[\\/]atributos\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const S = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
  const [arquivo, id, ...pares] = process.argv.slice(2);
  if (!arquivo) {
    console.log('uso: node atributos.mjs <arquivo.btt> [id da formacao] [campo=valor ...]');
    for (const [nome, c] of Object.entries(CAMPOS)) console.log(`   ${nome.padEnd(11)} ${c.escala.join(', ')}`);
    console.log('\n   "Typical" e o padrao de cada unidade, que o editor resolve ao salvar:');
    console.log('   nao ha valor para escrever. Deixe como esta para manter o tipico.');
  } else {
    const caminho = /[\\/]/.test(arquivo) ? arquivo : S + arquivo;
    if (!id) {
      const d = lerArquivo(caminho);
      const R = registros(d.cru).sort((a, b) => a.off - b.off);
      console.log(`${arquivo}: formacoes presentes`);
      for (const x of R.filter((r) => r.form && !r.ausente && r.nm).slice(0, 30)) {
        const a = decodificar(d.cru, x.off);
        console.log(`   id ${String(x.id).padStart(5)}  ${NOMES.map((n) => a[n].padEnd(9)).join('')} ${x.nm}`);
      }
    } else {
      const campos = Object.fromEntries(pares.map((p) => {
        const k = p.indexOf('=');
        if (k < 0) throw new Error(`argumento sem "=": ${p}`);
        return [p.slice(0, k), p.slice(k + 1)];
      }));
      const r = aplicar(caminho, caminho.replace(/\.btt$/i, ' MOD.btt'), Number(id), campos);
      console.log(`formacao ${id}: ${r.registros} registros`);
      for (const n of NOMES) {
        const mudou = r.antes[n] !== r.agora[n];
        console.log(`   ${n.padEnd(11)} ${r.antes[n].padEnd(10)}${mudou ? ' -> ' + r.agora[n] : ''}`);
      }
    }
  }
}
