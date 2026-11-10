// Pixel renderer, reconstructed from the original 4-bit DIB and blit calls.
// Logical drawing surface is always 640 x 480. No Windows or CPU emulation.
export const WIDTH = 640, HEIGHT = 480;

export class Graphics {
  constructor(assets) {
    this.assets = assets;
    this.buffers = [0, 1, 2].map(() => new Uint8Array(WIDTH * HEIGHT).fill(5));
    this.saved = new Map();
    this.missing = new Set();
    this.clipRect = [0, 0, WIDTH, HEIGHT];
  }

  clear(color = 5, target = 1) { this.buffers[target].fill(color & 255); }

  screen(name, target = 0) {
    const f = this.assets.images[name]?.[0];
    if (!f) { this.missing.add(name); return; }
    const src = this.assets.pixels, dst = this.buffers[target];
    for (let y = 0; y < Math.min(HEIGHT, f.h); y++) {
      dst.set(src.subarray(f.offset + y * f.w, f.offset + y * f.w + Math.min(WIDTH, f.w)), y * WIDTH);
    }
  }

  sprite(name, index, x, y, flags = 0, width, height, target = 1) {
    const frame = this.assets.images[name]?.[index];
    if (!frame) { this.missing.add(`${name}:${index}`); return; }
    x = Math.trunc(x); y = Math.trunc(y);
    const dw = Math.trunc(width ?? frame.w), dh = Math.trunc(height ?? frame.h);
    if (dw <= 0 || dh <= 0) return;
    const src = this.assets.pixels, dst = this.buffers[target];
    const [cl,ct,cr,cb] = this.clipRect;
    const x0 = Math.max(0, -x, cl-x), x1 = Math.min(dw, WIDTH-x, cr-x);
    const y0 = Math.max(0, -y, ct-y), y1 = Math.min(dh, HEIGHT-y, cb-y);
    // Original seg7:03f5/0404: 2 = horizontal, 1 = vertical reflection.
    for (let j = y0; j < y1; j++) {
      let sy = Math.floor(j * frame.h / dh);
      if (flags & 1) sy = frame.h - 1 - sy;
      const line = frame.offset + sy * frame.w, dest = (y + j) * WIDTH + x;
      for (let i = x0; i < x1; i++) {
        let sx = Math.floor(i * frame.w / dw);
        if (flags & 2) sx = frame.w - 1 - sx;
        const pixel = src[line + sx];
        if (pixel !== 0) dst[dest + i] = pixel;
      }
    }
  }

  copyRect(src, dst, x, y, w, h, dx = x, dy = y) {
    [x,y,w,h,dx,dy] = [x,y,w,h,dx,dy].map(Math.trunc);
    const from = this.buffers[src], to = this.buffers[dst];
    const left = Math.max(0,-x,-dx), top = Math.max(0,-y,-dy);
    const right = Math.min(w, WIDTH-x, WIDTH-dx), bottom = Math.min(h,HEIGHT-y,HEIGHT-dy);
    if (right <= left || bottom <= top) return;
    // A temporary rectangle preserves BitBlt behavior when source overlaps destination.
    const source = src === dst ? from.slice() : from;
    for (let j=top;j<bottom;j++) {
      to.set(source.subarray((y+j)*WIDTH+x+left,(y+j)*WIDTH+x+right),(dy+j)*WIDTH+dx+left);
    }
  }

  rect(x, y, w, h, outline, fill, target = 1) {
    [x,y,w,h] = [x,y,w,h].map(Math.trunc);
    const dst=this.buffers[target];
    const [cl,ct,cr,cb]=this.clipRect;
    for(let j=Math.max(0,y,ct);j<Math.min(HEIGHT,y+h,cb);j++) {
      for(let i=Math.max(0,x,cl);i<Math.min(WIDTH,x+w,cr);i++) {
        dst[j*WIDTH+i]=(i===x || j===y || i===x+w-1 || j===y+h-1 ? outline : fill)&255;
      }
    }
  }

  circle(x,y,diameter,outline,fill,target=1) {
    const r=Math.floor(diameter/2), cx=Math.trunc(x)+r, cy=Math.trunc(y)+r;
    const dst=this.buffers[target];
    const [cl,ct,cr,cb]=this.clipRect;
    if(r<=0)return;
    const mask=this.assets.circleMasks?.[r*2];
    for(let j=Math.max(0,cy-r,ct);j<Math.min(HEIGHT,cy+r,cb);j++) {
      for(let i=Math.max(0,cx-r,cl);i<Math.min(WIDTH,cx+r,cr);i++) {
        if(mask){
          const value=mask[(j-cy+r)*(r*2)+i-cx+r];
          if(value)dst[j*WIDTH+i]=(value===1?outline:fill)&255;
          continue;
        }
        const d=(i-cx)*(i-cx)+(j-cy)*(j-cy);
        if(d<=r*r)dst[j*WIDTH+i]=(d>(r-1)*(r-1)?outline:fill)&255;
      }
    }
  }

  capture(slot,x,y,w,h,source=1) {
    [x,y,w,h]=[x,y,w,h].map(Math.trunc);
    if(w<=0 || h<=0)return;
    const pixels=new Uint8Array(w*h).fill(5),src=this.buffers[source];
    for(let j=0;j<h;j++)for(let i=0;i<w;i++) {
      if(x+i>=0 && x+i<WIDTH && y+j>=0 && y+j<HEIGHT)pixels[j*w+i]=src[(y+j)*WIDTH+x+i];
    }
    this.saved.set(slot,{pixels,w,h});
  }

  restore(slot,x,y,target=1) {
    const saved=this.saved.get(slot);if(!saved)return;
    const {pixels,w,h}=saved,dst=this.buffers[target];x=Math.trunc(x);y=Math.trunc(y);
    for(let j=0;j<h;j++)for(let i=0;i<w;i++) {
      if(x+i>=0 && x+i<WIDTH && y+j>=0 && y+j<HEIGHT)dst[(y+j)*WIDTH+x+i]=pixels[j*w+i];
    }
  }

  rgba(target=2, output=new Uint8ClampedArray(WIDTH*HEIGHT*4)) {
    const px=this.buffers[target],pal=this.assets.palette;
    for(let i=0;i<px.length;i++) {
      const p=px[i]*3,o=i*4;
      output[o]=pal[p];output[o+1]=pal[p+1];output[o+2]=pal[p+2];output[o+3]=255;
    }
    return output;
  }
}
