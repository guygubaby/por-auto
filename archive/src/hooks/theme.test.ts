import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyTheme, useTheme } from './use-theme';
import { useUI } from '@/lib/ui-store';
describe('light, dark and system themes', () => {
  it('sets the actual color scheme and persists the requested mode', () => {
    applyTheme('system', true);
    expect(document.documentElement).toHaveClass('dark');
    applyTheme('light', true);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
    applyTheme('dark', false);
    expect(document.documentElement).toHaveClass('dark');
  });
  it('responds to live OS changes only while following system and removes its listener', () => {
    const media = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue(
      media as unknown as MediaQueryList,
    );
    useUI.setState({ theme: 'system' });
    const { rerender, unmount } = renderHook(() => useTheme());
    expect(document.documentElement).not.toHaveClass('dark');
    media.matches = true;
    act(() => media.addEventListener.mock.calls[0][1]());
    expect(document.documentElement).toHaveClass('dark');
    act(() => useUI.setState({ theme: 'light' }));
    rerender();
    expect(document.documentElement).not.toHaveClass('dark');
    expect(JSON.parse(localStorage.getItem('por-auto-ui')!).state.theme).toBe(
      'light',
    );
    unmount();
    expect(media.removeEventListener).toHaveBeenCalled();
  });
});
