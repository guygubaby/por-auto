export interface Pair { name: string; value: string }
export type Auth = { type: 'none' } | { type: 'bearer'; credential: string } | { type: 'basic'; username: string; credential: string } | { type: 'api_key'; name: string; location: 'header' | 'query'; credential: string };
export interface HttpRequest { url: string; method: 'GET' | 'POST'; query: Pair[]; headers: Pair[]; auth: Auth; body: unknown | null; response: { type: 'text' | 'ignore' } | { type: 'json'; pointer: string }; timeoutSeconds: number }
export interface HttpPreview { status: number; elapsedMs: number; fetchedAt: number; raw: string; message: string; parseError?: string | null }
export interface Hooks { beforeRun: HttpRequest | null; afterRun: HttpRequest | null }
export interface SendInput { message: { type: 'manual'; text: string } | { type: 'before_run' } | { type: 'http'; request: HttpRequest; refresh: 'run' | 'recipient' }; recipients: { scope: 'groups' | 'conversations'; mode: 'all' | 'selected'; names: string[] }; intervalMs: number }
export interface TargetList { items: { title: string }[]; source: string; scannedAt: number; complete: boolean }
export function defaultRequest(): HttpRequest { return { url: '', method: 'GET', query: [], headers: [], auth: { type: 'none' }, body: null, response: { type: 'json', pointer: '/message' }, timeoutSeconds: 20 }; }
export function defaultSendInput(): SendInput { return { message: { type: 'manual', text: '' }, recipients: { scope: 'groups', mode: 'selected', names: [] }, intervalMs: 1000 }; }
