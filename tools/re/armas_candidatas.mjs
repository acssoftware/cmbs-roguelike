// AS 27 ARMAS: O QUE DA PARA SABER SEM ABRIR O JOGO.
//
// A arma de um soldado e um par `classe/item` no rabo do registro dele (FORMATO 113.1) e os nomes
// nao estao no executavel. Estao, em texto puro, dentro dos `.brz`: `black sea v217.brz` traz um
// unico arquivo, `strings.txt`, e a ultima secao dele ("Name", 2467 entradas) e o dicionario de
// todos os nomes que o jogo escreve na tela — armas incluidas, com a grafia exata.
//
// Isso da o VOCABULARIO, nao o vinculo: a secao e alfabetica e nao ha, em lugar nenhum dos 5,5 GB
// de arquivo, uma tabela de arma em ordem de id. O vinculo continua sendo o tooltip do jogo.
//
// O que este script faz e estreitar o cerco antes disso, cruzando tres coisas que ja estao no
// repositorio com o vocabulario recem-extraido:
//
//   1. `toe_armas.json`  — que arma cada vaga de cada tipo de unidade carrega, e com que municao;
//   2. `tipos_roster.json` — o NOME do tipo, que as vezes nomeia a arma ("Machinegun Team (PKM)");
//   3. a municao — o calibre, que elimina a maior parte do dicionario de uma vez.
//
// Sai `research/armas_candidatas.json`: por `classe/item`, o calibre, quem carrega, e a lista curta
// de nomes do jogo que ainda podem ser aquela arma. Com ela, um print de tooltip deixa de ser uma
// leitura e vira uma conferencia.
//
//   node tools/re/armas_candidatas.mjs [--gravar]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');
const PESQUISA = path.join(RAIZ, 'research');

