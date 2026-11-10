// Derived from SCRANTIC.SCR segment 10; source addresses in analysis/ads-findings.md.
import {createActor, interpretFrame, initTtm} from './ttm.js';

const signed = n => n & 0x8000 ? n - 0x10000 : n;
const wordLengths = new Map([
  ...[0x2000,0x2005].map(x=>[x,5]),
  ...[0x2010,0x2015,0x2020,0x4000,0x4010].map(x=>[x,4]),
  ...[0x1010,0x1020,0x1030,0x1040,0x1050,0x1060,0x1070,
      0x1310,0x1320,0x1330,0x1340,0x1350,0x1360,0x1370].map(x=>[x,3]),
  ...[0xf010,0xf200,0xf210,0x1080,0x1380,0x1390,0x13a0,0x13a1,
      0x13b0,0x13b1,0x13c0,0x13c1,0x3020].map(x=>[x,2]),
]);
const isWhile = op => op >= 0x1010 && op <= 0x1080 && (op & 15) === 0;
const isIf = op => op >= 0x1310 && op <= 0x13c1 &&
  ([0,1].includes(op & 15)) && !(op & 1 && op < 0x13a0);
const isCondition = op => isWhile(op) || isIf(op);
const key = (resource, scene) => `${resource}:${scene}`;

/** Decode fixed-size original instructions and match nested control structures. */
export function decodeAds(data) {
  const scenes = [];
  let pc = 0;
  while (pc < data.words.length) {
    const id = data.words[pc++];
    const scene = {id, label:data.tags?.[id] ?? String(id), start:pc,
      code:new Map(), mode:8, savedWhile:null, count:0, references:new Set()};
    scenes.push(scene);
    let ended = false;
    while (pc < data.words.length) {
      const op = data.words[pc], len = wordLengths.get(op) ?? 1;
      if (pc + len > data.words.length) throw new Error(`Truncated ADS opcode ${op.toString(16)}`);
      const instruction = {pc,op,args:data.words.slice(pc+1,pc+len),next:pc+len};
      scene.code.set(pc,instruction);
      if (op === 0x2000 || op === 0x2005)
        scene.references.add(key(instruction.args[0],instruction.args[1]));
      pc += len;
      if (op === 0xffff) { ended = true; break; }
    }
    if (!ended) throw new Error(`ADS scene ${id} lacks terminator`);
    scene.afterInit = scene.start;
    const stack = [];
    const consumed = new Set();
    for (const ins of scene.code.values()) {
      if (ins.op === 5) scene.afterInit = ins.next;
      if (isCondition(ins.op) && !consumed.has(ins.pc)) {
        ins.predicates = [ins];
        ins.connectors = [];
        let next = scene.code.get(ins.next);
        while (next && (next.op === 0x1420 || next.op === 0x1430)) {
          const predicate = scene.code.get(next.next);
          if (!predicate || !isCondition(predicate.op))
            throw new Error(`ADS condition missing operand at ${next.pc}`);
          ins.connectors.push(next.op);
          ins.predicates.push(predicate);
          consumed.add(predicate.pc);
          next = scene.code.get(predicate.next);
        }
        ins.body = next?.pc ?? null;
        stack.push(ins);
      } else if (ins.op === 0x1500) {
        const top = stack.at(-1);
        if (!top || !isIf(top.op)) throw new Error(`Unmatched ADS ELSE at ${ins.pc}`);
        top.elseBody = ins.next;
      } else if (ins.op === 0x1510 || ins.op === 0x1520) {
        const top = stack.pop();
        if (!top || (ins.op === 0x1520) !== isWhile(top.op))
          throw new Error(`Unmatched ADS block end at ${ins.pc}`);
        top.after = ins.next;
      }
    }
    if (stack.length) throw new Error(`Unterminated ADS block in scene ${id}`);
  }
  return scenes;
}

