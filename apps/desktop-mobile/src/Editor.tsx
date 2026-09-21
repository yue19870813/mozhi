import { lineSeparator } from './platform';
import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
export function Editor({ documentKey, value, readOnly, onChange, onComposition }: { documentKey: string; value: string; readOnly: boolean; onChange: (value: string) => void; onComposition: (active: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onComposition });
  callbacks.current = { onChange, onComposition };
  const editability = useRef(new Compartment());
  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [
      EditorState.lineSeparator.of(lineSeparator(value)), history(), lineNumbers(), highlightActiveLine(), drawSelection(), markdown(), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap]), editability.current.of(EditorState.readOnly.of(readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown 编辑器', spellcheck: 'false' }),
      EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc()); }),
      EditorView.domEventHandlers({ compositionstart: () => { callbacks.current.onComposition(true); }, compositionend: () => { callbacks.current.onComposition(false); } }),
      EditorView.theme({ '&': { height: '100%', background: 'transparent', color: 'var(--text)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '14px', lineHeight: '1.9' }, '.cm-content': { padding: '30px 0 90px' }, '.cm-line': { padding: '0 26px' }, '.cm-gutters': { background: 'transparent', color: 'var(--muted)', border: 'none', paddingTop: '30px' }, '.cm-activeLine': { background: 'var(--hover)' }, '.cm-activeLineGutter': { background: 'transparent' }, '.cm-cursor': { borderLeftColor: 'var(--accent)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: '#35618e55' }, '&.cm-focused': { outline: 'none' } }),
    ] }) });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
    // Document switches deliberately create separate undo histories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey]);
  useEffect(() => { view.current?.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(readOnly)) }); }, [readOnly]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.sliceDoc() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  return <div className="editor-host" ref={host} />;
}
