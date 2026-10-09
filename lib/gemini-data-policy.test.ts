import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  geminiDataPolicy,
  geminiDataSharingAllowed,
} from './gemini-data-policy';

afterEach(() => vi.unstubAllEnvs());

describe('Gemini data policy', () => {
  it('uses the owner-approved free tier by default', () => {
    vi.stubEnv('GEMINI_DATA_POLICY', '');
    expect(geminiDataPolicy()).toBe('free-acknowledged');
    expect(geminiDataSharingAllowed()).toBe(true);
  });
  it('supports blocking all provider data sharing', () => {
    vi.stubEnv('GEMINI_DATA_POLICY', 'blocked');
    expect(geminiDataSharingAllowed()).toBe(false);
  });
  it('recognizes paid no-training terms', () => {
    vi.stubEnv('GEMINI_DATA_POLICY', 'paid-no-training');
    expect(geminiDataPolicy()).toBe('paid-no-training');
  });
});
