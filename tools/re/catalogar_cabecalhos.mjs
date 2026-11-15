// FASE A.1 — descritor do cabecalho da forca em todos os .btt disponiveis.
// Para cada arquivo: bytes do marcador ate o id do 1o registro, o campo "descritor" (u32 em m+1),
// A, N e o que N pode ser (registros, unidades, formacoes), e a composicao por lado em ordem de arquivo.
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';
import { acharA } from './compor.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const lado=(a)=>a===2?'V':'A';
const linhas=[];
for(const dir of dirs){
  for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt')).sort()){
    const c=G+dir+'/'+f; let d,m,R;
    try{ d=ler(c); m=marcador(d).pos; R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ linhas.push({f:dir+'/'+f,erro:e.message.slice(0,40)}); continue; }
    if(!R.length){ linhas.push({f:dir+'/'+f,erro:'sem forca'}); continue; }
    const p=indiceDeTokens(d.tokens);
    const id=R[0].off+3;
    const cab=d.cru.subarray(m,id);
    // blocos por lado em ordem de arquivo (corridas de exercito -> lado)
    let i=0; const tops=[];
    while(i<R.length){ if(!R[i].form){i++;continue;} let e; try{e=subArvore(d.cru,p,R,i);}catch(x){e=i+1;} tops.push({army:R[i].army,side:lado(R[i].army),off:R[i].off}); if(e<=i)break; i=e; }
    const blocos=[]; for(const t of tops){ const u=blocos[blocos.length-1]; if(u&&u.side===t.side) u.n++; else blocos.push({side:t.side,n:1}); }
    let v1='s',c1='-'; try{ const x=inicioDoRegistro(d.cru,p,R[0].off); v1=x.variante[0]; if(x.variante==='contador') c1=d.cru.readUInt32LE(R[0].off-1);}catch(x){}
    let A='?'; try{A=acharA(d.cru,R).v;}catch(x){}
    const uni=R.filter(r=>!r.form).length, form=R.length-uni;
    linhas.push({f:dir+'/'+f, cab:cab.toString('hex').replace(/(..)/g,'$1 ').trim(), len:cab.length, desc:cab.subarray(1,5).toString('hex'), A, N16:d.cru.readUInt16LE(m+9), regs:R.length, uni, form, blocos:blocos.map(b=>b.side+b.n).join(' '), v1, c1});
  }
}
fs.writeFileSync('../../research/cabecalhos.json', JSON.stringify(linhas,null,1));
console.log('arquivo'.padEnd(44)+'len desc      A      N16  regs  uni form  blocos(ordem)  1oreg  cabecalho');
for(const l of linhas){
  if(l.erro){ console.log('  '+l.f.slice(0,42).padEnd(44)+'-- '+l.erro); continue; }
  console.log('  '+l.f.slice(0,42).padEnd(44)+String(l.len).padStart(2)+'  '+l.desc+'  '+String(l.A).padStart(6)+'  '+String(l.N16).padStart(5)+' '+String(l.regs).padStart(5)+' '+String(l.uni).padStart(4)+' '+String(l.form).padStart(4)+'  '+l.blocos.padEnd(14)+' '+l.v1+(l.c1!=='-'?l.c1:'')+'   '+l.cab);
}
