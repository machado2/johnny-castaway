import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {Graphics} from '../web/dist/graphics.js';
const folder=new URL('../web/dist/assets/',import.meta.url);
const data=JSON.parse(fs.readFileSync(new URL('original.json',folder)));
data.pixels=new Uint8Array(gunzipSync(fs.readFileSync(new URL('pixels.bin.gz',folder))));

test('export is linked to the three exact user supplied files',()=>{
  for(const [name,hash] of Object.entries(data.sources)) {
    const original=fs.readFileSync(new URL('../'+name,import.meta.url));
    assert.equal(crypto.createHash('sha256').update(original).digest('hex'),hash);
  }
  assert.equal(Object.keys(data.images).length,127);
  assert.equal(Object.values(data.images).reduce((n,v)=>n+v.length,0),2402);
  assert.equal(Object.keys(data.ttm).length,41);
  assert.equal(Object.keys(data.ads).length,10);
  assert.equal(Object.keys(data.sounds).length,23);
  for(const frames of Object.values(data.images))for(const f of frames)
    assert(f.offset>=0 && f.offset+f.w*f.h<=data.pixels.length);
});

test('original NE sound names map to resource IDs, including gaps',()=>{
  assert.equal(data.sounds[10],'10.wav');
  assert.equal(data.sounds[11],undefined);
  assert.equal(data.sounds[12],'11.wav');
  assert.equal(data.sounds[13],undefined);
  assert.equal(data.sounds[25],'23.wav');
});

test('sprite transparency, negative clipping and original mirror flag',()=>{
  const gfx=new Graphics({images:{TEST:[{w:3,h:2,offset:0}]},pixels:new Uint8Array([0,1,2,3,4,5]),palette:data.palette});
  gfx.clear(7);gfx.sprite('TEST',0,-1,0);
  assert.deepEqual([...gfx.buffers[1].subarray(0,3)],[1,2,7]);
  assert.deepEqual([...gfx.buffers[1].subarray(640,643)],[4,5,7]);
  gfx.clear(7);gfx.sprite('TEST',0,0,0,2);
  assert.deepEqual([...gfx.buffers[1].subarray(0,3)],[2,1,7]);
  gfx.clear(7);gfx.clipRect=[1,0,2,1];gfx.sprite('TEST',0,0,0);
  assert.deepEqual([...gfx.buffers[1].subarray(0,3)],[7,1,7]);
  assert.equal(gfx.buffers[1][641],7);
});

test('overlapping opaque copies preserve their source pixels',()=>{
  const gfx=new Graphics(data);gfx.buffers[1].set([1,2,3,4,5],0);
  gfx.copyRect(1,1,0,0,4,1,1,0);
  assert.deepEqual([...gfx.buffers[1].subarray(0,5)],[1,1,2,3,4]);
});

test('every original circle diameter has the Windows GDI coverage mask',()=>{
  for(const ttm of Object.values(data.ttm))for(const frame of ttm.frames)for(const [op,args] of frame) {
    if(op!==0xa404)continue;
    const d=Math.floor(args[3]/2)*2;
    assert.equal(data.circleMasks[d].length,d*d);
    assert(data.circleMasks[d].includes(1));assert(data.circleMasks[d].includes(2));
  }
});

test('page contains exactly one canvas and no visible controls',()=>{
  const html=fs.readFileSync(new URL('../web/dist/index.html',import.meta.url),'utf8');
  assert.equal((html.match(/<canvas\b/g)||[]).length,1);
  assert(!/<(?:button|input|header|footer|nav|h[1-6]|video|iframe)\b/i.test(html));
});
