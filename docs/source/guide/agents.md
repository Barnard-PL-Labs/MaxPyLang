---
description: "Give a coding agent these docs, run maxpylang setup-claude, and what to ask it to check."
---

# Coding agents

MaxPyLang is easy to drive from a coding agent such as Claude Code, Cursor or Copilot: the
agent writes a Python script, and you open the patch it saves.

## Give the agent the docs

This site is also published as plain text for agents:

- [`llms.txt`](https://barnard-pl-labs.github.io/MaxPyLang/llms.txt): a short index of the pages.
- [`llms-full.txt`](https://barnard-pl-labs.github.io/MaxPyLang/llms-full.txt): every page and
  the API reference in one Markdown file. Paste the link, or the file, into the agent's context.

## `maxpylang setup-claude`

For Claude Code, run this in your project folder:

```bash
maxpylang setup-claude
```

It writes `CLAUDE.md`, a short API guide Claude Code reads at the start of every session. It
will not replace an existing `CLAUDE.md` unless you add `--force`, which overwrites the whole
file.

## Ask the agent to check its work

Agents make the same mistakes people do. Two instructions catch most of them:

- *Use the stubs from `maxpylang.objects` and tuples in `connect()`, then run `mypy` on the
  script and fix every error.* This catches audio wired into message-only inlets and wrong
  inlet numbers. See {doc}`checks`.
- *Run the script and fix every `UnknownObjectWarning`, until `save()` reports no unknown
  objects.*
