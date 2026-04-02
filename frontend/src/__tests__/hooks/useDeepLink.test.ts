import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(),
}));

import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useDeepLink } from '../../hooks/useDeepLink';

describe('useDeepLink', () => {
  const mockUnlisten = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (onOpenUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUnlisten);
  });

  it('onOpenUrl 리스너를 등록한다', () => {
    renderHook(() => useDeepLink());
    expect(onOpenUrl).toHaveBeenCalledOnce();
  });

  it('유효한 URL 수신 시 token을 localStorage에 저장한다', () => {
    let callback: (urls: string[]) => void;
    (onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb;
      return Promise.resolve(mockUnlisten);
    });

    renderHook(() => useDeepLink());
    callback!(['ddobak://callback?token=test-jwt-token']);

    expect(localStorage.getItem('access_token')).toBe('test-jwt-token');
  });

  it('onToken 콜백을 호출한다', () => {
    let callback: (urls: string[]) => void;
    (onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb;
      return Promise.resolve(mockUnlisten);
    });

    const onToken = vi.fn();
    renderHook(() => useDeepLink(onToken));
    callback!(['ddobak://callback?token=test-jwt-token']);

    expect(onToken).toHaveBeenCalledWith('test-jwt-token');
  });

  it('잘못된 URL은 무시한다', () => {
    let callback: (urls: string[]) => void;
    (onOpenUrl as ReturnType<typeof vi.fn>).mockImplementation((cb) => {
      callback = cb;
      return Promise.resolve(mockUnlisten);
    });

    renderHook(() => useDeepLink());
    callback!(['https://malicious.com?token=xxx']);

    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('언마운트 시 리스너를 해제한다', async () => {
    (onOpenUrl as ReturnType<typeof vi.fn>).mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useDeepLink());
    unmount();

    await vi.waitFor(() => {
      expect(mockUnlisten).toHaveBeenCalled();
    });
  });
});
