---
description: "Give a coding agent these docs, run maxpylang setup-agent, and what to ask it to check."
---

# Coding agents

MaxPyLang is easy to drive from a coding agent such as Claude Code, Cursor or Copilot: the
agent writes a Python script, and you open the patch it saves.

## Give the agent the docs

This site is also published as plain text for agents:

- [`llms.txt`](https://barnard-pl-labs.github.io/MaxPyLang/llms.txt): a short index of the pages.
- [`llms-full.txt`](https://barnard-pl-labs.github.io/MaxPyLang/llms-full.txt): every page and
  the API reference in one Markdown file. Paste the link, or the file, into the agent's context.

## `maxpylang setup-agent`

Run this once in your project folder, after installing:

```bash
maxpylang setup-agent
```

(If your shell can't find `maxpylang`, run `python -m maxpylang setup-agent`.)

It writes a guide to the MaxPyLang API into `AGENTS.md`, which most coding agents read on
their own, and adds one line, `@AGENTS.md`, to `CLAUDE.md` so Claude Code reads it too. The
guide sits between two marker lines, so anything else in those files is kept. Run it again
after upgrading MaxPyLang to refresh the guide. `maxpylang setup-claude` is another name for
the same command.

## Ask the agent to check its work

Agents make the same mistakes people do. Two instructions catch most of them:

- *Run the script and fix every `UnknownObjectWarning`, `ConnectionWarning` and
  `GraphWarning`, until `save()` reports none.* These catch misspelled objects, audio wired
  into message-only inlets, hot loops, and parts of the patch that reach nothing.
  See {doc}`checks`.
- *Use the stubs from `maxpylang.objects` and tuples in `connect()`, then run `mypy` on the
  script and fix every error.* This catches the same cord mistakes, and wrong inlet numbers,
  before the script runs.
