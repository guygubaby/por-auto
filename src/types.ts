import { z } from 'zod';
export const deviceSchema = z.object({
  serial: z.string(),
  state: z.string(),
  model: z.string(),
});
export const environmentSchema = z.object({
  ready: z.boolean(),
  version: z.string(),
  platform: z.string(),
  devices: z.array(deviceSchema),
  automation_version: z.string().optional(),
});
export type Device = z.infer<typeof deviceSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type ExecutionMode = 'native' | 'visual';
export interface Workflow {
  id: string;
  name: string;
  version: string;
  description: string;
  package: string;
  inputSchema?: unknown;
  steps: { id?: string; name: string; action: { type: string } }[];
}
const pairSchema = z.object({ name: z.string(), value: z.string() });
const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), credential: z.string() }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    credential: z.string(),
  }),
  z.object({
    type: z.literal('api_key'),
    name: z.string(),
    location: z.enum(['header', 'query']),
    credential: z.string(),
  }),
]);
export const httpRequestSchema = z.object({
  url: z.url('请输入有效的 HTTP 请求地址'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  query: z.array(pairSchema),
  headers: z.array(pairSchema),
  auth: authSchema,
  body: z.unknown(),
  response: z.union([
    z.object({ type: z.enum(['text', 'ignore']) }),
    z.object({ type: z.literal('json'), pointer: z.string() }),
    z.object({
      type: z.literal('javascript'),
      code: z.string().min(1, '请输入 JavaScript 代码').max(10000),
    }),
  ]),
  timeoutSeconds: z.number().int().min(5).max(120),
});
export const hooksSchema = z.object({
  beforeRun: httpRequestSchema.nullable(),
  afterRun: httpRequestSchema.nullable(),
});
export const recipientCategoriesSchema = z
  .object({ direct: z.boolean(), groups: z.boolean() })
  .refine(
    (value) => value.direct || value.groups,
    '至少选择全部单聊或全部群聊',
  );
const legacyRecipientsSchema = z.object({
  scope: z.enum(['groups', 'conversations']),
  mode: z.enum(['all', 'selected']),
  names: z.array(z.string()),
});
export const sendInputSchema = z.object({
  message: z.discriminatedUnion('type', [
    z.object({ type: z.literal('manual'), text: z.string() }),
    z.object({ type: z.literal('before_run') }),
    z.object({
      type: z.literal('http'),
      request: httpRequestSchema,
      refresh: z.enum(['run', 'recipient']),
    }),
  ]),
  recipients: recipientCategoriesSchema,
  intervalMs: z
    .number()
    .int()
    .min(500, '间隔至少为 500 毫秒')
    .max(600000, '间隔最多为 10 分钟'),
});
export type Pair = z.infer<typeof pairSchema>;
export type Auth = z.infer<typeof authSchema>;
export type HttpRequest = z.infer<typeof httpRequestSchema>;
export type Hooks = z.infer<typeof hooksSchema>;
export type SendInput = z.infer<typeof sendInputSchema>;
export type StoredSendInput = Omit<SendInput, 'recipients'> & {
  recipients: SendInput['recipients'] | z.infer<typeof legacyRecipientsSchema>;
};
export interface Installed {
  key: string;
  registryUrl: string;
  reference: string;
  commit: string;
  workflow: Workflow;
  input?: StoredSendInput | null;
  hooks?: Hooks;
  executionMode?: ExecutionMode;
  dryRun?: boolean;
}
export interface Registry {
  url: string;
  reference: string;
  name: string;
  commit: string;
  workflows: Workflow[];
}
export interface Store {
  schemaVersion: number;
  registries: Registry[];
  installed: Installed[];
}
export interface RunResult {
  nickname: string | null;
  outputs: Record<string, string>;
  workflow_name: string;
  workflow_version: string;
  workflow_key: string;
  serial: string;
  timestamp: number;
  screenshot: string | null;
  error: string | null;
  warning: string | null;
  folder: string;
}
export interface Progress {
  serial: string;
  workflow_key: string;
  scheduled: boolean;
  step: number;
  total: number;
  message: string;
}
export interface DeviceRun {
  serial: string;
  model: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result: RunResult | null;
  error: string | null;
  progress?: Progress;
}
export interface RunSummary {
  id: string;
  workflow_name: string;
  workflow_version: string;
  serial: string;
  timestamp: number;
  status: string;
  error?: string;
  dry_run?: boolean;
  schedule_id?: string | null;
  schedule_name?: string | null;
}
export interface Target {
  title: string;
  scope?: 'groups' | 'conversations';
  status: string;
  error?: string | null;
}
export interface RunDetails {
  summary: RunSummary;
  result: RunResult | null;
  events: {
    timestamp: number;
    status: string;
    message: string;
    details?: unknown;
  }[];
  targets: Target[];
  folder: string;
  batch?: {
    message?: string;
    devices?: { serial: string; runId: string | null; error: string | null }[];
  } | null;
}
export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  serials: string[];
  snapshot: Installed;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastMessage: string | null;
}
export interface ScheduleView {
  tasks: Schedule[];
  runningIds: string[];
  error: string | null;
}
export interface Provider {
  baseUrl: string;
  model: string;
  credential?: string | null;
  allowScreenshots: boolean;
  timeoutSeconds: number;
  thinking: boolean | null;
}
export interface UpdateStatus {
  phase: string;
  currentVersion: string;
  version?: string;
  notes?: string;
  error?: string;
  checkedAt?: number;
  downloaded: number;
  total?: number;
  autoCheck: boolean;
}
export const defaultResponseCode =
  "return (res || []).map((item) => item.text).join('\\n');";
