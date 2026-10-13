import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { ParsedNote } from './api';

export function wikiTarget(path: string): string {
  const name = path.replace(/\.md$/i, '');
  return name.includes('/') ? name : `./${name}`;
}

export function wikiCompletions(notes: ParsedNote[], currentPath: string) {
  return (context: CompletionContext): CompletionResult | null => {
    if (context.view?.composing || context.state.readOnly) return null;
    const before = context.state.doc.lineAt(context.pos).text.slice(0, context.pos - context.state.doc.lineAt(context.pos).from);
    const open = before.lastIndexOf('[[');
    if (open < 0 || before.slice(open + 2).includes(']') || before.slice(open + 2).includes('|')) return null;
    if ((before.slice(0, open).match(/(?<!\\)`/g)?.length ?? 0) % 2 === 1) return null;
    const node = syntaxTree(context.state).resolve(context.pos, -1);
    for (let parent = node; ; ) {
      if (/Code|Frontmatter|Link/.test(parent.name)) return null;
      if (!parent.parent) break;
      parent = parent.parent;
    }
    const query = before.slice(open + 2).toLocaleLowerCase();
    const candidates = notes.filter(note => note.path !== currentPath && (
      note.title.toLocaleLowerCase().includes(query) || note.path.toLocaleLowerCase().includes(query)
    )).slice(0, 100);
    if (!candidates.length) return null;
    const from = context.pos - query.length;
    return { from, filter: false, options: candidates.map(note => ({
      label: note.title,
      detail: note.path,
      boost: note.path.slice(0, note.path.lastIndexOf('/')) === currentPath.slice(0, currentPath.lastIndexOf('/')) ? 1 : 0,
      apply(view, _completion, _from, to) {
        const closing = view.state.doc.sliceString(to, to + 2) === ']]' ? 2 : 0;
        const insert = `${wikiTarget(note.path)}]]`;
        view.dispatch({ changes: { from, to: to + closing, insert }, selection: { anchor: from + insert.length } });
      },
    })) };
  };
}
