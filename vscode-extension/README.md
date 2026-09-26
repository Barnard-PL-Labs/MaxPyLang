# MaxPyLang VSCode Extension

A VSCode extension for generating Max/MSP and Max for Live patches using natural language prompts.

## Status

**Scaffold only** — the UI shell is in place but generation logic is not yet connected. The extension registers:

- A sidebar panel with a prompt input, plugin type selector, and generate button
- A command `MaxPyLang: Open Prompt` to open the sidebar

## Development

```bash
cd vscode-extension
npm install
npm run compile
```

Then press `F5` in VSCode to launch the Extension Development Host and test.

## Structure

```
vscode-extension/
  src/
    extension.ts      # Entry point — registers command + webview provider
    promptView.ts     # Webview sidebar panel with prompt UI
  media/
    icon.svg          # Activity bar icon
  package.json        # Extension manifest
  tsconfig.json       # TypeScript config
```

## Next Steps

- [ ] Connect the generate button to the backend API
- [ ] Display generation progress and results in the webview
- [ ] Add output file handling (open generated .maxpat/.amxd in editor or finder)
- [ ] Add preset prompt templates for common plugin types
