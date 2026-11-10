// Original WAVESFX resource names are mapped from the executable's NE name table.
// WinMM sndPlaySound(...,7) permits one asynchronous effect at a time.
export class OriginalAudio {
  constructor(sounds) {
    this.files=sounds;this.bank=new Map();this.context=null;this.source=null;
    this.enabled=true;this.loading=null;
  }
  async unlock() {
    if(!this.context)this.context=new AudioContext();
    await this.context.resume();
    if(!this.loading)this.loading=Promise.all(Object.entries(this.files).map(async([id,file])=>{
      const response=await fetch(new URL('./assets/'+file,import.meta.url));
      if(!response.ok)throw new Error('Missing original sound '+id);
      this.bank.set(Number(id),await this.context.decodeAudioData(await response.arrayBuffer()));
    }));
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