// O CALIBRE DE CADA ITEM DE MUNICAO, deduzido por aritmetica dos paineis do jogo (o total do
// esquadrao bate com a soma dos homens). Nao e chute: cada um destes foi conferido num print.
export const MUNICAO = {
  1: { calibre: '5.45x39mm', lado: 'RU' },
  2: { calibre: '5.56x45mm', lado: 'US' },
  4: { calibre: '7.62x51mm', lado: 'US' },
  5: { calibre: '7.62x54mmR', lado: 'RU' },
  6: { calibre: '9mm', lado: 'RU' },
  7: { calibre: '9mm', lado: 'US' },
  14: { calibre: '40x46mm HEDP', lado: 'US' },
  67: { calibre: '40mm VOG HE', lado: 'RU' },
  497: { calibre: '25mm ABHE', lado: 'US' },
  516: { calibre: '25mm HEDP', lado: 'US' },
  // 17/09/2026 (E67), pela mesma aritmetica e sem o jogo aberto: o print do `Squad (Recon)` core 213
  // da `ZZ ARMAS UKR T1` escreve "RPG-22 HEAT 2" e o unico item da unidade que soma 2 e o 481. Ele
  // ja estava amarrado a arma 4/15 pela colheita (um por portador); o que faltava era o NOME.
  481: { calibre: 'RPG-22 HEAT', lado: 'RU' },
  // 17/09/2026, SEGUNDA RODADA (E68): 17 itens de uma sessao de 40 unidades na `ZZ ARMAS UKR T1`.
  // Duas fontes na mesma tela, e elas se dividem o trabalho:
  //   - a CAIXA DA ESQUERDA (655,1000) nomeia calibre de arma pessoal, granada, tubo descartavel e
  //     tiro de canhao: "5.45mm", "Grenade", "RPG-26 HEAT", "100mm APFSDS";
  //   - a coluna AMMO da DIREITA (1055,930), que so aparece quando a unidade tem arma de equipe,
  //     nomeia o tiro dela: "Corsar ATGM 5", "Stugna ATGM 7", "AT-10 ATGM 1".
  // A conta casa com a soma do save unidade por unidade (a ponte e o nome do chefe). A coluna AMMO
  // as vezes mostra UM MENOS que o save — o que esta na cocha do lancador nao conta —, e por isso o
  // NOME e o que vale aqui, nao a quantidade.
  11: { calibre: '30mm HE', lado: 'RU' },          // AGS-17 (3/50), core 38: 232 = 116 + 116
  41: { calibre: 'PG-7VL HEAT', lado: 'RU' },      // RPG-7V1 (4/13): 4 por lancador
  42: { calibre: 'PG-7VR', lado: 'RU' },           // o tandem que vai junto, 1 por lancador
  43: { calibre: 'OG-9V HE', lado: 'RU' },         // SPG-9 (5/19), core 320: 8 = 4 + 4
  45: { calibre: 'PG-9N HEAT', lado: 'RU' },
  46: { calibre: 'PG-9VNT', lado: 'RU' },
  54: { calibre: 'AT-4C ATGM', lado: 'RU' },       // AT-4C Spigot (5/6), core 318
  62: { calibre: 'AT-7 ATGM', lado: 'RU' },        // AT-7 Saxhorn (5/9), cores 464/465: 5 por equipe
  55: { calibre: 'AT-14 ATGM', lado: 'RU' },       // Kornet (5/11) e paiol do BMP-2M: 55 = 4 e o painel diz "AT-14 ATGM 4" (02/10, E118)
  310: { calibre: '.300 Win Mag', lado: 'US' },    // exclusivo do Mk21 PSR .300 (2/11), 49 por homem — pelo calibre da arma, sem prova em tela
  89: { calibre: 'AT-10 ATGM', lado: 'RU' },       // o missil do MT-12K (3/53) — e o que o separa do 3/52
  482: { calibre: 'RPG-26 HEAT', lado: 'RU' },     // exclusivo do 4/16, que por isso e o RPG-26
  483: { calibre: 'RPO-A Therm', lado: 'RU' },     // exclusivo do 4/17, que por isso e o RPO-A
  485: { calibre: 'Corsar ATGM', lado: 'UKR' },    // exclusivo do 4/20, que por isso e o Corsar
  486: { calibre: '100mm HEAT', lado: 'RU' },      // MT-12 / MT-12K, cores 586 e 608
  487: { calibre: '100mm APFSDS', lado: 'RU' },
  489: { calibre: '100mm HE', lado: 'RU' },
  490: { calibre: 'Stugna ATGM', lado: 'UKR' },    // o missil do SKIF (5/21)
  493: { calibre: 'Igla SAM', lado: 'RU' },        // exclusivo do 4/24, que por isso e a Igla
  // 17/09/2026, forca RUSSA (E70): a coluna AMMO da caixa verde de cada arma de equipe.
  12: { calibre: '30mm HE', lado: 'RU' },          // AGS-30 (3/51), core 219: 116 + 116 = 232
  66: { calibre: 'AT-13 ATGM', lado: 'RU' },       // AT-13 Saxhorn (5/10), core 112
  484: { calibre: 'RPO-M Therm', lado: 'RU' },     // RPO-M Shmel (4/18), core 371
  494: { calibre: 'Igla-S SAM', lado: 'RU' },      // Igla-S (4/26), core 354
  // O RPG-7V2 (4/14) leva TRES tipos e os tres aparecem na coluna AMMO do `1st Team Recon` core 714:
  // "TBG-7V Therm 1 / PG-7VR 3 / OG-7V HE 1". O PG-7VR e o item 42, que ja tinha nome e fecha em 3.
  // Os itens 38 e 39 sao os outros dois, um de cada nas duas unidades — o painel nao separava. SEPARADO
  // em 21/09 (E92): numa copia ZZ do save (`ZZ E92 RPG 38`) a quantidade foi escrita no lugar, 39 -> 2
  // no core 714 e 38 -> 2 no core 229. A coluna AMMO do 714 disse "TBG-7V Therm 2 / OG-7V HE 1" e o
  // icone de equipamento do 229 disse "HE Rocket" x2 — as duas leituras apontam o mesmo par.
  38: { calibre: 'OG-7V HE', lado: 'RU' },
  39: { calibre: 'TBG-7V Therm', lado: 'RU' },
  // 21/09/2026, forca AMERICANA (E89, `ZZ PE US T1`): caixa de municao, coluna AMMO e — novo — o
  // tooltip dos ICONES DE EQUIPAMENTO do painel ("M136 AT4" x2, "Night Vision" x9, "Breach Kit").
  56: { calibre: 'M136 AT4', lado: 'US' },         // 1 por portador do 4/2 em cinco unidades; "M136 AT4 1" na caixa
  57: { calibre: 'Javelin ATGM', lado: 'US' },     // Javelin (4/1), core 261: AMMO "Javelin ATGM 2" contra 57 x2
  79: { calibre: '40x53mm HEDP', lado: 'US' },     // Mk19 (3/21), core 387: 144 contra 144
  517: { calibre: '25mm Therm', lado: 'US' },      // M25 CDTE, core 51: o outro tiro de 4 (o 516 ja era o HEDP)
  541: { calibre: '.50cal AP-I', lado: 'US' },     // M2A1 (3/1), core 379: 600 contra 600
  10: { calibre: '.50cal Mk211', lado: 'US' },     // M107A1 (2/7): so o portador dele o leva ("Mk211 70" no painel)
  492: { calibre: 'Stinger SAM', lado: 'US' },     // Stinger (4/4): 1 por homem da dupla, "Stinger SAM 2"
};

