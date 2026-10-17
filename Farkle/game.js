import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { DicePhysics } from './physics.js';
import { findScoringOptions, scoreSelection } from './scoring.js';
import { chooseBotMove, makePlayers } from './bot.js';
import { ParticleEffects, AmbientPixels } from './effects.js';

const canvas = document.querySelector('#dice-table');
const tableWrap = document.querySelector('#table-wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000');
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 80);
// Fixed isometric orbit: 35° above the table, 45° around its diagonal.
const ISO_ELEVATION = THREE.MathUtils.degToRad(35);
const ISO_AZIMUTH = THREE.MathUtils.degToRad(45);
const cameraRadius = 28;
camera.position.set(
  cameraRadius * Math.cos(ISO_ELEVATION) * Math.sin(ISO_AZIMUTH),
  cameraRadius * Math.sin(ISO_ELEVATION),
  cameraRadius * Math.cos(ISO_ELEVATION) * Math.cos(ISO_AZIMUTH),
);
camera.lookAt(0, 0, 0);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  const loading = document.querySelector('#table-loading');
  loading.hidden = false;
  loading.innerHTML = '<span class="loading-die">⚄</span><span>WebGL is unavailable in this browser.</span>';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

scene.add(new THREE.HemisphereLight('#ffffff', '#650000', 2.2));
const keyLight = new THREE.DirectionalLight('#ffffff', 3.2);
keyLight.position.set(-3, 16, -5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -12; keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12; keyLight.shadow.camera.bottom = -12;
keyLight.shadow.bias = -.0007;
scene.add(keyLight);
const fillLight = new THREE.PointLight('#c30000', 18, 22, 2);
fillLight.position.set(0, 9, 3); scene.add(fillLight);

function canvasTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  draw(context, canvas.width);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

const PALETTE = { black: '#000000', maroon: '#650000', white: '#ffffff', red: '#c30000', gray: '#b0aea8' };
const SELECTION_GREEN = '#00ff72';
const SKINS = {
  basic:  { base: PALETTE.gray, trim: PALETTE.white, pip: PALETTE.black, pattern: 'edge', pulse: false },
  aurora: { base: PALETTE.black, trim: PALETTE.white, pip: PALETTE.red, pattern: 'aurora', pulse: true },
  lava:   { base: PALETTE.maroon, trim: PALETTE.red, pip: PALETTE.white, pattern: 'lava', pulse: true },
  crt:    { base: PALETTE.black, trim: PALETTE.red, pip: PALETTE.white, pattern: 'scan', pulse: false },
  pearl:  { base: PALETTE.white, trim: PALETTE.gray, pip: PALETTE.maroon, pattern: 'pearl', pulse: false },
  toxic:  { base: PALETTE.gray, trim: PALETTE.red, pip: PALETTE.maroon, pattern: 'static', pulse: true },
  grid:   { base: PALETTE.black, trim: PALETTE.gray, pip: PALETTE.red, pattern: 'grid', pulse: false },
  ocean:  { base: PALETTE.maroon, trim: PALETTE.gray, pip: PALETTE.white, pattern: 'tide', pulse: true },
  candy:  { base: PALETTE.white, trim: PALETTE.red, pip: PALETTE.black, pattern: 'checker', pulse: false },
  void:   { base: PALETTE.black, trim: PALETTE.maroon, pip: PALETTE.white, pattern: 'void', pulse: true },
};
let activeSkin = 'basic';
try { activeSkin = localStorage.getItem('farkle-club-die-skin') || 'basic'; } catch { /* Storage may be disabled; the default skin is still usable. */ }
if (!SKINS[activeSkin]) activeSkin = 'basic';

function makeFaceTexture(value, skinId) {
  const skin = SKINS[skinId] || SKINS.basic;
  const positions = {
    1: [[.5,.5]],
    2: [[.23,.23],[.77,.77]],
    3: [[.23,.23],[.5,.5],[.77,.77]],
    4: [[.23,.23],[.77,.23],[.23,.77],[.77,.77]],
    5: [[.23,.23],[.77,.23],[.5,.5],[.23,.77],[.77,.77]],
    6: [[.23,.2],[.77,.2],[.23,.5],[.77,.5],[.23,.8],[.77,.8]],
  }[value];
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = skin.base; ctx.fillRect(0,0,size,size);
    ctx.fillStyle = skin.trim;
    if (skin.pattern === 'grid' || skin.pattern === 'scan' || skin.pattern === 'static') {
      const step = skin.pattern === 'scan' ? 14 : 32;
      for(let y=12;y<size;y+=step) for(let x=12;x<size;x+=step) ctx.fillRect(x,y,skin.pattern==='static'?5:3,skin.pattern==='scan'?2:3);
    } else if (skin.pattern === 'checker' || skin.pattern === 'aurora') {
      for(let y=0;y<4;y++) for(let x=0;x<4;x++) if((x+y)%2===0 || skin.pattern==='aurora'&&y===0) ctx.fillRect(16+x*120,16+y*120,42,42);
    } else if (skin.pattern === 'lava' || skin.pattern === 'tide' || skin.pattern === 'void' || skin.pattern === 'pearl') {
      for(let i=0;i<8;i++){const x=(i*73+19)%size,y=(i*131+27)%size;ctx.fillRect(x,y,28+(i%3)*11,7+(i%4)*5);}
    }
    ctx.strokeStyle = skin.trim; ctx.lineWidth = 9; ctx.strokeRect(9,9,size-18,size-18);
    ctx.strokeStyle = skin.pip; ctx.lineWidth = 4; ctx.strokeRect(25,25,size-50,size-50);
    for (const [x,y] of positions) {
      const px=Math.round(x*size/16)*16, py=Math.round(y*size/16)*16;
      ctx.fillStyle = skin.pip; ctx.fillRect(px-24,py-24,48,48);
      ctx.fillStyle = skin.trim; ctx.fillRect(px-9,py-9,18,18);
    }
  });
}
const faceForMaterialOrder = [3, 4, 1, 6, 2, 5]; // BoxGeometry groups: +x, -x, +y, -y, +z, -z.
function makeSkinMaterials(skinId) {
  const skin=SKINS[skinId]||SKINS.basic;
  const faces=Array.from({length:6},(_,i)=>new THREE.MeshStandardMaterial({map:makeFaceTexture(i+1,skinId),roughness:.58,metalness:.02,emissive:new THREE.Color(skin.pulse ? skin.trim : '#000000'),emissiveIntensity:skin.pulse ? .12 : 0}));
  return faceForMaterialOrder.map(face=>faces[face-1]);
}
let dieMaterials=makeSkinMaterials(activeSkin);

