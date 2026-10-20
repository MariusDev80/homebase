import { TestBed } from '@angular/core/testing';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { SystemService, SystemUnavailableError } from './system.service';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

describe('SystemService', () => {
  const invokeMock = vi.mocked(invoke);
  const isTauriMock = vi.mocked(isTauri);
  let service: SystemService;

  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    service = TestBed.inject(SystemService);
  });

  describe('outside Tauri', () => {
    beforeEach(() => isTauriMock.mockReturnValue(false));

    it('reports unavailable', () => {
      expect(service.isAvailable()).toBe(false);
    });

    it('rejects with SystemUnavailableError without calling invoke', async () => {
      await expect(service.getAutostart()).rejects.toBeInstanceOf(SystemUnavailableError);
      await expect(service.setAutostart(true)).rejects.toBeInstanceOf(SystemUnavailableError);
      await expect(service.scheduleTestNotification(10)).rejects.toBeInstanceOf(
        SystemUnavailableError,
      );
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe('inside Tauri', () => {
    beforeEach(() => isTauriMock.mockReturnValue(true));

    it('schedules a notification with the right command and args', async () => {
      invokeMock.mockResolvedValue(undefined);
      await service.scheduleTestNotification(10);
      expect(invokeMock).toHaveBeenCalledWith('schedule_test_notification', { delaySecs: 10 });
    });

    it('reads autostart', async () => {
      invokeMock.mockResolvedValue(true);
      await expect(service.getAutostart()).resolves.toBe(true);
      expect(invokeMock).toHaveBeenCalledWith('get_autostart', undefined);
    });

    it('sets autostart', async () => {
      invokeMock.mockResolvedValue(undefined);
      await service.setAutostart(false);
      expect(invokeMock).toHaveBeenCalledWith('set_autostart', { enabled: false });
    });

    it('propagates the typed error from Rust', async () => {
      const error = { kind: 'delayOutOfRange', min: 1, max: 3600, got: 0 };
      invokeMock.mockRejectedValue(error);
      await expect(service.scheduleTestNotification(0)).rejects.toEqual(error);
    });
  });
});
