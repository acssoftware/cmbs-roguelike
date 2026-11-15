// NOMES QUE A PAGINA USA E NINGUEM DECLAROU.
//
//   node app/web/lint.mjs
//
// Por que isto existe: o codigo da pagina so roda no navegador, e eu edito estes arquivos por
// patch. Ao tirar a vista de lista apaguei um intervalo de linhas e levei junto o
// `let repriceTimer = null` que morava no meio dele. O `node --check` passou — a sintaxe estava
// perfeita — e o erro so apareceu na tela do autor, disfarcado de "could not read the formation
// library", porque quem chamava estava dentro de um try.
//
// A checagem e deliberadamente boba e nao entende escopo: junta tudo o que o arquivo DECLARA em
// qualquer lugar (let/const/var, funcoes, classes, parametros, desestruturacoes, catch) e reclama
// do identificador usado que nao esteja nesse conjunto nem entre os nomes que o navegador oferece.
// O que ela pega e o nome que nao existe em lugar NENHUM, que e exatamente o que o --check nao ve.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVOS = process.argv.slice(2).length ? process.argv.slice(2) : ['app.js', 'canvas.js'].map((f) => path.join(AQUI, f));

// O que o navegador poe na mesa, mais o que um destes arquivos empresta do outro.
const GLOBAIS = new Set([
  'window', 'document', 'console', 'localStorage', 'sessionStorage', 'location', 'history', 'navigator',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'alert', 'confirm', 'prompt', 'Option', 'Image', 'Audio', 'Event', 'CustomEvent', 'MutationObserver',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'TypeError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Symbol', 'Proxy', 'Reflect', 'BigInt', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone',
  'undefined', 'globalThis', 'this', 'arguments', 'SVGElement', 'HTMLElement', 'Node', 'DOMParser',
  'renderCanvas',                       // canvas.js define, app.js chama
]);

const PALAVRAS = new Set(['const', 'let', 'var', 'function', 'class', 'return', 'if', 'else', 'for', 'of', 'in',
  'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'new', 'delete', 'typeof', 'instanceof',
  'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'export', 'import', 'from', 'as', 'extends',
  'super', 'static', 'get', 'set', 'void', 'true', 'false', 'null', 'NaN', 'Infinity']);

// Apaga comentario e TEXTO de string, guardando o que esta dentro de `${...}` — ali moram nomes de
// verdade. Char a char, porque as duas tentativas por regex falharam do mesmo jeito: uma crase ou
// uma aspa dentro de um literal de regex abria uma "string" que engolia o resto do arquivo e
// escondia todas as declaracoes dele.
function semTextos(src) {
  let out = '';
  const pilha = [];                 // uma entrada por `${` aberto, contando as chaves dentro dele
  let i = 0, modo = 'codigo';
  const branco = (c) => { out += c === '\n' ? '\n' : ' '; };

  while (i < src.length) {
    const c = src[i], d = src[i + 1];

    if (modo === 'codigo') {
      if (c === '/' && d === '/') { out += '  '; i += 2; modo = 'linha'; continue; }
      if (c === '/' && d === '*') { out += '  '; i += 2; modo = 'bloco'; continue; }
      // Regex ou divisao: decide pelo ultimo caractere util antes da barra.
      if (c === '/' && !/[\w$)\]]/.test(out.replace(/\s+$/, '').slice(-1))) {
        out += ' '; i++;
        let classe = false;
        while (i < src.length) {
          const k = src[i];
          if (k === '\\') { out += '  '; i += 2; continue; }
          if (k === '\n') break;                       // nao era regex depois de tudo
          if (k === '[') classe = true;
          else if (k === ']') classe = false;
          else if (k === '/' && !classe) { out += ' '; i++; break; }
          branco(k); i++;
        }
        while (i < src.length && /[a-z]/.test(src[i])) { out += ' '; i++; }   // as flags
        continue;
      }
      if (c === "'" || c === '"') { out += c; i++; modo = c; continue; }
      if (c === '`') { out += ' '; i++; modo = 'template'; continue; }
      // Dentro de `${...}` estamos em codigo: a chave que fecha devolve ao texto do template, e as
      // de dentro (um objeto literal, por exemplo) so contam profundidade.
      if (c === '{' && pilha.length) { pilha[pilha.length - 1]++; out += c; i++; continue; }
      if (c === '}' && pilha.length) {
        if (pilha[pilha.length - 1] > 0) { pilha[pilha.length - 1]--; out += c; i++; continue; }
        pilha.pop(); out += ' '; i++; modo = 'template'; continue;
      }
      out += c; i++; continue;
    }

    if (modo === 'linha') { if (c === '\n') modo = 'codigo'; branco(c); i++; continue; }

    if (modo === 'bloco') {
      if (c === '*' && d === '/') { out += '  '; i += 2; modo = 'codigo'; continue; }
      branco(c); i++; continue;
    }

    if (modo === "'" || modo === '"') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === modo) { out += c; i++; modo = 'codigo'; continue; }
      branco(c); i++; continue;
    }

    // template
    if (c === '\\') { out += '  '; i += 2; continue; }
    if (c === '`') { out += ' '; i++; modo = 'codigo'; continue; }
    if (c === '$' && d === '{') { out += '  '; i += 2; pilha.push(0); modo = 'codigo'; continue; }
    branco(c); i++;
  }
  return out;
}