function relativeLuminance(hex){
  const rgb=hex.match(/[\da-f]{2}/gi).map(part=>parseInt(part,16)/255).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4);
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function contrastRatio(first,second){
  const a=relativeLuminance(first),b=relativeLuminance(second);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
function guideColorForSkin(skinId){
  const base=(SKINS[skinId]||SKINS.basic).base;
  if(contrastRatio(PALETTE.red,base)>=3)return PALETTE.red;
  return relativeLuminance(base)>.179?PALETTE.black:PALETTE.white;
}

const tableCanvasTexture = canvasTexture((ctx, size) => {
  ctx.fillStyle = PALETTE.black; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = PALETTE.maroon;
  for(let y=0;y<size;y+=16) for(let x=(y%32?0:16);x<size;x+=32) ctx.fillRect(x,y,4,4);
  ctx.strokeStyle=PALETTE.gray;ctx.lineWidth=5;ctx.strokeRect(10,10,size-20,size-20);
  ctx.strokeStyle=PALETTE.red;ctx.lineWidth=2;ctx.strokeRect(20,20,size-40,size-40);
  ctx.fillStyle=PALETTE.white;ctx.font='bold 36px monospace';ctx.textAlign='center';ctx.fillText('FARKLE / CLUB',size/2,size*.79);
  ctx.fillStyle=PALETTE.gray;ctx.font='28px monospace';ctx.fillText('ROLL · SCORE · RISK',size/2,size*.85);
});
const tableBase = new THREE.Mesh(new THREE.BoxGeometry(10,.78,15), new THREE.MeshStandardMaterial({ color:PALETTE.black, roughness:.52, metalness:.16 }));
tableBase.position.y=-.33; tableBase.receiveShadow=true; tableBase.castShadow=true; scene.add(tableBase);
const felt = new THREE.Mesh(new THREE.PlaneGeometry(9.6,14.6),new THREE.MeshStandardMaterial({map:tableCanvasTexture,roughness:.95}));
felt.rotation.x=-Math.PI/2;felt.position.y=.002;felt.receiveShadow=true;scene.add(felt);
const railMaterial=new THREE.MeshStandardMaterial({color:PALETTE.red,roughness:.43,metalness:.12});
for(const [x,z,sx,sz] of [[0,-7.37,10,.18],[0,7.37,10,.18],[-4.87,0,.18,15],[4.87,0,.18,15]]){
  const rail=new THREE.Mesh(new THREE.BoxGeometry(sx,.16,sz),railMaterial);rail.position.set(x,.055,z);rail.castShadow=true;scene.add(rail);
}

const physics = new DicePhysics(6);
const dice = Array.from({ length:6 },(_,id)=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.9,.9,.9),dieMaterials);
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.dieId=id;scene.add(mesh);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.56,.7,4),new THREE.MeshBasicMaterial({color:PALETTE.gray,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.028;ring.visible=false;scene.add(ring);
  const guide=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:PALETTE.red,transparent:true,opacity:.55,depthWrite:false}));
  guide.scale.setScalar(1.045);guide.visible=false;scene.add(guide);
  const selectedLayer=new THREE.Mesh(mesh.geometry,new THREE.MeshBasicMaterial({color:SELECTION_GREEN,transparent:true,opacity:.34,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));
  selectedLayer.scale.setScalar(1.018);selectedLayer.visible=false;selectedLayer.renderOrder=3;scene.add(selectedLayer);
  return {id,face:0,mesh,ring,guide,selectedLayer,kept:false};
});
const effects = new ParticleEffects(scene);
const ambient = new AmbientPixels(document.querySelector('#ambient-pixels'));
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const STORAGE_KEY='farkle-club-stats-v1';
function loadStats(){try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return {games:Number(value.games)||0,wins:Number(value.wins)||0,farkles:Number(value.farkles)||0,bestBank:Number(value.bestBank)||0};}catch{return {games:0,wins:0,farkles:0,bestBank:0};}}
const stats=loadStats();
function saveStats(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(stats));}catch{/* Private browsing may disable local storage; the game still runs. */}}

