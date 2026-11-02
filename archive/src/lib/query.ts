import { QueryClient, queryOptions } from '@tanstack/react-query';
import { invoke } from './bridge';
import {
  environmentSchema,
  type Store,
  type RunSummary,
  type ScheduleView,
  type Progress,
} from '@/types';
import { desktop } from './bridge';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
    mutations: { networkMode: 'always', retry: false },
  },
});
export const storeQuery = queryOptions({
  queryKey: ['store'],
  queryFn: () => invoke<Store>('workflow_store'),
});
export const environmentQuery = queryOptions({
  queryKey: ['environment'],
  queryFn: async () =>
    environmentSchema.parse(await invoke('check_environment')),
  networkMode: 'always',
  refetchInterval: desktop ? 2000 : false,
  refetchIntervalInBackground: true,
});
export const runsQuery = queryOptions({
  queryKey: ['runs'],
  queryFn: () => invoke<RunSummary[]>('list_runs'),
});
export const schedulesQuery = queryOptions({
  queryKey: ['schedules'],
  queryFn: () => invoke<ScheduleView>('list_schedules'),
  networkMode: 'always',
});
export const activeQuery = queryOptions({
  queryKey: ['active-runs'],
  queryFn: () =>
    invoke<Record<string, Partial<Progress> & { message: string }>>(
      'active_runs',
    ),
  enabled: desktop,
  networkMode: 'always',
  refetchInterval: 1500,
  refetchIntervalInBackground: true,
});
