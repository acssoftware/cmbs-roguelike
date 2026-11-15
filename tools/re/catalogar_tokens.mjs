// FASE A.2 — catalogo dos tokens de cabeca das formacoes de TOPO, com candidatos a preditor.
// Uma linha por formacao de topo: arquivo, posicao, exercito, lado, variante, codigo do token,
// contador, id, delta para o registro anterior, delta para o topo anterior, o que vem antes.
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const dirs=['Scenarios','formations','TESTING'];
const lado=(a)=>a===2?'V':'A';
const out=[];
for(const dir of dirs){
  for(const f of fs.readdirSync(G+dir).filter(x=>x.endsWith('.btt')).sort()){
    const c=G+dir+'/'+f; let d,R;
    try{ d=ler(c); marcador(d); R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ continue; }
    if(R.length<2) continue;
    const p=indiceDeTokens(d.tokens);
    let i=0, k=0, prevTop=null, prevSide=null;
    while(i<R.length){
      if(!R[i].form){i++;continue;}
      let e; try{e=subArvore(d.cru,p,R,i);}catch(x){e=i+1;}
      const r=R[i]; let v='sem',cod='-',ct='-',pos=null;
      try{ const x=inicioDoRegistro(d.cru,p,r.off); v=x.variante; cod=d.tokens[x.k].cod; pos=x.pos; if(v==='contador') ct=d.cru.readUInt32LE(r.off-1);}catch(x){}
      const ant=i>0?R[i-1]:null;
      const side=lado(r.army);
      out.push({f:dir+'/'+f, k, army:r.army, side, primeiroDoLado: side!==prevSide, v, cod, ct, id:r.id,
        dAnt: ant?r.id-ant.id:null, dTopo: prevTop?r.id-prevTop.id:null, antForm: ant?!!ant.form:null, antArmy: ant?ant.army:null,
        nome:(r.nm||'?').slice(0,24), sub:e-i});
      prevTop=r; prevSide=side; k++;
      if(e<=i)break; i=e;
    }
  }
}
fs.writeFileSync('../../research/tokens_topo.json', JSON.stringify(out,null,1));
// pivo: codigo do token por (primeiro da forca? / primeiro do lado? / lado / sinal do delta ao registro anterior)
const chave=(o)=>(o.k===0?'1oForca':(o.primeiroDoLado?'1oLado':'irma'))+' '+o.side+' d'+(o.dAnt===null?'?':(o.dAnt>0?'+':'-'));
const piv={};
for(const o of out){ const ch=chave(o); piv[ch]=piv[ch]||{}; const cd=o.v==='sem'?'sem':('0x'+o.cod.toString(16)+(o.v==='contador'?'c':'')); piv[ch][cd]=(piv[ch][cd]||0)+1; }
console.log(out.length+' formacoes de topo em '+new Set(out.map(o=>o.f)).size+' arquivos');
console.log('');
console.log('contexto                 -> codigos (c = variante com contador)');
for(const ch of Object.keys(piv).sort()) console.log('  '+ch.padEnd(24)+' '+Object.entries(piv[ch]).sort((a,b)=>b[1]-a[1]).map(([c,n])=>c+':'+n).join('  '));
// os casos 1oLado com delta, listados
console.log('');
console.log('cabecas de bloco de lado (nao-primeiro da forca):');
for(const o of out.filter(o=>o.k>0&&o.primeiroDoLado)) console.log('  '+o.f.slice(0,36).padEnd(38)+' ex'+o.army+' '+o.side+'  '+(o.v==='sem'?'sem':'0x'+o.cod.toString(16)+(o.v==='contador'?' c='+o.ct:''))+'  id '+String(o.id).padStart(5)+'  dAnt '+String(o.dAnt).padStart(6)+'  dTopo '+String(o.dTopo).padStart(6)+'  antes: '+(o.antForm?'form':'unid')+' ex'+o.antArmy);
