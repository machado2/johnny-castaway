import {Graphics,WIDTH,HEIGHT} from './graphics.js';
import {Director} from './story.js';
import {OriginalAudio} from './audio.js';

const canvas=document.querySelector('canvas');
const context=canvas.getContext('2d',{alpha:false});
const stage=document.createElement('canvas');stage.width=WIDTH;stage.height=HEIGHT;
const stageContext=stage.getContext('2d',{alpha:false});
const frame=stageContext.createImageData(WIDTH,HEIGHT);
const STORAGE_KEY='scrantic.web.original.v1';
let director,gfx,audio,lastTime=0,elapsed=0,nextTick=16,nextStep=55;
let lastSaved='',lastSaveAt=0,stopped=false,ready=false;

function resize(){
  const dpr=Math.min(devicePixelRatio||1,3);
  canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);
  context.imageSmoothingEnabled=false;
  if(ready)present();
}
function present(){
  gfx.rgba(2,frame.data);stageContext.putImageData(frame,0,0);
  context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);
  const scale=Math.min(canvas.width/WIDTH,canvas.height/HEIGHT);
  const w=WIDTH*scale,h=HEIGHT*scale;
  context.drawImage(stage,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
}
function save(){
  if(!director)return;
  try{
    const serialized=JSON.stringify(director.config);
    if(serialized!==lastSaved){localStorage.setItem(STORAGE_KEY,serialized);lastSaved=serialized;}
  }catch{/* Storage can be unavailable in private browsing; animation continues. */}
}
function loop(time){
  if(stopped)return;
  try{
    if(!lastTime)lastTime=time;
    // Hidden tabs suspend the presentation; return without fast-forwarding hours.
    elapsed+=Math.min(time-lastTime,250);lastTime=time;
    let drawn=false;
    while(nextStep<=elapsed){
      while(nextTick<=nextStep){director.tick();nextTick+=16;}
      director.step(new Date());nextStep+=55;drawn=true;
      const sounds=director.env.sounds.splice(0);
      for(const id of sounds)audio.play(id);
    }
    if(drawn)present();
    if(time-lastSaveAt>10000){save();lastSaveAt=time;}
    requestAnimationFrame(loop);
  }catch(error){stopped=true;console.error(error);canvas.dataset.error=String(error);save();}
}

addEventListener('resize',resize);
addEventListener('pagehide',()=>{save();audio?.stop();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){save();audio?.stop();}
  lastTime=0;
});
async function unlockAudio(){
  try{await audio?.unlock();}catch(error){console.error('Original audio:',error);}
}
canvas.addEventListener('pointerdown',unlockAudio);
canvas.addEventListener('keydown',unlockAudio);
resize();

try{
  const read=async name=>{
    const response=await fetch(new URL('./assets/'+name,import.meta.url));
    if(!response.ok)throw new Error('Não foi possível carregar '+name);
    return response;
  };
  const [dataResponse,storyResponse,pixelResponse]=await Promise.all([
    read('original.json'),read('story.json'),read('pixels.bin.gz')
  ]);
  const assets=await dataResponse.json();assets.story=await storyResponse.json();
  assets.pixels=new Uint8Array(await new Response(pixelResponse.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  let config={};try{config=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');}catch{}
  gfx=new Graphics(assets);audio=new OriginalAudio(assets.sounds);
  gfx.screen('INTRO.SCR',2);ready=true;present();
  director=new Director(assets,gfx,config,Date.now());
  canvas.dataset.ready='true';
  // Read-only diagnostics have no visible UI and do not change original behavior.
  Object.defineProperty(window,'scrantic',{value:Object.freeze({
    get status(){return {ticks:director.env.now,scene:director.current,config:{...director.config},missing:[...gfx.missing]};}
  })});
  requestAnimationFrame(loop);
}catch(error){
  stopped=true;console.error(error);canvas.dataset.error=String(error);
  context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#fff';context.font='16px monospace';
  context.fillText('Não foi possível carregar a animação.',24,40);
}
