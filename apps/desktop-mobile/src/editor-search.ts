import { EditorState } from '@codemirror/state';
import { SearchQuery } from '@codemirror/search';
import { t } from './i18n';

export function searchPhrases() {
  return EditorState.phrases.of({
    Find: t('查找'), Replace: t('替换'), next: t('下一个'), previous: t('上一个'),
    all: t('选中全部'), 'match case': t('区分大小写'), regexp: t('正则表达式'),
    'by word': t('全词匹配'), replace: t('替换'), 'replace all': t('全部替换'), close: t('关闭'),
  });
}

export function matchCount(state: EditorState, query: SearchQuery): string {
  if (!query.search || !query.valid) return '0';
  let count = 0;
  const cursor = query.getCursor(state);
  while (!cursor.next().done) {
    if (++count > 10000) return '10000+';
  }
  return String(count);
}