const ui={
  overlay:document.querySelector('#screen-overlay'),overlayKicker:document.querySelector('#overlay-kicker'),overlayTitle:document.querySelector('#overlay-title'),overlayCopy:document.querySelector('#overlay-copy'),
  lobbyFields:document.querySelector('#lobby-fields'),lobbyAction:document.querySelector('#lobby-action'),lobbyBest:document.querySelector('#lobby-best-value'),
  playerName:document.querySelector('#player-name-input'),botCount:document.querySelector('#bot-count'),targetSelect:document.querySelector('#target-score-select'),customTarget:document.querySelector('#custom-target-score'),customTargetWrap:document.querySelector('#custom-target-wrap'),difficulty:document.querySelector('#difficulty-select'),skin:document.querySelector('#skin-select'),throwPower:document.querySelector('#throw-power-select'),targetLabel:document.querySelector('#target-score-label'),targetBadge:document.querySelector('.target-badge'),
  players:document.querySelector('#player-list'),turnName:document.querySelector('#turn-name'),turnLabel:document.querySelector('#turn-label'),phase:document.querySelector('#phase-kicker'),
  turnScore:document.querySelector('#turn-score'),selectionCopy:document.querySelector('#selection-copy'),selectionScore:document.querySelector('#selection-score'),message:document.querySelector('#turn-message'),
  roll:document.querySelector('#roll-button'),rollLabel:document.querySelector('#roll-label'),keep:document.querySelector('#keep-button'),keepValue:document.querySelector('#keep-value'),bank:document.querySelector('#bank-button'),
  diceCount:document.querySelector('#dice-count-label'),timer:document.querySelector('#throw-timer'),round:document.querySelector('#round-number'),toast:document.querySelector('#toast'),loading:document.querySelector('#table-loading'),
  statWins:document.querySelector('#stat-wins'),statGames:document.querySelector('#stat-games'),statHigh:document.querySelector('#stat-high'),
};
let players=[];
let currentIndex=0;
let round=0;
let matchTarget=10000;
let difficulty='easy';
let throwPower='medium';
let phase='lobby';
let turnPoints=0;
let activeIds=[];
let keptIds=[];
let selectedIds=new Set();
let selectedResult={valid:false,points:0};
let botChoice=null;
let matchSerial=0;
let toastTimeout=0;
let animationFrame=0;

