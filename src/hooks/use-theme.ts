import { useEffect } from 'react';
import { useUI, type Theme } from '@/lib/ui-store';
import { desktop, invoke } from '@/lib/bridge';
export function applyTheme(
  theme: Theme,
  dark = window.matchMedia('(prefers-color-scheme: dark)').matches,
) {
  const effective = theme === 'system' ? (dark ? 'dark' : 'light') : theme;
  document.documentElement.classList.toggle('dark', effective === 'dark');
  document.documentElement.style.colorScheme = effective;
}
export function useTheme() {
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(theme, media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return {
    theme,
    setTheme: async (value: Theme) => {
      if (desktop) await invoke('set_theme', { theme: value });
      useUI.getState().setTheme(value);
    },
  };
}
