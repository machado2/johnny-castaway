// Integration checks against the original extracted catalogue and native tables.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
import {Director,originalRandom} from '../web/dist/story.js';
import {Graphics} from '../web/dist/graphics.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name));
const assets=JSON.parse(read('web/dist/assets/original.json'));
assets.story=JSON.parse(read('analysis/story-tables.json'));
assets.pixels=new Uint8Array(zlib.gunzipSync(read('web/dist/assets/pixels.bin.gz')));
const date=new Date(2026,10,10,12);
const silentGraphics=()=>({buffers:[0,1,2].map(()=>new Uint8Array(640*480)),sprite(){},screen(){},clear(){},copyRect(){}});

// A different millisecond within one second must produce the same seed stream.
const seedA=new Director(assets,silentGraphics(),{},1770000000100);
const seedB=new Director(assets,silentGraphics(),{},1770000000900);
assert.deepEqual(Array.from({length:32},()=>seedA.rng()),Array.from({length:32},()=>seedB.rng()));
const raw=originalRandom(assets.story.random,0),r=assets.story.random;
assert.equal(raw(),(r.state_u16[r.index_a]+r.state_u16[r.index_b])&65535);

const d=new Director(assets,silentGraphics(),{},1234000);
let routes=0,maxRouteTicks=0;
for(let from=1;from<=6;from++)for(let to=1;to<=6;to++)for(let direction=0;direction<8;direction++){
  d.walk.set(from,direction);let reached=false,ticks=0;
  for(;ticks<5000;ticks++){d.tick();if(d.walk.advance(to,7)){reached=true;break;}}
  assert(reached,`Native route ${from}->${to} from direction ${direction} did not finish`);
  assert.equal(d.walk.location,to);assert.equal(d.walk.direction,7);
  ++routes;maxRouteTicks=Math.max(maxRouteTicks,ticks);
}

let batches=0;
for(let slot=0;slot<16;slot++)for(let iteration=0;iteration<15;iteration++){
  d.build(new Date(2026,10,10,9+Math.floor(slot/2),(slot%2)*30));
  assert.equal(d.slot,slot);
  assert(d.plan.length>0&&d.plan.length<=299);
  assert(d.plan.every(s=>s.sequence&&assets.story.scenes.includes(s)));
  assert(d.plan.at(-1).flags&4);
  assert(d.plan[0].flags&1 || d.plan.length===1);
  ++batches;
}

// Persisted chapter progress is unlocked by calendar changes, not elapsed frames.
const config={lastDate:'2026-11-09',storyDay:2,maxStoryDay:1};
const calendar=new Director(assets,silentGraphics(),config,0);
assert.strictEqual(calendar.config,config);
calendar.updateCalendar(new Date(2026,10,10,9));
assert.equal(calendar.day,2);assert.equal(calendar.maxDay,2);assert.equal(calendar.slot,0);
calendar.updateCalendar(new Date(2026,10,11,15));
assert.equal(calendar.maxDay,2);assert.equal(calendar.slot,12);
config.storyDay=12;config.maxStoryDay=11;
calendar.updateCalendar(new Date(2026,10,12,9));
assert.equal(calendar.day,1);assert.equal(calendar.maxDay,1);
for(const [month,day,mode] of [[10,29,1],[10,28,0],[12,23,2],[12,26,0],[12,29,3],[1,1,3],[3,15,4],[3,18,0]]){
  calendar.updateCalendar(new Date(2026,month-1,day));assert.equal(calendar.holiday,mode);
}
const restored=new Director(assets,silentGraphics(),JSON.parse(JSON.stringify(config)),0);
assert.deepEqual(restored.config,config);

// Preserve documented original out-of-range draws as safe no-ops. These values
// occur in the supplied TTM streams or after original replay suppresses a load.
// Original loader's [frameCount] terminator is NULL; above-count reads were unsafe.
const originalInvalid=new Set(['SJGFTASK.BMP:41','SMDATE11.BMP:31','SMDATE11.BMP:30',
  'SLEVEJC2.BMP:17','GJNAT1.BMP:27']);
const originalNullFrame=request=>{
  const split=request.lastIndexOf(':'),name=request.slice(0,split),index=Number(request.slice(split+1));
  return split>0&&assets.images[name]&&index===assets.images[name].length;
};
const gfx=new Graphics(assets);
const director=new Director(assets,gfx,{storyDay:1,maxStoryDay:1,lastDate:'2026-11-10'},1770000000000);
const report={routes,maxRouteTicks,batches,calendar:'passed',adsLifecycle:'pending',scenes:[],missing:[],failures:[]};
// Same-family scenes must retain module/actor state; a family change unloads it.
const first=assets.story.scenes.find(s=>s.ads_file==='STAND.ADS'&&s.sequence===1);
const second=assets.story.scenes.find(s=>s.ads_file==='STAND.ADS'&&s.sequence===2);
const third=assets.story.scenes.find(s=>s.ads_file==='ACTIVITY.ADS');
director.playScene(first.index,date);director.plan=[first,second,third];
let firstModule=null,secondModule=null,thirdModule=null,firstResources=null,secondResources=null,thirdResources=null;
for(let frame=0;frame<5000&&!thirdModule;frame++){
  for(let t=0;t<4;t++)director.tick();director.step(date);director.sounds.length=0;
  if(director.player&&director.index===0){firstModule=director.player;firstResources=director.env.ttmResources;}
  if(director.player&&director.index===1){secondModule=director.player;secondResources=director.env.ttmResources;}
  if(director.player&&director.index===2){thirdModule=director.player;thirdResources=director.env.ttmResources;}
}
assert(firstModule&&secondModule&&thirdModule,'Catalogue family-transition fixtures must start');
assert.strictEqual(firstModule,secondModule);assert.strictEqual(firstResources,secondResources);
assert.notStrictEqual(secondModule,thirdModule);assert.notStrictEqual(secondResources,thirdResources);
report.adsLifecycle='passed';
assert.equal(assets.story.scenes.length,80);
assert.equal(director.playScene(0,date),false); // Inert group-200 dummy.
for(let index=1;index<assets.story.scenes.length;index++){
  director.playScene(index,date);let finished=false;const beforeMissing=new Set(gfx.missing);
  const baseTicks=director.now;
  for(let frames=0;frames<16000;frames++){
    const wanted=baseTicks+Math.floor((frames+1)*55/16);
    while(director.now<wanted)director.tick();
    director.step(date);director.sounds.length=0;
    if(director.index===1){
      const scene=assets.story.scenes[index];
      report.scenes.push({index,ads:scene.ads_file,sequence:scene.sequence,frames:frames+1,
        originalInvalidDraws:[...gfx.missing].filter(x=>!beforeMissing.has(x))});
      finished=true;break;
    }
  }
  if(!finished)report.failures.push({index,scene:director.current,playerSteps:director.player?.steps});
}
report.missing=[...gfx.missing];report.maxFrames=Math.max(...report.scenes.map(s=>s.frames));
fs.writeFileSync(path.join(root,'analysis/story-runtime-verification.json'),JSON.stringify(report,null,2)+'\n');
assert.deepEqual(report.failures,[],'Original catalogue scene did not terminate');
assert.deepEqual(report.missing.filter(x=>!originalInvalid.has(x)&&!originalNullFrame(x)),[],'Unexpected missing original resource');
assert.equal(report.scenes.length,79);
console.log(`Story: ${routes} native routes, ${batches} plans, calendar/persistence checks, ${report.scenes.length} complete real-renderer scenes; ${report.missing.length} documented original invalid draws.`);
