"""Extract original pixel planes and scripts into browser-friendly data."""
from pathlib import Path
import json,struct,sys,hashlib,gzip,shutil
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from decode_original import u16,u32
DEC=ROOT/'analysis/decoded'
OUT=ROOT/'web/dist/assets'
OUT.mkdir(parents=True,exist_ok=True)

def named_table(b):
    count=u16(b,0);p=2;out={}
    for i in range(count):
        ident=u16(b,p);p+=2;end=b.index(0,p)
        out[ident]=b[p:end].decode('latin1');p=end+1
    assert p==len(b),(p,len(b))
    return out

def run():
    pal=list((DEC/'JOHNCAST.PAL.VGA').read_bytes())
    # Windows code builds a 4-bit DIB (seg9:006b..0070).
    # Its conversion table at DS:25b8 maps VGA intensities to multiples of four.
    ds=(ROOT/'analysis/raw/seg14.bin').read_bytes()
    palette=[ds[0x25b0+pal[i]] for i in range(768)]
    bank=bytearray();images={};scripts={};ads={}
    previews=ROOT/'analysis/previews';previews.mkdir(exist_ok=True)
    for f in sorted(DEC.glob('*.BIN')):
        name=f.name[:-4];b=f.read_bytes();pixels=bytearray(len(b)*2)
        pixels[0::2]=bytes(x>>4 for x in b);pixels[1::2]=bytes(x&15 for x in b)
        frames=[];pos=0
        if name.endswith('.BMP'):
            inf=(DEC/(name+'.INF')).read_bytes();n=u16(inf,0)
            sizes=[(u16(inf,2+2*i),u16(inf,2+2*n+2*i)) for i in range(n)]
        else:sizes=[struct.unpack('<HH',(DEC/(name+'.DIM')).read_bytes())]
        for w,h in sizes:
            count=w*h
            assert pos+count<=len(pixels),(name,w,h,pos,len(pixels))
            frames.append({'w':w,'h':h,'offset':len(bank)})
            bank.extend(pixels[pos:pos+count]);pos+=count
        assert pos==len(pixels),(name,pos,len(pixels))
        images[name]=frames
        if name in ['INTRO.SCR','OCEAN00.SCR','BACKGRND.BMP','JOHNWALK.BMP']:
            n=len(frames);cols=min(8,n);tw=max(s['w'] for s in frames);th=max(s['h'] for s in frames)
            sheet=Image.new('P',(cols*(tw+4),((n+cols-1)//cols)*(th+16)),0);sheet.putpalette(palette)
            from PIL import ImageDraw
            draw=ImageDraw.Draw(sheet)
            for i,fr in enumerate(frames):
                im=Image.frombytes('P',(fr['w'],fr['h']),bytes(bank[fr['offset']:fr['offset']+fr['w']*fr['h']]))
                im.putpalette(palette);x=i%cols*(tw+4);y=i//cols*(th+16)
                sheet.paste(im,(x,y));draw.text((x,y+th),str(i),fill=15)
            sheet.save(previews/(name+'.png'))
    for f in sorted(DEC.glob('*.TTM.TT3.json')):
        name=f.name[:-9];ops=json.loads(f.read_text());frames=[]
        for op in ops:
            while len(frames)<=op['frame']:frames.append([])
            frames[op['frame']].append([int(op['op'],16),op['args']])
        tag=DEC/(name+'.TAG')
        scripts[name]={'frames':frames,'tags':named_table(tag.read_bytes()) if tag.exists() else {}}
    for f in sorted(DEC.glob('*.ADS.SCR')):
        name=f.name[:-4]
        ads[name]={'words':list(struct.unpack('<'+'H'*(f.stat().st_size//2),f.read_bytes())),
                   'resources':named_table((DEC/(name+'.RES')).read_bytes()),
                   'tags':named_table((DEC/(name+'.TAG')).read_bytes())}
    exe=(ROOT/'SCRANTIC.SCR').read_bytes()
    inv=json.loads((ROOT/'analysis/original-inventory.json').read_text())
    name_resource=next(r for r in inv['ne_resources'] if r['type']==15)
    p=name_resource['offset'];sounds={}
    while u16(exe,p):
        size=u16(exe,p);typ=u16(exe,p+2);ident=u16(exe,p+4)&0x7fff
        names=exe[p+6:p+size].split(b'\0')
        if len(names)>1 and names[0]==b'WAVE':
            effect=int(names[1].decode().removeprefix('WAVESFX'))
            sounds[effect]=str(ident)+'.wav'
        p+=size
    manifest={'images':images,'ttm':scripts,'ads':ads,'palette':palette,'sounds':sounds,
              'sources':{f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest() for f in ['SCRANTIC.SCR','RESOURCE.MAP','RESOURCE.001']}}
    masks=ROOT/'analysis/gdi-circle-masks.json'
    if masks.exists():manifest['circleMasks']=json.loads(masks.read_text())
    (OUT/'original.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
    (OUT/'pixels.bin.gz').write_bytes(gzip.compress(bytes(bank),mtime=0))
    story=ROOT/'analysis/story-tables.json'
    if story.exists():shutil.copyfile(story,OUT/'story.json')
    for f in (ROOT/'analysis/raw').glob('*.wav'):shutil.copyfile(f,OUT/f.name)
    print(len(images),'images,',sum(map(len,images.values())),'sprites/screens,',len(scripts),'TTMs,',len(ads),'ADSs')
    print('Pixels',len(bank),'gzip', (OUT/'pixels.bin.gz').stat().st_size)

if __name__=='__main__':run()
