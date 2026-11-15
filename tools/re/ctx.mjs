import { imprimir, inicioFuncaoV2 } from './disasm.mjs';
const va = parseInt(process.argv[2], 16);
const ini = inicioFuncaoV2(va);
console.log(`alvo 0x${va.toString(16)} | inicio: ${ini?'0x'+ini.toString(16):'NAO ACHADO'}`);
if (ini) imprimir(ini, parseInt(process.argv[3]||'150'));
