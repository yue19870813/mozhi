import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, Nodes } from 'mdast';
import { markdownBody } from './note-outline';

export type MindmapNode = { id: string; label: string; children: MindmapNode[] };
export type MindmapPosition = { node: MindmapNode; x: number; y: number; height: number; lines: string[]; parent?: string };
const NODE_WIDTH = 260;
function lineWidth(value: string) {
  return Array.from(value).reduce((width, char) => width + (/[\u0000-\u00ff]/.test(char) ? 0.58 : 1), 0);
}
export function wrapMindmapLabel(label: string, maxWidth = 16): string[] {
  const lines: string[] = [];
  let line = '';
  let width = 0;
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const wordWidth = lineWidth(word);
    if (line && width + 1 + wordWidth <= maxWidth) {
      line += ` ${word}`;
      width += 1 + wordWidth;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    width = 0;
    for (const char of word) {
      const charWidth = lineWidth(char);
      if (line && width + charWidth > maxWidth) {
        lines.push(line);
        line = '';
        width = 0;
      }
      line += char;
      width += charWidth;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['…'];
}
function text(node: Nodes): string {
  if (node.type === 'html') return '';
  if ('children' in node) return node.children.map(text).join('');
  return 'value' in node ? node.value : node.type === 'image' ? node.alt ?? '' : '';
}

/** Parse structure only: never execute HTML or fetch linked resources. */
export function markdownMindmap(content: string, title: string): MindmapNode {
  const parsed = unified().use(remarkParse).use(remarkGfm).parse(markdownBody(content).text);
  let next = 0;
  const make = (label: string): MindmapNode => ({ id: String(next++), label, children: [] });
  const root = make(title);
  const stack = [{ depth: 0, node: root }];
  const first = parsed.children[0];
  const useTitle = first?.type === 'heading' && first.depth === 1;
  if (useTitle) root.label = text(first) || title;
  function append(block: RootContent, parent: MindmapNode) {
    if (block.type === 'list') {
      for (const item of block.children) {
        const label = item.children.filter(child => child.type !== 'list').map(text).filter(Boolean).join(' ');
        const node = make(`${item.checked == null ? '' : item.checked ? '☑ ' : '☐ '}${label || '…'}`);
        parent.children.push(node);
        for (const child of item.children) if (child.type === 'list') append(child, node);
      }
    } else if (block.type === 'blockquote') {
      for (const child of block.children) append(child, parent);
    } else {
      const label = text(block).trim();
      if (label) parent.children.push(make(label));
    }
  }
  for (const block of parsed.children.slice(useTitle ? 1 : 0)) {
    if (block.type === 'heading') {
      while (stack.length > 1 && stack[stack.length - 1].depth >= block.depth) stack.pop();
      const node = make(text(block) || '…');
      stack[stack.length - 1].node.children.push(node);
      stack.push({ depth: block.depth, node });
    } else append(block, stack[stack.length - 1].node);
  }
  return root;
}

export function mindmapLayout(root: MindmapNode, collapsed: ReadonlySet<string>) {
  const nodes: MindmapPosition[] = [];
  let cursor = 40;
  function place(node: MindmapNode, depth: number, parent?: string): { top: number; bottom: number; center: number } {
    const children = collapsed.has(node.id) ? [] : node.children;
    const childBounds = children.map(child => place(child, depth + 1, node.id));
    const lines = wrapMindmapLabel(node.label);
    const height = Math.max(48, lines.length * 20 + 20);
    let top: number, bottom: number, center: number;
    if (childBounds.length) {
      top = childBounds[0].top;
      bottom = childBounds[childBounds.length - 1].bottom;
      center = (childBounds[0].center + childBounds[childBounds.length - 1].center) / 2;
      if (bottom - top < height) {
        top = center - height / 2;
        bottom = center + height / 2;
      }
    } else {
      top = cursor;
      center = top + height / 2;
      bottom = top + height;
      cursor = bottom + 24;
    }
    nodes.push({ node, x: 40 + depth * 320, y: center, height, lines, parent });
    return { top, bottom, center };
  }
  place(root, 0);
  return { nodes, width: Math.max(...nodes.map(n => n.x)) + NODE_WIDTH + 40, height: Math.max(160, cursor - 24 + 40) };
}
