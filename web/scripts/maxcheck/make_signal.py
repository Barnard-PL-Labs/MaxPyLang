"""The test signal, ten seconds, stereo: an impulse (echo times and tails), a 220 Hz sine
at -12 and -3 dB (level and distortion), a 40 Hz to 16 kHz sweep (frequency response),
white noise (broadband level), then silence (what rings on). Usage: make_signal.py out.wav"""
import numpy as np, wave, sys
sr=44100
def seg(x): return x
t=lambda s: np.arange(int(sr*s))/sr
parts=[]
# 0.0-0.5 silence, impulse at 0.5
z=np.zeros(int(sr*0.5)); parts.append(z)
imp=np.zeros(int(sr*1.5)); imp[0]=0.8; parts.append(imp)            # 0.5-2.0 impulse + tail room
tt=t(1.0); parts.append(0.25*np.sin(2*np.pi*220*tt))                 # 2.0-3.0 sine 220 @ -12 dB
parts.append(0.7*np.sin(2*np.pi*220*tt))                             # 3.0-4.0 sine 220 @ -3 dB
tt=t(3.0); f0,f1=40,16000; k=np.log(f1/f0)/3.0
parts.append(0.25*np.sin(2*np.pi*f0*(np.exp(k*tt)-1)/k))             # 4.0-7.0 log sweep 40..16k
rng=np.random.default_rng(1); parts.append(0.18*rng.standard_normal(int(sr*1.0)))  # 7.0-8.0 white noise
parts.append(np.zeros(int(sr*2.0)))                                  # 8.0-10.0 tail
x=np.concatenate(parts); x=np.clip(x,-1,1)
st=np.stack([x,x],1); pcm=(st*32767).astype('<i2')
w=wave.open(sys.argv[1],'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
print(len(x)/sr)
