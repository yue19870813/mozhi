import { t } from './i18n';
export type CreateKind = 'note' | 'directory';

export function parentDirectory(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

export function createPath(parent: string, name: string, kind: CreateKind): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\\0-\x1f]/.test(trimmed)) {
    throw new Error(t("请输入名称，不要包含路径分隔符。"));
  }
  const filename = kind === 'note' && !trimmed.endsWith('.md') ? `${trimmed}.md` : trimmed;
  return parent ? `${parent}/${filename}` : filename;
}
