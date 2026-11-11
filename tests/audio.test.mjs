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

test('a tap during startup unlocks audio before the sound manifest arrives',async t=>{
  mockAudio(t);
  const audio=new OriginalAudio();
  let fetches=0;
  t.mock.method(globalThis,'fetch',async()=>{fetches++;return response();});
  await audio.unlock();
  const context=audio.context;
  assert.equal(fetches,0);
  await audio.load({1:'1.wav',2:'2.wav'});
  assert.strictEqual(audio.context,context,'keep the context authorized by the early tap');
  assert.equal(audio.bank.size,2,'load sounds without requiring a second tap');
  await audio.unlock();
  assert.equal(fetches,2);
});

test('loading the manifest before a tap leaves audio creation to the gesture',async t=>{
  mockAudio(t);
  const audio=new OriginalAudio();
  t.mock.method(globalThis,'fetch',async()=>response());
  await audio.load({1:'1.wav'});
  assert.equal(audio.context,null);
  await audio.unlock();
  assert.equal(audio.bank.size,1);
});

test('each gesture retries resume synchronously while a previous attempt is blocked',async t=>{
  mockAudio(t);
  let calls=0,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const audio=new OriginalAudio({1:'1.wav'});
  audio.context=new AudioContext();audio.context.state='suspended';
  audio.context.resume=()=>{
    calls++;
    if(calls===2){audio.context.state='running';release();}
    return pending;
  };
  t.mock.method(globalThis,'fetch',async()=>response());
  const first=audio.unlock();
  assert.equal(calls,1,'resume must run before returning from the first gesture');
  const second=audio.unlock();
  assert.equal(calls,2,'a blocked attempt must not swallow the next gesture');
  await Promise.all([first,second]);
  assert.equal(audio.context.state,'running');
  assert.equal(audio.bank.size,1);
});

test('audio resumes after a mobile interruption without reloading the bank',async t=>{
  mockAudio(t);
  let fetches=0;
  t.mock.method(globalThis,'fetch',async()=>{fetches++;return response();});
  const audio=new OriginalAudio({1:'1.wav'});
  await audio.unlock();
  let resumes=0;
  audio.context.resume=async()=>{resumes++;audio.context.state='running';};
  for(const state of ['interrupted','suspended']){
    audio.context.state=state;
    await audio.resume();
    assert.equal(audio.context.state,'running');
  }
  await audio.resume();
  assert.equal(resumes,2);
  assert.equal(fetches,1);
});