function declarados(src) {
  const nomes = new Set();
  const add = (s) => { for (const n of String(s).match(/[A-Za-z_$][\w$]*/g) || []) nomes.add(n); };

  // let/const/var: cada parte separada por virgula de topo, e o nome e o que vem antes do `=`.
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([^;\n]*)/g)) {
    let fundo = 0, parte = '';
    const partes = [];
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) fundo++;
      else if (')]}'.includes(ch)) fundo--;
      if (ch === ',' && fundo <= 0) { partes.push(parte); parte = ''; continue; }
      parte += ch;
    }
    // A ultima parte entra fora do laco: numa arrow (`const el = (a, b) => {`) a linha acaba
    // dentro de um parentese aberto, e uma condicao de profundidade a perderia.
    partes.push(parte);
    for (const p of partes) add(p.split('=')[0]);
  }
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(m[1]);
  // parametros: `function nome(...)`, `function (...)`, `(...) =>` e `x =>`
  for (const m of src.matchAll(/\bfunction\s*(?:[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  // metodo de objeto ou de classe: `nome(args) {`
  for (const m of src.matchAll(/[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{/g)) add(m[1]);
  return nomes;
}

// Uso: identificador que nao seja acesso a propriedade nem chave de objeto.
function usados(src) {
  const limpo = src
    .replace(/\?\.\s*[A-Za-z_$][\w$]*/g, '?.')
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, '.')
    .replace(/([A-Za-z_$][\w$]*)\s*:/g, ':');
  const out = new Map();
  for (const m of limpo.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (PALAVRAS.has(m[0]) || out.has(m[0])) continue;
    out.set(m[0], limpo.slice(0, m.index).split('\n').length);
  }
  return out;
}

let falhou = false;
for (const f of ARQUIVOS) {
  const bruto = fs.readFileSync(f, 'utf8');
  const src = semTextos(bruto);
  const linhas = bruto.split('\n');
  const tem = declarados(src);
  const soltos = [...usados(src)].filter(([n]) => !tem.has(n) && !GLOBAIS.has(n));
  if (soltos.length) {
    falhou = true;
    console.log(`FALHA ${path.basename(f)}: ${soltos.length} nome(s) que ninguem declara`);
    for (const [n, linha] of soltos) console.log(`      ${n}   (linha ${linha}: ${(linhas[linha - 1] || '').trim().slice(0, 90)})`);
  } else {
    console.log(`ok    ${path.basename(f)}: todo nome usado esta declarado`);
  }
}
console.log(`\nRESULTADO: ${falhou ? 'FALHOU' : 'ok'}`);
process.exit(falhou ? 1 : 0);
