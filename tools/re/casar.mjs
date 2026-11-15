// Casa as capturas de tela da arvore de unidades com a ordem de batalha do arquivo.
//
// Nao da para confiar no numero da captura: a rolagem no editor nem sempre e de uma pagina
// inteira. Entao a posicao de cada captura e deduzida do CONTEUDO, por tres caminhos, do
// mais forte para o mais fraco: nomes ja conhecidos, janelas independentes (para aguentar
// buraco no meio) e, quando nao ha nome nenhum, a assinatura estrutural das repeticoes.
import fs from 'fs';
import { ordemCompleta } from './oob.mjs';

const R = '../../research';
const hx = (v) => '0x' + v.toString(16).padStart(2, '0');

const PARAR = new Set(['the', 'of', 'a', 'x']);
export function toks(s) {
  return new Set(String(s).toLowerCase()
    .replace(/^(hq|\d+(st|nd|rd|th)|[a-h])\s+/i, '')     // ordinal posicional
    .replace(/[()\[\],]/g, ' ')
    .split(/\s+/).filter((w) => w && !PARAR.has(w)));
}

// O primeiro argumento e o nome gravado no arquivo; o segundo, a linha lida na tela. A tela
// acrescenta coisa que nao faz parte do tipo: o sufixo de equipamento da infantaria e a arma
// do veiculo — "Squad (Rifle)" aparece como "3rd Squad (Rifle) (M4A1 ACOG)". Por isso a
// comparacao e ASSIMETRICA: basta o nome gravado caber inteiro dentro da linha da tela. O que
// a tela tem a mais e ignorado, mas o que o arquivo diz tem de estar la. Nome de uma palavra
// so exige os 70% simetricos, senao "Trench" casaria com qualquer linha que cite trincheira.
// Uma entrada ambigua do catalogo guarda as duas leituras unidas por barra —
// "Command Vehicle (M1130 Stryker) | AH-64D Apache Longbow (Attack Helicopter)". Comparar a
// string inteira contra a tela nao casa com nenhuma das duas, e o vizinho e descartado em
// silencio. Cada alternativa tem de ser testada por si.
export function igual(a, b) {
  return String(a).split(' | ').some((alt) => igualUm(alt, b));
}

function igualUm(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return false;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  if (A.size >= 2 && n === A.size) return true;
  return n / Math.max(A.size, B.size) >= 0.7;
}

// Dentro de uma formacao de FORTIFICACAO os indices querem dizer outra coisa: no ZZ US ALL,
// 0x00/0x01 aparece dez vezes seguidas como "Barbed Wire" e no resto do arquivo como
// "Infantry Carrier Vehicle (M1126 Stryker)". Quem escolhe a tabela e a formacao-mae, nao o
// byte +18 — entao o que e colhido debaixo de uma dessas formacoes vai para uma secao
// propria. A lista e fechada: e o que o editor oferece no menu Fortifications.
const FORT = /trench|sandbag|barbed wire|\bmines\b|target reference|bunker|foxhole|roadblock|obstacle|rubble/i;
const CABECA = new Set([0x19, 0x0b, 0x1a, 0x18]);

// Uma janela so vale se as linhas ja conhecidas dentro dela baterem TODAS. A unica folga e um
// erro isolado de leitura da tela, e so quando ha ancora de sobra para sustenta-lo.
const JAN = 12, PASSO = 3, MIN_ANC = 4;
const firme = (r) => r.testados >= MIN_ANC &&
  (r.pontos === r.testados || (r.testados >= 10 && r.pontos === r.testados - 1));