function showToast(message){ui.toast.textContent=message;ui.toast.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>ui.toast.classList.remove('show'),1500);}
function later(ms,callback){const serial=matchSerial;setTimeout(()=>{if(serial===matchSerial)callback();},ms);}
function currentPlayer(){return players[currentIndex];}
function formatNumber(value){return Math.floor(value).toLocaleString('en-US');}

function refreshStats(){ui.statWins.textContent=String(stats.wins);ui.statGames.textContent=String(stats.games);ui.statHigh.textContent=formatNumber(stats.bestBank);ui.lobbyBest.textContent=formatNumber(stats.bestBank);}
refreshStats();

function showLobby(mode='new',winner=null){
  phase='lobby';matchSerial++;
  ui.overlay.hidden=false;
  if(mode==='over'){
    ui.overlayKicker.textContent=winner?.isHuman?'NICE RUN · TABLE WON':'MATCH COMPLETE';
    ui.overlayTitle.textContent=winner?.isHuman?'You took the table.':`${winner?.name||'A bot'} wins.`;
    ui.overlayCopy.textContent=`Final score: ${formatNumber(winner?.score||0)} · target ${formatNumber(matchTarget)}. Set up another table and take your luck for a second ride.`;
    ui.lobbyFields.hidden=true;ui.lobbyAction.innerHTML='PLAY ANOTHER GAME <span>→</span>';
  }else{
    ui.overlayKicker.textContent='LOCAL BOT LOBBY';ui.overlayTitle.textContent='One more roll?';
    const requestedTarget=ui.targetSelect.value==='custom'?Number(ui.customTarget.value):Number(ui.targetSelect.value);
    const previewTarget=Number.isFinite(requestedTarget)&&requestedTarget>0?requestedTarget:matchTarget;
    ui.overlayCopy.textContent=`Set the table, choose your dice skin, throw power and difficulty. First player to ${formatNumber(previewTarget)} points wins.`;
    ui.lobbyFields.hidden=false;ui.lobbyAction.innerHTML='SEAT THE TABLE <span>→</span>';
  }
}

function startMatch(){
  const target = ui.targetSelect.value==='custom' ? Number(ui.customTarget.value) : Number(ui.targetSelect.value);
  if(!Number.isFinite(target)||target<1||target>100000){
    ui.customTarget.setAttribute('aria-invalid','true');ui.customTarget.focus();showToast('Choose a target from 1 to 100,000.');return;
  }
  matchTarget=Math.floor(target);difficulty=ui.difficulty.value;throwPower=ui.throwPower.value;
  ui.targetLabel.textContent=formatNumber(matchTarget);ui.targetBadge.textContent=formatNumber(matchTarget);
  applySkin(ui.skin.value);
  matchSerial++;
  players=makePlayers(ui.playerName.value,Number(ui.botCount.value));
  players.forEach(player=>player.score=0);
  currentIndex=0;round=1;turnPoints=0;keptIds=[];activeIds=[0,1,2,3,4,5];selectedIds.clear();
  stats.games++;saveStats();refreshStats();
  ui.overlay.hidden=true;ui.round.textContent=String(round).padStart(2,'0');
  renderPlayers();beginTurn();
}

ui.lobbyAction.addEventListener('click',()=>startMatch());
document.querySelector('#new-game').addEventListener('click',()=>showLobby());
ui.targetSelect.addEventListener('change',()=>{
  const custom=ui.targetSelect.value==='custom';ui.customTargetWrap.hidden=!custom;
  if(custom)ui.customTarget.focus();
  updateTargetPreview();
});
ui.customTarget.addEventListener('input',()=>{ui.customTarget.removeAttribute('aria-invalid');updateTargetPreview();});
ui.skin.value=activeSkin;
ui.skin.addEventListener('change',()=>applySkin(ui.skin.value));
try { ui.throwPower.value=localStorage.getItem('farkle-club-throw-power')||'medium'; } catch { ui.throwPower.value='medium'; }
if(!['low','medium','high'].includes(ui.throwPower.value))ui.throwPower.value='medium';
ui.throwPower.addEventListener('change',()=>{try{localStorage.setItem('farkle-club-throw-power',ui.throwPower.value);}catch{/* Keep the chosen power for this visit. */}});

