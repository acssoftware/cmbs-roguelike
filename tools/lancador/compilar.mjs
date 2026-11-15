// COMPILAR O LANCADOR (14/11/2026, autor: o pacote para a comunidade, sem a janela preta do console). O fonte e
// app/launcher/Launcher.cs (C# 5); o compilador e o csc.exe que vem com o .NET Framework 4.x de todo Windows 10/11
// (%WINDIR%\Microsoft.NET\Framework64\v4.0.30319) — nada para instalar. O empacotador chama isto na copia ja mascarada
// e varrida; o teste 244 compila numa pasta temporaria.
//
//   node tools/lancador/compilar.mjs [saida.exe]     padrao: dist/lancador-build/CMBS Roguelike.exe
//
// O executavel: /target:winexe (subsistema GUI, nenhum console pisca), o icone em /win32icon (o Explorer) e como recurso
// "launcher.ico" (a bandeja carrega o de 16 px dele), os atributos de versao do APP_VERSION, sem empresa nem copyright
// (nenhum nome de pessoa no arquivo) e sem /debug (nenhum caminho desta maquina embutido).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../../app/src/pacote.mjs';

const RAIZ = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const FONTE = path.join(RAIZ, 'app', 'launcher', 'Launcher.cs');
export const ICONE = path.join(RAIZ, 'app', 'launcher', 'launcher.ico');
export const NOME_EXE = 'CMBS Roguelike.exe';

export function acharCsc() {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  return [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')]
    .find((f) => fs.existsSync(f)) || null;
}

// os atributos que o Explorer mostra em Propriedades > Detalhes; a versao de 4 partes que o .NET exige
export function assemblyInfo(versao = APP_VERSION) {
  const quatro = [...versao.split('.').map((n) => String(parseInt(n, 10) || 0)), '0', '0', '0'].slice(0, 4).join('.');
  return [
    'using System.Reflection;',
    '[assembly: AssemblyTitle("CMBS Roguelike")]',
    '[assembly: AssemblyProduct("CMBS Roguelike")]',
    '[assembly: AssemblyDescription("Starts the CMBS Roguelike app and keeps it in the system tray")]',
    `[assembly: AssemblyVersion("${quatro}")]`,
    `[assembly: AssemblyFileVersion("${quatro}")]`,
    `[assembly: AssemblyInformationalVersion("${versao}")]`,
    '',
  ].join('\r\n');
}

// o subsistema do PE: 2 = GUI (sem console), 3 = console
export function subsistemaPe(buf) {
  if (buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('nao e um executavel (sem MZ)');
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('cabecalho PE ausente');
  return buf.readUInt16LE(pe + 24 + 68);
}

export function compilarLancador({ fonte = FONTE, ico = ICONE, saida, versao = APP_VERSION, trabalho } = {}) {
  const csc = acharCsc();
  if (!csc) throw new Error('csc.exe nao encontrado (o .NET Framework 4 do Windows): o lancador nao pode ser compilado aqui');
  if (!fs.existsSync(fonte)) throw new Error(`fonte do lancador ausente: ${fonte}`);
  if (!fs.existsSync(ico)) throw new Error(`icone ausente: ${ico} (node tools/lancador/icone.mjs)`);
  trabalho = trabalho || path.join(path.dirname(saida), '.lancador-build');
  fs.mkdirSync(trabalho, { recursive: true });
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  const info = path.join(trabalho, 'AssemblyInfo.cs');
  fs.writeFileSync(info, assemblyInfo(versao));
  const args = ['/nologo', '/target:winexe', '/optimize+', '/utf8output', `/out:${saida}`, `/win32icon:${ico}`, `/resource:${ico},launcher.ico`,
    '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', fonte, info];
  let saidaCsc = '';
  try { saidaCsc = execFileSync(csc, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`o csc recusou o lancador:\n${String(e.stdout || '') + String(e.stderr || '')}`); }
  finally { fs.rmSync(trabalho, { recursive: true, force: true }); }
  const exe = fs.readFileSync(saida);
  const sub = subsistemaPe(exe);
  if (sub !== 2) throw new Error(`o lancador saiu com subsistema ${sub}, nao 2 (GUI): abriria um console`);
  return { saida, bytes: exe.length, subsistema: sub, avisos: saidaCsc.trim(), csc };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const saida = path.resolve(process.argv[2] || path.join(RAIZ, 'dist', 'lancador-build', NOME_EXE));
  const r = compilarLancador({ saida });
  console.log(`${r.saida}: ${r.bytes} bytes, subsistema ${r.subsistema} (GUI)${r.avisos ? '\n' + r.avisos : ''}`);
}
