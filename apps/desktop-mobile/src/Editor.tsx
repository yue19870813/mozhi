import { t, useLanguage } from './i18n';
import { lineSeparator } from './platform';
import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, tooltips } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { search, searchKeymap, openSearchPanel, closeSearchPanel, searchPanelOpen, getSearchQuery } from '@codemirror/search';
import { matchCount, searchPhrases } from './editor-search';
import { platform } from './platform';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { wikiCompletions } from './wiki-completion';
import type { ParsedNote } from './api';
const editorHighlightStyle = HighlightStyle.define([
  ...defaultHighlightStyle.specs,
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
]);
export function Editor({ documentKey, value, readOnly, onChange, onComposition, onPasteImage, notes = [], path = '', jump }: { documentKey: string; value: string; readOnly: boolean; onChange: (value: string) => void; onComposition: (active: boolean) => void; onPasteImage?: (file: File) => Promise<string | null>; notes?: ParsedNote[]; path?: string; jump?: { offset: number; serial: number } | null }) {
  const language = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onComposition, onPasteImage, notes, path });
  callbacks.current = { onChange, onComposition, onPasteImage, notes, path };
  const editability = useRef(new Compartment());
  const accessibility = useRef(new Compartment());
  const phrases = useRef(new Compartment());
  const [matches, setMatches] = useState<string | null>(null);
  useEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: [
      EditorState.lineSeparator.of(lineSeparator(value)), history(), lineNumbers(), highlightActiveLine(), drawSelection(), markdown(), syntaxHighlighting(editorHighlightStyle), EditorView.lineWrapping,
      search({ top: true, literal: true }), phrases.current.of(searchPhrases()),
      tooltips({ parent: document.body }),
      autocompletion({ override: [context => wikiCompletions(callbacks.current.notes, callbacks.current.path)(context)], icons: false }),
      keymap.of([...searchKeymap, { key: 'Ctrl-h', mac: 'Mod-Alt-f', run: openSearchPanel, scope: 'editor search-panel', preventDefault: true }, ...defaultKeymap, ...historyKeymap]), editability.current.of(EditorState.readOnly.of(readOnly)),
      accessibility.current.of(EditorView.contentAttributes.of({ 'aria-label': t("Markdown 编辑器"), spellcheck: 'false' })),
      EditorView.updateListener.of(update => {
        if (update.docChanged) callbacks.current.onChange(update.state.sliceDoc());
        if (update.docChanged && !update.view.composing) {
          const cursor = update.state.selection.main.head;
          const line = update.state.doc.lineAt(cursor);
          if (line.text.slice(0, cursor - line.from).endsWith('[[')) queueMicrotask(() => {
            if (view.current === update.view) startCompletion(update.view);
          });
        }
        if (update.docChanged || searchPanelOpen(update.startState) !== searchPanelOpen(update.state) || !getSearchQuery(update.startState).eq(getSearchQuery(update.state))) {
          setMatches(searchPanelOpen(update.state) ? matchCount(update.state, getSearchQuery(update.state)) : null);
        }
      }),
      EditorView.domEventHandlers({
        compositionstart: () => { callbacks.current.onComposition(true); },
        compositionend: () => { callbacks.current.onComposition(false); },
        paste: (event, editor) => {
          const importImage = callbacks.current.onPasteImage;
          if (!importImage || editor.state.readOnly) return false;
          const clipboard = event.clipboardData;
          const file = Array.from(clipboard?.items ?? [])
            .find(item => item.kind === 'file' && item.type.startsWith('image/'))
            ?.getAsFile() ?? Array.from(clipboard?.files ?? []).find(item => item.type.startsWith('image/'));
          if (!file) return false;
          event.preventDefault();
          const { from, to } = editor.state.selection.main;
          const notePath = callbacks.current.path;
          void importImage(file).then(relative => {
            if (!relative || view.current !== editor || callbacks.current.path !== notePath) return;
            const prefix = '../'.repeat(notePath.split('/').length - 1);
            const insertion = `![图片](${prefix}${relative})`;
            editor.dispatch({ changes: { from, to, insert: insertion }, selection: { anchor: from + insertion.length } });
          }).catch(() => {});
          return true;
        },
      }),
      EditorView.theme({ '&': { height: '100%', background: 'transparent', color: 'var(--text)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '14px', lineHeight: '1.9' }, '.cm-content': { padding: '30px 0 90px' }, '.cm-line': { padding: '0 26px' }, '.cm-gutters': { background: 'transparent', color: 'var(--muted)', border: 'none', paddingTop: '30px' }, '.cm-activeLine': { background: 'var(--hover)' }, '.cm-activeLineGutter': { background: 'transparent' }, '.cm-cursor': { borderLeftColor: 'var(--accent)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: '#35618e55' }, '&.cm-focused': { outline: 'none' } }),
    ] }) });
    view.current = editor;
    setMatches(null);
    return () => { editor.destroy(); view.current = null; };
    // Document switches deliberately create separate undo histories.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const open = searchPanelOpen(editor.state);
    if (open) closeSearchPanel(editor);
    editor.dispatch({ effects: editability.current.reconfigure(EditorState.readOnly.of(readOnly)) });
    if (open) openSearchPanel(editor);
  }, [readOnly]);
  useEffect(() => { view.current?.dispatch({ effects: accessibility.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': t('Markdown 编辑器'), spellcheck: 'false' })) }); }, [language]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const open = searchPanelOpen(editor.state);
    if (open) closeSearchPanel(editor);
    editor.dispatch({ effects: phrases.current.reconfigure(searchPhrases()) });
    if (open) openSearchPanel(editor);
  }, [language]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.sliceDoc() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || !jump) return;
    const offset = Math.min(jump.offset, editor.state.doc.length);
    editor.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: 'start', yMargin: 40 }) });
    editor.focus();
  }, [jump]);
  return <div className="editor-container"><div className="editor-search-toolbar"><button type="button" title={`${platform.modifier} F`} onClick={()=>{if(view.current)openSearchPanel(view.current);}}>{t('查找与替换')}</button>{matches!==null&&<span role="status">{t('{0} 处匹配', matches)}</span>}</div><div className="editor-host" ref={host} /></div>;
}
