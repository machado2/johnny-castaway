// Exercise every supplied original ADS scene through the original-derived VM.
// Rendering calls are recorded without painting, to isolate scheduler behavior.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {AdsPlayer,decodeAds} from '../web/dist/ads.js';
const assets=JSON.parse(fs.readFileSync(new URL('../web/dist/assets/original.json',import.meta.url)));
let total=0,maxFrames=0,failed=[];
for(const [file,data] of Object.entries(assets.ads)) {
  const scenes=decodeAds(data);
  for(const scene of scenes) {
    let seed=0x7ac1, sprites=0;
    const rng={below(n){seed=(seed*25173+13849)&65535;return n>0?seed%n:0;}};
    const gfx={buffers:Array.from({length:3},()=>new Uint8Array(640*480)),clipRect:null,
      capture(){},circle(){},copyRect(){},rect(){},restore(){},screen(){},sprite(){sprites++;}};
    const env={assets,gfx,rng,now:0,offset:[0,0],sounds:[]};
    const player=new AdsPlayer(assets,file,scene.id,env);
    assert.equal(player.done,false,'A newly requested ADS scene must start pending');
    let frames=0;
    for(;frames<20000&&!player.done;frames++) {
      env.now=frames*4;
      env.sounds.length=0;
      player.step(env);
    }
    if(!player.done) failed.push(player.diagnostic);
    total++;
    maxFrames=Math.max(maxFrames,frames);
    console.log(file,scene.id,scene.label,frames,sprites,player.done?'complete':'STILL ACTIVE');
  }
}
console.log(JSON.stringify({total,maxFrames,failed},null,2));
assert.equal(total,66);
assert.equal(failed.length,0,'Every shipped ADS scene must eventually complete');
