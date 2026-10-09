export type GeminiDataPolicy =
  | 'blocked'
  | 'free-acknowledged'
  | 'paid-no-training';

export function geminiDataPolicy(): GeminiDataPolicy {
  const configured = process.env.GEMINI_DATA_POLICY?.trim();
  if (configured === 'blocked' || configured === 'paid-no-training')
    return configured;
  // This single-user deployment explicitly accepts the Gemini free-tier terms.
  return 'free-acknowledged';
}

export const geminiDataSharingAllowed = () => geminiDataPolicy() !== 'blocked';
