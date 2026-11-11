# MaxPyLang

[![CI](https://github.com/Barnard-PL-Labs/MaxPy-Lang/actions/workflows/ci.yml/badge.svg)](https://github.com/Barnard-PL-Labs/MaxPy-Lang/actions/workflows/ci.yml)

MaxPyLang is a Python package for metaprogramming of MaxMSP that uses Python to generate and edit Max patches. MaxPyLang allows users to move freely between text-based Python programming and visual programming in Max, making it much easier to implement dynamic patches, random patches, mass-placement and mass-connection of objects, and other easily text-programmed techniques.

As a text-based interface to MaxMSP, MaxPyLang enables vibecoding of Max patches. Give your tool of choice (Claude Code, Cursor, etc.) [llms-full.txt](https://barnard-pl-labs.github.io/MaxPyLang/llms-full.txt) and ask for the patch you would like; see [Coding agents](https://barnard-pl-labs.github.io/MaxPyLang/guide/agents.html).

## Installation

We publish our package on Pypi as [MaxPyLang](https://pypi.org/project/maxpylang/). It is easiest to install from there.

```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install maxpylang
```

## Documentation
- [Full Documentation](https://barnard-pl-labs.github.io/MaxPyLang/)
- [Getting Started](https://barnard-pl-labs.github.io/MaxPyLang/guide/getting-started.html)
- [Connecting Objects](https://barnard-pl-labs.github.io/MaxPyLang/guide/connecting.html)
- [Max for Live](https://barnard-pl-labs.github.io/MaxPyLang/guide/max-for-live.html)
- [Checks and Editor Setup](https://barnard-pl-labs.github.io/MaxPyLang/guide/checks.html): see wrong patch cords as you type
- [API Reference](https://barnard-pl-labs.github.io/MaxPyLang/API/API.html)
- [Examples](https://github.com/Barnard-PL-Labs/MaxPyLang/tree/main/examples)
- For coding agents: [llms-full.txt](https://barnard-pl-labs.github.io/MaxPyLang/llms-full.txt), the whole site as one Markdown file

## Quick Start

See this example in [examples/hello_world](./examples/hello_world).
To run this, `python3 examples/hello_world/main.py` will create a Max patch file `hello_world.maxpat` that contains a simple audio oscillator connected to the DAC.
You can then open this patch in MaxMSP and click the DAC to hear a 440 Hz tone.

```python
import maxpylang as mp

patch = mp.MaxPatch()
osc = patch.place("cycle~ 440")[0]
dac = patch.place("ezdac~")[0]
patch.connect([osc.outs[0], dac.ins[0]])
patch.save("hello_world.maxpat")
```

## Citation

MaxPy was published as a [demo paper](examples/NIME2023/MaxPy-NIME-2023-Paper.pdf) for NIME 2023.
The package name was updated to MaxPyLang in 2025 to avoid confusion with other similarly named packages.


## Watch MaxPyLang in Action

We post demos, tutorials, and generated patch examples on our YouTube channel:  
-> https://youtube.com/@fishpyler

## Video Demos

### Simple Demo of Jitter Patch
[![Simple Demo of Jitter Patch](https://img.youtube.com/vi/rMhSA1ZN5Mg/0.jpg)](https://www.youtube.com/watch?v=rMhSA1ZN5Mg)

A demo showing MaxPyLang generating a Jitter patch programmatically, demonstrating dynamic patch creation and integration with visual systems.

### Generating Your First Max Patch with Python
[![First MaxPatch Generation](https://img.youtube.com/vi/e5arn3SkfJI/0.jpg)](https://www.youtube.com/watch?v=e5arn3SkfJI)

Walkthrough of generating a basic Max patch using Python, including object placement and connections.


More videos (including tutorials and advanced examples) coming soon!


## Older Video Demos 
### [Basics](https://www.youtube.com/watch?v=F8Fpe0Udc4M)      
[![Introduction to MaxPy](https://img.youtube.com/vi/F8Fpe0Udc4M/0.jpg)](https://www.youtube.com/watch?v=F8Fpe0Udc4M)     
Mark demonstrates the basics of installing MaxPy, creating patches, and placing objects.   
<br>
### [Variable-Oscillator Synth](https://www.youtube.com/watch?v=nxusu32kkxs)       
[![Variable-Oscillator Synth Explanation](https://img.youtube.com/vi/nxusu32kkxs/0.jpg)](https://www.youtube.com/watch?v=nxusu32kkxs)      
Ranger explains a MaxPy script that dynamically generates an additive synth with a variable number of oscillators. The code for this synth is under [examples/variable-osc-synth](examples/variable-osc-synth). 
<br>
### [Replace() function]((https://youtu.be/RgYRqXn8Z6o))       
[![Using Replace() function with MaxPy](https://img.youtube.com/vi/RgYRqXn8Z6o/0.jpg)](https://youtu.be/RgYRqXn8Z6o)      
Satch explains using the replace() function to selectively replace objects in a loaded patch to sonify stock data. The code for this is under [examples/stocksonification_v1](examples/stocksonification_v1). 
