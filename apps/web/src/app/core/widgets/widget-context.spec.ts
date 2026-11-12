import { signal } from '@angular/core';
import { DataError } from '../../data';
import type { JsonObject, WidgetInstanceRecord } from '../../data';
import { fixtureDefinition } from '../testing/fixture-definitions';
import { MAX_CONFIG_CHARS } from './widget-config';
import {
  WidgetConfigError,
  WidgetInstanceNotFoundError,
  createWidgetContext,
} from './widget-context';
import type { WidgetConfigWriter } from './widget-context';

const record: WidgetInstanceRecord = {
  id: 'inst-1',
  dashboardId: 'dash-1',
  widgetType: 'fixture',
  grid: { x: 0, y: 0, w: 2, h: 2 },
  config: { label: 'default' },
  configVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

interface Call {
  readonly config: JsonObject;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function setup() {
  const calls: Call[] = [];
  const writer: WidgetConfigWriter = {
    saveConfig: (id, config, version) =>
      new Promise((resolve, reject) => {
        expect(id).toBe('inst-1');
        expect(version).toBe(1);
        calls.push({ config, resolve: () => resolve(record), reject });
      }),
  };
  const ctx = createWidgetContext({
    record,
    definition: fixtureDefinition({ permissions: ['network'] }),
    initialConfig: { label: 'default' },
    size: signal({ w: 2, h: 2 }),
    writer,
  });
  return { ctx, calls };
}

describe('createWidgetContext', () => {
  it('exposes identity, size and permissions', () => {
    const { ctx } = setup();
    expect(ctx.instanceId).toBe('inst-1');
    expect(ctx.type).toBe('fixture');
    expect(ctx.size()).toEqual({ w: 2, h: 2 });
    expect(ctx.permissions.has('network')).toBe(true);
  });

  it('updates the signal immediately and writes once', async () => {
    const { ctx, calls } = setup();
    const done = ctx.updateConfig({ label: 'next' });
    expect(ctx.config()).toEqual({ label: 'next' });
    expect(calls).toHaveLength(1);
    expect(calls[0].config).toEqual({ label: 'next' });
    calls[0].resolve();
    await done;
  });

  it('rejects a too large config without writing', async () => {
    const { ctx, calls } = setup();
    await expect(ctx.updateConfig({ label: 'a'.repeat(MAX_CONFIG_CHARS) })).rejects.toMatchObject({
      reason: 'too-large',
    });
    expect(calls).toHaveLength(0);
  });

  it('keeps signal and base untouched on a rejected config', async () => {
    const { ctx, calls } = setup();
    await expect(ctx.updateConfig({ label: '' })).rejects.toBeInstanceOf(WidgetConfigError);
    expect(ctx.config()).toEqual({ label: 'default' });
    expect(calls).toHaveLength(0);
  });

  it('restores the persisted value when the writer fails', async () => {
    const { ctx, calls } = setup();
    const done = ctx.updateConfig({ label: 'next' });
    calls[0].reject(new Error('disk'));
    await expect(done).rejects.toThrow('disk');
    expect(ctx.config()).toEqual({ label: 'default' });
  });

  it('coalesces concurrent updates into one running write and one pending write', async () => {
    const { ctx, calls } = setup();
    const first = ctx.updateConfig({ label: 'one' });
    const second = ctx.updateConfig({ label: 'two' });
    const third = ctx.updateConfig({ label: 'three' });
    expect(calls).toHaveLength(1);
    calls[0].resolve();
    await first;
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].config).toEqual({ label: 'three' });
    calls[1].resolve();
    await Promise.all([second, third]);
    expect(calls).toHaveLength(2);
    expect(ctx.config()).toEqual({ label: 'three' });
  });

  it('maps not_found to WidgetInstanceNotFoundError and restores the signal', async () => {
    const { ctx, calls } = setup();
    const done = ctx.updateConfig({ label: 'next' });
    calls[0].reject(new DataError('not_found', 'gone'));
    await expect(done).rejects.toBeInstanceOf(WidgetInstanceNotFoundError);
    expect(ctx.config()).toEqual({ label: 'default' });
  });

  it('turns a burst of 5 calls into 2 writes and persists the last value', async () => {
    const { ctx, calls } = setup();
    const results = ['a', 'b', 'c', 'd', 'e'].map((label) => ctx.updateConfig({ label }));
    expect(ctx.config()).toEqual({ label: 'e' });
    expect(calls).toHaveLength(1);
    expect(calls[0].config).toEqual({ label: 'a' });
    calls[0].resolve();
    await results[0];
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].config).toEqual({ label: 'e' });
    let settled = 0;
    results.slice(1).forEach((r) => void r.then(() => settled++));
    await Promise.resolve();
    expect(settled).toBe(0);
    calls[1].resolve();
    await Promise.all(results);
    expect(settled).toBe(4);
    expect(calls).toHaveLength(2);
    expect(ctx.config()).toEqual({ label: 'e' });
  });

  it('rejects coalesced promises and restores the last persisted value when the pending write fails', async () => {
    const { ctx, calls } = setup();
    const first = ctx.updateConfig({ label: 'one' });
    const second = ctx.updateConfig({ label: 'two' });
    const third = ctx.updateConfig({ label: 'three' });
    calls[0].resolve();
    await first;
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].reject(new Error('disk'));
    await expect(second).rejects.toThrow('disk');
    await expect(third).rejects.toThrow('disk');
    expect(ctx.config()).toEqual({ label: 'one' });
  });

  it('keeps the newest value when the running write fails but the pending one succeeds', async () => {
    const { ctx, calls } = setup();
    const first = ctx.updateConfig({ label: 'one' });
    const second = ctx.updateConfig({ label: 'two' });
    calls[0].reject(new Error('disk'));
    await expect(first).rejects.toThrow('disk');
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(ctx.config()).toEqual({ label: 'two' });
    calls[1].resolve();
    await second;
    expect(ctx.config()).toEqual({ label: 'two' });
  });

  it('maps not_found of a coalesced write to WidgetInstanceNotFoundError', async () => {
    const { ctx, calls } = setup();
    const first = ctx.updateConfig({ label: 'one' });
    const second = ctx.updateConfig({ label: 'two' });
    calls[0].resolve();
    await first;
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1].reject(new DataError('not_found', 'gone'));
    await expect(second).rejects.toBeInstanceOf(WidgetInstanceNotFoundError);
    expect(ctx.config()).toEqual({ label: 'one' });
  });

  it('starts a new write once the queue has drained', async () => {
    const { ctx, calls } = setup();
    const first = ctx.updateConfig({ label: 'one' });
    calls[0].resolve();
    await first;
    const second = ctx.updateConfig({ label: 'two' });
    expect(calls).toHaveLength(2);
    calls[1].resolve();
    await second;
  });
});
