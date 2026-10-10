import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { setLanguage } from './i18n';
import { NoteOptimizer, acceptsOptimizationEvent, canSaveOptimization, emptyOptimization, optimizationFile } from './NoteOptimizer';
import type { AiSource } from './api';

beforeEach(() => setLanguage('zh-CN'));
const source: AiSource = { id: 1, path: '项目/计划.md', text: '# Original', contentHash: 'hash', truncated: false };
const props = {
  vaultId: 'vault-a', notes: [{ path: source.path, title: '计划' }, { path: '其他.md', title: '其他' }],
  directories: ['项目'], onChange: () => {}, onBusy: () => {}, beforePrepare: async () => true,
  onApply: async () => false, onSave: async () => false, onOpen: () => {},
  authorized: false, onAuthorization: () => {},
};

describe('note optimization', () => {
  it('requires one selected note and instructions, with radio selection and no browser write access', () => {
    const html = renderToStaticMarkup(<NoteOptimizer {...props} session={emptyOptimization()}/>);
    expect(html).toContain('笔记优化');
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('type="checkbox" name="optimization-note"');
    expect(html).toContain('aria-label="准备优化"');
    expect(html).not.toContain('应用到原笔记');
  });
  it('shows the original and editable result only after completion', () => {
    const session = { ...emptyOptimization(), path: source.path, question: '简化', original: source, result: '# Better', status: 'complete' as const };
    const html = renderToStaticMarkup(<NoteOptimizer {...props} session={session}/>);
    expect(html).toContain('计划.md');
    expect(html).toContain('<h1>Original</h1>');
    expect(html).toContain('Better');
    expect(html).toContain('应用到原笔记');
    expect(html).toContain('另存为新笔记');
    expect(canSaveOptimization(session)).toBe(true);
    expect(canSaveOptimization({ ...session, status: 'stopped' })).toBe(false);
    expect(canSaveOptimization({ ...session, status: 'failed' })).toBe(false);
    expect(canSaveOptimization({ ...session, result: '  ' })).toBe(false);
  });
  it('keeps source and result scoped to the active vault and request', () => {
    expect(acceptsOptimizationEvent('vault-a', 'request-1', { vaultId: 'vault-a', requestId: 'request-1' })).toBe(true);
    expect(acceptsOptimizationEvent('vault-a', 'request-1', { vaultId: 'vault-b', requestId: 'request-1' })).toBe(false);
    expect(acceptsOptimizationEvent('vault-a', 'request-1', { vaultId: 'vault-a', requestId: 'request-old' })).toBe(false);
    expect(acceptsOptimizationEvent('vault-a', '', { vaultId: 'vault-a', requestId: '' })).toBe(false);
    expect(emptyOptimization().result).toBe('');
    expect(optimizationFile(source.path)).toEqual({ folder: '项目', name: '计划-优化.md' });
  });
});
