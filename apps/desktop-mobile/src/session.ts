import type { Note } from './api';
export type Save = (note: Note, content: string) => Promise<{ note: Note; indexWarning?: string }>;
/** Serializes saves and advances hashes only after disk acknowledgement. */
export class DocumentSession {
  text: string;
  private pending: Promise<void> = Promise.resolve();
  constructor(public note: Note, private save: Save, private warning: (message: string) => void = () => {}) { this.text = note.content; }
  get dirty() { return this.text !== this.note.content; }
  flush(): Promise<void> {
    this.pending = this.pending.catch(() => {}).then(async () => {
      while (this.dirty) {
        const content = this.text;
        const result = await this.save(this.note, content);
        this.note = result.note;
        if (result.indexWarning) this.warning(result.indexWarning);
      }
    });
    return this.pending;
  }
}
