"""Synthesize the built-in drum kit: public/samples/{kick,snare,clap,hat}.wav.

A pasted Max patch names its sound files but never carries them, so a playlist~ from
someone else's machine arrives pointing at `00-tr808-clap.wav` and nothing else. These
four are what the app offers instead (src/objects/audio/samples.ts). They are
synthesized here rather than borrowed from a sample pack so the repo owns them outright
— no licence to track, and anyone can regenerate or retune them.

Standard library only, fixed seed: running it twice writes identical files.

Usage:  python3 scripts/gen-drum-kit.py
"""

import math
import random
import struct
import wave
from pathlib import Path

SR = 44100
OUT = Path(__file__).resolve().parent.parent / "public" / "samples"


def env(t, tau):
    return math.exp(-t / tau)


class Biquad:
    """RBJ cookbook biquad, direct form I."""

    def __init__(self, kind, freq, q):
        w = 2 * math.pi * freq / SR
        cos, alpha = math.cos(w), math.sin(w) / (2 * q)
        if kind == "hp":
            b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
        elif kind == "bp":
            b = [alpha, 0.0, -alpha]
        else:
            raise ValueError(kind)
        a = [1 + alpha, -2 * cos, 1 - alpha]
        self.b = [x / a[0] for x in b]
        self.a = [x / a[0] for x in a]
        self.x1 = self.x2 = self.y1 = self.y2 = 0.0

    def __call__(self, x):
        y = (self.b[0] * x + self.b[1] * self.x1 + self.b[2] * self.x2
             - self.a[1] * self.y1 - self.a[2] * self.y2)
        self.x2, self.x1, self.y2, self.y1 = self.x1, x, self.y1, y
        return y


def kick(rng):
    # 808-style: a sine whose pitch falls 160 -> 48 Hz, long amplitude tail, short click.
    out, phase = [], 0.0
    for i in range(int(SR * 0.6)):
        t = i / SR
        freq = 48 + 112 * env(t, 0.035)
        phase += 2 * math.pi * freq / SR
        click = rng.uniform(-1, 1) * env(t, 0.002) * 0.3
        out.append(math.sin(phase) * env(t, 0.22) + click)
    return out


def snare(rng):
    # Two detuned body tones plus high-passed noise that outlasts them.
    hp = Biquad("hp", 1800, 0.7)
    out = []
    for i in range(int(SR * 0.35)):
        t = i / SR
        body = (math.sin(2 * math.pi * 185 * t) + 0.6 * math.sin(2 * math.pi * 330 * t)) * env(t, 0.045)
        noise = hp(rng.uniform(-1, 1)) * env(t, 0.09)
        out.append(0.55 * body + 1.1 * noise)
    return out


def clap(rng):
    # Band-passed noise, struck three times 11 ms apart and then left to ring: the
    # stutter of several hands not quite together is what makes it read as a clap.
    bp = Biquad("bp", 1150, 1.4)
    out = []
    for i in range(int(SR * 0.4)):
        t = i / SR
        bursts = sum(env(t - s, 0.006) for s in (0.0, 0.011, 0.022) if t >= s)
        tail = env(t - 0.022, 0.11) * 0.6 if t >= 0.022 else 0.0
        out.append(bp(rng.uniform(-1, 1)) * (bursts + tail))
    return out


def hat(rng):
    # Closed hi-hat: bright high-passed noise, gone in a few tens of milliseconds.
    hp1, hp2 = Biquad("hp", 7000, 0.7), Biquad("hp", 7000, 0.7)
    return [hp2(hp1(rng.uniform(-1, 1))) * env(i / SR, 0.03) for i in range(int(SR * 0.15))]


def write(name, samples):
    peak = max(abs(s) for s in samples) or 1.0
    gain = 10 ** (-1 / 20) / peak  # normalise to -1 dBFS
    fade = int(SR * 0.005)  # 5 ms fade-out so a sample never ends on a click
    frames = bytearray()
    for i, s in enumerate(samples):
        if i >= len(samples) - fade:
            s *= (len(samples) - i) / fade
        frames += struct.pack("<h", max(-32767, min(32767, round(s * gain * 32767))))
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, make in (("kick", kick), ("snare", snare), ("clap", clap), ("hat", hat)):
        write(name, make(random.Random(name)))
        print(f"wrote {OUT / name}.wav")


if __name__ == "__main__":
    main()
