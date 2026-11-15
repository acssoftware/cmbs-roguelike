// BIBLIOTECA de fontes limpas: valida os `LIB *.btt` gerados no editor por script e os move para
// Game Files/LIB com o nome da formacao que esta dentro. Uma fonte e "limpa" quando tem uma
// formacao de topo, ids desde 1, contador no primeiro filho (ou unidade unica) e nenhum salto.
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros, indiceDeTokens, inicioDoRegistro, subArvore } from './regs.mjs';
const G='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/Game Files/';
const L=G+'../LIB/'; const ORIGENS=[G+'Scenarios/', G+'Saved Games/', G, L];
const EX={1:'US',2:'RU',3:'UKR'};
if(!fs.existsSync(L)) fs.mkdirSync(L);
const so=process.argv[2]==='--so-validar';
let ok=0, ruim=0;
for(const S of ORIGENS) for(const f of fs.readdirSync(S).filter(x=>/^LIB .*\.btt$/i.test(x)).sort()){
  let d,R; try{ d=ler(S+f); marcador(d); R=registros(d.cru).sort((a,b)=>a.off-b.off); }catch(e){ console.log('  X '+f+': '+e.message.slice(0,50)); ruim++; continue; }
  if(!R.length){ console.log('  X '+f+': sem forca'); ruim++; continue; }
  const p=indiceDeTokens(d.tokens);
  let i=0,tops=[]; while(i<R.length){ if(!R[i].form){ tops.push(R[i]); i++; continue; } let e; try{e=subArvore(d.cru,p,R,i);}catch(x){e=i+1;} tops.push(R[i]); if(e<=i)break; i=e; }
  const ids=R.map(r=>r.id); let saltos=0; for(let k=1;k<ids.length;k++) if(ids[k]!==ids[k-1]+1) saltos++;
  const nome=(tops[0].nm||'?').replace(/[\/:*?"<>|]/g,'-');
  const problemas=[]; if(tops.length!==1) problemas.push(tops.length+' topos'); if(ids[0]!==1) problemas.push('id inicial '+ids[0]); if(saltos) problemas.push(saltos+' saltos');
  const ehAnexo=/^LIB ANX /i.test(f);
  // arquivo de anexo: base + 1 item; o item e o ULTIMO registro, e ele que da o nome
  const item=ehAnexo?(R[R.length-1].nm||'?').replace(/[\/:*?"<>|]/g,'-'):null;
  if(ehAnexo && !(d.cru[tops[0].off+7] & 0x20)) problemas.push('base sem flag de anexo');
  const destino=ehAnexo?('ANEXO '+EX[tops[0].army]+' - '+item+'.btt'):(EX[tops[0].army]+' - '+nome+'.btt');
  if(problemas.length){ console.log('  X '+f+' -> '+destino+': '+problemas.join(', ')); ruim++; continue; }
  console.log('  ok '+f+' -> '+destino+'  ('+R.length+' regs)');
  if(!so){
    let alvo=L+destino;
    if(fs.existsSync(alvo)){
      const igual=fs.readFileSync(alvo).equals(fs.readFileSync(S+f));
      if(igual){ fs.unlinkSync(S+f); console.log('     (identico ao ja existente; descartado)'); ok++; continue; }
      alvo=L+destino.replace(/.btt$/,' ['+f.replace(/^LIB |.btt$/g,'')+'].btt'); console.log('     (nome ja usado com conteudo diferente -> '+alvo.split('/').pop()+')');
    }
    fs.renameSync(S+f, alvo);
  }
  ok++;
}
console.log(ok+' validos, '+ruim+' com problema'+(so?' (so validacao, nada movido)':''));
