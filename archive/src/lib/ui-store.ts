import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeviceRun, Progress } from '@/types';
export type Theme = 'system' | 'light' | 'dark';
interface UIState {
  theme: Theme;
  serials: string[];
  workflow: string;
  runWorkflowKey: string;
  running: boolean;
  stopping: boolean;
  runs: DeviceRun[];
  setTheme: (theme: Theme) => void;
  select: (serials: string[]) => void;
  selectWorkflow: (workflow: string) => void;
  setRuns: (runs: DeviceRun[]) => void;
  onProgress: (progress: Progress) => void;
}
export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      serials: [],
      workflow: '',
      runWorkflowKey: '',
      running: false,
      stopping: false,
      runs: [],
      setTheme: (theme) => set({ theme }),
      select: (serials) => set({ serials }),
      selectWorkflow: (workflow) => set({ workflow }),
      setRuns: (runs) => set({ runs }),
      onProgress: (progress) => {
        if (
          progress.scheduled ||
          !get().running ||
          progress.workflow_key !== get().runWorkflowKey
        )
          return;
        set({
          runs: get().runs.map((run) =>
            run.serial === progress.serial
              ? { ...run, status: 'running', progress }
              : run,
          ),
        });
      },
    }),
    {
      name: 'por-auto-ui',
      partialize: ({ theme, serials, workflow }) => ({
        theme,
        serials,
        workflow,
      }),
    },
  ),
);
