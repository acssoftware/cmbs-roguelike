// O EQUIPAMENTO de uma formacao — os blocos coloridos no pe da tela Units.
//
// Selecionando uma formacao, o editor mostra a escolha em blocos encadeados: categoria, depois
// familia, depois modelo, depois variante. No Tank 31 e "Main Battle Tank > T-72 > T-72B3 >
// T-72B3 (APS)", e clicar em "T-90" troca os 31 tanques do batalhao de uma vez.
//
// Isso mora em DOIS lugares no registro, e foi preciso descobrir os dois:
//
//   +17/+18   o par de tipo, que ja era conhecido (o catalogo em tipos_confirmados.json). E o
//             que aparece no NOME da unidade na lista: "HQ Main Battle Tank (T-90A)".
//   +14       o nibble baixo e a raridade, que acompanha o modelo escolhido.
//   os dois ULTIMOS u16 do registro: familia e modelo. E o que os BLOCOS leem.
//
// Descobri a segunda parte porque escrevi so o tipo, carreguei no editor, e a lista mostrava
// "T-90A" enquanto os blocos continuavam mostrando o caminho do T-72 — o arquivo tinha ficado
// com duas identidades discordantes. Comparando byte a byte com o save do proprio jogo, a
// unica diferenca eram esses dois u16.
//
// O par (familia, modelo) identifica o CAMINHO nos blocos, nao a variante: T-72B3 e
// T-72B3 (APS) tem o mesmo 627/746, e o que os separa e o par de tipo. Por isso trocar
// equipamento exige escrever os dois.
//
// A posicao dos dois u16 nao e um offset fixo a partir da base — registros tem tamanhos
// diferentes. Sao os ultimos quatro bytes do registro, e o fim do registro e o inicio do
// seguinte (`inicioDoRegistro`), o que vale nas duas variantes de cabecalho.
import fs from 'fs';
import { ler as lerArquivo } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';
import { codificar } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

const TABELA = new URL('../../research/equipamento.json', import.meta.url);
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');
const chave = (r) => hx(r.tab) + ',' + hx(r.val);

// Os limites de cada registro, para achar os dois u16 do fim e medir o tamanho.
function fronteiras(d) {
  const R = registros(d.cru).sort((a, b) => a.off - b.off);
  const porPos = indiceDeTokens(d.tokens);
  const ini = R.map((r) => { try { return inicioDoRegistro(d.cru, porPos, r.off).pos; } catch { return null; } });
  return {
    R, porPos,
    ini: (i) => ini[i],
    fim: (i) => (i + 1 < R.length ? ini[i + 1] : null),
  };
}

// O par e uma CAUDA OPCIONAL de quatro bytes: so existe em unidade que tem escolha de
// equipamento, e o TAMANHO do registro denuncia. Os arquivos ALL mostraram isso lado a lado:
//
//   BMP-2              42 bytes   256/678 em 181 de 181    tem escolha
//   Squad (Rifle) US   42 bytes   699/710 em  18 de  18    tem escolha
//   Sniper Team US     40 bytes   256/639 em  10 de  10    tem escolha
//   MT-LBM             38 bytes   nenhum par dominante     nao tem
//   Squad (Rifle) UKR  36 bytes   nenhum par dominante     nao tem
//
// Ler os ultimos quatro bytes de um registro curto devolve outro campo, e era dai que vinha o
// lixo na mineracao. O corte fica em 40, o menor registro onde vi par de verdade.
export const MIN_COM_PAR = 40;

// So o tamanho nao basta: `Headquarters Team` tem registro grande e mesmo assim os ultimos
// quatro bytes NAO sao o par. Da para ver a olho — em 30 instancias do mesmo tipo saem 30
// valores diferentes, com o segundo u16 subindo sempre (17144, 17156, 17171, 17180 ...) e o
// primeiro aleatorio. E contador ou ponteiro, nao escolha. Os pares de verdade, esses, vivem
// numa faixa apertada: familia entre 256 e 709 (treze valores ao todo), modelo entre 605 e
// 747. O limite de 4096 e folgado de proposito — o ruido fica uma ordem de grandeza acima.
const LIMITE_INDICE = 4096;

export function indices(cru, inicio, fimDoRegistro) {
  if (fimDoRegistro === null || inicio === null) return null;
  if (fimDoRegistro - inicio < MIN_COM_PAR) return null;
  const familia = cru.readUInt16LE(fimDoRegistro - 4), modelo = cru.readUInt16LE(fimDoRegistro - 2);
  if (!familia || !modelo || familia >= LIMITE_INDICE || modelo >= LIMITE_INDICE) return null;
  return { familia, modelo };
}

