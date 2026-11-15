import { imprimir } from './disasm.mjs';
imprimir(parseInt(process.argv[2],16), parseInt(process.argv[3]||'40'));