function applySkin(skinId){
  if(!SKINS[skinId])return;
  const next=makeSkinMaterials(skinId);
  const oldFaces=new Set(dieMaterials);
  for(const material of oldFaces){material.map?.dispose();material.dispose();}
  dieMaterials=next;activeSkin=skinId;
  dice.forEach(die=>{die.mesh.material=dieMaterials;die.guide.material.color.set(guideColorForSkin(skinId));});
  try{localStorage.setItem('farkle-club-die-skin',skinId);}catch{/* Keep the in-memory choice for this visit. */}
}

function updateTargetPreview(){
  const value=ui.targetSelect.value==='custom'?Number(ui.customTarget.value):Number(ui.targetSelect.value);
  if(Number.isFinite(value)&&value>=1&&value<=100000){
    const formatted=formatNumber(value);ui.targetLabel.textContent=formatted;ui.targetBadge.textContent=formatted;
  }
}

function renderPlayers(){
  if(!players.length){ui.players.innerHTML='<li class="empty-player">Start a lobby to seat the table.</li>';return;}
  ui.players.replaceChildren(...players.map((player,index)=>{
    const li=document.createElement('li');li.className=`player-row${index===currentIndex?' active':''}`;
    const avatar=document.createElement('span');avatar.className='player-avatar';avatar.textContent=player.isHuman?'✦':player.name.slice(0,1).toUpperCase();avatar.style.color=player.color;avatar.style.borderColor=player.color+'77';
    const name=document.createElement('span');name.className='player-name';name.textContent=player.name;
    const sub=document.createElement('small');sub.textContent=player.isHuman?'YOU':'BOT';name.append(sub);
    const score=document.createElement('b');score.className='player-score';score.textContent=formatNumber(player.score);
    li.append(avatar,name,score);return li;
  }));
}

function beginTurn(){
  if(!players.length)return;
  phase='waiting';turnPoints=0;keptIds=[];activeIds=[0,1,2,3,4,5];selectedIds.clear();selectedResult={valid:false,points:0};botChoice=null;
  dice.forEach(die=>{die.face=0;die.kept=false;die.ring.visible=false;die.guide.visible=false;die.ring.material.color.set(PALETTE.white);});
  renderPlayers();updateTurnUI();
  const player=currentPlayer();
  setMessage(player.isHuman?'Your hand is ready. Every throw takes 2 seconds.':`${player.name} is getting ready to roll…`);
  rollHand();
}

function setMessage(message,tone='') { ui.message.textContent=message;ui.message.dataset.tone=tone; }
function updateTurnUI(){
  if(!players.length){updateControls();return;}
  const player=currentPlayer();
  ui.turnName.textContent=player.name;ui.turnLabel.textContent=player.isHuman?`${player.name.toUpperCase()} · AT THE TABLE`:`${player.name.toUpperCase()} · BOT TURN`;
  ui.phase.textContent=player.isHuman?'YOUR TURN':'BOT TURN';
  ui.turnScore.textContent=formatNumber(turnPoints);
  ui.diceCount.textContent=`${activeIds.length} ${activeIds.length===1?'DIE':'DICE'} IN HAND`;
  ui.round.textContent=String(round).padStart(2,'0');
  updateControls();
}

function updateControls(){
  const player=players[currentIndex];
  const human=Boolean(player?.isHuman);
  ui.roll.disabled=!(human&&phase==='waiting');
  ui.rollLabel.textContent=activeIds.length===6?'Roll all 6 dice':`Roll ${activeIds.length} remaining ${activeIds.length===1?'die':'dice'}`;
  ui.keep.disabled=!(human&&phase==='selecting'&&selectedResult.valid);
  ui.keepValue.textContent=`+${formatNumber(selectedResult.points||0)}`;
  ui.bank.disabled=!(human&&turnPoints>0&&['waiting','selecting'].includes(phase));
  if(phase==='rolling'){
    ui.roll.disabled=true;ui.keep.disabled=true;ui.bank.disabled=true;
  }
}

