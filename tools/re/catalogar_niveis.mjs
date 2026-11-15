// FASE A.3 — o codigo do token de cabeca de formacao e o numero de niveis fechados?
// Para cada registro calcula a profundidade pela caminhada com contadores; para cada FORMACAO com
// token, cruza o codigo com (profundidade do registro anterior - profundidade propria).
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, contagemDeFilhos } from './regs.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const piv={}, pivTopo={}, exemplos={};
let total=0, arquivos=0;
for(const dir of dirs){
  for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt')).sort()){
    let d,R; try{ d=ler(G+dir+'/'+f); marcador(d); R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ continue; }
    if(R.length<2) continue; arquivos++;
    const p=indiceDeTokens(d.tokens);
    // profundidade por caminhada: pilha de filhos restantes
    const prof=new Array(R.length).fill(0); const pilha=[];
    for(let i=0;i<R.length;i++){
      prof[i]=pilha.length;
      if(pilha.length) pilha[pilha.length-1]--;
      if(R[i].form){ let c=0; try{c=contagemDeFilhos(d.cru,p,R,i);}catch(e){} if(c>0) pilha.push(c); }
      while(pilha.length && pilha[pilha.length-1]<=0) pilha.pop();
    }
    for(let i=1;i<R.length;i++){
      if(!R[i].form) continue;
      let cod=null,v=null; try{ const x=inicioDoRegistro(d.cru,p,R[i].off); cod=d.tokens[x.k].cod; v=x.variante; }catch(e){ continue; }
      const fechados=prof[i-1]-prof[i];       // niveis fechados antes deste registro (pode ser negativo = desceu)
      const ch=(fechados>=0?'+':'')+fechados;
      const cd='0x'+cod.toString(16)+(v==='contador'?'c':'');
      piv[ch]=piv[ch]||{}; piv[ch][cd]=(piv[ch][cd]||0)+1; total++;
      if(prof[i]===0){ pivTopo[ch]=pivTopo[ch]||{}; pivTopo[ch][cd]=(pivTopo[ch][cd]||0)+1; }
      const k=ch+' '+cd; if(!exemplos[k]) exemplos[k]=dir+'/'+f+' i='+i+' '+(R[i].nm||'?').slice(0,22)+' apos '+(R[i-1].nm||'?').slice(0,18)+' prof '+prof[i-1]+'->'+prof[i];
    }
  }
}
console.log(total+' formacoes com token em '+arquivos+' arquivos');
console.log('');
console.log('TODAS as formacoes: niveis fechados -> codigos');
for(const ch of Object.keys(piv).sort((a,b)=>Number(a)-Number(b))) console.log('  '+ch.padStart(3)+'  '+Object.entries(piv[ch]).sort((a,b)=>b[1]-a[1]).map(([c,n])=>c+':'+n).join('  '));
console.log('');
console.log('so formacoes de TOPO: niveis fechados -> codigos');
for(const ch of Object.keys(pivTopo).sort((a,b)=>Number(a)-Number(b))) console.log('  '+ch.padStart(3)+'  '+Object.entries(pivTopo[ch]).sort((a,b)=>b[1]-a[1]).map(([c,n])=>c+':'+n).join('  '));
console.log('');
console.log('exemplos das combinacoes raras:');
for(const [k,v] of Object.entries(exemplos)){ const [ch,cd]=k.split(' '); if((piv[ch][cd]||0)<30) console.log('  '+k.padEnd(12)+v); }
