// Regression checks against the supplied original data and reconstructed TTM.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createActor, initTtm, interpretFrame} from '../web/dist/ttm.js';
import {Graphics, WIDTH, HEIGHT} from '../web/dist/graphics.js';

const assetsPath = new URL('../web/dist/assets/', import.meta.url);
const assets = JSON.parse(readFileSync(new URL('original.json', assetsPath), 'utf8'));
assets.pixels = new Uint8Array(gunzipSync(readFileSync(new URL('pixels.bin.gz', assetsPath))));
const environment = gfx => ({assets, gfx, now: 0, offset: [0, 0], sounds: [],
  rng: {below: n => { assert(n > 0); return 0; }}});

// Every original command must be accepted. Side effects must only fire on the
// initial render; original rendering can repaint a frame many times.
const calls = [];
const recording = {buffers: [0, 1, 2].map(() => new Uint8Array(WIDTH * HEIGHT)),
  clipRect: [0, 0, WIDTH, HEIGHT]};
for (const name of ['sprite', 'copyRect', 'rect', 'circle', 'capture', 'restore', 'screen'])
  recording[name] = (...args) => calls.push([name, ...args]);
const env = environment(recording);
let frameCount = 0, actorCount = 0;
for (const [name, resource] of Object.entries(assets.ttm)) {
  const callCount = calls.length;
  initTtm(env, name);
  assert.equal(calls.length, callCount, 'resource indexing must not execute frame 0');
  for (const frame of resource.frames) {
    if (frame[0]?.[0] !== 0x1111) continue;
    assert(createActor(name, frame[0][1][0], assets));
    actorCount++;
  }
  const actor = {resourceName: name, frame: 0, alreadyRendered: false};
  for (let frame = 0; frame < resource.frames.length; frame++) {
    actor.frame = frame;
    actor.alreadyRendered = false;
    assert(interpretFrame(actor, env).valid);
    const soundCount = env.sounds.length;
    actor.alreadyRendered = true;
    interpretFrame(actor, env);
    assert.equal(env.sounds.length, soundCount, `${name}:${frame} repeated sound`);
    frameCount++;
  }
}
assert.equal(frameCount, 6631);
assert.equal(actorCount, 611);
assert.equal(env.sounds.length, 535);
const fire = createActor('FIRE.TTM', 7, assets);
fire.frame = 26;
assert.equal(interpretFrame(fire, env).nextFrame, fire.start, 'deferred label loop');
const invalidName = '__INVALID_OPCODE_TEST__';
assets.ttm[invalidName] = {frames: [[[0xdead, []]]]};
assert.throws(() => interpretFrame({resourceName: invalidName, frame: 0}, env), /Unknown original TTM opcode/);
delete assets.ttm[invalidName];

// Actual original fullscreen scene transitions. F01F commits the SCR to the
// persistent background immediately, then transient sprites paint working.
const transitions = [
  ['SJWORK.TTM', 'JOFFICE.SCR'],
  ['SJMSUZY.TTM', 'SUZBEACH.SCR'],
  ['SUZYCITY.TTM', 'SUZBEACH.SCR'],
  ['THEEND.TTM', 'THEEND.SCR'],
];
const transitionResults = [];
for (const [name, screen] of transitions) {
  const gfx = new Graphics(assets), local = environment(gfx);
  const actor = {resourceName: name, frame: 1, alreadyRendered: false};
  interpretFrame(actor, local); // Original explicit resource-loading entry.
  const expected = new Graphics(assets);
  expected.buffers[0].set(gfx.buffers[1]);
  expected.screen(screen, 0);
  actor.frame = 2;
  interpretFrame(actor, local);
  assert.deepEqual(gfx.buffers[0], expected.buffers[0], `${name} did not persist its SCR`);
  assert(gfx.buffers[1].some((v, i) => v !== gfx.buffers[0][i]),
    `${name} must draw transient sprites after committing the background`);
  const persistent = gfx.buffers[0].slice();
  gfx.copyRect(0, 1, 0, 0, WIDTH, HEIGHT); // Director's next-pass restore.
  actor.frame = 3;
  interpretFrame(actor, local);
  assert.deepEqual(gfx.buffers[0], persistent, `${name} changed background on following frame`);
  // An arbitrary untouched corner proves replaying F01F does not reload SCR.
  gfx.buffers[0][0] ^= 15;
  const changed = gfx.buffers[0][0];
  actor.frame = 2;
  actor.alreadyRendered = true;
  interpretFrame(actor, local);
  assert.equal(gfx.buffers[0][0], changed, `${name} replayed its screen-load side effect`);
  transitionResults.push({ttm: name, screen, persistent: true, transientSpritesSeparate: true});
}
console.log(JSON.stringify({frames: frameCount, actors: actorCount, soundEvents: env.sounds.length,
  frame0NotImplicit: true, unknownOpcodeRejected: true, transitions: transitionResults}, null, 2));
