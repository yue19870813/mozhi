import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { lineSeparator, platformLabels } from './platform';
it('displays the correct desktop shortcut and credential store', () => {
  expect(platformLabels('Win32')).toEqual({ modifier: 'Ctrl', credentials: 'Windows 凭据管理器', desktop: 'Windows', openDirectory: '在资源管理器中打开目录' });
  expect(platformLabels('MacIntel').openDirectory).toBe('在访达中打开目录');
  expect(platformLabels('Linux').openDirectory).toBe('在文件管理器中打开目录');
  expect(platformLabels('MacIntel').modifier).toBe('⌘');
  expect(platformLabels('Linux').credentials).toBe('系统凭据存储');
});
it('preserves CRLF across CodeMirror edits and supports LF notes', () => {
  for (const text of ['# 中文\r\n正文\r\n', '# 中文\n正文\n']) {
    const state = EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of(lineSeparator(text))] });
    const next = state.update({ changes: { from: state.doc.length, insert: '新增' } }).state;
    expect(next.sliceDoc()).toBe(`${text}新增`);
  }
});
