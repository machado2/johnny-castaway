// Native scene director, derived only from SCRANTIC.SCR seg03/seg04.
// Machine-readable original tables: assets.story; evidence: story-findings.md.
import { AdsPlayer } from './ads.js';

export function originalRandom(table, seed = 0) {
  const state = Uint16Array.from(table.state_u16);
  let a = table.index_a, b = table.index_b;
  const next = () => {
    state[b] = (state[b] + state[a]) & 65535;
    const value = state[b];
    a = (a + 1) % 56; b = (b + 1) % 56;
    return value;
  };
  next.next = next;
  next.int = next.below = n => n > 0 ? next() % n : 0;
  // seg04:1F1B deliberately has a small uncovered remainder above 65500.
  next.percent = (...weights) => {
    let roll = next();
    for (let i = 0; i < weights.length && weights[i]; ++i) {
      const threshold = 655 * weights[i];
      if (roll < threshold) return i + 1;
      roll -= threshold;
    }
    return 0;
  };
  for (let i = 0, n = (Math.trunc(seed) >>> 0) & 65535; i < n; ++i) next();
  return next;
}

const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const slotOf = time => (Math.trunc(time / 50) + Math.trunc((time % 100) / 30) + 14) % 16;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

class Walk {
  constructor(d) { this.d = d; this.location = 1; this.direction = 0; this.reset(); }
  reset() { this.path = null; this.pathFrame = 0; this.delay = 0; this.frame = null; }
  set(location, direction) { this.location = location || 1; this.direction = direction & 7; this.reset(); }
  tick() { if (this.delay) --this.delay; }
  standing(turning = false) {
    const table = turning ? this.d.tables.turning_walk_by_position : this.d.tables.standing_walk_by_position;
    return this.d.walks.get(table[this.location])?.frames[this.direction] || null;
  }
  advance(location = 0, direction = -1) {
    const target = location || this.location;
    if (!this.delay) {
      if (!this.path && this.location !== target) {
        const route = this.d.routes.get(`${this.location}:${target}`);
        const choices = route?.steps.find(s => s.position === this.location)?.choices || [];
        let roll = this.d.rng.int(100), selected;
        for (const choice of choices) { roll -= choice.weight; selected = choice; if (roll <= 0) break; }
        this.path = this.d.walks.get(selected?.walk) || null;
        this.pathFrame = 0;
      }
      const wanted = this.path ? this.path.start_direction : (direction === -1 ? this.direction : direction);
      if (this.direction !== wanted) {
        const diff = (wanted - this.direction + 8) & 7;
        this.direction = (this.direction + (diff === 4 ? (this.d.rng() & 1 ? -1 : 1) : diff < 4 ? 1 : -1) + 8) & 7;
        this.frame = this.standing(this.location !== target);
      } else if (this.path) {
        this.frame = this.path.frames[this.pathFrame++];
        if (this.pathFrame === this.path.frames.length) {
          this.location = this.path.end_position;
          this.direction = this.path.end_direction;
          this.path = null;
        }
      } else this.frame = this.standing();
      this.delay = 4;
    }
    this.draw();
    return !this.path && this.location === target && (direction === -1 || this.direction === direction);
  }
  draw() {
    const f = this.frame || this.standing();
    if (f) {
      this.d.gfx.sprite('JOHNWALK.BMP', f.frame, f.x + this.d.origin[0], f.y + this.d.origin[1], f.flip_x ? 2 : 0);
      const im=this.d.assets.images['JOHNWALK.BMP'][f.frame];
      this.d.repairForeground(f.x+this.d.origin[0],f.y+this.d.origin[1],im.w,im.h,false);
    }
  }
}

