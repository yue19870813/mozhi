import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { Root, PhrasingContent } from 'mdast';

export type OutlineHeading = { level: number; text: string; offset: number };

export function markdownBody(content: string) {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  return { text: match ? content.slice(match[0].length) : content, offset: match?.[0].length ?? 0 };
}

function headingText(nodes: PhrasingContent[]): string {
  return nodes.map(node => 'value' in node ? String(node.value) : 'children' in node ? headingText(node.children as PhrasingContent[]) : '').join('');
}

export function noteOutline(content: string): OutlineHeading[] {
  const body = markdownBody(content);
  const root = unified().use(remarkParse).parse(body.text) as Root;
  return root.children.filter(node => node.type === 'heading').map(node => ({
    level: node.depth,
    text: headingText(node.children).trim(),
    offset: body.offset + (node.position?.start.offset ?? 0),
  }));
}
