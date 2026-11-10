"""Capture the Windows GDI Ellipse raster used by SCRANTIC seg09:070d.

This calls only GDI on an offscreen DIB. It never executes the screensaver,
emulates its executable, captures a desktop, or reads another implementation.
The resulting masks are portable data consumed by the JavaScript renderer.
"""
import ctypes as C
from ctypes import wintypes as W
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]

class Header(C.Structure):
    _fields_=[('size',W.DWORD),('width',W.LONG),('height',W.LONG),('planes',W.WORD),('bits',W.WORD),('compression',W.DWORD),('image_size',W.DWORD),('xppm',W.LONG),('yppm',W.LONG),('used',W.DWORD),('important',W.DWORD)]

def run():
    g=C.WinDLL('gdi32',use_last_error=True)
    g.CreateCompatibleDC.argtypes=[W.HDC];g.CreateCompatibleDC.restype=W.HDC
    g.CreateDIBSection.argtypes=[W.HDC,C.POINTER(Header),W.UINT,C.POINTER(C.c_void_p),W.HANDLE,W.DWORD];g.CreateDIBSection.restype=W.HBITMAP
    g.CreatePen.argtypes=[C.c_int,C.c_int,W.DWORD];g.CreatePen.restype=W.HANDLE
    g.CreateSolidBrush.argtypes=[W.DWORD];g.CreateSolidBrush.restype=W.HBRUSH
    g.SelectObject.argtypes=[W.HDC,W.HANDLE];g.SelectObject.restype=W.HANDLE
    g.Ellipse.argtypes=[W.HDC,C.c_int,C.c_int,C.c_int,C.c_int]
    g.DeleteObject.argtypes=[W.HANDLE];g.DeleteDC.argtypes=[W.HDC]
    assets=json.loads((ROOT/'web/dist/assets/original.json').read_text())
    diameters=sorted({args[3]//2*2 for t in assets['ttm'].values() for f in t['frames'] for op,args in f if op==0xa404})
    masks={}
    for diameter in diameters:
        dc=g.CreateCompatibleDC(None);ptr=C.c_void_p()
        header=Header(C.sizeof(Header),diameter,-diameter,1,32,0,0,0,0,0,0)
        bitmap=g.CreateDIBSection(dc,C.byref(header),0,C.byref(ptr),None,0)
        assert dc and bitmap and ptr.value
        old_bitmap=g.SelectObject(dc,bitmap)
        pen=g.CreatePen(0,1,0x0000ff);brush=g.CreateSolidBrush(0x00ff00)
        old_pen=g.SelectObject(dc,pen);old_brush=g.SelectObject(dc,brush)
        C.memset(ptr,0,diameter*diameter*4)
        assert g.Ellipse(dc,0,0,diameter,diameter)
        g.GdiFlush()
        pixels=C.string_at(ptr,diameter*diameter*4)
        mask=[1 if pixels[i+2] else 2 if pixels[i+1] else 0 for i in range(0,len(pixels),4)]
        masks[str(diameter)]=mask
        g.SelectObject(dc,old_pen);g.SelectObject(dc,old_brush);g.SelectObject(dc,old_bitmap)
        for obj in [pen,brush,bitmap]:g.DeleteObject(obj)
        g.DeleteDC(dc)
    path=ROOT/'analysis/gdi-circle-masks.json';path.write_text(json.dumps(masks,separators=(',',':')))
    print('Captured',len(masks),'offscreen GDI circle masks')

if __name__=='__main__':run()
