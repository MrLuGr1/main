import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { DicePhysics } from './physics.js';
import { findScoringOptions, scoreSelection } from './scoring.js';
import { chooseBotMove, makePlayers } from './bot.js';
import { ParticleEffects } from './effects.js';

const canvas = document.querySelector('#dice-table');
const tableWrap = document.querySelector('#table-wrap');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101815);
const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, .1, 45);
camera.position.set(0, 20, 0);
camera.up.set(0, 0, -1);
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

scene.add(new THREE.HemisphereLight(0xe5f0d9, 0x152b26, 2.1));
const keyLight = new THREE.DirectionalLight(0xffe6b0, 3.2);
keyLight.position.set(-3, 13, -5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -9; keyLight.shadow.camera.right = 9;
keyLight.shadow.camera.top = 8; keyLight.shadow.camera.bottom = -8;
keyLight.shadow.bias = -.0007;
scene.add(keyLight);
const fillLight = new THREE.PointLight(0x54d8b4, 22, 18, 2);
fillLight.position.set(0, 7, 2); scene.add(fillLight);

function canvasTexture(draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  draw(context, canvas.width);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeFaceTexture(value) {
  const positions = {
    1: [[.5,.5]],
    2: [[.23,.23],[.77,.77]],
    3: [[.23,.23],[.5,.5],[.77,.77]],
    4: [[.23,.23],[.77,.23],[.23,.77],[.77,.77]],
    5: [[.23,.23],[.77,.23],[.5,.5],[.23,.77],[.77,.77]],
    6: [[.23,.2],[.77,.2],[.23,.5],[.77,.5],[.23,.8],[.77,.8]],
  }[value];
  return canvasTexture((ctx, size) => {
    ctx.fillStyle = '#f0ecdc'; ctx.fillRect(0,0,size,size);
    ctx.fillStyle = '#d1c9ae'; ctx.fillRect(0,0,size,5); ctx.fillRect(0,size-5,size,5);
    ctx.strokeStyle = '#b9b095'; ctx.lineWidth = 3; ctx.strokeRect(4,4,size-8,size-8);
    for (const [x,y] of positions) {
      ctx.fillStyle = '#26342c'; ctx.beginPath(); ctx.arc(x*size,y*size,9,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#47584a'; ctx.fillRect(x*size-2,y*size-5,4,3);
    }
  });
}
const faceMaterials = Array.from({ length: 6 }, (_, i) => new THREE.MeshStandardMaterial({ map: makeFaceTexture(i + 1), roughness: .48, metalness: .02 }));
const faceForMaterialOrder = [3, 4, 1, 6, 2, 5]; // BoxGeometry groups: +x, -x, +y, -y, +z, -z.
const dieMaterials = faceForMaterialOrder.map(face => faceMaterials[face - 1]);

const tableCanvasTexture = canvasTexture((ctx, size) => {
  ctx.fillStyle = '#155245'; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = '#18594a';
  for(let y=0;y<size;y+=8) for(let x=(y%16?0:8);x<size;x+=16) ctx.fillRect(x,y,2,2);
  ctx.strokeStyle='#80b798';ctx.lineWidth=3;ctx.strokeRect(9,9,size-18,size-18);
  ctx.strokeStyle='#437b62';ctx.lineWidth=1;ctx.strokeRect(14,14,size-28,size-28);
  ctx.fillStyle='#8cbaa0';ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText('FARKLE  /  CLUB',size/2,size*.79);
  ctx.fillStyle='#d8bd75';ctx.font='8px monospace';ctx.fillText('ROLL · SCORE · RISK',size/2,size*.85);
});
const tableBase = new THREE.Mesh(new THREE.BoxGeometry(14.8,.62,10.8), new THREE.MeshStandardMaterial({ color:0x5c4731, roughness:.52, metalness:.16 }));
tableBase.position.y=-.33; tableBase.receiveShadow=true; tableBase.castShadow=true; scene.add(tableBase);
const felt = new THREE.Mesh(new THREE.PlaneGeometry(14,10),new THREE.MeshStandardMaterial({map:tableCanvasTexture,roughness:.95}));
felt.rotation.x=-Math.PI/2;felt.position.y=.002;felt.receiveShadow=true;scene.add(felt);
const railMaterial=new THREE.MeshStandardMaterial({color:0x846d47,roughness:.43,metalness:.12});
for(const [x,z,sx,sz] of [[0,-5.27,14.8,.18],[0,5.27,14.8,.18],[-7.31,0,.18,10.5],[7.31,0,.18,10.5]]){
  const rail=new THREE.Mesh(new THREE.BoxGeometry(sx,.16,sz),railMaterial);rail.position.set(x,.055,z);rail.castShadow=true;scene.add(rail);
}

const physics = new DicePhysics(6);
const dice = Array.from({ length:6 },(_,id)=>{
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.9,.9,.9),dieMaterials);
  mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.dieId=id;scene.add(mesh);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.56,.7,4),new THREE.MeshBasicMaterial({color:0x80e6c7,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.028;ring.visible=false;scene.add(ring);
  return {id,face:0,mesh,ring,kept:false};
});
const effects = new ParticleEffects(scene);
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
  playerName:document.querySelector('#player-name-input'),botCount:document.querySelector('#bot-count'),
  players:document.querySelector('#player-list'),turnName:document.querySelector('#turn-name'),turnLabel:document.querySelector('#turn-label'),phase:document.querySelector('#phase-kicker'),
  turnScore:document.querySelector('#turn-score'),selectionCopy:document.querySelector('#selection-copy'),selectionScore:document.querySelector('#selection-score'),message:document.querySelector('#turn-message'),
  roll:document.querySelector('#roll-button'),rollLabel:document.querySelector('#roll-label'),keep:document.querySelector('#keep-button'),keepValue:document.querySelector('#keep-value'),bank:document.querySelector('#bank-button'),
  diceCount:document.querySelector('#dice-count-label'),timer:document.querySelector('#throw-timer'),round:document.querySelector('#round-number'),toast:document.querySelector('#toast'),loading:document.querySelector('#table-loading'),
  statWins:document.querySelector('#stat-wins'),statGames:document.querySelector('#stat-games'),statHigh:document.querySelector('#stat-high'),
};
let players=[];
let currentIndex=0;
let round=0;
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
    ui.overlayCopy.textContent=`Final score: ${formatNumber(winner?.score||0)}. Set up another table and take your luck for a second ride.`;
    ui.lobbyFields.hidden=true;ui.lobbyAction.innerHTML='PLAY ANOTHER GAME <span>→</span>';
  }else{
    ui.overlayKicker.textContent='LOCAL BOT LOBBY';ui.overlayTitle.textContent='One more roll?';
    ui.overlayCopy.textContent='Set the table, then see how long you can ride your luck. First player to 10,000 points wins.';
    ui.lobbyFields.hidden=false;ui.lobbyAction.innerHTML='SEAT THE TABLE <span>→</span>';
  }
}

function startMatch(){
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
  dice.forEach(die=>{die.face=0;die.kept=false;die.ring.visible=false;die.ring.material.color.set(0x80e6c7);});
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
    die.ring.visible=die.kept||selected||(phase==='selecting'&&valid);
    die.ring.position.x=die.mesh.position.x;die.ring.position.z=die.mesh.position.z;
    die.ring.material.color.set(die.kept?0xe7c87b:selected?0x7aecd0:0x5bbba3);
    die.ring.material.opacity=selected?.98:die.kept?.72:.3;
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
  physics.throwDice(activeIds);
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
    botChoice=chooseBotMove(activeIds.map(id=>dice[id]),turnPoints,player.score);
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
  effects.burst('#9ce3c0',72,new THREE.Vector3(0,.65,0));
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
  effects.burst('#ed957b',56,new THREE.Vector3(0,.55,0));
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
  const winner=players.find(item=>item.score>=10000);
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
  effects.burst(winner.isHuman?'#e7c87b':'#ed957b',110,new THREE.Vector3(0,.75,0));
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
  // Fit the whole board on narrow phones while keeping the camera perfectly top-down.
  const halfHeight=Math.max(5.65,7.55/aspect);
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
  renderer.render(scene,camera);
}
frame();
showLobby('new');