export function casar(arquivo, cen) {
  const t = JSON.parse(fs.readFileSync(`${R}/tipos_confirmados.json`, 'utf8'));
  const { bl, linhas } = ordemCompleta(arquivo);
  const nome = (o) => t.tabelas[hx(bl[o + 18])]?.[hx(bl[o + 17])];
  const chaveDe = (o) => `${hx(bl[o + 18])}/${hx(bl[o + 17])}`;

  // marca as linhas que estao debaixo de uma formacao de fortificacao
  const ehFort = new Array(linhas.length).fill(false);
  let sob = false;
  linhas.forEach((L, i) => {
    if (!L) { sob = false; return; }
    if (CABECA.has(bl[L.off + 18])) { sob = FORT.test(nome(L.off) || ''); return; }
    ehFort[i] = sob;
  });
  // O item de fortificacao nao tem nome proprio: ele herda o tipo da mae. Entao a chave dele
  // no catalogo tem de carregar a mae junto, senao vira uma afirmacao falsa — "0x00/0x02 e
  // Sandbag Wall" nao se sustenta, porque o mesmo 0x00/0x02 e "Mines (antitank)" debaixo de
  // outra formacao.
  const paiDe = new Array(linhas.length).fill(null);
  let pai = null;
  linhas.forEach((L, i) => {
    if (!L) { pai = null; return; }
    if (CABECA.has(bl[L.off + 18])) { pai = chaveDe(L.off); return; }
    paiDe[i] = pai;
  });

  const caps = fs.readdirSync(`${R}/capturas_lidas`)
    .map((f) => JSON.parse(fs.readFileSync(`${R}/capturas_lidas/${f}`, 'utf8').replace(/^﻿/, '')))
    .filter((c) => c.cen === cen && c.linhas && c.linhas.length).sort((a, b) => a.n - b.n);
  const ultima = caps[caps.length - 1];

  // Conta acertos de uma faixa de linhas da captura contra o arquivo, a partir de `off`.
  const medir = (cap, k0, k1, off) => {
    let pontos = 0, testados = 0;
    for (let k = k0; k < k1 && k < cap.length; k++) {
      const L = linhas[off + k]; if (!L) continue;
      const n = nome(L.off); if (!n) continue;
      testados++; if (igual(n, cap[k])) pontos++;
    }
    return { pontos, testados };
  };

  const achados = new Map(), fort = new Map(), relat = [];
  // Guarda o nome lido na tela para as linhas que ainda nao tem nome. O contexto de
  // fortificacao tem catalogo proprio, entao o "ja tem nome" tem de ser consultado la.
  const colher = (cap, off, k0, k1) => {
    let n = 0;
    for (let k = k0; k < k1; k++) {
      const L = linhas[off + k]; if (!L) continue;
      const txt = cap[k]; if (!txt || txt === '?') continue;
      const eFort = ehFort[off + k];
      const chave = eFort ? `${paiDe[off + k]} + ${chaveDe(L.off)}` : chaveDe(L.off);
      if (eFort ? t.fortificacoes?.[chave] : nome(L.off)) continue;
      const lim = txt.replace(/^(HQ|\d+(st|nd|rd|th)|[A-H])\s+/, '').replace(/\s*\(Off Map\)\s*$/, '');
      const alvo = eFort ? fort : achados;
      if (!alvo.has(chave)) alvo.set(chave, new Map());
      const v = alvo.get(chave); v.set(lim, (v.get(lim) || 0) + 1);
      n++;
    }
    return n;
  };

  for (const c of caps) {
    // ETAPA 1 - posicao aproximada da captura inteira. Serve so de palpite: quando a arvore
    // tem linha que o arquivo nao tem (ou vice-versa), o alinhamento DESLIZA no meio da
    // captura e nenhum deslocamento unico acerta tudo.
    let pal = { off: null, pontos: 0, testados: 0 };
    for (let off = -40; off < linhas.length; off++) {
      const r = medir(c.linhas, 0, c.linhas.length, off);
      if (r.testados >= 8 && r.pontos > pal.pontos) pal = { off, ...r };
    }
    const conf = pal.testados ? pal.pontos / pal.testados : 0;

    // ETAPA 2 - cada JANELA de linhas se posiciona sozinha, o que absorve o deslize. So colhe
    // quando a janela bate nas linhas ja conhecidas e o deslocamento e unico.
    let janelas = 0, colhidas = 0, estrutural = false, pos = null;
    for (let k0 = 0; k0 < c.linhas.length; k0 += PASSO) {
      const k1 = Math.min(k0 + JAN, c.linhas.length);
      const ini = pal.off !== null ? Math.max(-40, pal.off - 15) : -40;
      const fim = pal.off !== null ? Math.min(linhas.length, pal.off + 16) : linhas.length;
      let melhor = null, empate = false;
      for (let off = ini; off < fim; off++) {
        const r = medir(c.linhas, k0, k1, off);
        if (!firme(r)) continue;
        if (!melhor || r.pontos > melhor.pontos) { melhor = { off, ...r }; empate = false; }
        else if (r.pontos === melhor.pontos && off !== melhor.off) empate = true;
      }
      if (!melhor || empate) continue;
      janelas++; if (pos === null) pos = melhor.off - k0;
      colhidas += colher(c.linhas, melhor.off, k0, k1);
    }

    // ETAPA 3 - quando nenhuma janela firma, sobra a assinatura ESTRUTURAL, que nao depende de
    // nome nenhum: onde a tela troca de texto, o arquivo troca de (tabela, indice). Dez linhas
    // iguais, um cabecalho, dez linhas iguais. E isso que resgata a zona de fortificacao, onde
    // nao ha um unico nome conhecido para servir de ancora.
    if (!janelas && c.linhas.length >= 12) {
      const borda = [];
      for (let k = 1; k < c.linhas.length; k++) borda.push(c.linhas[k] !== c.linhas[k - 1]);
      const chaveArq = (i) => { const L = linhas[i]; return L ? chaveDe(L.off) : null; };
      let melhor = null, empate = false;
      for (let off = 0; off + c.linhas.length <= linhas.length; off++) {
        let acertos = 0, trocas = 0;
        for (let k = 1; k < c.linhas.length; k++) {
          const a = chaveArq(off + k - 1), b = chaveArq(off + k);
          if (a === null || b === null) { acertos = -1; break; }
          if (borda[k - 1] === (a !== b)) acertos++;
          if (borda[k - 1]) trocas++;
        }
        if (acertos < 0 || trocas < (c === ultima ? 1 : 3)) continue;  // padrao chapado nao decide
        if (acertos < c.linhas.length - 2) continue;                   // quase perfeito ou nada
        // Os blocos de fortificacao tem todos a mesma forma — cabecalho e dez itens —, entao a
        // estrutura empata entre eles. O que desempata na ultima captura e que a arvore nao
        // rola alem do fim: a ultima linha da tela e a ultima linha do arquivo.
        if (c === ultima && off + c.linhas.length !== linhas.length) continue;
        if (!melhor || acertos > melhor.acertos) { melhor = { off, acertos }; empate = false; }
        else if (acertos === melhor.acertos) empate = true;
      }
      if (melhor && !empate) {
        janelas = 1; estrutural = true; pos = melhor.off;
        colhidas += colher(c.linhas, melhor.off, 0, c.linhas.length);
      }
    }
    relat.push({ n: c.n, off: pal.off, pos, conf: +conf.toFixed(2), ancoras: pal.testados, janelas, colhidas, estrutural });
  }
  // SEGUNDA PASSADA - uma captura que sobrou pode ser fixada pela vizinha ja posicionada: a
  // rolagem so desce e as telas se sobrepoem, entao a posicao dela cabe numa faixa estreita.
  // Ali dentro a assinatura estrutural volta a decidir, mesmo com poucas trocas de texto.
  caps.forEach((c, i) => {
    if (relat[i].janelas) return;
    const viz = [relat[i+1], relat[i-1]].find((r) => r && r.pos !== null);
    if (!viz) return;
    const L = c.linhas.length;
    const ini = Math.max(0, viz.pos - 2 * L), fim = Math.min(linhas.length - L, viz.pos + 2 * L);
    const borda = [];
    for (let k = 1; k < L; k++) borda.push(c.linhas[k] !== c.linhas[k-1]);
    let melhor = null, empate = false;
    for (let off = ini; off <= fim; off++) {
      let acertos = 0;
      for (let k = 1; k < L; k++) {
        const a = linhas[off+k-1], b = linhas[off+k];
        if (!a || !b) { acertos = -1; break; }
        if (borda[k-1] === (chaveDe(a.off) !== chaveDe(b.off))) acertos++;
      }
      if (acertos < L - 2) continue;
      if (!melhor || acertos > melhor.acertos) { melhor = { off, acertos }; empate = false; }
      else if (acertos === melhor.acertos) empate = true;
    }
    if (!melhor || empate) return;
    relat[i].janelas = 1; relat[i].estrutural = true; relat[i].pos = melhor.off;
    relat[i].colhidas += colher(c.linhas, melhor.off, 0, L);
  });

  return { relat, achados, fort };
}

