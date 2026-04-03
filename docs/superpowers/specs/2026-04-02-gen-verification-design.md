# Gen Support Verification Results

## Operator Catalog Completeness

- **240 unique operators** extracted from local Max reference files
- **240 operators** scraped from Cycling '74 online docs
- **Catalogs match** — 9 differences are HTML entity encoding only (`<` vs `&lt;`)
- **0 unknown operators** — all 240 are recognized by MaxPyLang

## Operator I/O Correctness

### Verified against Cycling '74 docs

| Source | Operators Checked | Method |
|--------|-------------------|--------|
| gen~ operators page | 54 | Full page lists explicit I/O counts |
| Individual reference pages | ~25 | Scraped one by one (scale, clip, wrap, mix, sah, phasor, etc.) |
| Total verified | ~75 | Cross-checked and corrected |

### Corrections applied during verification

| Operator | Was | Now | Source |
|----------|-----|-----|--------|
| scale | (2,1) | (6,1) | gen_common_scale reference |
| clip, clamp | (2,1) | (3,1) | gen_common_clip reference |
| fold, wrap | (2,1) | (3,1) | gen_common_fold/wrap reference |
| mix, smoothstep | (2,1) | (3,1) | gen_common_mix reference |
| gate | (3,1) | (2,1) | gen_common_gate reference |
| interp | (2,1) | (7,1) | gen_dsp_interp reference |
| sah | (2,1) | (3,1) | gen~ operators page |
| slide | (2,1) | (3,1) | gen_dsp_slide reference |
| counter | (2,1) | (3,3) | gen~ operators page |
| train | (1,1) | (3,1) | gen~ operators page |
| triangle | (1,1) | (2,1) | gen~ operators page |
| rate | (1,1) | (2,1) | gen~ operators page |
| phasor | (1,1) | (2,1) | gen_dsp_phasor reference |
| cartopol | (1,2) | (2,2) | gen_common_cartopol reference |
| poltocar | (1,2) | (2,2) | gen_common_poltocar reference |
| buffer | (0,1) | (1,2) | gen~ operators page |
| cycle | (1,1) | (2,1) | gen~ operators page |
| data | (0,1) | (0,2) | gen~ operators page |
| lookup | (1,1) | (2,1) | gen~ operators page |
| wave | (3,1) | (4,1) | gen~ operators page |
| ftom, mtof | (1,1) | (2,1) | gen~ operators page |
| round | (2,1) | (1,1) | gen~ operators page |
| fftinfo | (1,2) | (0,1) | gen~ operators page |

### Remaining ~165 operators

These are standard unary/binary math, logic, comparison, and trig operators where the inlet count is inherent to the operation (e.g., `sin` = 1 inlet, `+` = 2 inlets). No individual verification was deemed necessary.

## Patch Validity in Max

### Tested live in Max/MSP on 2026-04-02

| Patch | Opens | Audio | Visual | Notes |
|-------|-------|-------|--------|-------|
| gen-verification-test | Yes | 220 Hz tone | scope~ waveform | 18 operators visible in gen~ |
| gen-fm-synthesis | Yes | Metallic FM tone | — | Two-operator FM working |
| gen-echo-delay | Yes | Repeating echoes | — | Feedback delay with decay |
| gen-noise-and-hold | Yes | Random pitch jumps | — | sah + noise working |

### Not yet tested in Max (generate without errors)

| Patch | Generates | Operators Used |
|-------|-----------|---------------|
| gen-passthrough | Yes | in, out |
| gen-sine-oscillator | Yes | param, phasor, cycle, out |
| gen-sample-counter | Yes | in, +, history, out |
| gen-bounded-ramp | Yes | param, +, history, wrap, out |
| gen-ramp-to-click | Yes | param, phasor, delta, abs, >, out |
| gen-waveshaper | Yes | in, param, *, tanh, out |
| gen-onepole-filter | Yes | in, param, history, -, *, +, out |
| gen-wavetable-osc | Yes | param, phasor, peek, buffer, out |
