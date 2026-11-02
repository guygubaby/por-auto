import { describe, expect, it } from 'vitest';
import {
  editableInput,
  hasRecipientCategories,
  isBatch,
  recipientSummary,
  type StoredSendInput,
} from '@/types';

const legacy: StoredSendInput = {
  message: { type: 'manual', text: '验收' },
  recipients: { scope: 'conversations', mode: 'selected', names: ['旧对象'] },
  intervalMs: 1000,
};

describe('recipient categories', () => {
  it('identifies batch capability by action, not the workflow name', () => {
    const workflow = {
      id: 'daily-report',
      name: 'Report',
      version: '1.0.0',
      description: '',
      package: 'com.tencent.wework',
      steps: [{ name: 'Send', action: { type: 'chat_broadcast' } }],
    };
    expect(isBatch(workflow)).toBe(true);
    expect(
      isBatch({
        ...workflow,
        id: 'broadcast-example',
        steps: [{ name: 'Open', action: { type: 'chat_home' } }],
      }),
    ).toBe(false);
  });
  it('migrates an old fixed scope without dropping its message', () => {
    const value = editableInput(legacy);
    expect(value.message).toEqual(legacy.message);
    expect(value.recipients).toEqual({ direct: true, groups: true });
    expect(hasRecipientCategories(legacy)).toBe(false);
    expect(hasRecipientCategories(value)).toBe(true);
  });

  it('describes the exact selected categories', () => {
    expect(recipientSummary(legacy)).toBe('旧版接收范围 · 保留原快照');
    expect(
      recipientSummary({
        ...editableInput(legacy),
        recipients: { direct: true, groups: true },
      }),
    ).toBe('全部单聊和群聊');
    expect(
      recipientSummary({
        ...editableInput(legacy),
        recipients: { direct: false, groups: true },
      }),
    ).toBe('全部群聊');
    expect(
      recipientSummary({
        ...editableInput(legacy),
        recipients: { direct: true, groups: false },
      }),
    ).toBe('全部单聊');
  });
});
