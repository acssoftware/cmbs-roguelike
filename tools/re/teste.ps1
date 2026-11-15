Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class U {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder t, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
}
"@
$SCRATCH="<home>\AppData\Local\Temp\claude\c--Users-autor-0-AREA-DE-TRABALHO-1-PROJETOS-PERSONAL-APP\ca4d09ce-b16b-4677-8bbd-da534434e569\scratchpad"
$EXE="C:\Program Files (x86)\Steam\steamapps\common\Combat Mission Black Sea\CM Black Sea.exe"
function Shot($nome){
  $s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $b=New-Object System.Drawing.Bitmap($s.Width,$s.Height)
  $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0,0,0,0,$b.Size)
  $p=Join-Path $SCRATCH "$nome.png"; $b.Save($p,[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose();$b.Dispose()
  "shot: $p"
}
function Clique($x,$y){
  [U]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 150
  [U]::mouse_event(0x02,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 80
  [U]::mouse_event(0x04,0,0,0,[IntPtr]::Zero); Start-Sleep -Milliseconds 300
}
function Janela(){ $h=[U]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 256; [void][U]::GetWindowText($h,$sb,256); $sb.ToString() }
function Vivo(){ $p=Get-Process -Name "CM Black Sea" -ErrorAction SilentlyContinue
  if($p){"VIVO pid $($p.Id) mem $([math]::Round($p.WorkingSet64/1MB))MB"} else {"MORTO"} }
function Matar(){ Get-Process -Name "CM Black Sea","Launcher" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep 2; "matado" }
function Lancar(){
  Start-Process -FilePath $EXE -WorkingDirectory (Split-Path $EXE)
  $h=[IntPtr]::Zero; $t=0
  while($h -eq [IntPtr]::Zero -and $t -lt 40){ Start-Sleep 1; $t++
    foreach($n in @("CM Black Sea","Launcher")){ $p=Get-Process -Name $n -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if($p){ $h=$p.MainWindowHandle; $tit=$p.MainWindowTitle; break } } }
  if($h -eq [IntPtr]::Zero){ return "SEM JANELA apos ${t}s" }
  [void][U]::MoveWindow($h,460,255,1000,537,$true); Start-Sleep -Milliseconds 500
  [void][U]::SetForegroundWindow($h); Start-Sleep -Milliseconds 500
  "launcher '$tit' apos ${t}s; foreground='$(Janela)'"
}
function Testar($linha,$rotulo){
  "== TESTE $rotulo (linha $linha) =="
  Matar | Out-Null
  Lancar
  Clique 1368 400; "play"; Start-Sleep 25
  Shot "$rotulo-1-menu"
  Clique 959 670; "scenario editor"; Start-Sleep 5
  Clique 53 13;   "load"; Start-Sleep 3
  Clique 623 447; "pasta Scenarios"; Start-Sleep 3
  Shot "$rotulo-2-lista"
  $y=345+17*($linha-1)
  Clique 662 $y;  "arquivo linha $linha (y=$y)"; Start-Sleep 20
  Shot "$rotulo-3-depois"
  "RESULTADO ${rotulo}: $(Vivo)  foreground='$(Janela)'"
}
function Pixel($x,$y){ $b=New-Object System.Drawing.Bitmap(1,1); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($x,$y,0,0,$b.Size); $c=$b.GetPixel(0,0); $g.Dispose(); $b.Dispose(); $c }
function EhIcone($x,$y){ $c=Pixel $x $y; ($c.R -gt 150 -and $c.G -gt 110 -and $c.B -lt 140 -and ($c.R - $c.B) -gt 40) }
function TemTexto($y){ $n=0; for($x=595;$x -le 720;$x+=2){ $c=Pixel $x $y; if(($c.R+$c.G+$c.B) -lt 300){$n++} }; ($n -ge 3) }
function NavegarScenarios(){
  for($i=0;$i -lt 4;$i++){
    $i1=EhIcone 581 345; $i9=EhIcone 581 481; $t1=TemTexto 345
    if($i1 -and $i9){ Clique 623 464; Start-Sleep 3; return "raiz Game Files -> Scenarios" }
    if((-not $i1) -and $t1){ return "ja em Scenarios" }
    Clique 580 287; Start-Sleep 2
  }
  "NAO ACHEI a pasta"
}
function Testar2($linha,$rotulo){
  "== TESTE $rotulo (linha $linha) =="
  Matar | Out-Null; Lancar
  Clique 1368 400; Start-Sleep 25
  Clique 959 670; Start-Sleep 5
  Clique 53 13;   Start-Sleep 3
  "navegacao: " + (NavegarScenarios)
  Shot "$rotulo-lista"
  $y=345+17*($linha-1); Clique 662 $y; "clique linha $linha (y=$y)"; Start-Sleep 20
  Shot "$rotulo-depois"
  "RESULTADO ${rotulo}: $(Vivo)  fg='$(Janela)'"
}
function NavegarScenarios2(){
  $ultima=''
  for($i=0;$i -lt 6;$i++){
    $t1=TemTexto 345; $t10=TemTexto 498
    if($t1 -and $t10){ return "em Scenarios (lista longa) apos $i passos" }
    if($t1 -and -not $t10 -and $ultima -ne 'scen'){ Clique 623 464; Start-Sleep 3; $ultima='scen'; continue }
    Clique 580 287; Start-Sleep 2; $ultima='up'
  }
  "NAO ACHEI"
}
function Testar3($linha,$rotulo){
  "== TESTE $rotulo (linha $linha) =="
  Matar | Out-Null; Lancar
  Clique 1368 400; Start-Sleep 25
  Clique 959 670; Start-Sleep 5
  Clique 53 13;   Start-Sleep 3
  "navegacao: " + (NavegarScenarios2)
  Shot "$rotulo-lista"
  $y=345+17*($linha-1); Clique 662 $y; "clique linha $linha (y=$y)"; Start-Sleep 20
  Shot "$rotulo-depois"
  "RESULTADO ${rotulo}: $(Vivo)  fg='$(Janela)'"
}
function Teclar($texto){ [System.Windows.Forms.SendKeys]::SendWait($texto); Start-Sleep -Milliseconds 300 }
function Editor(){ Matar | Out-Null; Lancar; Clique 1368 400; Start-Sleep 25; Clique 959 670; Start-Sleep 5; "no editor: " + (Vivo) }
function TemTextoLista($y){ $n=0; for($x=258;$x -le 700;$x+=2){ $c=Pixel $x $y; if(($c.R+$c.G+$c.B) -lt 400 -and $c.B -gt ($c.R+40)){$n++} }; ($n -ge 3) }
function ContarLinhas(){ $n=0; for($i=0;$i -lt 44;$i++){ $y=59+16*$i; if(TemTextoLista $y){ $n=$i+1 } }; $n }
function Novo(){ Clique 161 13; Start-Sleep 2; Clique 880 589; Start-Sleep 3; Clique 110 77; Start-Sleep 1; Clique 29 116; Start-Sleep 3 }
function Salvar($nome){ Clique 53 42; Start-Sleep 3; Clique 623 464; Start-Sleep 2; Clique 947 813; Start-Sleep 1; Teclar $nome; Start-Sleep 1; Clique 1262 814; Start-Sleep 4 }
# compra a linha N da Available (lado: 105 azul / 164 vermelho; bandeira x ou 0; categoria y) e salva
function GerarFonte($ladoY,$bandeiraX,$catY,$linha,$nome){
  Novo; Clique 110 $ladoY; Start-Sleep 2; if($bandeiraX -gt 0){ Clique $bandeiraX 500; Start-Sleep 2 }
  Clique 110 $catY; Start-Sleep 2
  $y=59+16*($linha-1); Clique 320 $y; Start-Sleep 1; Clique 923 823; Start-Sleep 3
  Salvar $nome; "gerado $nome (linha $linha)"
}
# versao rapida: uma captura da regiao da lista e varredura em memoria
function ContarLinhas(){
  $b=New-Object System.Drawing.Bitmap(460,760); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(250,50,0,0,$b.Size); $g.Dispose()
  $n=0; for($i=0;$i -lt 44;$i++){ $y=59+16*$i-50; $k=0; for($x=8;$x -lt 450;$x+=2){ $c=$b.GetPixel($x,$y); if(($c.R+$c.G+$c.B) -lt 400 -and $c.B -gt ($c.R+40)){$k++} }; if($k -ge 3){ $n=$i+1 } }
  $b.Dispose(); $n }
function ContarLinhas(){
  $b=New-Object System.Drawing.Bitmap(460,760); $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(250,50,0,0,$b.Size); $g.Dispose()
  $n=0; for($i=0;$i -lt 44;$i++){ $y=59+16*$i-50; $k=0; for($x=8;$x -lt 450;$x+=2){ $c=$b.GetPixel($x,$y); if(($c.R+$c.G+$c.B) -gt 150){$k++} }; if($k -ge 3){ $n=$i+1 } }
  $b.Dispose(); $n }
# lote: lista de @{lado=105;band=36;cat=616;n=8;pref='LIB US MECH'}; relanca o jogo a cada 15 arquivos
function GerarLote($itens){
  $feitos=0
  foreach($it in $itens){ for($i=1;$i -le $it.n;$i++){
    if($feitos -gt 0 -and ($feitos % 15) -eq 0){ Matar | Out-Null; Editor | Out-Null }
    GerarFonte $it.lado $it.band $it.cat $i ($it.pref+' '+$i.ToString('00')) | Select-String 'gerado'
    $feitos++ } }
  "lote concluido: $feitos arquivos; " + (Vivo)
}
# Save As robusto: sobe ate a raiz Game Files (texto em y=498 e nada em y=515), entra em Scenarios
function IrParaScenariosNoSave(){
  for($i=0;$i -lt 5;$i++){
    $t498=TemTexto 498; $t515=TemTexto 515; $t345=TemTexto 345
    if($t345 -and $t498 -and -not $t515){ Clique 623 464; Start-Sleep 2; return "raiz -> Scenarios" }
    Clique 580 287; Start-Sleep 2
  }
  "NAO ACHEI a raiz"
}
function Salvar($nome){
  Clique 53 42; Start-Sleep 3
  $nav=IrParaScenariosNoSave
  Clique 947 813; Start-Sleep 1; Teclar $nome; Start-Sleep 1; Clique 1262 814; Start-Sleep 4
  "salvo $nome ($nav)"
}
# fila: carrega as linhas 1..N (arquivos A0 ...) e, para as marcadas, captura as arvores Units azul e vermelha
function RodarFila($rotulos, $comArvore){
  $linha=1
  foreach($r in $rotulos){
    $res = Testar3 $linha $r | Select-String 'RESULTADO'
    "$res"
    if($comArvore -contains $r -and ("$res" -match 'VIVO')){
      Clique 110 77; Start-Sleep 1; Clique 29 116; Start-Sleep 3; Shot "$r-units-blue" | Out-Null
      Clique 110 164; Start-Sleep 3; Shot "$r-units-red" | Out-Null
    }
    $linha++
  }
  Matar | Out-Null; "fila concluida"
}
# ANEXOS: um arquivo por item de Specialist Teams (dropY=397) ou Single Vehicles (dropY=417),
# comprado dentro de um batalhao-base (categoria catY, linha 1) num cenario NOVO.
function GerarAnexo($ladoY,$bandeiraX,$catY,$dropY,$linha,$nome){
  Novo; Clique 110 $ladoY; Start-Sleep 2; if($bandeiraX -gt 0){ Clique $bandeiraX 500; Start-Sleep 2 }
  Clique 110 $catY; Start-Sleep 2
  Clique 320 59; Start-Sleep 1; Clique 923 823; Start-Sleep 3         # compra o batalhao-base (linha 1)
  Clique 1180 59; Start-Sleep 1                                       # seleciona o batalhao comprado
  Clique 108 378; Start-Sleep 1; Clique 72 $dropY; Start-Sleep 2      # categoria de anexo
  $y=59+16*($linha-1); Clique 320 $y; Start-Sleep 1; Clique 923 823; Start-Sleep 3
  Salvar $nome; "gerado $nome (anexo linha $linha)"
}
# conta as linhas da lista de anexos de um lado/exercito (abre um NOVO, compra a base, seleciona, muda categoria)
function ContarAnexos($ladoY,$bandeiraX,$catY,$dropY){
  Novo; Clique 110 $ladoY; Start-Sleep 2; if($bandeiraX -gt 0){ Clique $bandeiraX 500; Start-Sleep 2 }
  Clique 110 $catY; Start-Sleep 2; Clique 320 59; Start-Sleep 1; Clique 923 823; Start-Sleep 3
  Clique 1180 59; Start-Sleep 1; Clique 108 378; Start-Sleep 1; Clique 72 $dropY; Start-Sleep 2
  ContarLinhas
}
function GerarLoteAnexos($itens){
  $feitos=0
  foreach($it in $itens){ for($i=1;$i -le $it.n;$i++){
    if($feitos -gt 0 -and ($feitos % 15) -eq 0){ Matar | Out-Null; Editor | Out-Null }
    GerarAnexo $it.lado $it.band $it.cat $it.drop $i ($it.pref+' '+$i.ToString('00')) | Select-String 'gerado'
    $feitos++ } }
  "lote de anexos concluido: $feitos; " + (Vivo)
}
# conta as linhas de cada categoria (botoes y=596..696) para um lado/exercito, numa passada
function ContarCategorias($ladoY,$bandeiraX){
  Novo; Clique 110 $ladoY; Start-Sleep 2; if($bandeiraX -gt 0){ Clique $bandeiraX 500; Start-Sleep 2 }
  $out=@{}
  foreach($y in 596,616,636,656,676,696){ Clique 110 $y; Start-Sleep 2; $out[$y]=ContarLinhas }
  Shot ("cats-"+$ladoY+"-"+$bandeiraX) | Out-Null
  ($out.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' '
}
# Navegacao determinística no dialogo de LOAD: sobe com o icone de pasta ate reconhecer a raiz
# Game Files (linhas de pasta ate y=498 e nada em y=515) e entao entra em Scenarios (623,464).
function NavegarScenarios2(){
  for($i=0;$i -lt 6;$i++){
    $t345=TemTexto 345; $t498=TemTexto 498; $t515=TemTexto 515
    if($t345 -and $t498 -and -not $t515){ Clique 623 464; Start-Sleep 3
      if((TemTexto 345) -and (TemTexto 753)){ return "raiz -> Scenarios (lista longa confirmada)" } else { return "raiz -> Scenarios (lista curta?)" } }
    Clique 580 287; Start-Sleep 2
  }
  "NAO ACHEI a raiz"
}
# Raiz Game Files: 9 linhas no LOAD (TESTING em 481) ou 10 no SAVE (TESTING em 498). Assinatura comum:
# texto em 345 e em 481, nada em 515. Scenarios fica em 464 nos dois.
function EhRaiz(){ (TemTexto 345) -and (TemTexto 481) -and -not (TemTexto 515) }
function NavegarScenarios2(){
  for($i=0;$i -lt 6;$i++){
    if(EhRaiz){ Clique 623 464; Start-Sleep 3; if((TemTexto 345) -and (TemTexto 753)){ return "raiz -> Scenarios" } else { return "raiz -> Scenarios? (lista curta)" } }
    Clique 580 287; Start-Sleep 2
  }
  "NAO ACHEI a raiz"
}
function IrParaScenariosNoSave(){
  for($i=0;$i -lt 6;$i++){ if(EhRaiz){ Clique 623 464; Start-Sleep 2; return "raiz -> Scenarios" }; Clique 580 287; Start-Sleep 2 }
  "NAO ACHEI a raiz"
}
# --- sondas de estado (03/09, depois do lote cair no 3-D Preview) ---
function Em3D(){ $c=Pixel 960 300; (($c.R+$c.G+$c.B) -gt 120) }                       # editor e preto ali; 3-D tem ceu/terreno
function EmMission(){ $c=Pixel 630 32; ($c.R -gt 180 -and $c.G -gt 100 -and $c.B -lt 90) } # caixa laranja "Battle Type"
function DialogoSimNao(){ $c=Pixel 960 520; ($c.R -gt 40 -and $c.G -lt 30 -and $c.B -lt 30) } # fundo vinho do "Continue?"
function IrParaUnits(){
  if(EmMission){ Clique 110 77; Start-Sleep 1; Clique 29 116; Start-Sleep 3; return "Mission -> Units" }
  "ja fora de Mission (presumo Units)"
}
function Novo(){
  if(Em3D){ Teclar '{ESC}'; Start-Sleep 3 }
  Clique 161 13; Start-Sleep 2
  if(DialogoSimNao){ Clique 880 589; Start-Sleep 3 }
  IrParaUnits | Out-Null
}
# raiz dos dialogos sem depender da linha cinza do .vdf: Scenarios (464) tem texto, 515 nao
function EhRaiz(){ (TemTexto 345) -and (TemTexto 464) -and -not (TemTexto 515) }
function IrParaScenariosNoSave(){
  for($i=0;$i -lt 6;$i++){
    if(EhRaiz){ Clique 623 464; Start-Sleep 2; if(TemTexto 753){ return "raiz -> Scenarios" } else { Clique 580 287; Start-Sleep 2; continue } }
    Clique 580 287; Start-Sleep 2 }
  "NAO ACHEI a raiz"
}
function NavegarScenarios2(){
  for($i=0;$i -lt 6;$i++){
    if(EhRaiz){ Clique 623 464; Start-Sleep 3; if(TemTexto 753){ return "raiz -> Scenarios" } else { Clique 580 287; Start-Sleep 2; continue } }
    Clique 580 287; Start-Sleep 2 }
  "NAO ACHEI a raiz"
}
function EmMission(){ $c=Pixel 526 32; ($c.R -gt 200 -and $c.G -gt 150 -and $c.B -lt 120) }   # borda laranja do Battle Type
function DialogoSimNao(){ $c=Pixel 960 520; ($c.R -gt 15 -and $c.G -lt 12 -and $c.B -lt 12) } # fundo vinho (33,0,0)
function GerarLote($itens){
  $feitos=0
  foreach($it in $itens){ $ini=1; if($it.de){ $ini=$it.de }
    for($i=$ini;$i -le $it.n;$i++){
      if($feitos -gt 0 -and ($feitos % 15) -eq 0){ Matar | Out-Null; Editor | Out-Null }
      GerarFonte $it.lado $it.band $it.cat $i ($it.pref+' '+$i.ToString('00')) | Select-String 'gerado'
      $feitos++ } }
  "lote concluido: $feitos arquivos; " + (Vivo)
}
# Salvar v3: raiz limpa (arquivos avulsos sao movidos para LIB logo apos cada save), campo de nome
# esvaziado com backspaces antes de digitar, navegacao raiz -> Scenarios so se a raiz for reconhecida.
$GF='C:\Program Files (x86)\Steam\steamapps\common\Combat Mission Black Sea\Game Files'
$LIBDIR='C:\Program Files (x86)\Steam\steamapps\common\Combat Mission Black Sea\LIB'
function LimparRaiz(){ Get-ChildItem -Path $GF -Filter '*.btt' -File -ErrorAction SilentlyContinue | ForEach-Object { Move-Item -Force $_.FullName (Join-Path $LIBDIR $_.Name) } }
function Salvar($nome){
  Clique 53 42; Start-Sleep 3
  $nav='sem navegar'; if(EhRaiz){ Clique 623 464; Start-Sleep 2; $nav='raiz -> Scenarios' }
  Clique 947 813; Start-Sleep 1; Teclar '{BS 60}'; Teclar $nome; Start-Sleep 1; Clique 1262 814; Start-Sleep 4
  LimparRaiz
  "salvo $nome ($nav)"
}
