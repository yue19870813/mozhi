import { describe, expect, it } from 'vitest';
import { treeMoveDestination } from './tree-drag';

describe('tree drag targets', () => {
  const paths=['工作','工作/计划.md','归档','归档/计划.md','附件','附件/图.png'];
  it('moves notes and folders into a directory or back to the root', () => {
    expect(treeMoveDestination('工作/计划.md','',paths)).toBe('计划.md');
    expect(treeMoveDestination('附件/图.png','工作',paths)).toBe('工作/图.png');
    expect(treeMoveDestination('工作','归档',paths)).toBe('归档/工作');
  });
  it('rejects same-parent drops, collisions, and descendant loops', () => {
    expect(treeMoveDestination('工作/计划.md','工作',paths)).toBeNull();
    expect(treeMoveDestination('工作/计划.md','归档',paths)).toBeNull();
    expect(treeMoveDestination('工作','工作',paths)).toBeNull();
    expect(treeMoveDestination('工作','工作/子目录',[...paths,'工作/子目录'])).toBeNull();
    expect(treeMoveDestination('工作/计划.md','不存在',paths)).toBeNull();
  });
});