export class AdsPlayer {
  constructor(assets, filename, sceneId, env) {
    const data = assets.ads[filename];
    if (!data) throw new Error(`Missing original ADS resource ${filename}`);
    this.assets = assets;
    this.filename = filename;
    this.env = env;
    this.scenes = decodeAds(data);
    this.byId = new Map(this.scenes.map(s=>[s.id,s]));
    this.mainScene = this.byId.get(Number(sceneId));
    if (!this.mainScene) throw new Error(`Missing original ADS scene ${filename}:${sceneId}`);
    this.actors = new Map();
    this.renderOrder = [];
    this.resources = data.resources;
    this.steps = 0;
    this.lastDrawn = 0;
    for (const [id,name] of Object.entries(data.resources)) {
      if (env) initTtm(env,name);
      const ttm = assets.ttm[name];
      if (!ttm) throw new Error(`Missing original TTM resource ${name}`);
      // Preserve descriptor creation order, which is TTM marker/frame order.
      for (const frame of ttm.frames) {
        for (const [op,args] of frame) {
          if (op !== 0x1111) continue;
          const scene = args[0], actorKey = key(id,scene);
          if (this.actors.has(actorKey)) continue;
          const actor = createActor(name,scene,assets);
          if (!actor) throw new Error(`Missing original TTM marker ${name}:${scene}`);
          actor.resourceId = Number(id);
          this.actors.set(actorKey,actor);
          this.renderOrder.push(actor);
          this.resetActor(actor);
        }
      }
    }
    this.start(sceneId,true);
  }

  resetActor(a) {
    // Original reset seg10:0b3e. Shared TTM bitmap resources remain loaded.
    const fresh = createActor(a.resourceName ?? a.ttm,a.sceneId,this.assets);
    if (fresh) {
      if (fresh.graphicsContext) a.graphicsContext = fresh.graphicsContext;
      for (const prop of ['bitmapSlot','paletteSlot','regionSlot','colors','clipRect'])
        if (prop in fresh) a[prop] = fresh[prop];
    }
    a.frame = a.start;
    a.pendingFrame = -1;
    a.alreadyRendered = false;
    a.first = true;
    a.selfJump = false;
    a.lastFrame = -1;
    a.delay = 0;
    a.frameDeadline = 0;
    a.stopAt = 0;
    a.starts = 0;
    a.state = 0;
    a.remainingRepeats = 0;
    a.groupMode = 0;
  }

  start(sceneId, reset = true) {
    const scene = this.byId.get(Number(sceneId));
    if (!scene) return false;
    scene.savedWhile = null;
    scene.mode = (scene.mode & 8) | (reset ? 3 : 4);
    return true;
  }

  // seg04:0c88 retains a loaded ADS family. seg10:0874 resets only the chosen
  // scene's actors; other actor state and linked rendering order survive.
  select(sceneId) {
    const scene = this.byId.get(Number(sceneId));
    if (!scene) throw new Error(`Missing original ADS scene ${this.filename}:${sceneId}`);
    this.mainScene = scene;
    this.start(sceneId,true);
    return this;
  }

  get done() {
    const scene = this.mainScene, mode = scene.mode & ~8;
    if (mode === 1 || mode === 4 || mode === 3) return false;
    for (const id of scene.references) {
      const a = this.actors.get(id);
      if (a && a.state !== 0 && a.state !== 4 && !a.selfJump) return false;
    }
    return true;
  }

  actor(resourceId,sceneId) { return this.actors.get(key(resourceId,sceneId)); }

  predicate(ins,scene,env) {
    const [x,y] = ins.args;
    const op = isWhile(ins.op) ? ins.op + 0x300 : ins.op;
    if (ins.op === 0x1080) return scene.count <= signed(x);
    if (op === 0x1380) return (env.adsGlobal ?? 0) <= signed(x);
    if (op === 0x1390) return (env.adsGlobal ?? 0) >= signed(x);
    if (op >= 0x13a0) {
      const value = env.adsGlobals?.[op & 1] ?? 0;
      if ((op & 0xfff0) === 0x13a0) return value <= x;
      if ((op & 0xfff0) === 0x13b0) return value >= x;
      return value === x;
    }
    const a = this.actor(x,y);
    switch(op) {
      case 0x1310: return !!a && a.state === 5;
      case 0x1320: return !a || a.state !== 5;
      case 0x1330: return !a || a.starts === 0;
      case 0x1340: return !!a && a.starts !== 0;
      case 0x1350: return !!a && a.state === 4;
      case 0x1360: return !a || a.state === 0 || a.state === 4;
      case 0x1370: return !!a && [1,2,3].includes(a.state);
      default: return false;
    }
  }