// O dicionario do jogo, de dentro do .brz. Um arquivo, sem compressao: cabecalho de 54 bytes e o
// texto inteiro depois dele.
export function lerStrings(brz) {
  const b = fs.readFileSync(brz);
  let o = 4;
  o += 4;                                   // numero de arquivos
  const ini = b.readUInt32LE(o); o += 4;     // onde os dados comecam
  const l1 = b.readUInt16LE(o); o += 2; const nome = b.toString('latin1', o, o + l1); o += l1;
  const l2 = b.readUInt16LE(o); o += 2; o += l2;
  if (nome !== 'strings.txt') throw new Error(`${path.basename(brz)} nao traz strings.txt e sim ${nome}`);
  return b.subarray(ini).toString('latin1');
}

// A secao "Name" — a ultima do arquivo, e a que tem os nomes de arma.
export function nomesDoJogo(texto) {
  const linhas = texto.split(/\r?\n/);
  const i = linhas.findIndex((l) => l === 'Name');
  if (i < 0) throw new Error('a secao "Name" nao esta no strings.txt');
  const out = [];
  for (let k = i + 1; k < linhas.length; k++) {
    const l = linhas[k];
    if (l.startsWith('<E>')) out.push(l.slice(3));
    else if (l !== '' && !/^[\t ]/.test(l)) break;
  }
  return out;
}

