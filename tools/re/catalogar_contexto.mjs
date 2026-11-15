// FASE A.5 — o codigo de TODO token e funcao do(s) byte(s) anterior(es)?
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const por1={}, por2={}, porCod={}; let n=0;
for(const dir of dirs) for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt'))){
  let d; try{ d=ler(G+dir+'/'+f); marcador(d); }catch(e){ continue; }
  for(const t of d.tokens){ if(t.pos<2) continue; n++;
    const b1=d.cru[t.pos-1], b2=d.cru[t.pos-2], c=t.cod;
    (por1[b1]=por1[b1]||{})[c]=(por1[b1][c]||0)+1;
    const k2=b2+','+b1; (por2[k2]=por2[k2]||{})[c]=(por2[k2][c]||0)+1;
    porCod[c]=(porCod[c]||0)+1; }
}
const pureza=(tab)=>{ let ok=0,tot=0; for(const e of Object.values(tab)){ const m=Math.max(...Object.values(e)); ok+=m; tot+=Object.values(e).reduce((a,b)=>a+b,0);} return ok/tot; };
console.log(n+' tokens.  codigos: '+Object.entries(porCod).sort((a,b)=>b[1]-a[1]).map(([c,k])=>'0x'+Number(c).toString(16)+':'+k).join('  '));
console.log('pureza do preditor "1 byte anterior": '+(100*pureza(por1)).toFixed(2)+'%    "2 bytes anteriores": '+(100*pureza(por2)).toFixed(2)+'%');
console.log('');
console.log('byte anterior -> codigos (os 40 mais frequentes):');
const chaves=Object.keys(por1).sort((a,b)=>Object.values(por1[b]).reduce((x,y)=>x+y,0)-Object.values(por1[a]).reduce((x,y)=>x+y,0)).slice(0,40);
for(const k of chaves){ const e=por1[k]; const tot=Object.values(e).reduce((a,b)=>a+b,0);
  console.log('   0x'+Number(k).toString(16).padStart(2,'0')+'  '+String(tot).padStart(6)+'  '+Object.entries(e).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([c,k2])=>'0x'+Number(c).toString(16)+':'+k2).join('  ')); }
console.log('');
// mapa byte anterior -> codigo dominante, para os bytes com >= 20 ocorrencias, agrupado por codigo
const mapa={}; for(const [k,e] of Object.entries(por1)){ const tot=Object.values(e).reduce((a,b)=>a+b,0); if(tot<20) continue; const [c]=Object.entries(e).sort((a,b)=>b[1]-a[1])[0]; (mapa[c]=mapa[c]||[]).push(Number(k)); }
for(const [c,bs] of Object.entries(mapa)) console.log('   codigo 0x'+Number(c).toString(16)+' <- bytes '+bs.sort((a,b)=>a-b).map(b=>'0x'+b.toString(16).padStart(2,'0')).join(' '));
fs.writeFileSync('../../research/token_por_byte_anterior.json', JSON.stringify(por1));
