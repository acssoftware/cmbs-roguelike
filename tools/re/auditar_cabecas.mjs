// FASE A.6 — regra provisoria (byte anterior 0x02 -> 0x7; 0x40..0x46 -> 0xc; senao 0x8) aplicada
// as cabecas de formacao de TOPO dos meus arquivos com resultado conhecido em jogo.
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';
const S='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/Scenarios/';
const prev=(b)=>b===0x02?0x7:(b>=0x40&&b<=0x46?0xc:0x8);
const casos=[['PASSOU','AA TRES'],['PASSOU','AA TRES NO QBLARGE'],['PASSOU','AA CA MECH MRPAR QBLARGE'],['PASSOU','AA 2CA 2T31'],['PASSOU','AA SMALL CA T31'],['PASSOU','AA TESTE PATCH'],['PASSOU','AA BATALHA 90MIN BLUEATK RUEXTRAS'],['PASSOU','AA LADOS3'],['PASSOU','AA JUNCAO MIN'],['PASSOU','AA LIB DOBRO'],
 ['TRAVOU','AA Y2'],['TRAVOU','AA CA MECH MR QBLARGE'],['TRAVOU','AA CA RECON MR'],['TRAVOU','AA CA RECON MR2'],['TRAVOU','AA CA RECON MR3'],['TRAVOU','AA CA RECON MR4'],['TRAVOU','AA TRIO'],['TRAVOU','AA TRIO2'],['TRAVOU','AA TRIO3'],['TRAVOU','AA BATALHA FINAL'],['TRAVOU','AA TESTE BASE'],['TRAVOU','AA LADOS'],['TRAVOU','AA LADOS2'],['TRAVOU','AA JUNCAO'],['TRAVOU','AA COM UCRANIA'],['TRAVOU','AA UCRANIA2'],['TRAVOU','AA UCRANIA3'],['TRAVOU','AA CA RECON+ MR 90MIN BLUEATK'],['TRAVOU','AA CA MECH T31 MR QBLARGE'],['TRAVOU','AA 2CA 1UKRMI 2T31']];
console.log('resultado  arquivo                              cabecas: [byte anterior -> gravado/previsto]');
for(const [res,nome] of casos){
  let d,R; try{ d=ler(S+nome+'.btt'); marcador(d); R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ console.log(res+'  '+nome.padEnd(36)+' (nao abre)'); continue; }
  const p=indiceDeTokens(d.tokens); let i=0; const out=[]; let erros=0;
  while(i<R.length){ if(!R[i].form){i++;continue;} let e; try{e=subArvore(d.cru,p,R,i);}catch(x){e=i+1;}
    if(i>0){ try{ const x=inicioDoRegistro(d.cru,p,R[i].off); const b=d.cru[x.pos-1]; const g=d.tokens[x.k].cod, pv=prev(b);
      out.push('0x'+b.toString(16)+'->'+g.toString(16)+'/'+pv.toString(16)+(g!==pv?'!!':'')); if(g!==pv) erros++; }catch(x){ out.push('semtok'); } }
    if(e<=i)break; i=e; }
  console.log(res+'   '+nome.padEnd(36)+(erros?'ERROS '+erros:'ok     ')+'  '+out.join(' '));
}
