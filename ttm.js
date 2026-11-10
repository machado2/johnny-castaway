// TTM bytecode interpreted directly from original SCRANTIC.SCR seg11/seg12.
// Exact source addresses and the complete original opcode inventory are in
// analysis/ttm-findings.md. This module does not emulate a CPU or Windows.
const WIDTH = 640, HEIGHT = 480;
const BUFFER = [2, 1, 0]; // Original numbers: front, working, background.
const FULL_CLIP = [0, 0, WIDTH, HEIGHT];

function stateFor(env, name) {
  env.ttmResources ??= new Map();
  let state = env.ttmResources.get(name);
  if (!state) {
    state = { bitmapSlots: Array(6).fill(null), savedRegions: new Map(),
      paletteSlots: Array(6).fill(null), initialized: false, loadFlags: 0 };
    env.ttmResources.set(name, state);
  }
  return state;
}

function newContext() {
  return { bitmapSlot: 0, paletteSlot: 0, regionSlot: 0,
    colors: [15, 15], clipRect: null, x: 0, y: 0, dx: 0, dy: 0 };
}

function findLabel(resource, label, entryOnly = false) {
  if (!resource) return -1;
  return resource.frames.findIndex(frame => {
    const first = frame[0];
    return first && (first[0] === 0x1111 || (!entryOnly && first[0] === 0x1101))
      && first[1][0] === label;
  });
}

export function createActor(resourceName, sceneId, assets) {
  const start = findLabel(assets.ttm[resourceName], sceneId, true);
  if (start < 0) return null;
  return { resourceName, ttm: resourceName, sceneId, start, frame: start,
    alreadyRendered: false, first: true, delay: 0, graphicsContext: newContext() };
}

export function createClip(env, resourceName, sceneId) {
  initTtm(env, resourceName);
  return createActor(resourceName, sceneId, env.assets);
}

// Original load preindexes frames but does not execute frame 0. ADS sequences
// begin at 1111 labels and explicitly load their required bitmap slots.
export function initTtm(env, name) {
  const resource = env.assets.ttm[name];
  if (!resource) throw new Error(`Missing original TTM resource: ${name}`);
  const state = stateFor(env, name);
  if (state.initialized) return state;
  state.initialized = true;
  return state;
}

function pixel(gfx, x, y, color) {
  x = Math.trunc(x); y = Math.trunc(y);
  const c = gfx.clipRect || FULL_CLIP;
  if (x >= Math.max(0, c[0]) && y >= Math.max(0, c[1]) &&
      x < Math.min(WIDTH, c[2]) && y < Math.min(HEIGHT, c[3])) {
    gfx.buffers[1][y * WIDTH + x] = color & 255;
  }
}

function line(gfx, x0, y0, x1, y1, color) {
  [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.trunc);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  // GDI LineTo paints up to, but excludes, the final endpoint.
  while (x0 !== x1 || y0 !== y1) {
    pixel(gfx, x0, y0, color);
    const twice = error * 2;
    if (twice >= dy) { error += dy; x0 += sx; }
    if (twice <= dx) { error += dx; y0 += sy; }
  }
}

function copyOriginalRect(gfx, source, target, x, y, width, height) {
  if (!width || !height || source === target) return;
  // Original 08:06ff expands both ends to its byte-oriented damage grid.
  const remainder = x % 8;
  x -= remainder;
  width += remainder;
  width += 8 - (width % 8);
  gfx.copyRect(source, target, x, y, width, height);
}

