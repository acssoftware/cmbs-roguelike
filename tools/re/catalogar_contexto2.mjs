// FASE A.5b — outros preditores do codigo do token: byte seguinte, par (anterior, seguinte), corrida de zeros apos.
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const T={seg:{}, par:{}, zeros:{}, ant_zeros:{}}; let n=0;
const add=(t,k,c)=>{ (t[k]=t[k]||{})[c]=(t[k][c]||0)+1; };
for(const dir of dirs) for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt'))){
  let d; try{ d=ler(G+dir+'/'+f); marcador(d); }catch(e){ continue; }
  const c=d.cru;
  for(const t of d.tokens){ if(t.pos<2||t.pos+8>c.length) continue; n++;
    let z=0; while(z<16 && c[t.pos+z]===0) z++;
    add(T.seg, c[t.pos], t.cod); add(T.par, c[t.pos-1]+','+c[t.pos], t.cod); add(T.zeros, z, t.cod); add(T.ant_zeros, c[t.pos-1]+',z'+z, t.cod); }
}
const pureza=(tab)=>{ let ok=0,tot=0; for(const e of Object.values(tab)){ ok+=Math.max(...Object.values(e)); tot+=Object.values(e).reduce((a,b)=>a+b,0);} return (100*ok/tot).toFixed(2)+'%'; };
console.log(n+' tokens');
console.log('pureza: byte seguinte '+pureza(T.seg)+'   (anterior,seguinte) '+pureza(T.par)+'   zeros apos '+pureza(T.zeros)+'   (anterior, zeros apos) '+pureza(T.ant_zeros));
console.log('');
console.log('zeros apos o token -> codigos:');
for(const k of Object.keys(T.zeros).sort((a,b)=>a-b)){ const e=T.zeros[k]; console.log('   z='+String(k).padStart(2)+'  '+Object.entries(e).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,v])=>'0x'+Number(c).toString(16)+':'+v).join('  ')); }
console.log('');
console.log('byte anterior 0x01 (o ambiguo), por zeros apos:');
for(const k of Object.keys(T.ant_zeros).filter(k=>k.startsWith('1,')).sort()){ const e=T.ant_zeros[k]; console.log('   '+k.padEnd(8)+Object.entries(e).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,v])=>'0x'+Number(c).toString(16)+':'+v).join('  ')); }
console.log('byte anterior 0x02, por zeros apos:');
for(const k of Object.keys(T.ant_zeros).filter(k=>k.startsWith('2,')).sort()){ const e=T.ant_zeros[k]; console.log('   '+k.padEnd(8)+Object.entries(e).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,v])=>'0x'+Number(c).toString(16)+':'+v).join('  ')); }