// O dicionario e compartilhado entre os jogos da Battlefront: tem Sherman, PPSh e MP40. O Black Sea
// e 2017, entao o que e da Segunda Guerra sai fora antes de virar candidato.
// `RPG-2(?!\d)` porque o `RPG-2` sem ancora tambem apagava RPG-22, RPG-26 e RPG-29 — as tres armas
// mais comuns dos esquadroes russos e ucranianos do Black Sea. Descoberto em 17/09 (E67) quando o
// teste de nomes reprovou "RPG-22", lido do painel: o filtro do QUE E VELHO estava comendo o que ha
// de mais novo. Erro de regex sem ancora, o mesmo formato do `RPO` que casava "MultipuRPOse".
const FORA_DE_EPOCA = /Sherman|Halftrack|Patton|PPSh|PPS-4|MP40|MP44|MP3008|Mk(I|II|III|IV|V|VI)$|MkIIC|M16A1|Garand|Thompson|Bren|Sten|Enfield|Mosin|RPG-2(?!\d)|M4A[23]|M4A1\(|Fortification|Fortress/i;
// `M25 CDTE` (a granada de estouro aereo de 25mm) so entrou depois que o teste de nomes reclamou:
// ela estava no dicionario do jogo e fora deste filtro, o que teria feito o teste acusar uma leitura
// correta. Vale a pena o filtro ser generoso — quem separa arma de nao-arma e o tooltip, nao ele.
// `M2A1` (a .50 do HMG Team) e `M136` (o AT4) entraram em 21/09 (E89), pelo mesmo caminho do M25: o
// painel escreveu os dois, eles estao no dicionario, e o teste de nomes reprovaria a leitura certa.
// E as pistolas (E92): `M9A1` (americana) e `PM` (a Makarov, com ancora — "PM" sozinho, nao prefixo).
// E os tubos de morteiro americanos (28/09, E108): a classe 7 entrou com a colheita de fabrica, e o painel
// escreveu `M224A1` e `M120`; os russos (`2B14`, `2B11`) ja passavam pelo `2Bd` da familia de baixo.
const ARMA = /^(AGS|AK|AKM|AKS|DShK|Dragunov|GM-94|Glock|GP-2|GP-3|Javelin|Kord|M107|M110|M120|M136|M224|M252|M14|M16A4|M2A1\b|M203|M240|M242|M249|M24$|M25\b|M32|M320|M4A1|M4\b|M9\b|M9A1\b|Makarov|Mk11|Mk19|Mk21|Mk44|Mk48|NSV|PK|PKM|PKP|PKT|PM$|PP-|RPG|RPK|RPO|SCAR|SPG|SVD|VSS)/i;
// A FAMILIA QUE FALTAVA (17/09/2026, E66). A lista acima nasceu das armas que os saves antigos ja
// mostravam — fuzis, metralhadoras, lanca-granadas — e por isso nao conhecia missil nenhum. Quando o
// painel do jogo escreveu "AT-7", "SKIF", "AT-4C" e "MT-12", o teste de nomes acusou leitura errada
// em leitura CERTA: os quatro estao no dicionario do jogo, so estavam fora deste filtro. Entram aqui
// a designacao OTAN (AT-n dos misseis anticarro, SA-n dos antiaereos), o nome de guerra que o jogo
// usa ao lado dela (Saxhorn, Spigot, Kornet, Corsar, Igla...), o canhao rebocado e o morteiro 2Bxx.
// `TOW(?!ed)` porque "Towed"/"towed" sao adjetivos de ficha, nao armas.
const ARMA_MISSIL = /^(AT-\d|SA-\d|MT-12|SKIF|Saxhorn|Spigot|Spandrel|Sagger|Konkurs|Fagot|Kornet|Metis|Corsar|Barrier|Shturm|Igla|Gimlet|Grouse|Grail|Gremlin|Stinger|TOW(?!ed)|2B\d|Vasilek|Podnos|Spear|Stugna|Shmel)/i;

export function vocabulario(nomes) {
  return nomes.filter((n) => (ARMA.test(n) || ARMA_MISSIL.test(n)) && !FORA_DE_EPOCA.test(n));
}

// ------------------------------------------------------------------ o cruzamento
export function levantar() {
  const toe = JSON.parse(fs.readFileSync(path.join(PESQUISA, 'toe_armas.json'), 'utf8'));
  const tipos = JSON.parse(fs.readFileSync(path.join(PESQUISA, 'tipos_roster.json'), 'utf8'));

  // O `tipo` do roster NAO e unico: 34 dos 376 colidem entre familias de `tab`. Quem desempata e o
  // tamanho — o numero de vagas que o save mostra tem de bater com o `n` da linha — e, em ultimo
  // caso, a frequencia. Sem isto o `3/38` sairia como "Grenade Launcher Team" (visto 1 vez) em vez
  // de "Machinegun Team (PKM)" (visto 105), e a pista mais valiosa da tabela mentiria.
  const escolherTipo = (id, nVagas) => {
    const linhas = tipos.filter((r) => r.tipo === id);
    if (!linhas.length) return null;
    const certas = linhas.filter((r) => r.n === nVagas);
    return (certas.length ? certas : linhas).sort((a, b) => (b.vezes || 0) - (a.vezes || 0))[0];
  };

  const armas = new Map();   // "classe/item" -> dados
  for (const [tipo, vagas] of Object.entries(toe.tipos)) {
    const t = escolherTipo(Number(tipo), vagas.length);
    for (const v of vagas) {
      if (!v.arma) continue;
      if (!armas.has(v.arma)) armas.set(v.arma, { arma: v.arma, municao: {}, portadores: [], homens: 0 });
      const a = armas.get(v.arma);
      a.homens += v.total || 0;
      for (const [item, qtd] of Object.entries(v.municao || {})) {
        a.municao[item] = Math.max(a.municao[item] || 0, qtd);
      }
      a.portadores.push({ tipo: Number(tipo), nome: t ? t.nome : `tipo ${tipo}`, vaga: v.vaga, n: t ? t.n : null, votos: v.votos, total: v.total });
    }
  }

  // O lado sai da municao: 5.45 e 7.62x54R sao russos, 5.56 e 7.62x51 sao americanos.
  for (const a of armas.values()) {
    const lados = new Set(Object.keys(a.municao).map((i) => MUNICAO[i]?.lado).filter(Boolean));
    a.lado = lados.size === 1 ? [...lados][0] : (lados.size ? [...lados].join('/') : null);
    a.calibres = Object.keys(a.municao).map((i) => ({ item: Number(i), ...(MUNICAO[i] || { calibre: `item ${i}`, lado: null }), maximo: a.municao[i] }));
    // O nome do TIPO as vezes nomeia a arma: "Machinegun Team (PKM)", "Team (Javelin)". Vale muito
    // quando o portador e uma equipe de dois em que os dois carregam a mesma coisa.
    a.pistas = [...new Set(a.portadores.map((p) => (p.nome.match(/\(([^)]+)\)/) || [])[1]).filter(Boolean))];
    a.classe = Number(a.arma.split('/')[0]);
    a.item = Number(a.arma.split('/')[1]);
  }
  return [...armas.values()].sort((x, y) => x.classe - y.classe || x.item - y.item);
}

