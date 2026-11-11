import test from 'node:test';
import assert from 'node:assert/strict';
import {OriginalAudio} from '../web/dist/audio.js';

function mockAudio(t, decode = async bytes => ({bytes})) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  globalThis.AudioContext=class {
    state='running';
    async resume() {}
    decodeAudioData(bytes) { return decode(bytes); }
  };
  t.after(()=>{
    if(previous)Object.defineProperty(globalThis,'AudioContext',previous);
    else delete globalThis.AudioContext;
  });
}
const response=()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});

for(const failure of ['network','http','decode']) {
  test(`audio retries a failed ${failure} load without reloading successful sounds`,async t=>{
    const attempts=new Map();let decodes=0;
    mockAudio(t,async bytes=>{
      if(failure==='decode' && ++decodes===1)throw new Error('Temporary decode failure');
      return {bytes};
    });
    t.mock.method(globalThis,'fetch',async url=>{
      const file=url.pathname.split('/').at(-1),attempt=(attempts.get(file)||0)+1;
      attempts.set(file,attempt);
      if(file==='1.wav' && attempt===1) {
        if(failure==='network')throw new Error('Temporary network failure');
        if(failure==='http')return {ok:false};
      }
      return response();
    });
    const audio=new OriginalAudio({1:'1.wav',2:'2.wav'});
    await assert.rejects(audio.unlock());
    const loaded=audio.bank.get(2);
    assert(loaded,'the successful sound should remain available');
    await audio.unlock();
    assert.equal(audio.bank.size,2);
    assert.strictEqual(audio.bank.get(2),loaded);
    assert.equal(attempts.get('1.wav'),2);
    assert.equal(attempts.get('2.wav'),1);
    await audio.unlock();
    assert.equal(attempts.get('1.wav'),2,'a successful bank should not be fetched again');
  });
}

test('repeated audio gestures share pending loads even when one file fails early',async t=>{
  mockAudio(t);
  let release;const delayed=new Promise(resolve=>{release=resolve;});
  const attempts=new Map();
  t.mock.method(globalThis,'fetch',async url=>{
    const file=url.pathname.split('/').at(-1),attempt=(attempts.get(file)||0)+1;
    attempts.set(file,attempt);
    if(file==='1.wav' && attempt===1)throw new Error('Temporary failure');
    if(file==='2.wav')await delayed;
    return response();
  });
  const audio=new OriginalAudio({1:'1.wav',2:'2.wav'});
  const first=audio.unlock().catch(error=>error);
  await new Promise(resolve=>setImmediate(resolve));
  const second=audio.unlock().catch(error=>error);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...attempts.values()],[1,1]);
  release();
  assert((await first) instanceof Error);
  assert((await second) instanceof Error);
  await audio.unlock();
  assert.deepEqual([...attempts.values()],[2,1]);
  assert.equal(audio.bank.size,2);
});
