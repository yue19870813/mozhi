import { describe, expect, it } from 'vitest';
import { separateLabelBoxes, type LabelBox } from './graph-layout';

function expectSeparated(boxes: LabelBox[]) {
  const offsets = separateLabelBoxes(boxes);
  const result = boxes.map(box => ({ ...box, y1: box.y1 + offsets.get(box.id)!, y2: box.y2 + offsets.get(box.id)! }));
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i], b = result[j];
      expect(a.x2 + 16 <= b.x1 || b.x2 + 16 <= a.x1 || a.y2 + 16 <= b.y1 || b.y2 + 16 <= a.y1).toBe(true);
    }
  }
  return offsets;
}

describe('graph label spacing', () => {
  it('separates long Chinese titles and adjacent notes using their full bounds', () => {
    expectSeparated([
      { id: '留下想法，让知识相连', x1: -60, x2: 60, y1: -7, y2: 43 },
      { id: '新笔记3', x1: 35, x2: 95, y1: -7, y2: 29 },
      { id: '项目计划', x1: -24, x2: 24, y1: 155, y2: 191 },
      { id: '中文输入检查', x1: -46, x2: 26, y1: 162, y2: 198 },
    ]);
  });

  it('leaves already separated nodes in place without mutating input', () => {
    const boxes = [
      { id: 'a', x1: 0, x2: 120, y1: 0, y2: 40 },
      { id: 'b', x1: 136, x2: 256, y1: 0, y2: 40 },
      { id: 'c', x1: 0, x2: 120, y1: 56, y2: 96 },
    ];
    const original = structuredClone(boxes);
    expect([...expectSeparated(boxes).values()]).toEqual([0, 0, 0]);
    expect(boxes).toEqual(original);
  });

  it('resolves chained overlaps including coincident nodes and multiline titles', () => {
    const boxes = Array.from({ length: 80 }, (_, i) => ({
      id: String(i), x1: (i % 4) * 35, x2: (i % 4) * 35 + 120,
      y1: Math.floor(i / 4) * 12, y2: Math.floor(i / 4) * 12 + 28 + (i % 3) * 14,
    }));
    const offsets = expectSeparated(boxes);
    expect(separateLabelBoxes([...boxes].reverse())).toEqual(offsets);
  });
});