export function defaultRequest(): HttpRequest {
  return {
    url: '',
    method: 'GET',
    query: [],
    headers: [],
    auth: { type: 'none' },
    body: null,
    response: { type: 'javascript', code: defaultResponseCode },
    timeoutSeconds: 20,
  };
}
export function httpResponseCode(response: HttpRequest['response']): string {
  if (response.type === 'javascript') return response.code;
  if (response.type === 'json') {
    const fields =
      response.pointer === '' ? [] : response.pointer.slice(1).split('/');
    return `return res${fields.map((field) => `[${JSON.stringify(field.replace(/~1/g, '/').replace(/~0/g, '~'))}]`).join('')};`;
  }
  return defaultResponseCode;
}
export function defaultInput(): SendInput {
  return {
    message: { type: 'manual', text: '' },
    recipients: { direct: false, groups: true },
    intervalMs: 1000,
  };
}
export function hasRecipientCategories(
  input: StoredSendInput | null | undefined,
): input is SendInput {
  return (
    !!input &&
    'direct' in input.recipients &&
    typeof input.recipients.direct === 'boolean' &&
    'groups' in input.recipients &&
    typeof input.recipients.groups === 'boolean'
  );
}
export function editableInput(input?: StoredSendInput | null): SendInput {
  if (!input) return defaultInput();
  if (hasRecipientCategories(input)) return input;
  return {
    ...input,
    recipients: {
      direct:
        'scope' in input.recipients &&
        input.recipients.scope === 'conversations',
      groups: true,
    },
  };
}
export function recipientSummary(input?: StoredSendInput | null): string {
  if (!hasRecipientCategories(input)) return '旧版接收范围 · 保留原快照';
  if (input.recipients.direct && input.recipients.groups)
    return '全部单聊和群聊';
  if (input.recipients.groups) return '全部群聊';
  return '全部单聊';
}
export const isSender = (w: Workflow) =>
  w.steps.some((s) =>
    ['chat_send_text', 'chat_broadcast'].includes(s.action.type),
  );
export const isBatch = (w: Workflow) =>
  w.steps.some((s) => s.action.type === 'chat_broadcast');