const EH_MAIN = process.argv[1] && /casar\w*\.mjs$/.test(process.argv[1]);
if (EH_MAIN && process.argv[2]) {
  const [arquivo, cen] = [process.argv[2], process.argv[3]];
  const { relat, achados, fort } = casar(arquivo, cen);
  const bons = relat.filter((x) => x.janelas > 0);
  console.log(`${cen}: ${bons.length}/${relat.length} capturas posicionadas`);
  const est = bons.filter((x) => x.estrutural).length;
  if (est) console.log(`   ${est} so pela estrutura, sem nenhuma ancora de nome`);
  const mudas = relat.filter((x) => !x.janelas);
  if (mudas.length) console.log(`   sem posicao: ` + mudas.map((x) => `#${x.n}(${x.ancoras} ancoras, conf ${x.conf})`).join(' '));
  const mostra = (m, rot) => {
    if (!m.size) return;
    console.log(`\n${m.size} ${rot}:`);
    [...m.entries()].sort().forEach(([k, v]) => {
      const arr = [...v.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`   ${k}  "${arr[0][0]}"  (${arr[0][1]} voto${arr[0][1] > 1 ? 's' : ''}${arr.length > 1 ? `, divergencias: ${arr.slice(1).map((x) => `"${x[0]}"x${x[1]}`).join(' ')}` : ''})`);
    });
  };
  mostra(achados, 'tipos novos');
  mostra(fort, 'itens novos em contexto de fortificacao');
}