export function tabela() {
  return JSON.parse(fs.readFileSync(TABELA, 'utf8'));
}

// Le a composicao de equipamento de uma formacao: quantas unidades de cada tipo, com o caminho
// que os blocos mostrariam.
export function listar(arquivo, idFormacao) {
  const d = lerArquivo(arquivo);
  const { R, porPos, ini, fim } = fronteiras(d);
  const i = R.findIndex((x) => x.id === idFormacao);
  if (i < 0) throw new Error(`formacao ${idFormacao} nao achada`);
  const ate = subArvore(d.cru, porPos, R, i);
  const por = new Map();
  for (let k = i; k < ate; k++) {
    const r = R[k];
    const ix = indices(d.cru, ini(k), fim(k));
    const c = chave(r);
    if (!por.has(c)) por.set(c, { tipo: c, nome: r.nm, n: 0, raridade: d.cru[r.off + 14] & 0x0f, ix });
    por.get(c).n++;
  }
  return [...por.values()];
}

// O par de uma unidade do tipo alvo que ja exista no arquivo. Devolve tambem a raridade e o
// TAMANHO do registro dela, que e o que decide se a troca cabe (ver `trocar`).
//
// A FAMILIA importa na escolha do doador, e isso custou um arquivo torto. O par identifica o
// GRUPO de equipamento da formacao, nao so o modelo: num batalhao ucraniano de BTR os 50
// transportes sao 666/667 (grupo "BTR") e os 2 veiculos de HQ sao 256/665 (grupo "HQ Vehicle").
// Trocando os transportes por BTR-4E, o unico BTR-4E do arquivo eram os dois do HQ, e carimbar
// o par deles nos 50 fez o editor fundir os dois grupos — a linha "BTR" sumiu da lista de
// escolhas. O batalhao de BTR-4E de verdade usa 666/668: mesma familia dos transportes, outro
// modelo. Por isso o doador so vale se a familia dele bater com a do registro que sai.
function doadorNoArquivo(cru, R, ini, fim, tipo, familiaDesejada) {
  const m = new Map();
  for (let k = 0; k < R.length - 1; k++) {
    if (chave(R[k]) !== tipo) continue;
    const ix = indices(cru, ini(k), fim(k));
    if (!ix) continue;
    if (familiaDesejada !== undefined && ix.familia !== familiaDesejada) continue;
    const kk = `${ix.familia}/${ix.modelo}/${cru[R[k].off + 14] & 0x0f}/${fim(k) - ini(k)}`;
    m.set(kk, (m.get(kk) || 0) + 1);
  }
  if (!m.size) return null;
  const [par, n] = [...m].sort((a, b) => b[1] - a[1])[0];
  const [familia, modelo, raridade, tamanho] = par.split('/').map(Number);
  return { familia, modelo, raridade, tamanho, fonte: `doador no proprio arquivo (${n} unidades)` };
}

// O par que um tipo usa NESTE arquivo, lido das unidades que ja existem nele.
export function parDoTipo(arquivo, tipo) {
  const d = lerArquivo(arquivo);
  const { R, ini, fim } = fronteiras(d);
  return doadorNoArquivo(d.cru, R, ini, fim, tipo);
}

function daTabela(tipo) {
  const alvo = tabela()[tipo];
  if (!alvo) throw new Error(`tipo ${tipo} nao existe neste arquivo nem na tabela; rode "node equipamento.mjs minerar"`);
  if (alvo.ambiguo)
    throw new Error(`tipo ${tipo} tem caminho diferente por exercito (${alvo.ambiguo.join(' e ')}) e nao ha ` +
                    `unidade dele neste arquivo para copiar; nao da para escolher sem saber o exercito`);
  return { ...alvo, fonte: 'tabela minerada' };
}

