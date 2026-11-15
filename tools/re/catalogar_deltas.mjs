// FASE A.4b — o codigo do token codifica uma relacao de ID (anterior, irmao anterior, pai)?
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, contagemDeFilhos } from './regs.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const bucket=(v)=>{ if(v===null) return '?'; const a=Math.abs(v); const s=v<0?'-':'+'; if(a===0) return '0'; if(a===1) return s+'1'; if(a<128) return s+'<128'; if(a<256) return s+'<256'; if(a<32768) return s+'<32k'; return s+'big'; };
const P={ant:{}, irm:{}, pai:{}};
const add=(p,k,cd)=>{ p[k]=p[k]||{}; p[k][cd]=(p[k][cd]||0)+1; };
for(const dir of dirs) for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt'))){
  let d,R; try{ d=ler(G+dir+'/'+f); marcador(d); R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ continue; }
  if(R.length<2) continue; const p=indiceDeTokens(d.tokens);
  // caminhada com pilha de {pai, restantes, ultimoIrmao}
  const pilha=[]; const info=new Array(R.length);
  for(let i=0;i<R.length;i++){
    const topo=pilha[pilha.length-1];
    info[i]={pai: topo?topo.pai:null, irmao: topo?topo.ultimo:null};
    if(topo){ topo.restantes--; topo.ultimo=R[i].id; }
    if(R[i].form){ let c=0; try{c=contagemDeFilhos(d.cru,p,R,i);}catch(e){} if(c>0) pilha.push({pai:R[i].id, restantes:c, ultimo:null}); }
    while(pilha.length && pilha[pilha.length-1].restantes<=0) pilha.pop();
  }
  for(let i=1;i<R.length;i++){ if(!R[i].form) continue;
    let x; try{ x=inicioDoRegistro(d.cru,p,R[i].off); }catch(e){ continue; }
    const cod=d.tokens[x.k].cod; if(![0x7,0x8,0xc].includes(cod)||x.variante!=='comum') continue;
    const cd='0x'+cod.toString(16); const id=R[i].id;
    add(P.ant, bucket(id-R[i-1].id), cd);
    add(P.irm, info[i].irmao===null?'1o filho':bucket(id-info[i].irmao), cd);
    add(P.pai, info[i].pai===null?'topo':bucket(id-info[i].pai), cd);
  }
}
for(const [nome,p] of [['delta para o registro ANTERIOR',P.ant],['delta para o IRMAO anterior',P.irm],['delta para o PAI',P.pai]]){
  console.log(nome+':');
  const chaves=Object.keys(p).sort((a,b)=>Object.values(p[b]).reduce((x,y)=>x+y,0)-Object.values(p[a]).reduce((x,y)=>x+y,0));
  for(const k of chaves){ const e=p[k]; const tot=Object.values(e).reduce((x,y)=>x+y,0); const puro=Math.max(...Object.values(e))/tot;
    console.log('   '+k.padEnd(10)+['0x7','0x8','0xc'].map(c=>c+':'+String(e[c]||0).padStart(5)).join('  ')+'   pureza '+(100*puro).toFixed(0)+'%'); }
}
