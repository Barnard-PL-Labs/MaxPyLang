"""Measure a folder of rendered WAVs against its init.wav (the device with nothing on):
level on the two sines and the noise, distortion, tail level, peak, and the sweep in ten
bands. Usage: analyze.py <dir> [name prefixes]"""
import numpy as np, wave, sys, os, json
sr=44100
def load(p):
    w=wave.open(p,'rb'); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth()
    d=np.frombuffer(w.readframes(n),dtype={2:'<i2',4:'<i4'}[sw]).astype(np.float64)/(2**(8*sw-1))
    return d.reshape(-1,ch)
def db(x): return 20*np.log10(max(x,1e-9))
def rms(x): return float(np.sqrt(np.mean(x*x))) if len(x) else 0.0
def seg(x,a,b,off): return x[int(a*sr)+off:int(b*sr)+off]
def thd(x,f0=220):
    n=len(x); w=np.hanning(n); X=np.abs(np.fft.rfft(x*w)); fr=np.fft.rfftfreq(n,1/sr)
    def pk(f): 
        i=np.argmin(abs(fr-f)); return np.sqrt(np.sum(X[max(0,i-3):i+4]**2))
    f=pk(f0); h=np.sqrt(sum(pk(f0*k)**2 for k in range(2,40) if f0*k<sr/2))
    return 100*h/max(f,1e-12)
SW0,SW1,F0,F1=4.0,7.0,40,16000
BANDS=[50,100,200,400,800,1600,3200,6400,9000,12500]
def sweep_resp(x,off):
    out=[]; k=np.log(F1/F0)/(SW1-SW0)
    for f in BANDS:
        t=np.log(f/F0)/k; a=SW0+t
        out.append(db(rms(seg(x,a-0.04,a+0.04,off))))
    return np.array(out)
def analyze(path, off, ref=None):
    x=load(path); r={}
    for c,name in ((0,'L'),(1,'R')):
        y=x[:,c]
        r[name]=dict(
          s12=db(rms(seg(y,2.1,2.9,off))), s3=db(rms(seg(y,3.1,3.9,off))),
          thd12=thd(seg(y,2.1,2.9,off)), thd3=thd(seg(y,3.1,3.9,off)),
          noise=db(rms(seg(y,7.1,7.9,off))), tail=db(rms(seg(y,8.3,9.8,off))),
          peak=db(float(np.max(np.abs(y)))), dc=float(np.mean(seg(y,3.1,3.9,off))),
          sweep=sweep_resp(y,off),
          imp=seg(y,0.5,2.0,off))
    return r
def offset(path):
    y=load(path)[:,0]; i=int(np.argmax(np.abs(y[:sr*3])>0.2)); return i-int(0.5*sr)
def echoes(imp, thr=0.02, gap=0.004):
    idx=np.where(np.abs(imp)>thr)[0]; out=[]; last=-1e9
    for i in idx:
        if i-last>gap*sr: out.append((round(1000*i/sr,1), round(float(imp[i]),3)))
        last=i
    return out[:8]
def report(d, names=None, tag=''):
    off=offset(os.path.join(d,'init.wav')); ref=analyze(os.path.join(d,'init.wav'),off)
    res={}
    print('%s offset=%d samples'%(tag,off))
    print('%-22s %6s %6s %6s %6s %6s %6s %6s | sweep rel init (dB) @ %s'%('test','s-12','s-3','thd12','thd3','noise','tail','peak',' '.join(str(b) for b in BANDS)))
    files=sorted(f for f in os.listdir(d) if f.endswith('.wav'))
    for f in files:
        n=f[:-4]
        if names and not any(n.startswith(p) for p in names): continue
        a=analyze(os.path.join(d,f),off); res[n]=a
        for c in ('L','R'):
            m=a[c]; rel=m['sweep']-ref[c]['sweep']
            if c=='R' and all(abs(m[k]-a['L'][k])<0.3 for k in ('s12','s3','noise','tail')) and np.max(np.abs(m['sweep']-a['L']['sweep']))<1: continue
            print('%-20s %s %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f | %s'%(n,c,m['s12']-ref[c]['s12'],m['s3']-ref[c]['s3'],m['thd12'],m['thd3'],m['noise']-ref[c]['noise'],m['tail'],m['peak'],' '.join('%5.1f'%v for v in rel)))
    return res,ref
if __name__=='__main__':
    res,ref=report(sys.argv[1], sys.argv[2:] or None)
