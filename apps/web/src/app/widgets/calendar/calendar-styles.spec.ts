import { ensureCalendarStyles } from './calendar-styles';

const links = (doc: Document) => doc.head.querySelectorAll('link[data-hb-style="calendar-lib"]');

describe('ensureCalendarStyles', () => {
  afterEach(() => document.head.querySelectorAll('link').forEach((l) => l.remove()));

  it('inserts one link for two calls and resolves on load', async () => {
    const first = ensureCalendarStyles(document);
    const second = ensureCalendarStyles(document);
    expect(links(document)).toHaveLength(1);
    expect(links(document)[0].getAttribute('href')).toBe('calendar-lib.css');
    links(document)[0].dispatchEvent(new Event('load'));
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('rejects on error and tries again afterwards', async () => {
    const failed = ensureCalendarStyles(document);
    links(document)[0].dispatchEvent(new Event('error'));
    await expect(failed).rejects.toThrow();
    expect(links(document)).toHaveLength(0);
    void ensureCalendarStyles(document);
    expect(links(document)).toHaveLength(1);
  });

  it('rejects after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const timedOut = expect(ensureCalendarStyles(document, 50)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(60);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });
});
