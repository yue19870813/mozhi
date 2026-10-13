import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import type { ParsedNote } from './api';
import { wikiCompletions, wikiTarget } from './wiki-completion';

const note = (path: string, title: string): ParsedNote => ({path,title,id:null,tags:[],references:[],issues:[]});
const notes = [note('工作/计划.md','项目计划'),note('个人/计划.md','项目计划'),note('计划.md','项目计划')];
function complete(content: string, path = '工作/当前.md') {
  const state = EditorState.create({doc:content,extensions:[markdown()]});
  return wikiCompletions(notes,path)(new CompletionContext(state,content.length,false));
}

describe('Wiki link completion', () => {
  it('shows same-name notes with distinct paths and explicit targets', () => {
    const result = complete('See [[项目');
    expect(result?.options.map(option => option.detail)).toEqual(['工作/计划.md','个人/计划.md','计划.md']);
    expect(notes.map(note => wikiTarget(note.path))).toEqual(['工作/计划','个人/计划','./计划']);
  });
  it('does not offer links in code or after an alias or closed link', () => {
    expect(complete('`[[')).toBeNull();
    expect(complete('```md\n[[')).toBeNull();
    expect(complete('[[项目|显示')).toBeNull();
    expect(complete('[[项目]]')).toBeNull();
  });
});
