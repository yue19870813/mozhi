import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Preview } from './Preview';
function render(content:string){return renderToStaticMarkup(<Preview content={content} onOpen={()=>{}}/>);}
describe('untrusted Markdown preview',()=>{
  it('renders web links as external anchors while keeping note links inside the app',()=>{
    const output=render('[web](https://example.com/docs?q=1#part)\n[note](notes/test.md)\n[[目标]]');
    expect(output).toContain('href="https://example.com/docs?q=1#part"');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('note</button>');
    expect(output).toContain('目标</button>');
  });
  it('does not render executable HTML or load remote images',()=>{
    const output=render('<script>alert(1)</script>\n\n<iframe src="https://evil.test"></iframe>\n\n![tracking](https://evil.test/pixel)\n\n[run](javascript:alert%281%29)');
    expect(output).not.toContain('<script');expect(output).not.toContain('<iframe');expect(output).not.toContain('<img');expect(output).not.toContain('href="javascript:');
  });
  it('renders Wiki links only in prose and keeps unknown metadata out of preview',()=>{
    const output=render('---\ncustom: secret-metadata\n---\n# 标题\n[[项目/目标|别名]]\n\n`[[代码]]`\n\n```md\n[[代码块]]\n```');
    expect(output).toContain('别名</button>');expect(output).toContain('<code>[[代码]]</code>');expect(output).not.toContain('secret-metadata');expect(output.match(/<button/g)?.length).toBe(1);
  });
});