function setDieHighlights(){
  const options=phase==='selecting'?findScoringOptions(activeIds.map(id=>dice[id])):[];
  const possible=new Set(options.flatMap(option=>option.indices.map(index=>activeIds[index])));
  for(const die of dice){
    const selected=selectedIds.has(die.id);
    const valid=possible.has(die.id);
    const guideVisible=difficulty==='easy'&&phase==='selecting'&&currentPlayer()?.isHuman&&valid;
    die.guide.visible=guideVisible;
    die.guide.position.copy(die.mesh.position);die.guide.quaternion.copy(die.mesh.quaternion);
    die.selectedLayer.visible=selected&&selectedResult.valid;
    die.selectedLayer.position.copy(die.mesh.position);die.selectedLayer.quaternion.copy(die.mesh.quaternion);
    die.ring.visible=die.kept||selected;
    die.ring.position.x=die.mesh.position.x;die.ring.position.z=die.mesh.position.z;
    die.ring.material.color.set(die.kept?PALETTE.gray:PALETTE.white);
    die.ring.material.opacity=selected ? .98 : die.kept ? .72 : 0;
  }
}

function updateSelection(){
  const faces=[...selectedIds].map(id=>dice[id].face);
  selectedResult=scoreSelection(faces);
  if(!faces.length){ui.selectionCopy.textContent='No dice selected';ui.selectionScore.textContent='+0';}
  else if(selectedResult.valid){ui.selectionCopy.textContent=selectedResult.label;ui.selectionScore.textContent=`+${formatNumber(selectedResult.points)}`;}
  else{ui.selectionCopy.textContent='That full selection does not score';ui.selectionScore.textContent='+0';}
  setDieHighlights();updateControls();
}

function rollHand(){
  if(phase!=='waiting'||!activeIds.length)return;
  phase='rolling';selectedIds.clear();selectedResult={valid:false,points:0};
  physics.throwDice(activeIds,throwPower);
  setMessage(currentPlayer().isHuman?'Dice rolling…':'Dice are tumbling across the table.');
  ui.timer.textContent='2.00 s';updateTurnUI();setDieHighlights();
}

function handleRollSettled(faces){
  for(const [id,face] of faces)dice[id].face=face;
  ui.timer.textContent='';
  const options=findScoringOptions(activeIds.map(id=>dice[id]));
  if(!options.length){handleFarkle();return;}
  phase='selecting';
  if(currentPlayer().isHuman){
    setMessage('Choose any complete scoring set. You may bank your turn points now.', 'good');
    updateSelection();updateTurnUI();
  }else{
    const player=currentPlayer();
    botChoice=chooseBotMove(activeIds.map(id=>dice[id]),turnPoints,player.score,matchTarget);
    selectedIds=new Set(botChoice.selection.indices.map(index=>activeIds[index]));
    updateSelection();setMessage(`${player.name} selects ${botChoice.selection.label} for ${formatNumber(botChoice.selection.points)} points…`);
    later(780,()=>keepSelected(true));
  }
}

function keepSelected(automatic=false){
  if(phase!=='selecting'||!selectedResult.valid)return;
  const player=currentPlayer();
  if(player.isHuman&&automatic)return;
  const ids=[...selectedIds];
  const points=selectedResult.points;
  turnPoints+=points;
  for(const id of ids){
    dice[id].kept=true;
    physics.stashDie(id,keptIds.length);
    keptIds.push(id);
  }
  activeIds=activeIds.filter(id=>!selectedIds.has(id));
  selectedIds.clear();selectedResult={valid:false,points:0};
  setDieHighlights();updateTurnUI();
  setMessage(`${player.name} keeps ${formatNumber(points)} points. Turn total: ${formatNumber(turnPoints)}.`, 'good');

  if(activeIds.length===0){
    if(!player.isHuman&&botChoice?.shouldBank){bankTurn(true);return;}
    later(700,hotDice);
    return;
  }
  phase='waiting';updateControls();
  if(!player.isHuman){
    const bank=botChoice?.shouldBank;
    later(620,()=>bank?bankTurn(true):rollHand());
  }
}

function hotDice(){
  if(!players.length||!['selecting','waiting'].includes(phase))return;
  phase='waiting';
  keptIds=[];activeIds=[0,1,2,3,4,5];
  dice.forEach(die=>{die.kept=false;die.ring.visible=false;});
  effects.burst(PALETTE.white,72,new THREE.Vector3(0,.65,0));
  showToast('HOT DICE! All six are back.');
  setMessage('HOT DICE! All six dice are back in your hand.', 'hot');
  updateTurnUI();
  later(820,rollHand);
}