function executeFrame(actor, env, shared, depth) {
  const name = actor.resourceName || actor.ttm;
  const resource = env.assets.ttm[name];
  const frame = resource?.frames[actor.frame];
  const result = { valid: !!frame, complete: false, done: false,
    nextFrame: null, delay: null };
  if (!frame) return result;
  if (depth > 32) throw new Error(`Original TTM recursion exceeded 32 frames: ${name}`);
  const first = !actor.alreadyRendered;
  const context = actor.graphicsContext ??= newContext();
  const gfx = env.gfx;
  const oldClip = gfx.clipRect;
  gfx.clipRect = context.clipRect || FULL_CLIP;
  const offsets = env.offset || [0, 0];
  const ox = offsets[0] || 0, oy = offsets[1] || 0;
  try {
    for (const [opcode, raw] of frame) {
      const args = Array.isArray(raw) ? raw.slice() : raw;
      if (Array.isArray(args) && ((opcode >= 0xa000 && opcode <= 0xafff) ||
          opcode === 0x4004 || opcode === 0x4204)) {
        if (![0xa601, 0xaf1f, 0xaf2f].includes(opcode)) {
          args[0] += ox; args[1] += oy;
          if (opcode === 0xa0a4 || opcode === 0x4004) {
            args[2] += ox; args[3] += oy;
          }
        }
      }
      switch (opcode) {
        case 0x0ff0: return result;
        case 0x0080:
          if (first) shared.bitmapSlots[context.bitmapSlot] = null;
          break;
        case 0x0110: result.complete = result.done = true; break;
        case 0x1021: result.delay = args[0]; break;
        case 0x1051: context.bitmapSlot = args[0]; break;
        case 0x1061: context.paletteSlot = args[0]; break;
        case 0x1101: case 0x1111: break; // Labels are indexed, not executed.
        case 0x1121: context.regionSlot = args[0]; break;
        case 0x1201: {
          const target = findLabel(resource, args[0]);
          if (target >= 0) result.nextFrame = target;
          break;
        }
        case 0x2002: context.colors = [args[0] & 255, args[1] & 255]; break;
        case 0x2012: if (first) shared.loadFlags = 1; break;
        case 0x2022:
          if (first) result.delay = args[0] + env.rng.below(args[1] - args[0]);
          break;
        case 0x4004:
          context.clipRect = [args[0], args[1], args[2] + 1, args[3] + 1];
          gfx.clipRect = context.clipRect;
          break;
        case 0x4204:
          if (first) copyOriginalRect(gfx, 1, 0, ...args);
          break;
        case 0x4214: break; // Empty original Windows handler, 12:0860.
        case 0xa002: pixel(gfx, args[0], args[1], context.colors[0]); break;
        case 0xa054:
          if (first && args[2] > 0 && args[3] > 0 &&
              args[0] + args[2] <= WIDTH && args[1] + args[3] <= HEIGHT) {
            const slot = `${name}:0`;
            gfx.capture(slot, ...args, 1);
            shared.savedRegions.set(0, { slot, x: args[0], y: args[1] });
          }
          break;
        case 0xa064: {
          const saved = shared.savedRegions.get(0);
          if (first && saved) gfx.restore(saved.slot, saved.x, saved.y, 1);
          break;
        }
        case 0xa0a4: line(gfx, ...args, context.colors[0]); break;
        case 0xa104: gfx.rect(...args, ...context.colors, 1); break;
        case 0xa404: gfx.circle(args[0], args[1], args[3], ...context.colors, 1); break;
        case 0xa504: case 0xa524: {
          const bitmap = shared.bitmapSlots[args[3]];
          if (bitmap) gfx.sprite(bitmap, args[2], args[0], args[1], (opcode >> 4) & 15);
          break;
        }
        case 0xa601: break; // Original uses a separate damage-copy queue.
        case 0xb606:
          if (first) copyOriginalRect(gfx, BUFFER[args[4]] ?? 1,
            BUFFER[args[5]] ?? 1, args[0], args[1], args[2], args[3]);
          break;
        case 0xc051:
          if (first && args[0] >= 1 && args[0] <= 25) (env.sounds ??= []).push(args[0]);
          break;
        case 0xf01f:
          if (first) {
            gfx.screen(raw, 1);
            // 12:06d8 -> 11:0b31 -> 11:0b74 commits the full working
            // screen to background immediately, before later sprites draw.
            gfx.copyRect(1, 0, 0, 0, WIDTH, HEIGHT);
            env.fullRedraw = true;
          }
          break;
        case 0xf02f:
          if (first) {
            shared.bitmapSlots[context.bitmapSlot] = raw;
            shared.loadFlags = 0;
          }
          break;
        case 0xf05f:
          if (first) shared.paletteSlots[context.paletteSlot] = raw;
          break;
        // These original handlers are included for diagnostic/manual playback;
        // no current original TT3 stream contains them.
        case 0xa514: case 0xa534: case 0xa506: case 0xa516: case 0xa526: case 0xa536: {
          const bitmap = shared.bitmapSlots[args[3]];
          if (bitmap) gfx.sprite(bitmap, args[2], args[0], args[1],
            (opcode >> 4) & 15, args[4], args[5]);
          break;
        }
        case 0x3003: {
          const target = findLabel(resource, args[2]);
          if (target >= 0) {
            const previousOffset = env.offset;
            env.offset = [ox + args[0], oy + args[1]];
            try {
              const nested = executeFrame({ ...actor, frame: target }, env, shared, depth + 1);
              if (nested.delay !== null) result.delay = nested.delay;
              if (nested.nextFrame !== null) result.nextFrame = nested.nextFrame;
            } finally { env.offset = previousOffset; }
          }
          break;
        }
        default:
          throw new Error(`Unknown original TTM opcode 0x${opcode.toString(16)} in ${name}, frame ${actor.frame}`);
      }
    }
    return result;
  } finally { gfx.clipRect = oldClip; }
}

export function interpretFrame(actor, env) {
  const name = actor.resourceName || actor.ttm;
  const state = initTtm(env, name);
  return executeFrame(actor, env, state, 0);
}

export function renderTTM(env, clip) {
  if (typeof clip.first === 'boolean') clip.alreadyRendered = !clip.first;
  return interpretFrame(clip, env);
}