// Troca todas as unidades de um tipo por outro, dentro de uma formacao — o que o editor faz
// quando se clica num bloco.
export function trocar(arquivo, saida, idFormacao, deTipo, paraTipo) {
  const [tab, val] = paraTipo.split(',').map((x) => parseInt(x, 16));
  const d = lerArquivo(arquivo);
  const cru = Buffer.from(d.cru);
  const { R, porPos, ini, fim } = fronteiras(d);
  const i = R.findIndex((x) => x.id === idFormacao);
  if (i < 0) throw new Error(`formacao ${idFormacao} nao achada`);
  const ate = subArvore(cru, porPos, R, i);

  // De onde sai o par, em ordem de confianca: um doador do tipo alvo que ja exista no arquivo E
  // na mesma familia de quem sai (mesmo grupo de equipamento); depois a tabela minerada; e por
  // ultimo qualquer doador do tipo alvo. O doador resolve de graca a ambiguidade entre
  // exercitos — o BMP-2 e 256/678 num arquivo ucraniano e 615/617 num russo —, mas so acerta o
  // grupo se a familia for a mesma.
  const familiaQueSai = (() => {
    for (let k = i; k < ate; k++) {
      if (chave(R[k]) !== deTipo) continue;
      const ix = indices(cru, ini(k), fim(k));
      if (ix) return ix.familia;
    }
    return undefined;
  })();
  const alvo = doadorNoArquivo(cru, R, ini, fim, paraTipo, familiaQueSai)
            || (() => { try { return daTabela(paraTipo); } catch { return null; } })()
            || doadorNoArquivo(cru, R, ini, fim, paraTipo)
            || daTabela(paraTipo);

  let n = 0;
  for (let k = i; k < ate; k++) {
    const r = R[k];
    if (chave(r) !== deTipo) continue;
    const f = fim(k);
    if (f === null) throw new Error(`registro ${r.id}: nao da para achar o fim`);
    // sem a cauda de quatro bytes nao ha onde gravar a escolha, e escrever ali seria pisar
    // noutro campo — a unidade de origem nao tinha alternativa nos blocos
    if (!indices(cru, ini(k), f)) throw new Error(`registro ${r.id} (${deTipo}) nao tem o par de equipamento: e uma unidade sem escolha`);
    // O REGISTRO PRECISA CABER. Cada tipo tem seu tamanho — o `Precision Sniper Rifle` usa 42
    // bytes e o `M107A1` 40 — e trocar so o tipo nao redimensiona nada. Escrever um tipo maior
    // num registro menor MATA O JOGO na hora de carregar, reproduzivel: foi o que aconteceu
    // convertendo M107A1 em Precision. O contrario passa, porque sobra espaco.
    const tam = f - ini(k);
    if (alvo.tamanho && tam < alvo.tamanho)
      throw new Error(`registro ${r.id}: ${deTipo} ocupa ${tam} bytes e ${paraTipo} precisa de ` +
                      `${alvo.tamanho}; trocar sem redimensionar gera arquivo que derruba o jogo`);
    cru[r.off + 17] = val;
    cru[r.off + 18] = tab;
    cru[r.off + 14] = (cru[r.off + 14] & 0xf0) | alvo.raridade;
    cru.writeUInt16LE(alvo.familia, f - 4);
    cru.writeUInt16LE(alvo.modelo, f - 2);
    n++;
  }
  if (!n) throw new Error(`nenhuma unidade do tipo ${deTipo} na formacao ${idFormacao}`);

  const bloco = Buffer.concat([Buffer.from([d.esc, 0x00]), codificar({ cru, tokens: d.tokens }, d.esc)]);
  reconstruir(arquivo, saida, (b, k) => (k === 1 ? bloco : b));

  const v = lerArquivo(saida);
  const conferido = listar(saida, idFormacao).find((x) => x.tipo === paraTipo);
  if (!conferido || conferido.n < n) throw new Error('o arquivo gravado nao tem as unidades trocadas');
  if (!v.cru.equals(cru)) throw new Error('o cru do gravado divergiu do planejado');
  return { trocadas: n, para: alvo.nome || paraTipo, fonte: alvo.fonte };
}

// Minera a tabela do corpus: para cada tipo, o par (familia, modelo) e a raridade que ele usa.
//
// O filtro que resolve e o TAMANHO do registro, nao a estatistica: quem nao tem a cauda de
// quatro bytes nao tem escolha de equipamento, e ler os ultimos bytes dele traz outro campo.
// Antes eu separava o joio do trigo so por dominancia, e isso deixava passar tipo raro que por
// acaso repetia. Com a regra do tamanho a Ucrania fecha em 9 de 9 tipos que tem a cauda, e a
// dominancia fica como conferencia. Exigir que o par apareca em mais de um ARQUIVO era o
// terceiro filtro; saiu, porque com a regra do tamanho ele so custava cobertura — reprovava
// veiculo que so existe no exercito de um arquivo so.
// A mineracao e POR ARQUIVO, e so depois junta. Juntar antes estraga: o par depende do
// EXERCITO, porque o menu de cada um e outro. O BMP-2 (0x00,0x28) sai 256/678 no arquivo
// ucraniano e 615/617 no russo, os dois firmes; misturado, nenhum dos dois domina e o tipo
// sumia da tabela. Onde os arquivos discordam o tipo entra marcado como ambiguo, com as
// variantes, e `trocar` recusa em vez de gravar o caminho errado.
function minerarUm(caminho) {
  let d; try { d = lerArquivo(caminho); } catch { return null; }
  const { R, ini, fim } = fronteiras(d);
  const por = new Map();
  for (let k = 0; k < R.length - 1; k++) {
    const r = R[k], ix = indices(d.cru, ini(k), fim(k));
    if (!ix) continue;
    const c = chave(r);
    if (!por.has(c)) por.set(c, { nome: r.nm, pares: new Map(), rar: new Map() });
    const g = por.get(c);
    const kk = ix.familia + '/' + ix.modelo;
    g.pares.set(kk, (g.pares.get(kk) || 0) + 1);
    const rr = d.cru[r.off + 14] & 0x0f;
    g.rar.set(rr, (g.rar.get(rr) || 0) + 1);
  }
  const saida = new Map();
  let comCauda = 0, dispersos = 0;
  for (const [c, g] of por) {
    const tot = [...g.pares.values()].reduce((s, v) => s + v, 0);
    if (tot < 5) continue;
    comCauda++;
    const [par, n] = [...g.pares].sort((a, b) => b[1] - a[1])[0];
    if (n / tot <= 0.9) { dispersos++; continue; }
    const [familia, modelo] = par.split('/').map(Number);
    saida.set(c, {
      nome: g.nome, familia, modelo,
      raridade: [...g.rar].sort((a, b) => b[1] - a[1])[0][0],
      amostras: tot,
    });
  }
  return { saida, comCauda, dispersos };
}