function handleFarkle(){
  const player=currentPlayer();
  phase='farkle';
  if(player.isHuman){stats.farkles++;saveStats();refreshStats();}
  turnPoints=0;selectedIds.clear();selectedResult={valid:false,points:0};
  effects.burst(PALETTE.red,56,new THREE.Vector3(0,.55,0));
  showToast('FARKLE — turn points lost');
  setMessage(`FARKLE! ${player.name} had no scoring dice; the turn total is lost.`, 'bad');
  updateTurnUI();
  later(1400,nextTurn);
}

function bankTurn(automatic=false){
  const player=currentPlayer();
  if(!player||turnPoints<=0||(!player.isHuman&&!automatic)||!['waiting','selecting'].includes(phase))return;
  player.score+=turnPoints;
  stats.bestBank=Math.max(stats.bestBank,turnPoints);saveStats();refreshStats();
  showToast(`${player.name} banks ${formatNumber(turnPoints)} points`);
  setMessage(`${player.name} banks ${formatNumber(turnPoints)} points.`, 'good');
  renderPlayers();
  const winner=players.find(item=>item.score>=matchTarget);
  if(winner){endMatch(winner);return;}
  phase='banked';turnPoints=0;
  later(800,nextTurn);
}

function nextTurn(){
  if(!players.length||phase==='lobby'||phase==='gameover')return;
  currentIndex=(currentIndex+1)%players.length;
  if(currentIndex===0)round++;
  beginTurn();
}

function endMatch(winner){
  phase='gameover';
  if(winner.isHuman)stats.wins++;
  saveStats();refreshStats();
  effects.burst(winner.isHuman?PALETTE.white:PALETTE.red,110,new THREE.Vector3(0,.75,0));
  renderPlayers();showLobby('over',winner);
}

function onTableClick(event){
  if(phase!=='selecting'||!currentPlayer()?.isHuman)return;
  const rect=canvas.getBoundingClientRect();
  pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(dice.map(die=>die.mesh),false)[0];
  if(!hit)return;
  const id=hit.object.userData.dieId;
  if(!activeIds.includes(id))return;
  if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);
  updateSelection();
}
canvas.addEventListener('pointerup',onTableClick);
ui.roll.addEventListener('click',rollHand);
ui.keep.addEventListener('click',()=>keepSelected(false));
ui.bank.addEventListener('click',()=>bankTurn(false));
addEventListener('keydown',event=>{
  if(event.repeat)return;
  if(event.code==='Space'&&phase==='waiting'&&currentPlayer()?.isHuman){event.preventDefault();rollHand();}
  if(event.code==='Enter'&&phase==='selecting'&&currentPlayer()?.isHuman&&selectedResult.valid){event.preventDefault();keepSelected(false);}
  if(event.code==='KeyB'&&turnPoints>0&&currentPlayer()?.isHuman){bankTurn(false);}
});

function resize(){
  const rect=tableWrap.getBoundingClientRect();
  if(rect.width<1||rect.height<1)return;
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));renderer.setSize(rect.width,rect.height,false);
  const aspect=rect.width/rect.height;
  // Orthographic bounds fit the projected 10 × 15 table from the fixed 35° / 45° view.
  const halfHeight=Math.max(6.2,9.1/aspect);
  const halfWidth=halfHeight*aspect;
  camera.left=-halfWidth;camera.right=halfWidth;camera.top=halfHeight;camera.bottom=-halfHeight;camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(tableWrap);resize();
ui.loading.hidden=true;

function frame(){
  animationFrame=requestAnimationFrame(frame);
  const dt=Math.min(clock.getDelta(),.05);
  if(phase==='rolling'){
    const faces=physics.step(dt);
    if(faces)handleRollSettled(faces);
    ui.timer.textContent=`${Math.max(0,2-(physics.roll?.elapsed||0)).toFixed(2)} s`;
  }
  physics.sync(dice.map(die=>die.mesh));
  setDieHighlights();
  effects.update(dt);
  ambient.update(dt);
  const pulse=performance.now()*.001;
  if(SKINS[activeSkin].pulse){
    const intensity=.12+.13*(.5+.5*Math.sin(pulse*.45));
    for(const material of new Set(dieMaterials))material.emissiveIntensity=intensity;
  }
  renderer.render(scene,camera);
}
frame();
showLobby('new');

