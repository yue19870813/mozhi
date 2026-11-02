import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, Nodes } from 'mdast';
import { attachmentImagePath } from './attachment-image';
import { markdownBody } from './note-outline';

export type MindmapNode = { id: string; label: string; children: MindmapNode[]; images?: { url: string; alt: string }[] };
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
  return 'value' in node ? node.value : (node.type === 'image' || node.type === 'imageReference') ? node.alt ?? '' : '';
}

/** Parse structure only: never execute HTML or fetch linked resources. */
export function markdownMindmap(content: string, title: string, path = ''): MindmapNode {
  const parsed = unified().use(remarkParse).use(remarkGfm).parse(markdownBody(content).text);
  const definitions = new Map(parsed.children.filter(node => node.type === 'definition').map(node => [node.identifier.toLowerCase(), node.url]));
  function images(node: Nodes): { url: string; alt: string }[] {
    if (node.type === 'image' || node.type === 'imageReference') {
      const url = node.type === 'image' ? node.url : definitions.get(node.identifier.toLowerCase());
      return url && attachmentImagePath(path, url) ? [{ url, alt: node.alt ?? '' }] : [];
    }
    return 'children' in node ? node.children.flatMap(images) : [];
  }
  function withImages(node: MindmapNode, blocks: Nodes[]) {
    const found = blocks.flatMap(images);
    if (found.length) node.images = found;
    return node;
  }
  let next = 0;
  const make = (label: string): MindmapNode => ({ id: String(next++), label, children: [] });
  const root = make(title);
  const stack = [{ depth: 0, node: root }];
  const first = parsed.children[0];
  const useTitle = first?.type === 'heading' && first.depth === 1;
  if (useTitle) { root.label = text(first) || title; withImages(root, [first]); }
  function append(block: RootContent, parent: MindmapNode) {
    if (block.type === 'list') {
      for (const item of block.children) {
        const label = item.children.filter(child => child.type !== 'list').map(text).filter(Boolean).join(' ');
        const node = make(`${item.checked == null ? '' : item.checked ? '☑ ' : '☐ '}${label || '…'}`);
        withImages(node, item.children.filter(child => child.type !== 'list'));
        parent.children.push(node);
        for (const child of item.children) if (child.type === 'list') append(child, node);
      }
    } else if (block.type === 'blockquote') {
      for (const child of block.children) append(child, parent);
    } else {
      const label = text(block).trim();
      if (label || images(block).length) parent.children.push(withImages(make(label || '…'), [block]));
    }
  }
  for (const block of parsed.children.slice(useTitle ? 1 : 0)) {
    if (block.type === 'heading') {
      while (stack.length > 1 && stack[stack.length - 1].depth >= block.depth) stack.pop();
      const node = withImages(make(text(block) || '…'), [block]);
      stack[stack.length - 1].node.children.push(node);
      stack.push({ depth: block.depth, node });
    } else append(block, stack[stack.length - 1].node);
  }
  return root;
}

export function mindmapLayout(root: MindmapNode, collapsed: ReadonlySet<string>) {
  const nodes: MindmapPosition[] = [];
  // Reserve each subtree's full height so image-heavy parents cannot overlap siblings.
  const measured = new Map<string, { lines: string[]; height: number; subtree: number }>();
  function measure(node: MindmapNode): number {
    const children = collapsed.has(node.id) ? [] : node.children;
    const lines = wrapMindmapLabel(node.label);
    const height = Math.max(48, lines.length * 20 + 20) + (node.images?.length ?? 0) * 132;
    const childHeight = children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, children.length - 1) * 24;
    const subtree = Math.max(height, childHeight);
    measured.set(node.id, { lines, height, subtree });
    return subtree;
  }
  const totalHeight = measure(root);
  function place(node: MindmapNode, depth: number, top: number, parent?: string) {
    const { lines, height, subtree } = measured.get(node.id)!;
    const children = collapsed.has(node.id) ? [] : node.children;
    const childHeight = children.reduce((sum, child) => sum + measured.get(child.id)!.subtree, 0) + Math.max(0, children.length - 1) * 24;
    let childTop = top + (subtree - childHeight) / 2;
    for (const child of children) {
      place(child, depth + 1, childTop, node.id);
      childTop += measured.get(child.id)!.subtree + 24;
    }
    nodes.push({ node, x: 40 + depth * 320, y: top + subtree / 2, height, lines, parent });
  }
  place(root, 0, 40);
  return { nodes, width: Math.max(...nodes.map(n => n.x)) + NODE_WIDTH + 40, height: Math.max(160, totalHeight + 80) };
}
