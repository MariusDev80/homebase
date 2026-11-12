import { TestBed } from '@angular/core/testing';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { WidgetPermissionError } from '../widgets';
import type { WidgetContext } from '../widgets';
import {
  InvalidUrlError,
  URL_OPENER_BROWSER_FALLBACK,
  UrlOpener,
  UrlOpenerUnavailableError,
} from './url-opener';
import { parseWebUrl } from './web-url';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const allowed: Pick<WidgetContext, 'type' | 'permissions'> = {
  type: 'shortcuts',
  permissions: new Set(['open-url']),
};
const denied: Pick<WidgetContext, 'type' | 'permissions'> = {
  type: 'hello',
  permissions: new Set(),
};

describe('parseWebUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['  http://example.com/a?b=1#c  ', 'http://example.com/a?b=1#c'],
    ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['http:\\\\server\\share', 'http://server/share'],
    ['https:example.com', 'https://example.com/'],
    ['https://bücher.example/', 'https://xn--bcher-kva.example/'],
    ['https://example.com/a b"c', 'https://example.com/a%20b%22c'],
    ['https://exam\tple.com/\n', 'https://example.com/'],
  ])('accepts %j', (input, href) => {
    expect(parseWebUrl(input)).toEqual({ ok: true, url: href });
  });

  it('never returns a URL with a space, a quote or a control character', () => {
    const result = parseWebUrl('https://example.com/a b"c\u0001d');
    expect(result.ok).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(result.ok && /[\s"\u0000-\u001f]/.test(result.url)).toBe(false);
  });

  it.each([
    ['javascript:alert(1)', 'protocol'],
    ['file:///C:/Windows/system32/cmd.exe', 'protocol'],
    ['data:text/html,<script>alert(1)</script>', 'protocol'],
    ['mailto:a@b.c', 'protocol'],
    ['ftp://example.com', 'protocol'],
    ['https://user@example.com', 'credentials'],
    ['https://user:pass@example.com', 'credentials'],
    ['example.com', 'invalid'],
    ['\\\\server\\share', 'invalid'],
    ['https://exa mple.com', 'invalid'],
    ['https://exa\u0000mple.com', 'invalid'],
    ['https://exa\u0007mple.com', 'invalid'],
    ['', 'invalid'],
    ['https://', 'invalid'],
    ['https://example.com/' + 'a'.repeat(2048), 'too-long'],
  ])('refuses %j (%s)', (input, reason) => {
    expect(parseWebUrl(input)).toEqual({ ok: false, reason });
  });
});

describe('UrlOpener', () => {
  const isTauriMock = vi.mocked(isTauri);
  const openUrlMock = vi.mocked(openUrl);
  let opener: UrlOpener;
  let windowOpen: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    isTauriMock.mockReset().mockReturnValue(true);
    openUrlMock.mockReset().mockResolvedValue();
    windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    opener = TestBed.inject(UrlOpener);
  });
  afterEach(() => windowOpen.mockRestore());

  it('refuses a widget without the open-url permission, before anything else', async () => {
    await expect(opener.open(denied, 'https://example.com')).rejects.toBeInstanceOf(
      WidgetPermissionError,
    );
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows/system32/cmd.exe',
    'data:text/html,hi',
    'https://user:pass@example.com/',
    'not a url',
  ])('refuses %s', async (url) => {
    await expect(opener.open(allowed, url)).rejects.toBeInstanceOf(InvalidUrlError);
    expect(openUrlMock).not.toHaveBeenCalled();
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it.each(['http://example.com/', 'https://example.com/path?q=1'])(
    'opens %s through the Tauri opener',
    async (url) => {
      await opener.open(allowed, url);
      expect(openUrlMock).toHaveBeenCalledExactlyOnceWith(url);
      expect(windowOpen).not.toHaveBeenCalled();
    },
  );

  it('throws outside Tauri when not in dev mode', async () => {
    isTauriMock.mockReturnValue(false);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: URL_OPENER_BROWSER_FALLBACK, useValue: false }],
    });
    opener = TestBed.inject(UrlOpener);
    await expect(opener.open(allowed, 'https://example.com')).rejects.toBeInstanceOf(
      UrlOpenerUnavailableError,
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('falls back to window.open with noopener,noreferrer outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    await opener.open(allowed, 'https://example.com');
    expect(windowOpen).toHaveBeenCalledExactlyOnceWith(
      'https://example.com/',
      '_blank',
      'noopener,noreferrer',
    );
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it('propagates a plugin failure', async () => {
    openUrlMock.mockRejectedValue(new Error('denied by scope'));
    await expect(opener.open(allowed, 'https://example.com')).rejects.toThrow('denied by scope');
  });
});
