import { expect, it } from 'vitest';
import configSource from '../src-tauri/tauri.conf.json?raw';

it('leaves native tree drag events to the HTML frontend', () => {
  // Tauri's native file-drop handler consumes hover/drop events on the WebView.
  // An omitted value defaults to true and breaks HTML drag-and-drop.
  const config = JSON.parse(configSource);
  expect(config.app.windows.find((window: { label: string }) => window.label === 'main').dragDropEnabled).toBe(false);
});
