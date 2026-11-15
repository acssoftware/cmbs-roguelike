// FASE A.4a — o codigo do token descreve a FORMA do registro?
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro } from './regs.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const piv=(name)=>({name,t:{}});
const P={len:piv('tamanho do registro'), pres:piv('byte +7 (presenca)'), tipo:piv('par de tipo +17/+18'), b8:piv('byte +8'), b13:piv('byte +13'), tok0:piv('1o byte do payload do token'), pre2:piv('2 bytes antes do id (off+1,off+2)')};
const add=(p,k,cd)=>{ p.t[k]=p.t[k]||{}; p.t[k][cd]=(p.t[k][cd]||0)+1; };
for(const dir of dirs) for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt'))){
  let d,R; try{ d=ler(G+dir+'/'+f); marcador(d); R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ continue; }
  if(R.length<2) continue; const p=indiceDeTokens(d.tokens);
  for(let i=1;i<R.length;i++){ if(!R[i].form) continue;
    let x; try{ x=inicioDoRegistro(d.cru,p,R[i].off); }catch(e){ continue; }
    const cod=d.tokens[x.k].cod; if(![0x7,0x8,0xc].includes(cod)||x.variante!=='comum') continue;
    const cd='0x'+cod.toString(16); const r=R[i]; const c=d.cru;
    let fim; try{ fim=inicioDoRegistro(c,p,R[i+1].off).pos; }catch(e){ fim=i+1<R.length?R[i+1].off+2:x.pos+40; }
    add(P.len, String(fim-x.pos), cd);
    add(P.pres, '0x'+c[r.off+7].toString(16), cd);
    add(P.tipo, c[r.off+17].toString(16)+'/'+c[r.off+18].toString(16), cd);
    add(P.b8, '0x'+c[r.off+8].toString(16), cd);
    add(P.b13, '0x'+c[r.off+13].toString(16), cd);
    add(P.tok0, '0x'+c[x.pos].toString(16), cd);
    add(P.pre2, c[r.off+1].toString(16)+' '+c[r.off+2].toString(16), cd);
  }
}
for(const p of Object.values(P)){
  const chaves=Object.keys(p.t).sort((a,b)=>{const sa=Object.values(p.t[a]).reduce((x,y)=>x+y,0), sb=Object.values(p.t[b]).reduce((x,y)=>x+y,0); return sb-sa;}).slice(0,14);
  console.log(p.name+':');
  for(const k of chaves){ const e=p.t[k]; const tot=Object.values(e).reduce((x,y)=>x+y,0); const puro=Math.max(...Object.values(e))/tot;
    console.log('   '+k.padEnd(10)+['0x7','0x8','0xc'].map(c=>c+':'+String(e[c]||0).padStart(5)).join('  ')+'   pureza '+(100*puro).toFixed(0)+'%'); }
}
