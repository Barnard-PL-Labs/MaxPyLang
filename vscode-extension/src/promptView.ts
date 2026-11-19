import * as vscode from 'vscode';

/**
 * Webview provider for the MaxPyLang prompt panel.
 *
 * This is a skeleton — the actual prompt UI and generation logic
 * will be implemented by the team. The webview can post messages
 * back to the extension, which can then call the backend API.
 */
export class PromptViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'maxpylang.promptView';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtml();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'generate':
                    // TODO: Connect to backend API to generate the plugin
                    // message.prompt contains the user's prompt text
                    // message.pluginType contains the selected plugin type
                    vscode.window.showInformationMessage(
                        `MaxPyLang: Generate "${message.pluginType}" plugin — not yet implemented`
                    );
                    break;
            }
        });
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MaxPyLang</title>
    <style>
        body {
            padding: 12px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
        }
        h3 {
            margin-top: 0;
            font-weight: 600;
        }
        label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        select, textarea {
            width: 100%;
            padding: 6px 8px;
            margin-bottom: 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            font-family: var(--vscode-font-family);
            font-size: 13px;
            box-sizing: border-box;
        }
        textarea {
            min-height: 100px;
            resize: vertical;
        }
        button {
            width: 100%;
            padding: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .info {
            margin-top: 16px;
            padding: 8px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textBlockQuote-border);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <h3>MaxPyLang</h3>

    <label for="pluginType">Plugin Type</label>
    <select id="pluginType">
        <option value="instrument">Instrument</option>
        <option value="audio_effect">Audio Effect</option>
        <option value="midi_effect">MIDI Effect</option>
    </select>

    <label for="prompt">Describe your plugin</label>
    <textarea id="prompt" placeholder="e.g., A warm lo-fi synth with vinyl crackle and tape saturation..."></textarea>

    <button id="generateBtn">Generate Plugin</button>

    <div class="info">
        This extension is under development. Generation will connect to
        the MaxPyLang backend API to create Max for Live devices.
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('generateBtn').addEventListener('click', () => {
            const prompt = document.getElementById('prompt').value;
            const pluginType = document.getElementById('pluginType').value;
            if (prompt.trim()) {
                vscode.postMessage({
                    command: 'generate',
                    prompt: prompt,
                    pluginType: pluginType
                });
            }
        });
    </script>
</body>
</html>`;
    }
}
