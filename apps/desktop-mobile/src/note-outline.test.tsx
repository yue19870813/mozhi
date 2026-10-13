import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { noteOutline } from './note-outline';
import { Preview } from './Preview';

describe('note outline', () => {
  it('uses live Markdown headings and exact source offsets, excluding front matter and code', () => {
    const content = '---\ntags: [work]\n---\n# Overview\n\n## Plan *today*\n\n```md\n# Not a heading\n```\n\nPlan again\n----------\n';
    const headings = noteOutline(content);
    expect(headings.map(({level,text}) => [level,text])).toEqual([[1,'Overview'],[2,'Plan today'],[2,'Plan again']]);
    for (const heading of headings) expect(content.slice(heading.offset)).toMatch(/^(#|Plan again)/);
    const html = renderToStaticMarkup(<Preview content={content} onOpen={() => {}}/>);
    for (const heading of headings) expect(html).toContain(`data-outline-offset="${heading.offset}"`);
  });

  it('keeps duplicate headings distinct by source position', () => {
    const headings = noteOutline('## Repeat\n\n## Repeat\n');
    expect(headings.map(heading => heading.text)).toEqual(['Repeat','Repeat']);
    expect(headings[0].offset).not.toBe(headings[1].offset);
  });
});
