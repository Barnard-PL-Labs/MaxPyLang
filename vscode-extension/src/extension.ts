import * as vscode from 'vscode';
import { PromptViewProvider } from './promptView';

export function activate(context: vscode.ExtensionContext) {
    // Register the webview panel provider for the sidebar
    const provider = new PromptViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('maxpylang.promptView', provider)
    );

    // Register the command to open the prompt panel
    context.subscriptions.push(
        vscode.commands.registerCommand('maxpylang.openPrompt', () => {
            vscode.commands.executeCommand('workbench.view.extension.maxpylang');
        })
    );
}

export function deactivate() {}
