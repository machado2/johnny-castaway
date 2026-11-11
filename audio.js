// Original WAVESFX resource names are mapped from the executable's NE name table.
// WinMM sndPlaySound(...,7) permits one asynchronous effect at a time.
export class OriginalAudio {
  constructor(sounds={}) {
    this.files=sounds;this.bank=new Map();this.context=null;this.source=null;
    this.enabled=true;this.loading=null;
  }
  async unlock() {
    if(!this.context) {
      const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
      this.context=new AudioContext();
    }
    // Resume directly in the gesture handler, before any network/decode awaits.
    await Promise.all([this.resume(),this.load()]);
  }
  async resume() {
    if(this.context && this.context.state!=='running')await this.context.resume();
  }
  async load(sounds=this.files) {
    this.files=sounds;
    // The first tap can arrive before the animation's manifest has loaded.
    if(!this.context)return;
    if(!this.loading) {
      const missing=Object.entries(this.files).filter(([id])=>!this.bank.has(Number(id)));
      if(!missing.length)return;
      // Keep concurrent gestures on one attempt until every pending file settles.
      // A later gesture retries only failures, including fetch and decode errors.
      this.loading=Promise.allSettled(missing.map(async([id,file])=>{
        const response=await fetch(new URL('./assets/'+file,import.meta.url));
        if(!response.ok)throw new Error('Missing original sound '+id);
        this.bank.set(Number(id),await this.context.decodeAudioData(await response.arrayBuffer()));
      })).then(results=>{
        const failure=results.find(result=>result.status==='rejected');
        if(failure)throw failure.reason;
      }).finally(()=>{this.loading=null;});
    }
    await this.loading;
  }
  play(id) {
    if(!this.enabled || !this.context || this.context.state!=='running')return;
    const buffer=this.bank.get(id);if(!buffer)return;
    if(this.source){try{this.source.stop();}catch{ /* Previous sound already ended. */ }}
    const source=this.context.createBufferSource();source.buffer=buffer;
    source.connect(this.context.destination);source.start();this.source=source;
  }
  stop(){if(this.source){try{this.source.stop();}catch{ /* already ended */ }this.source=null;}}
}
