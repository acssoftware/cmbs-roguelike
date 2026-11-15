// ANEXAR POR CODIGO, na corrente completa (secao 64). Substitui `anexos.mjs`, que operava na
// corrente compactada adivinhando tokens e travava quando aplicado duas vezes (secao 56).
//
// Aqui nao ha token para adivinhar: expande com `escape.expandir`, mexe nos bytes por offset e
// recodifica com `escape.codificarComoJogo`, que reproduz blocos de forca BYTE A BYTE (secao 63).
//
// O que o editor faz ao comprar um time avulso dentro de uma formacao (medido contra o proprio
// editor em 03/09/2026, `ZZ UKR RECON BREACH` x `UKR - Company (Brigade Reconnaissance)`):
//   A (custo, marcador+5)        += 52 por item
//   N (unidades, marcador+9)      = numero de unidades
//   flag +7 do registro de topo   |= 0x20
//   contador de filhos            += n   (u32 em off-1 do PRIMEIRO filho)
//   registros novos               entram como ultimos filhos, ids seguindo o maior existente
// O resto dos bytes que mudam entre duas compras e sorteio do editor (semente por soldado).
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, regraDeEnchimento } from './regs.mjs';
import { expandir, codificarComoJogo } from './escape.mjs';
import { reconstruir } from './rebuild.mjs';

// Abre um arquivo ja na corrente completa, com os offsets dos registros convertidos.
export function abrirCompleto(caminho) {
  const d = ler(caminho);
  const { completo, mapa } = expandir(d.cru, d.tokens);
  const inv = new Map(); mapa.forEach((o, i) => { if (o >= 0 && !inv.has(o)) inv.set(o, i); });
  // `c` (offset no completo) vem da varredura do PROPRIO completo, casada por ordem com a do cru.
  // Mapear `off + 2` pelo mapa cru->completo falha quando os 3 zeros de cabeca emendam num id que
  // comeca com 00 (256 = 00 01 00 00): a corrida vira token, o `p - 14` do scanner recua demais no
  // cru e `c` sai 8 bytes antes — o compor2 gravava o id novo em cima do enchimento (secao 96).
  const Rc = registros(d.cru).sort((a, b) => a.off - b.off);
  const Rk = registros(completo).sort((a, b) => a.off - b.off);
  // E quando a ordem NAO casa (as duas varreduras acham contagens diferentes), pelo ID, que e unico no arquivo
  // (05/10, E146): a bateria dos Meet pegou um id 256 cuja corrida de 14 zeros virou token dentro dos 14 bytes de
  // cabeca; o mapa cru->completo o punha 13 bytes antes e o verificarForca acusava "4 zeros, regra pede 13".
  const porId = new Map(); for (const x of Rk) porId.set(x.id, porId.has(x.id) ? null : x.off);
  const R = Rc.map((r, k) => ({ ...r, c: Rk.length === Rc.length && Rk[k].id === r.id ? Rk[k].off : (porId.get(r.id) ?? (inv.get(r.off + 2) - 2)) }));

  // O MARCADOR, CONFERIDO PELA LARGURA DO CABECALHO (E70, 17/09). `marcador` escolhe o ultimo token
  // 0x03 antes da forca, e isso valeu em 235 dos 236 arquivos medidos — mas numa batalha de 13
  // topos o proprio cabecalho da forca produziu um token parecido e o escolhido saiu 5 bytes adiante
  // do certo. Dali para frente tudo que se le do cabecalho sai de outro lugar: `K_azul` deu
  // 16.777.216 (0x01000000) em vez de 3, a arvore nao achou o bloco vermelho, e a verificacao
  // acusou enchimento errado num Ural que estava perfeito — uma batalha boa recusada por leitura.
  //
  // O QUE CONFERE, e e medido: o cabecalho da forca tem largura FIXA e termina NO ID do primeiro
  // registro, entao `R[0].c - m` e **14** no arquivo azul-primeiro e **18** no vermelho-primeiro,
  // que carrega o `K_verm` a mais (149 e 86 arquivos; o unico fora dos dois era o errado). Onde o
  // marcador nao satisfaz isso, o cabecalho e achado pela geometria e conferido pela forma: byte 0
  // em zero, e `K_azul` entre 1 e o numero de registros (azul-primeiro) ou zero com `K_verm` >= 1
  // (vermelho-primeiro). Nao da para procurar outro token: o zero do cabecalho pode estar DENTRO de
  // uma corrida tokenizada, e ai nao ha token nenhum naquela posicao.
  const mk = marcador(d);
  let m = inv.get(mk.pos);
  // NUM MAPA SEM TROPAS o marcador tem a forma `00 a b 00 00 10` e o ultimo registro do mapa termina em `02 00 00 00`
  // (14/10/2026, Small Town-Forest 018r Meet). Quando os zeros do registro e os do marcador viram UMA corrida
  // tokenizada (`[4]00 04 00 00 10`, marcador `00 00 04 00 00 10`), a posicao do token cai no 2o byte do marcador;
  // o marcador comeca um antes. So o 018r em 316 arquivos medidos.
  // m+3/m+4 sao Blue/Red Electronic Warfare Strength (0..3, 17/10/2026). O recuo para m-1 nao dispara falso: exigiria
  // completo[m+4] (o Red EW) === 0x10.
  const formaMarcador = (x) => x >= 0 && x + 5 < completo.length && completo[x] === 0 && completo[x + 3] <= 3 && completo[x + 4] <= 3 && completo[x + 5] === 0x10;
  if (!R.length && m !== undefined && !formaMarcador(m) && formaMarcador(m - 1)) m -= 1;
  const forma = (x) => {
    if (x === undefined || x < 0 || x + 21 > completo.length || completo[x] !== 0x00) return false;
    const dif = R[0].c - x;
    if (dif === 14) { const k = completo.readUInt32LE(x + 13); return k >= 1 && k <= R.length; }
    if (dif === 18) return completo.readUInt32LE(x + 13) === 0 && completo.readUInt32LE(x + 17) >= 1;
    return false;
  };
  if (R.length && !forma(m)) {
    for (const x of [R[0].c - 14, R[0].c - 18]) if (forma(x)) { m = x; break; }
  }
  return { d, completo, R, m };
}