// ------------------------------------------------------------------------ main
const ehMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehMain) {
  const brz = process.env.CMBS_BRZ
    || path.join('C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Data', 'black sea v217.brz');
  const nomes = nomesDoJogo(lerStrings(brz));
  const vocab = vocabulario(nomes);
  const armas = levantar();

  console.log(`${nomes.length} nomes no dicionario do jogo, ${vocab.length} deles armas da epoca`);
  console.log(`${armas.length} armas distintas nos saves\n`);

  const CLASSE = { 2: 'pessoal', 3: 'guarnicao', 4: 'pesada' };
  for (const a of armas) {
    const cal = a.calibres.map((c) => `${c.calibre} x${c.maximo}`).join(' + ') || 'sem municao propria';
    console.log(`${a.arma.padEnd(6)} classe ${CLASSE[a.classe] || a.classe}  lado ${String(a.lado).padEnd(5)}  ${cal}`);
    console.log(`        ${a.homens} homens em ${a.portadores.length} vagas: ${[...new Set(a.portadores.map((p) => p.nome))].slice(0, 4).join(', ')}`);
    if (a.pistas.length) console.log(`        pista no nome do tipo: ${a.pistas.join(', ')}`);
  }

  if (process.argv.includes('--gravar')) {
    const saida = path.join(PESQUISA, 'armas_candidatas.json');
    fs.writeFileSync(saida, JSON.stringify({
      nota: 'Por classe/item: calibre, quem carrega e o vocabulario do jogo. O NOME so entra depois de conferido no tooltip. O vocabulario e a secao "Name" do strings.txt filtrada, e o que o jogo escreve na tela pode ser DUAS entradas juntas ("AT-7" + "Saxhorn"): quem confere nome (teste 19) confere palavra por palavra. Refazer com `node tools/re/armas_candidatas.mjs --gravar`.',
      vocabulario: vocab,
      armas,
    }, null, 1));
    console.log(`\ngravado ${saida}`);
  }
}
