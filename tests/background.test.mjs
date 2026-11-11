import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Director} from '../web/dist/story.js';
import {Graphics} from '../web/dist/graphics.js';

const folder=new URL('../web/dist/assets/',import.meta.url);
const assets=JSON.parse(fs.readFileSync(new URL('original.json',folder)));
assets.story=JSON.parse(fs.readFileSync(new URL('story.json',folder)));
assets.pixels=new Uint8Array(gunzipSync(fs.readFileSync(new URL('pixels.bin.gz',folder))));
function background(config={},state={}) {
  const gfx=new Graphics(assets),d=new Director(assets,gfx,{waves:false,...config},0);
  Object.assign(d,{mode:0,slot:0,variant:-1,placement:-1,holiday:0,showHoliday:false,
    hideRaft:false,hideWaves:false},state);
  d.setupBackground();
  return d;
}

test('seed-zero background follows the original ocean/variant/x/y draw order',()=>{
  // Fixed oracle from seg03:01f5, 0226 and 0233 with the extracted seed table.
  const d=background();
  assert.equal(d.variant,1);
  assert.deepEqual(d.origin,[-121,24]);
  const ocean=new Graphics(assets);ocean.screen('OCEAN02.SCR');
  // The left ocean strip is outside the island, clouds and particle bounds.
  assert.deepEqual(d.gfx.buffers[0].subarray(200*640,200*640+40),
    ocean.buffers[0].subarray(200*640,200*640+40));
  for(const [config,state] of [[{},{slot:12}],[{background:false},{}],[{},{mode:2}]]) {
    const night=background(config,state);
    assert.equal(night.variant,1);
    assert.deepEqual(night.origin,[-70,-16],'no ocean draw should be consumed for a fixed screen');
  }
});

test('clouds persist in the background without movement or random draws between setups',()=>{
  const d=background(),gfx=d.gfx;
  const ocean=new Graphics(assets);ocean.screen('OCEAN02.SCR');
  const sky=gfx.buffers[0].slice(0,140*640);
  assert.notDeepEqual(sky,ocean.buffers[0].slice(0,140*640),'setup should paint the clouds into the persistent background');
  const clouds=structuredClone(d.clouds);
  const unexpectedRandom=()=>{throw new Error('Regular ambient redraw consumed a cloud random number');};
  unexpectedRandom.int=unexpectedRandom.percent=unexpectedRandom;
  d.rng=unexpectedRandom;
  for(let i=0;i<200;i++) {
    d.tick();gfx.copyRect(0,1,0,0,640,480);d.ambience();d.present();
  }
  assert.deepEqual(d.clouds,clouds);
  assert.deepEqual(gfx.buffers[2].subarray(0,140*640),sky);
  // A TTM screen replacement must not be overpainted with the old clouds.
  gfx.screen('NIGHT.SCR',0);const night=gfx.buffers[0].slice(0,140*640);
  gfx.copyRect(0,1,0,0,640,480);d.ambience();d.present();
  assert.deepEqual(gfx.buffers[2].subarray(0,140*640),night);
});

test('disabled clouds and fullscreen scenes do not bake clouds into the background',()=>{
  const d=background({clouds:false}),ocean=new Graphics(assets);
  ocean.screen('OCEAN02.SCR');
  assert.deepEqual(d.gfx.buffers[0].subarray(0,140*640),ocean.buffers[0].subarray(0,140*640));
  const full=background({}, {mode:2});
  assert(full.gfx.buffers.every(buffer=>buffer.every(pixel=>pixel===5)));
});
