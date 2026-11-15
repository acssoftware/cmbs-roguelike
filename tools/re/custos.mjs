// Tabela de custo em pontos de cada fonte da biblioteca: o campo A do cabecalho (marcador+5),
// que e o custo de compra do Quick Battle (secao 53). Moeda do modo roguelike.
import fs from 'fs';
import { ler, marcador } from './transplante.mjs';
import { registros } from './regs.mjs';
const L='C:/Program Files (x86)/Steam/steamapps/common/Combat Mission Black Sea/LIB/';
const out=[];
for(const f of fs.readdirSync(L).filter(x=>x.endsWith('.btt')).sort()){
  try{ const d=ler(L+f); const m=marcador(d).pos; const R=registros(d.cru);
    const R0=R.slice().sort((a,b)=>a.off-b.off)[0]; const curto=(R0.off+3-m)===11;   // 11 = off-map; 15 = vermelho-primeiro; 17 = padrao (A sempre em m+5)
    out.push({ arquivo:f, exercito:f.split(' - ')[0], nome:f.replace(/^w+ - |.btt$/g,''), pontos: curto?null:d.cru.readUInt32LE(m+5), cabecalhoCurto:curto, registros:R.length, unidades:R.filter(r=>!r.form).length }); }
  catch(e){ out.push({ arquivo:f, erro:e.message.slice(0,60) }); }
}
fs.writeFileSync('../../research/custos.json', JSON.stringify(out,null,1));
console.log('custo (pontos)  regs  unid  fonte');
for(const o of out) console.log(o.erro?('  ERRO '+o.arquivo+': '+o.erro):('  '+String(o.pontos).padStart(6)+'  '+String(o.registros).padStart(5)+' '+String(o.unidades).padStart(5)+'  '+o.arquivo));
