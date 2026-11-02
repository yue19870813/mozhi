import { expect, it } from 'vitest';
import { attachmentImagePath } from './attachment-image';

it('resolves vault attachment paths relative to the note', () => {
  expect(attachmentImagePath('notes/note.md', '../attachments/a%20b.png')).toBe('attachments/a b.png');
  expect(attachmentImagePath('note.md', './attachments/image.png')).toBe('attachments/image.png');
});
it('rejects remote images, absolute paths, traversal and malformed encodings', () => {
  for (const path of ['https://example.com/a.png', 'data:image/png;base64,x', '//example.com/a', '/attachments/a', '../attachments/a', 'attachments/../../a', '%2Fattachments/a', 'attachments/%5c..%5ca', 'attachments/%00a', 'attachments/a?x', '%zz', 'other/a']) {
    expect(attachmentImagePath('note.md', path), path).toBeNull();
  }
});