  expression(ins,scene,env) {
    let result = false, group = this.predicate(ins.predicates[0],scene,env);
    for (let i=0;i<ins.connectors.length;i++) {
      if (ins.connectors[i] === 0x1420) group = group && this.predicate(ins.predicates[i+1],scene,env);
      else { result ||= group; group = this.predicate(ins.predicates[i+1],scene,env); }
    }
    return result || group;
  }

  randomBelow(env,n) {
    if (env.rng?.below) return env.rng.below(n);
    if (env.rng?.int) return env.rng.int(n);
    if (env.rng?.next) return (env.rng.next() & 0xffff) % n;
    if (typeof env.rng === 'function') return (env.rng() & 0xffff) % n;
    // Deterministic fallback only; the Director supplies the original generator.
    this.seed = ((this.seed ?? 1) * 25173 + 13849) & 0xffff;
    return this.seed % n;
  }

  command(ins,scene,env) {
    const [x,y,z] = ins.args;
    const a = this.actor(x,y);
    switch(ins.op) {
      case 1: case 5: case 0x3020: break;
      case 0x2000:
      case 0x2005:
        if (a) {
          if (ins.op === 0x2000) a.frame = a.start;
          const count = signed(z);
          if (count === 0) a.state = 1;
          else if (count > 0) { a.state = 2; a.remainingRepeats = count-1; }
          else { a.state = 3; a.stopAt = env.now - count; }
          a.starts++;
        }
        break;
      case 0x2010: if (a) a.state = 0; break;
      case 0x2015: if (a) a.state = 5; break;
      case 0x2020: if (a) this.resetActor(a); break;
      case 0x4000:
      case 0x4010:
        if (a) {
          this.renderOrder.splice(this.renderOrder.indexOf(a),1);
          if (ins.op === 0x4000) this.renderOrder.push(a);
          else this.renderOrder.unshift(a);
        }
        break;
      case 0xf000: scene.mode=2; return true;
      case 0xf010: {
        const target = signed(x) === -1 ? scene : this.byId.get(x);
        if (target) target.mode = 2;
        if (target === scene) return true;
        break;
      }
      case 0xf200:
      case 0xf210: {
        const target = this.byId.get(x);
        if (target) target.mode = (target.mode & 8) | (ins.op === 0xf200 ? 4 : 3);
        break;
      }
      default:
        throw new Error(`Unknown original ADS opcode 0x${ins.op.toString(16)} in ${this.filename}`);
    }
    return false;
  }

  runBlock(scene,pc,env,depth=0) {
    if (depth > 32) throw new Error('Original ADS nesting exceeded expected bound');
    while (pc != null) {
      const ins = scene.code.get(pc);
      if (!ins || [0xffff,0x1500,0x1510,0x1520].includes(ins.op)) return false;
      if (isCondition(ins.op)) {
        const truth = this.expression(ins,scene,env);
        if (isWhile(ins.op)) {
          if (truth) {
            scene.savedWhile = pc;
            scene.count++;
            this.runBlock(scene,ins.body,env,depth+1);
            return true; // One WHILE iteration per scheduler pass, not a busy loop.
          }
          scene.savedWhile = null;
          scene.count = 0;
        } else {
          const chosen = truth ? ins.body : ins.elseBody;
          if (chosen != null && this.runBlock(scene,chosen,env,depth+1)) return true;
        }
        pc = ins.after;
      } else if (ins.op === 0x3010) {
        const candidates = [];
        let scan = scene.code.get(ins.next), total = 0;
        while (scan && scan.op !== 0x30ff) {
          const weight = scan.args.at(-1) ?? 0;
          candidates.push([scan,weight]); total += weight;
          scan = scene.code.get(scan.next);
        }
        if (!scan) throw new Error(`Missing ADS random terminator in ${this.filename}`);
        if (total) {
          let choice = this.randomBelow(env,total)+1;
          for (const [candidate,weight] of candidates) {
            choice -= weight;
            if (choice <= 0) {
              if (candidate.op !== 0x3020 && this.command(candidate,scene,env)) return true;
              break;
            }
          }
        }
        pc = scan.next;
      } else {
        if (this.command(ins,scene,env)) return true;
        pc = ins.next;
      }
    }
    return false;
  }

