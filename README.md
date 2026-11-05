# MaxPyLang

[![CI](https://github.com/Barnard-PL-Labs/MaxPy-Lang/actions/workflows/ci.yml/badge.svg)](https://github.com/Barnard-PL-Labs/MaxPy-Lang/actions/workflows/ci.yml)

MaxPyLang is a Python package for metaprogramming of MaxMSP that uses Python to generate and edit Max patches. MaxPyLang allows users to move freely between text-based Python programming and visual programming in Max, making it much easier to implement dynamic patches, random patches, mass-placement and mass-connection of objects, and other easily text-programmed techniques.

As a text-based interface to MaxMSP, MaxPyLang enables vibecoding of Max patches with a coding agent (Claude Code, Cursor, Codex, etc). See [Using MaxPyLang with a coding agent](#using-maxpylang-with-a-coding-agent).

## Installation

We publish our package on Pypi as [MaxPyLang](https://pypi.org/project/maxpylang/). It is easiest to install from there.

```bash
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install maxpylang
```

### Using MaxPyLang with a coding agent

After installing, run this once in your project folder:

```bash
maxpylang setup-agent
```

If your shell cannot find `maxpylang`, run `python -m maxpylang setup-agent` instead.

This writes a guide to the MaxPyLang API into `AGENTS.md`, which most coding agents read on their own, and adds one line (`@AGENTS.md`) to `CLAUDE.md` so Claude Code reads it too. Anything else in those files is kept. Run it again after upgrading MaxPyLang to refresh the guide.

## Documentation
- [Full Documentation](https://barnard-pl-labs.github.io/MaxPyLang/)
- [API Reference](https://barnard-pl-labs.github.io/MaxPyLang/API/API.html)
- [Examples](https://github.com/Barnard-PL-Labs/MaxPyLang/tree/main/examples)
- [Tutorials](https://barnard-pl-labs.github.io/MaxPyLang/tutorial.html)

## Quick Start

See this example in [examples/hello_world](./examples/hello_world).
To run this, `python3 examples/hello_world/main.py` will create a Max patch file `hello_world.maxpat` that contains a simple audio oscillator connected to the DAC.
You can then open this patch in MaxMSP and click the DAC to hear a 440 Hz tone.

```python
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(440))[0]
dac = patch.place(ezdac_tilde)[0]
patch.connect((osc.outs[0], dac.ins[0]))
patch.save("hello_world.maxpat")
```

### Checking your script

Written this way (objects from `maxpylang.objects`, `(outlet, inlet)` tuples in `connect()`), a type checker catches two mistakes before the script runs: audio wired into an inlet that takes only messages (`cycle~` into `flonum`), and an inlet or outlet number that does not exist. In VS Code, set **Python › Analysis: Type Checking Mode** to `basic` to see them as you type (it is `off` by default). Or run:

```bash
pip install pyright
pyright your_script.py
```

Running the script with `python` does not check these: the bad connection is saved into the patch.

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
