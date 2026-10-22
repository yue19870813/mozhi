import { describe, expect, it } from 'vitest';
import { markdownMindmap, mindmapLayout, wrapMindmapLabel } from './mindmap';

describe('Markdown mind map', () => {
  it('uses the first title as root, nests headings and ordered/task lists, and hides front matter', () => {
    const tree = markdownMindmap('---\nsecret: hidden\n---\n# Project\n## Product\n- [x] Design\n  - Prototype\n## Development\n1. Frontend\n2. Backend', 'Fallback');
    expect(tree.label).toBe('Project');
    expect(tree.children.map(n => n.label)).toEqual(['Product', 'Development']);
    expect(tree.children[0].children[0].label).toBe('☑ Design');
    expect(tree.children[0].children[0].children[0].label).toBe('Prototype');
    expect(tree.children[1].children.map(n => n.label)).toEqual(['Frontend', 'Backend']);
    expect(JSON.stringify(tree)).not.toContain('secret');
  });
  it('handles empty documents, skipped heading levels and repeated labels without losing nodes', () => {
    expect(markdownMindmap('', 'Empty')).toMatchObject({label: 'Empty', children: []});
    const tree = markdownMindmap('### Same\n##### Child\n### Same', 'Note');
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].children[0].label).toBe('Child');
    expect(tree.children[0].id).not.toBe(tree.children[1].id);
  });
  it('treats inline formatting as text, omits raw HTML and never interprets image or link destinations', () => {
    const tree = markdownMindmap('# **Title**\n\n[link](javascript:alert) ![image](https://tracking.test)\n\n<script>evil()</script>', 'Note');
    expect(tree.label).toBe('Title');
    expect(tree.children[0].label).toBe('link image');
    expect(JSON.stringify(tree)).not.toMatch(/javascript|tracking|evil/);
  });
  it('hides only descendants of collapsed branches and restores them on expansion', () => {
    const tree = markdownMindmap('# Root\n## A\n- Child\n## B', 'Note');
    const full = mindmapLayout(tree, new Set());
    const folded = mindmapLayout(tree, new Set([tree.children[0].id]));
    expect(full.nodes).toHaveLength(4);
    expect(folded.nodes.map(n => n.node.label)).toEqual(['A', 'B', 'Root']);
    expect(mindmapLayout(tree, new Set()).nodes).toEqual(full.nodes);
  });
  it('wraps long Chinese and Latin text without truncating it and allocates taller nodes', () => {
    const long = '北宋是中国历史上一个文化繁荣的重要朝代，经济和科技都有显著发展，留下了丰富的历史文献与艺术作品';
    const lines = wrapMindmapLabel(long);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(long);
    const tree = markdownMindmap(`# Root\n- ${long}`, 'Note');
    const child = mindmapLayout(tree, new Set()).nodes.find(item => item.node.label === long)!;
    expect(child.lines.join('')).toBe(long);
    expect(child.height).toBeGreaterThan(48);
  });
});
