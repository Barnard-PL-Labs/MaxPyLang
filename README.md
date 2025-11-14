# MaxPyLang

[![CI](https://github.com/Barnard-PL-Labs/MaxPy-Lang/actions/workflows/ci.yml/badge.svg)](https://github.com/Barnard-PL-Labs/MaxPy-Lang/actions/workflows/ci.yml)

MaxPyLang is a Python package for metaprogramming of MaxMSP that uses Python to generate and edit Max patches. MaxPyLang allows users to move freely between text-based Python programming and visual programming in Max, making it much easier to implement dynamic patches, random patches, mass-placement and mass-connection of objects, and other easily text-programmed techniques.

## Installation

```bash
git clone https://github.com/Barnard-PL-Labs/MaxPyLang.git
cd MaxPyLang
pip3 install .
```

## Documentation
- [Full Documentation](https://barnard-pl-labs.github.io/MaxPy/)
- [API Reference](https://barnard-pl-labs.github.io/MaxPy/API/API.html)
- [Examples](https://github.com/Barnard-PL-Labs/MaxPy/tree/main/examples)
- [Tutorial](https://barnard-pl-labs.github.io/MaxPy/tutorial.html)

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

## Video Demos 
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

## Formal Grammar of MaxMSP
To aid the development of MaxPy, we attempted to define a formal grammar of MaxMSP as a programming language. However, we discovered three major issues: 1) typing problems, 2) irregular objects, and 3) mismatches between saved program files and in-environment program behavior. See [this Google doc](https://docs.google.com/document/u/5/d/e/2PACX-1vQuFN8D44U0Z2s_2Jn3AcnZTgZrhUOEkb2gffNPamdWSFFroIWiXKIFlCmmnJs1XF0L7yd18yhqJO8a/pub) (in progress) for a writeup of these issues.   

## Related work

https://github.com/grrrr/py

## Contributors
Ranger Liu (developer)   
Dr. Mark Santolucito (PI)      
Richard Lee (documentation and examples)     
Satchel Peterson (documentation and examples)     

