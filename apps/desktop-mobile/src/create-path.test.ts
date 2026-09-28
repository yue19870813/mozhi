import { describe, expect, it } from 'vitest';
import { createPath, parentDirectory } from './create-path';

describe('creating inside the selected directory', () => {
  it('uses the selected folder for both notes and directories', () => {
    expect(createPath('工作/项目', '会议记录', 'note')).toBe('工作/项目/会议记录.md');
    expect(createPath('工作/项目', '资料', 'directory')).toBe('工作/项目/资料');
    expect(createPath('', '首页', 'note')).toBe('首页.md');
    expect(createPath('工作', '已有.md', 'note')).toBe('工作/已有.md');
  });
  it('derives a note parent and rejects embedded paths', () => {
    expect(parentDirectory('工作/项目/计划.md')).toBe('工作/项目');
    expect(parentDirectory('计划.md')).toBe('');
    expect(() => createPath('工作', '../越界', 'note')).toThrow();
    expect(() => createPath('', '', 'directory')).toThrow();
  });
});
