---
description: "What maxpylang's type system can't yet express or check about Max for Live devices: the gap log the plugin generator keeps."
---

# Type system: Max for Live gaps

maxpylang's type system checks cords as you type and when the script runs (see
{doc}`checks`). For Max for Live devices it still has gaps. The plugin generator
({doc}`plugin-generator`) records each one it meets, and each is pinned by a test, so the log
below always matches the code. It is kept in `docs/type-system/m4l-gaps.md`, shown here as
it is.

```{include} ../../type-system/m4l-gaps.md
:start-line: 2
```