// Fim do conteudo dos registros: o rodape da forca e uma corrida longa de zeros (215/220, secao
// 62) e DEPOIS dela ainda ha uma cauda nao-zero no bloco. Entao nao serve varrer do fim: procura,
// a partir do ultimo registro, onde comeca a primeira corrida de >= 32 zeros.
const fimDosRegistros = (c, desde) => {
  for (let i = desde; i < c.length; i++) {
    if (c[i] !== 0) continue;
    let z = 0; while (i + z < c.length && c[i + z] === 0) z++;
    if (z >= 32) return i;
    i += z;
  }
  return c.length;
};

export function anexar(caminhoAlvo, caminhoDoador, caminhoSaida, n = 2) {
  const A = abrirCompleto(caminhoAlvo), D = abrirCompleto(caminhoDoador);
  if (D.R.length < n) throw new Error(`doador tem ${D.R.length} registros, pedi ${n}`);
  const doados = D.R.slice(-n);
  // CADA REGISTRO TERMINA COM ENCHIMENTO DE ZEROS (13 nos casos medidos) e o proximo comeca
  // depois dele. O fim do conteudo do ultimo registro nao e, portanto, o ponto de insercao: o
  // enchimento do ultimo registro tem de vir ANTES do anexo, senao o registro novo cola no
  // anterior. Mede-se o enchimento no proprio alvo, pelos zeros antes do ultimo registro.
  // ... e o tamanho do enchimento NAO e fixo: e a regra da secao 53, agora entendida. O numero de
  // zeros entre um registro e o seguinte depende do ULTIMO BYTE do registro anterior: veiculo
  // (termina na lista de assentos, byte 0x02) -> 8 zeros; time a pe (termina no float de Y,
  // 0x40..0x46) -> 13; qualquer outro -> 9. Medi-lo no registro anterior ao ultimo dava 13 quando o
  // ultimo era um veiculo e deixava 5 zeros a mais — exatamente o que derrubava a composicao.
  // Medido nos arquivos do editor: 10 zeros antes do anexo depois de infantaria e 5 depois de
  // veiculo — mais os 3 zeros que o proprio registro anexado ja traz na cabeca (`00 00 00 | id`),
  // total 13 e 8. A carga comeca no registro com esses zeros, entao o enchimento a inserir e a
  // regra MENOS os zeros iniciais da carga.
  const fimConteudo = fimDosRegistros(A.completo, A.R[A.R.length - 1].c);
  const ultimoByte = A.completo[fimConteudo - 1];
  const regra = regraDeEnchimento(A.completo, fimConteudo);
  const zerosDaCarga = (b) => { let k = 0; while (k < b.length && b[k] === 0) k++; return k; };
  const carga = Buffer.from(D.completo.subarray(doados[0].c, fimDosRegistros(D.completo, doados[n - 1].c)));
  const pad = Math.max(0, regra - zerosDaCarga(carga));
  // O rodape do alvo fica INTEIRO depois do anexo (o editor nao o encurta): insere-se
  // `enchimento + registros` no ponto onde a corrida de zeros comeca.
  const corte = fimDosRegistros(A.completo, A.R[A.R.length - 1].c);
  const inserido = Buffer.concat([Buffer.alloc(pad), carga]);
  const c = Buffer.concat([A.completo.subarray(0, corte), inserido, A.completo.subarray(corte)]);

  // ids dos novos, continuando o maior existente
  let proximo = Math.max(...A.R.map((r) => r.id)) + 1;
  doados.forEach((r, k) => c.writeUInt32LE(proximo + k, corte + pad + (r.c - doados[0].c) + 3));

  const topo = A.R[0], primeiroFilho = A.R[1];
  c.writeUInt32LE(c.readUInt32LE(primeiroFilho.c - 1) + n, primeiroFilho.c - 1);   // filhos += n
  const unidades = A.R.filter((r) => !r.form).length + doados.filter((r) => !r.form).length;
  c.writeUInt32LE(unidades, A.m + 9);                                 // N

  // CUSTO e FLAG DO TOPO nao se calculam: o custo e o preco do item (o Scout Team custa 51, nao
  // os 52 que eu vinha somando) e o bit 0x20 do topo nem sempre acende (acendeu ao anexar um
  // veiculo ucraniano, nao acendeu com tres times americanos). Quando o doador e a MESMA formacao
  // ja com os extras — que e como se produz um doador — os dois valores certos sao os dele.
  const mesmaFormacao = D.R.length === A.R.length + n && D.R[0].tab === A.R[0].tab && D.R[0].val === A.R[0].val;
  if (mesmaFormacao) {
    c.writeUInt32LE(D.completo.readUInt32LE(D.m + 5), A.m + 5);
    c[topo.c + 7] = D.completo[D.R[0].c + 7];
  } else {
    c.writeUInt32LE(c.readUInt32LE(A.m + 5) + 51 * n, A.m + 5);
    console.log(`   (doador nao e a mesma formacao: custo estimado em 51 x ${n}, flag do topo intocado)`);
  }

  reconstruir(caminhoAlvo, caminhoSaida, (x, k) => (k === 1 ? codificarComoJogo(c, A.d.esc) : x));
  const V = abrirCompleto(caminhoSaida);
  if (V.R.length !== A.R.length + n) throw new Error(`gravado com ${V.R.length} registros, esperava ${A.R.length + n}`);
  const ids = V.R.map((r) => r.id).sort((a, b) => a - b);
  const buraco = ids.findIndex((x, i) => i && x !== ids[i - 1] + 1);
  if (buraco > 0) throw new Error(`ids com buraco em ${ids[buraco - 1]} -> ${ids[buraco]}`);
  return { registros: V.R.length, unidades, custo: V.completo.readUInt32LE(V.m + 5),
           filhos: V.completo.readUInt32LE(V.R[1].c - 1), flag: V.completo[V.R[0].c + 7],
           anexos: doados.map((r) => r.nm) };
}

const EH_MAIN = process.argv[1] && /[\\/]anexar2\.mjs$/.test(process.argv[1]);
if (EH_MAIN) {
  const [alvo, doador, saida, n] = process.argv.slice(2);
  if (!alvo) console.log('uso: node anexar2.mjs <alvo.btt> <doador.btt> <saida.btt> [n=2]');
  else { const r = anexar(alvo, doador, saida, n ? +n : 2); console.log(`${saida}: ${r.registros} registros, ${r.unidades} unidades, custo ${r.custo}, filhos ${r.filhos}, flag 0x${r.flag.toString(16)} — ${r.anexos.join(' + ')}`); }
}