export function minerar(arquivos) {
  const juntos = new Map();
  let comCauda = 0, dispersos = 0, lidos = 0;
  for (const c of arquivos) {
    const r = minerarUm(c);
    if (!r) continue;
    lidos++; comCauda += r.comCauda; dispersos += r.dispersos;
    for (const [k, v] of r.saida) {
      if (!juntos.has(k)) juntos.set(k, { ...v, arquivos: 1, variantes: new Set([v.familia + '/' + v.modelo]) });
      else {
        const g = juntos.get(k);
        g.arquivos++; g.amostras += v.amostras;
        g.variantes.add(v.familia + '/' + v.modelo);
      }
    }
  }
  const tabela = {};
  let ambiguos = 0;
  for (const [k, g] of juntos) {
    const { variantes, ...resto } = g;
    if (variantes.size > 1) { ambiguos++; tabela[k] = { ...resto, ambiguo: [...variantes] }; }
    else tabela[k] = resto;
  }
  return { tabela, lidos, comCauda, dispersos, ambiguos };
}

const EH_MAIN = process.argv[1] && /[\\/]equipamento\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const G = 'C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'minerar') {
    const dir = G + 'GENERATOR_TEMPLATES/ASSAULT/';
    const arquivos = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.btt')).slice(0, Number(args[0]) || 8).map((f) => dir + f)
      : [];
    arquivos.push(G + 'GENERATOR_TEMPLATES/City  (688 X 736) 047r Assault.btt');
    console.log(`minerando ${arquivos.length} arquivos...`);
    const { tabela: t, lidos, comCauda, dispersos, ambiguos } = minerar(arquivos);
    fs.writeFileSync(new URL(TABELA), JSON.stringify(t, null, 1));
    console.log(`   ${Object.keys(t).length} tipos com par (${ambiguos} ambiguos entre exercitos), de ${comCauda} com cauda e amostra em ${lidos} arquivos; ${dispersos} dispersos`);
    console.log(`   gravado em research/equipamento.json`);
  } else if (cmd === 'ver') {
    const [arquivo, id] = args;
    const caminho = /[\\/]/.test(arquivo) ? arquivo : G + 'Scenarios/' + arquivo;
    for (const x of listar(caminho, Number(id)))
      console.log(`   ${x.tipo}  x${String(x.n).padStart(3)}  raridade ${x.raridade}  ` +
                  `familia/modelo ${x.ix ? x.ix.familia + '/' + x.ix.modelo : '-'}   ${x.nome || ''}`);
  } else if (cmd === 'trocar') {
    const [arquivo, id, de, para] = args;
    const caminho = /[\\/]/.test(arquivo) ? arquivo : G + 'Scenarios/' + arquivo;
    const r = trocar(caminho, caminho.replace(/\.btt$/i, ' EQ.btt'), Number(id), de, para);
    console.log(`   ${r.trocadas} unidades agora sao ${r.para}`);
  } else {
    console.log('uso: node equipamento.mjs minerar [n de arquivos]');
    console.log('     node equipamento.mjs ver <arquivo.btt> <id da formacao>');
    console.log('     node equipamento.mjs trocar <arquivo.btt> <id> <tipo de> <tipo para>');
    console.log('     tipos no formato "0x05,0x34" (tab,val), como o "ver" mostra');
  }
}
