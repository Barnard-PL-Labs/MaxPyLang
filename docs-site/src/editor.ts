// The code editor under each example: CodeMirror with Python highlighting and the
// web app's MaxPy autocomplete (object names in place("…"), stubs, API methods).

import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { maxpyComplete } from '../../web/src/compiler/completions';

export function mountEditor(
  host: HTMLElement,
  doc: string,
  opts: { onRun: () => void; onChange: (text: string) => void },
): EditorView {
  const lang = python();
  return new EditorView({
    doc,
    parent: host,
    extensions: [
      basicSetup,
      lang,
      lang.language.data.of({ autocomplete: maxpyComplete }),
      // Run on Ctrl+Enter AND Cmd+Enter: 'Mod-Enter' alone means Cmd on a Mac, so
      // Ctrl+Enter there did nothing. Highest precedence, because basicSetup binds
      // Mod-Enter to "insert blank line" and the first binding that handles a key wins.
      Prec.highest(keymap.of([
        { key: 'Mod-Enter', preventDefault: true, run: () => { opts.onRun(); return true; } },
        { key: 'Ctrl-Enter', preventDefault: true, run: () => { opts.onRun(); return true; } },
      ])),
      keymap.of([indentWithTab]),
      EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange(u.state.doc.toString()); }),
      EditorView.theme({
        '&': { backgroundColor: 'var(--code-bg)', fontSize: '14px' },
        '.cm-gutters': { backgroundColor: 'var(--code-bg)', border: 'none', color: '#b08a80' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.35)' },
        '.cm-content': { fontFamily: 'ui-monospace, Menlo, monospace' },
      }),
    ],
  });
}