  advance(a,now) {
    if (a.delay) {
      if (a.frameDeadline > now) return false;
      a.frameDeadline = now+a.delay;
    }
    a.alreadyRendered = false;
    a.first = true;
    if (a.pendingFrame !== -1) { a.frame=a.pendingFrame; a.pendingFrame=-1; }
    else a.frame++;
    return true;
  }

  renderActor(a,env) {
    a.lastFrame = -1;
    const state = a.state;
    if (a.groupMode !== 6 && [1,2,3,5].includes(state)) {
      const result = interpretFrame(a,env);
      if (result.valid === false || a.groupMode === 5) {
        if (a.groupMode !== 5) { a.pendingFrame=a.start; a.state=4; }
      } else {
        a.alreadyRendered = true;
        a.first = false;
        a.lastFrame = a.frame;
        this.lastDrawn++;
        if (result.delay != null && result.delay !== -1 && result.delay !== a.delay) {
          a.delay = result.delay;
          a.frameDeadline = env.now+a.delay;
        }
        if (result.complete ?? result.done) {
          a.pendingFrame = a.start;
          if (a.state === 2 && a.remainingRepeats > 0) {
            if (this.advance(a,env.now)) a.remainingRepeats--;
          } else if (a.state === 3 && a.stopAt !== 0) {
            this.advance(a,env.now);
          } else if (this.advance(a,env.now)) { a.state=4; a.delay=0; }
        } else {
          if (result.nextFrame != null && result.nextFrame !== -1) {
            a.pendingFrame = result.nextFrame;
            if (a.pendingFrame === a.frame) a.selfJump = true;
          }
          if (a.state !== 5) this.advance(a,env.now);
        }
      }
    } else if (a.groupMode !== 6 && a.groupMode !== 5 && state === 4) a.state=0;
    if (state === 3 && a.stopAt <= env.now) a.state=4;
  }

  step(env=this.env) {
    if (!env) throw new Error('ADS playback needs its drawing environment');
    this.env = env;
    this.steps++;
    this.lastDrawn=0;
    for (const scene of this.scenes) {
      const mode = scene.mode & ~8;
      for (const ref of scene.references) {
        const a = this.actors.get(ref);
        if (!a) continue;
        if (mode === 3) this.resetActor(a);
        else a.groupMode = mode;
      }
    }
    for (const scene of this.scenes) {
      const first = !!(scene.mode & 8);
      let mode = scene.mode & ~8;
      scene.mode = mode;
      const pc = scene.savedWhile ?? (first ? scene.start : scene.afterInit);
      if (mode === 3 || mode === 4) scene.mode = mode = 1;
      if (mode === 1) this.runBlock(scene,pc,env);
    }
    for (const a of this.renderOrder) this.renderActor(a,env);
    return this.lastDrawn > 0;
  }

  get diagnostic() {
    return {file:this.filename,scene:this.mainScene.id,label:this.mainScene.label,
      done:this.done,steps:this.steps,drawn:this.lastDrawn,
      active:this.renderOrder.filter(a=>a.state!==0).map(a=>({
        resource:a.resourceName ?? a.ttm,scene:a.sceneId,frame:a.frame,state:a.state,
        delay:a.delay,starts:a.starts}))};
  }
}
