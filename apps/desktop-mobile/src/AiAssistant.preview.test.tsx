// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiAssistant, emptyAiSession } from './AiAssistant';
import type { AiPrepared } from './api';
import { setLanguage } from './i18n';

const bridge = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api', () => ({ native: true, aiRequest: bridge.request, errorText: String }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const preview: AiPrepared = {
  id: 'preview', vaultId: 'vault', config: { baseUrl: 'https://example.test', model: 'test' },
  mode: 'ask', question: '今年读书计划', authorized: false, history: [],
  sources: [1, 2].map(id => ({ id, path: `${id}.md`, text: `note ${id}`, contentHash: `hash${id}`, truncated: false })),
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setLanguage('zh-CN');
  vi.clearAllMocks();
  bridge.request.mockImplementation(async (_vault, request) => {
    if (request.action === 'prepare') return preview;
    if (request.action === 'send') return { text: 'answer [2]', sources: preview.sources.filter(s => request.sourceIds.includes(s.id)) };
    return false;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function button(label: string) {
  const result = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function checkbox(path: string) { return host.querySelector<HTMLInputElement>(`input[aria-label="${path}"]`)!; }
async function mount() {
  const initial = { ...emptyAiSession(), question: preview.question };
  await act(async () => root.render(<AiAssistant vaultId="vault" notes={[]} directories={[]} initial={initial} onSession={()=>{}} onOpen={()=>{}} onSettings={()=>{}} onSave={async()=>true} summaryPath="" beforeOptimize={async()=>true} onApplyOptimization={async()=>true}/>));
  await act(async () => button('准备参考内容').click());
}

it('defaults all preview sources to selected and sends only the remaining sources', async () => {
  await mount();
  expect(checkbox('1.md').checked).toBe(true);
  expect(checkbox('2.md').checked).toBe(true);
  await act(async () => checkbox('1.md').click());
  expect(checkbox('1.md').checked).toBe(false);
  await act(async () => button('确认发送').click());
  const sends = bridge.request.mock.calls.filter(([, request]) => request.action === 'send');
  expect(sends).toHaveLength(1);
  expect(sends[0][1]).toEqual({ action: 'send', id: 'preview', confirmed: true, sourceIds: [2] });
  expect(host.querySelector('button[title="2.md"]')).not.toBeNull();
  expect(host.querySelector('button[title="1.md"]')).toBeNull();
});

it('disables sending with no references and allows selecting a document again', async () => {
  await mount();
  await act(async () => { checkbox('1.md').click(); checkbox('2.md').click(); });
  expect(button('确认发送').disabled).toBe(true);
  await act(async () => button('确认发送').click());
  expect(bridge.request.mock.calls.some(([, r]) => r.action === 'send')).toBe(false);
  await act(async () => checkbox('1.md').click());
  expect(button('确认发送').disabled).toBe(false);
});

it('starts a new preview with all sources selected after cancellation', async () => {
  await mount();
  await act(async () => checkbox('1.md').click());
  await act(async () => button('取消').click());
  await act(async () => button('准备参考内容').click());
  expect(checkbox('1.md').checked).toBe(true);
  expect(checkbox('2.md').checked).toBe(true);
});
