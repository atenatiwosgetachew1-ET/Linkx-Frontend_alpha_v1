import { describe, expect, it } from 'vitest';

import { registerCatalog, setLocale, t, tn } from './index.js';

describe('i18n', () => {
  it('formats plain and plural messages', () => {
    expect(t('source.search.loadMore')).toBe('Load more');
    expect(tn('source.search.selectedFiles', 1)).toBe('1 selected file');
    expect(tn('source.search.selectedFiles', 3)).toBe('3 selected files');
  });

  it('falls back to the key when a message is missing', () => {
    expect(t('missing.key')).toBe('missing.key');
  });

  it('switches locale with a registered catalog and falls back to English', () => {
    registerCatalog('xx', { 'source.search.loadMore': 'Mehr laden' });
    setLocale('xx');
    expect(t('source.search.loadMore')).toBe('Mehr laden');
    expect(t('common.cancelled')).toBe('Cancelled');
    setLocale('en');
  });
});
