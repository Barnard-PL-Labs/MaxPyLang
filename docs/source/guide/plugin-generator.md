---
description: "Build a Max for Live audio effect in the browser with maxpylang, hear it on a clip, and download the .amxd."
---

# Plugin generator

The [plugin generator](https://barnard-pl-labs.github.io/MaxPyLang/app/interactive-plugin.html) builds a Max for Live audio effect with
maxpylang, in your browser, with nothing to install. You choose effects and settings, hear the
result on a clip, and download the device as a `.amxd` file for Ableton Live.

## What it does

- **Presets by effect:** 31 starting points, filed as Distortion, Lo-Fi, Filter, Chorus,
  Tremolo, Delay and Reverb.
- **An effect chain:** turn modules on and off and reorder them; each change rebuilds the
  patch.
- **A clip to hear it on:** piano, guitar, vocals or drums, or your own file. The clip plays
  into the device's `plugin~`, the way Live plays a track through an effect.
- **The device and its patch:** the device's dials work as it plays; unlock the view to see the
  patch maxpylang wrote.
- **Download:** the `.amxd` file, plus the maxpylang script that made it.

## How it works

The settings are turned into a maxpylang script (`web/src/plugin/fxgen.py`), which runs in
the browser with Python (Pyodide). The patch it saves plays in the same engine as this site's
object reference, and is drawn as the device. Turning a dial changes the running patch
directly and is written back into the settings, so the next build, a shared link and the
downloaded file all keep it.

## How far it has been checked

Every effect was rendered in Max 9, and the browser's preview was matched to those
recordings. The final version was compared against the last Max render rather than rendered
again, and no device has been loaded in Ableton Live yet.

## What maxpylang can't say about a device yet

Building real devices showed where maxpylang falls short for Max for Live: things it can't
express, such as a dial's range, and mistakes its checks don't catch, such as a duplicate
parameter name. The generator's **Type check** panel lists the ones each device had to work
around. The full list, with evidence and proposed fixes, is {doc}`type-system`.