export class Director {
  constructor(assets, gfx, config = {}, seedTime = Date.now()) {
    this.assets = assets; this.gfx = gfx; this.tables = assets.story; this.config = config;
    for (const [k,v] of Object.entries({background:true,clouds:true,waves:true,sounds:true,startTime:900,storyDay:1,maxStoryDay:1,lastDate:''}))
      if (config[k] === undefined) config[k] = v;
    // seg04:1EFA advances by low word of Borland time(NULL), seconds since epoch.
    this.rng = originalRandom(this.tables.random, Math.floor(seedTime / 1000));
    this.walks = new Map(this.tables.walks.map(w => [w.id,w]));
    this.routes = new Map(this.tables.routes.map(r => [`${r.from}:${r.to}`,r]));
    this.walk = new Walk(this); this.now = 0; this.origin = [0,0]; this.plan = [];
    this.index = 0; this.current = null; this.player = null; this.previousEnding = null;
    this.previousStory = null; this.idleRemaining = 0; this.shoreDelay = 0; this.waveDelay = 0;
    this.sounds = [];
    this.env = {assets,gfx,rng:this.rng,now:0,offset:[0,0],sounds:this.sounds};
    this.stats = {batches:0,scenesCompleted:0,storyCompleted:0};
  }
  tick() {
    ++this.now; this.env.now = this.now; this.walk.tick();
    if (this.idleRemaining) --this.idleRemaining;
    if (this.shoreDelay) --this.shoreDelay;
    if (this.waveDelay) --this.waveDelay;
  }
  get day() { return this.config.storyDay; }
  get maxDay() { return this.config.maxStoryDay; }
  // seg04:0EDB. Placement constraints, accumulated while selecting the batch.
  compatible(flags) {
    const h = flags >>> 16, c = this.placement;
    if (c === -1) return true;
    if ((h & 32) && (c & 42)) return false;
    if ((h & 16) && (c & 21)) return false;
    if ((h & 1) && (((!(h & 2)) && (c & 42)) || ((!(h & 4)) && (c & 48)))) return false;
    if ((h & 2) && (((!(h & 1)) && (c & 21)) || ((!(h & 8)) && (c & 48)))) return false;
    if ((h & 4) && (((!(h & 8)) && (c & 42)) || ((!(h & 1)) && (c & 12)))) return false;
    if ((h & 8) && (((!(h & 4)) && (c & 21)) || ((!(h & 2)) && (c & 12)))) return false;
    return true;
  }
  accumulate(flags) {
    if (flags & 0x200) this.variant = 0;
    if (flags & 0x4000) this.hideRaft = true;
    if (flags & 0x10) this.showHoliday = false;
    if (flags & 0x1000) this.hideWaves = true;
    if (flags & 0x800) this.mode = 1;
    if (flags & 0x2000) this.mode = 2;
    const h = (flags >>> 16) & 63;
    if (h && this.placement === -1) this.placement = 0;
    if (h & 32) this.placement = 1; else if (h & 16) this.placement = 2;
    for (let bit = 0; bit < 4; ++bit) if (h & (1 << bit)) this.placement |= 4 << bit;
  }
  choose(category, budget) {
    if (category === 4) budget = 999;
    if (category === 128) {
      if (this.rng.int(10)) return null;
      this.config.storyDay = this.config.maxStoryDay; budget = 999;
    }
    const choices = this.tables.scenes.filter(s => category === 128 && s.story_day === this.day ||
      (s.flags & category) && s.sequence && !s.story_day && s.min_slot <= this.slot && this.slot < s.max_slot_exclusive &&
      Math.trunc(s.duration_budget / 2) < budget && this.compatible(s.flags));
    const sum = choices.reduce((n,s) => n + s.weight, 0);
    if (!sum) return null;
    let roll = this.rng.int(sum) + 1;
    for (const s of choices) { roll -= s.weight; if (roll <= 0) return s; }
    return null;
  }
  updateCalendar(date) {
    const key = dateKey(date), cfg = this.config;
    if (cfg.lastDate !== key) {
      if (cfg.maxStoryDay < cfg.storyDay) ++cfg.maxStoryDay;
      if (cfg.maxStoryDay < 2 || cfg.maxStoryDay > 11) cfg.storyDay = cfg.maxStoryDay = 1;
      cfg.lastDate = key;
    }
    const hhmm = date.getHours()*100 + (date.getMinutes() >= 30 ? 30 : 0);
    this.slot = (16 + slotOf(hhmm) - slotOf(Number(cfg.startTime))) % 16;
    const m = date.getMonth()+1, d = date.getDate();
    this.holiday = m===10 && d>=29 ? 1 : m===12 && d>=23 && d<=25 ? 2 : m===12 && d>=29 || m===1 && d===1 ? 3 : m===3 && d>=15 && d<=17 ? 4 : 0;
  }
  build(date) {
    this.updateCalendar(date);
    // seg04:0C1A also advances a selected chapter when a rebuilt batch replaces
    // it before playback. Finished chapters already advanced beyond maxDay.
    if(this.stats.batches && this.storySelected && this.day<=this.maxDay)++this.config.storyDay;
    this.placement = -1; this.variant = -1;
    this.mode = 0; this.hideWaves = false; this.hideRaft = false; this.showHoliday = true;
    let budget = 300, ending = null, story = this.choose(128, 0);
    if (story === this.previousEnding || story === this.previousStory) story = null;
    this.storyRecord = story;
    this.storySelected=!!story;
    if (story && (story.flags & 4)) { ending = story; story = null; }
    for (let attempts=0; !ending && attempts<1000; ++attempts) {
      const s = this.choose(4, 0);
      if (s && s !== this.previousEnding && !(story && (s.flags & 1))) ending = s;
    }
    if (!ending) ending = this.choose(4,0);
    if (!ending) throw new Error('Original scene catalogue has no eligible ending');
    budget -= ending.duration_budget; this.accumulate(ending.flags);
    this.previousEnding = ending;
    if (story) { budget -= story.duration_budget; this.accumulate(story.flags); }
    this.previousStory = story;
    const plan = [];
    if (!(ending.flags & 1)) {
      if (story && (story.flags & 1) && this.rng.percent(50)) { plan.push(story); story = null; }
      else {
        const opening = this.choose(1,budget);
        if (opening) { plan.push(opening); budget -= opening.duration_budget; this.accumulate(opening.flags); }
      }
      while (budget && plan.length < 298) {
        if (story && this.rng.percent(5)) { plan.push(story); story = null; continue; }
        const middle = this.choose(2,budget); if (!middle) break;
        let repeats = 1;
        if (middle.flags & 8) {
          do { repeats = this.rng.percent(10,20,30,20,10,10); }
          while (!repeats || repeats > 1 && repeats * middle.duration_budget > budget);
        }
        while (repeats-- && plan.length < 298) {
          plan.push(middle); budget -= middle.duration_budget; this.accumulate(middle.flags);
        }
      }
    }
    plan.push(ending); this.plan = plan; this.index = 0; this.current = null; this.player = null;this.storyAnnounced=false;
    this.lastFamily=null;this.adsCached=null;this.env.ttmResources=new Map();
    this.walk.set(plan[0].start_position, plan[0].start_direction);
    this.setupBackground(); ++this.stats.batches;
  }
  locateIsland() {
    if (this.variant === -1) this.variant = this.rng() & 1;
    const c = Math.max(0,this.placement);
    if (c & 2) { this.origin = [0,20]; return; }
    if (c & 1) { this.origin = [-272,30]; return; }
    let x = this.variant ? 168 : 67, y = 255, w = this.variant ? 111 : 226, h = this.variant ? 59 : 129;
    if (c) {
      if ([16,32,48].includes(c)) y += Math.trunc(h/2);
      if (!((c&4)&&(c&16)) && !((c&8)&&(c&32))) h = Math.trunc(h/2);
      if ([8,32,40].includes(c)) x += Math.trunc(w/2);
      if (!((c&4)&&(c&8)) && !((c&16)&&(c&32))) w = Math.trunc(w/2);
    }
    this.origin = [x+this.rng.int(w)-289,y+this.rng.int(h)-279];
  }
  sprite(frame,x,y,target=1,flags=0,file='BACKGRND.BMP') {
    this.gfx.sprite(file,frame,x+this.origin[0],y+this.origin[1],flags,undefined,undefined,target);
  }
  repairForeground(x,y,w,h,ambient=true) {
    // seg03:1551 clips static foreground repairs to the sprite's touched area.
    if(this.mode===2)return;
    const previous=this.gfx.clipRect;
    this.gfx.clipRect=[x,y,x+w,y+h];
    if(ambient){
      const layers=this.tables.ambience.background_layers;
      for(const layer of [layers[2],layers[0],layers[1],layers[4],layers[5],layers[3]])
        if(layer.requires_variant===undefined||layer.requires_variant===this.variant)this.sprite(layer.frame,layer.x,layer.y);
    }else if(y+h<this.origin[1]+293)this.sprite(13,443,148);
    this.gfx.clipRect=previous;
  }
  setupBackground() {
    this.locateIsland(); const gfx = this.gfx;
    if (!this.config.background || this.mode === 2) gfx.clear(5,0);
    else gfx.screen(this.mode === 0 && this.slot < 12 ? this.tables.ambience.ocean_files[this.rng.int(3)] : 'NIGHT.SCR',0);
    this.shorePhases = [2,2,2]; this.shoreDelay = 0;
    if (this.mode !== 2) {
      this.drawRaft(0);
      for (const layer of this.tables.ambience.background_layers.slice(0,3))
        if (layer.requires_variant === undefined || layer.requires_variant === this.variant) this.sprite(layer.frame,layer.x,layer.y,0);
      this.drawShore(0);
      for (const layer of this.tables.ambience.background_layers.slice(3)) this.sprite(layer.frame,layer.x,layer.y,0);
    }
    this.wind = this.rng.percent(50) ? -1 : 1;
    this.clouds = []; this.particles = []; this.waveDelay=0;
    const limits = [8,4,2];
    for (let i=0; i<15; ++i) if (this.rng.percent(30)) {
      let size = [2,1,0][this.rng.percent(5,10,15)-1];
      while (size > 0 && !limits[size]) --size;
      if (size === undefined || !limits[size]) continue;
      --limits[size]; const frame=15+size, im=this.assets.images['BACKGRND.BMP'][frame];
      this.clouds.push({size,frame,x:this.rng.int(640-im.w),y:1+this.rng.int(139-im.h),delay:6+this.rng.int(5),remaining:this.rng.int(6)});
    }
    this.drawHoliday(0);
    gfx.copyRect(0,1,0,0,640,480); gfx.copyRect(0,2,0,0,640,480);
  }
  drawRaft(target=1) {
    if (!this.hideRaft && this.mode!==2) {
      const frame=clamp(this.maxDay-1,1,5)-1,x=this.variant?530:513,y=this.variant?281:266;
      this.sprite(frame,x,y,target,0,'MRAFT.BMP');
      if(target===1){const im=this.assets.images['MRAFT.BMP'][frame];this.repairForeground(x+this.origin[0],y+this.origin[1],im.w,im.h);}
    }
  }
  drawHoliday(target=1) {
    if (!this.holiday || !this.showHoliday || this.mode===2) return;
    const [f,x,y] = [[0,411,298],[2,405,267],[3,362,155],[1,334,286]][this.holiday-1];
    this.sprite(f,x,y,target,0,'HOLIDAY.BMP');
  }
  drawShore(target=1) {
    const waves=this.variant ? [[30,234,323,0],[33,368,356,1],[36,559,323,2],[39,130,340,0]] : [[3,271,306,0],[6,365,319,1],[9,519,303,2]];
    for (const [base,x,y,phase] of waves) this.sprite(base+this.shorePhases[phase],x,y,target);
  }
  animateClouds() {
    if (!this.config.clouds) return;
    const counts = [0,0,0]; for (const c of this.clouds) ++counts[c.size];
    for (let i=this.clouds.length; i<15; ++i) {
      const size=[2,1,0][this.rng.percent(20,30,50)-1];
      if (size === undefined || counts[size] >= [8,4,2][size]) continue;
      ++counts[size]; const frame=15+size, im=this.assets.images['BACKGRND.BMP'][frame];
      this.clouds.push({size,frame,x:(this.wind===1?-1000:640)+this.rng.int(1000-im.w),y:1+this.rng.int(139-im.h),delay:6+this.rng.int(5),remaining:0});
    }
    this.clouds=this.clouds.filter(c => {
      if (c.remaining-- === 0) { c.x+=this.wind; c.remaining=c.delay; }
      const im=this.assets.images['BACKGRND.BMP'][c.frame];
      if (this.wind<0 && c.x+im.w<0 || this.wind>0 && c.x>640) return false;
      this.gfx.sprite('BACKGRND.BMP',c.frame,c.x,c.y,this.wind>0?2:0);
      this.repairForeground(c.x,c.y,im.w,im.h);return true;
    });
  }
  animateParticles() {
    if (!this.config.waves || this.hideWaves) return;
    const limits=[30,4,2,1], counts=[0,0,0,0]; for(const p of this.particles) ++counts[p.type];
    for(let i=this.particles.length;i<30;++i) if(this.rng.percent(35)) {
      const type=this.rng.percent(35,5,5,5)-1;
      if(type<0 || counts[type]>=limits[type]) continue;
      const bounds=[[0,214,640,35],[-10,249,650,40],[-40,289,680,93],[-70,382,710,142]][type];
      const [x,y,w,h]=bounds,delay=type===0?10+this.rng.int(30):this.rng.percent(30,50);
      const px=x+this.rng.int(w),py=y+this.rng.int(h);
      // seg03:055E rejects sparkle spawn over the trunk or canopy rectangles.
      if(type===0 && [[443,148,22,145],[366,122,148,69]].some(([rx,ry,rw,rh])=>
        px>=rx+this.origin[0] && px<=rx+this.origin[0]+rw && py>=ry+this.origin[1] && py<=ry+this.origin[1]+rh))continue;
      this.particles.push({type,x:px,y:py,frame:0,delay,remaining:delay});++counts[type];
    }
    const advance=this.waveDelay===0;
    if(advance) this.waveDelay=10;
    this.particles=this.particles.filter(p=>{
      if(p.type===0){
        // Original sparkle uses two horizontal palette-15 pixels (seg03:07DE).
        if(advance && p.remaining--===0)return false;
        const buf=this.gfx.buffers[1];
        if(buf instanceof Uint8Array && p.x>=0 && p.x<639 && p.y>=0 && p.y<480) {buf[p.y*640+p.x]=15;buf[p.y*640+p.x+1]=15;}
        return true;
      }
      if(advance){p.x+=this.wind;if(p.remaining--===0){p.remaining=p.delay;++p.frame;}}
      const sequence=this.tables.ambience.wave_sequences[3-p.type],frame=sequence[p.frame];
      if(frame===undefined)return false;
      const im=this.assets.images['BACKGRND.BMP'][frame];
      const exclude=this.variant?[[234,323,120,48],[368,356,171,28],[559,323,81,48]]:[[271,306,72,29],[365,319,156,25],[519,303,65,32]];
      const contained=exclude.some(([x,y,w,h])=>p.x>=x+this.origin[0] && p.x+im.w<x+this.origin[0]+w && p.y>=y+this.origin[1] && p.y+im.h<y+this.origin[1]+h);
      if(!contained){this.gfx.sprite('BACKGRND.BMP',frame,p.x,p.y);this.repairForeground(p.x,p.y,im.w,im.h);}
      return true;
    });
  }
  ambience() {
    if(this.mode===2)return;
    this.animateParticles(); this.animateClouds();
    if(!this.hideWaves && this.config.waves && !this.shoreDelay){
      const p=this.shorePhases;
      if(p[0]===p[2])++p[0];else if(p[1]!==p[0])++p[1];else ++p[2];
      for(let i=0;i<3;++i)p[i]%=3;this.shoreDelay=4;
    }
    this.drawShore(); this.drawRaft();
  }
  finishScene() {
    const s=this.current;
    const pos=s.end_position || (s.ads_id===-1?0:1+this.rng.int(6));
    const dir=s.end_direction || (s.ads_id===-1?0:this.rng()&7);
    this.walk.set(pos,dir);
    if(s.story_day && s===this.storyRecord) {
      this.config.storyDay=s.story_day+1;++this.stats.storyCompleted;
    }
    ++this.stats.scenesCompleted; ++this.index;this.current=null;this.player=null;
  }
  step(date=new Date()) {
    if(this.index>=this.plan.length)this.build(date);
    this.env.now=this.now;
    this.gfx.copyRect(0,1,0,0,640,480);
    this.ambience();
    if(!this.current){this.current=this.plan[this.index];this.started=false;this.player=null;}
    const s=this.current;
    if(s===this.storyRecord&&!this.storyAnnounced){this.sounds.push(25);this.storyAnnounced=true;}
    if(!this.started){
      if(!this.walk.advance(s.start_position,s.start_direction)){this.drawHoliday();this.present();return this.env;}
      this.started=true;
      if(s.ads_id===-1){this.idleRemaining=180+this.rng.int(240);this.walk.reset();}
      else{
        this.env.offset=this.mode===2?[0,0]:[this.origin[0]+1+((s.flags&0x400)?272:0),this.origin[1]];
        // seg04:0C88 keeps an ADS module loaded until its family changes.
        if(this.lastFamily!==s.ads_file){this.env.ttmResources=new Map();this.lastFamily=s.ads_file;this.adsCached=null;}
        if(this.adsCached){this.player=this.adsCached;this.player.select(s.sequence);}
        else this.player=this.adsCached=new AdsPlayer(this.assets,s.ads_file,s.sequence,this.env);
      }
    }
    if(s.ads_id===-1){this.walk.advance();if(!this.idleRemaining)this.finishScene();}
    else{this.player.step(this.env);if(this.player.done)this.finishScene();}
    this.drawHoliday();this.present();return this.env;
  }
  present() {
    this.gfx.copyRect(1,2,0,0,640,480);
    if(!this.config.sounds)this.sounds.length=0;
  }
  // Convenience for diagnostic scene inspection; uses the same native engine.
  playScene(index,date=new Date()) {
    const scene=this.tables.scenes[index];if(!scene?.sequence)return false;
    this.updateCalendar(date);this.placement=-1;this.variant=-1;this.mode=0;
    this.hideWaves=false;this.hideRaft=false;this.showHoliday=true;this.accumulate(scene.flags);
    this.plan=[scene];this.index=0;this.current=null;this.player=null;this.storyRecord=null;
    this.lastFamily=null;this.adsCached=null;this.env.ttmResources=new Map();
    this.walk.set(scene.start_position,scene.start_direction);this.setupBackground();return true;
  }
}
