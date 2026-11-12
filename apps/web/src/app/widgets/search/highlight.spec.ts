import { highlightSegments } from './highlight';
import { buildSearchUrl } from './search-engines';

describe('highlightSegments', () => {
  it('splits every occurrence, case-insensitively, keeping the original case', () => {
    expect(highlightSegments('Angular et angular', 'ANGULAR')).toEqual([
      { text: 'Angular', match: true },
      { text: ' et ', match: false },
      { text: 'angular', match: true },
    ]);
  });

  it('returns the whole text when nothing matches or the query is blank', () => {
    expect(highlightSegments('abc', 'z')).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('abc', '  ')).toEqual([{ text: 'abc', match: false }]);
    expect(highlightSegments('', 'a')).toEqual([{ text: '', match: false }]);
  });

  it('keeps markup as plain text', () => {
    expect(highlightSegments('<b>x</b>', 'x')).toEqual([
      { text: '<b>', match: false },
      { text: 'x', match: true },
      { text: '</b>', match: false },
    ]);
  });
});

describe('buildSearchUrl', () => {
  it('encodes ampersands, hashes, spaces and accents in the query only', () => {
    const url = new URL(buildSearchUrl('google', 'a&b #c é+d'));
    expect(url.origin).toBe('https://www.google.com');
    expect(url.pathname).toBe('/search');
    expect(url.hash).toBe('');
    expect([...url.searchParams.keys()]).toEqual(['q']);
    expect(url.searchParams.get('q')).toBe('a&b #c é+d');
    expect(url.search).toBe('?q=a%26b+%23c+%C3%A9%2Bd');
  });

  it.each(['duckduckgo', 'google', 'bing', 'qwant', 'ecosia'] as const)(
    'builds an https URL for %s',
    (engine) => {
      expect(buildSearchUrl(engine, 'x').startsWith('https://')).toBe(true);
    },
  );
});
