import { scrubIdentifiers } from './ai-privacy';
import {
  EXPENSE_CATEGORIES,
  isExpenseCategory,
  type ExpenseCategory,
} from './expense-categories';
import { geminiDataSharingAllowed } from './gemini-data-policy';

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

type GeminiAttempt =
  | { status: 'complete'; category: ExpenseCategory | null }
  | { status: 'retry' | 'stop' };

async function requestGeminiCategory({
  apiKey,
  model,
  description,
  account,
}: {
  apiKey: string;
  model: string;
  description: string;
  account: string;
}): Promise<GeminiAttempt> {
  try {
    const result = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: 'Classifique uma despesa pessoal brasileira. Use somente uma das categorias permitidas. Escolha Outros quando o estabelecimento não der evidência suficiente. Não invente contexto.',
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Estabelecimento ou descrição: ${description}\nCartão ou conta: ${account}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 120,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: EXPENSE_CATEGORIES,
                },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
              required: ['category', 'confidence'],
            },
          },
        }),
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!result.ok) {
      return {
        status:
          result.status === 429 || result.status >= 500 ? 'retry' : 'stop',
      };
    }
    const payload = (await result.json()) as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('');
    if (!text) return { status: 'retry' };
    const parsed = JSON.parse(text) as {
      category?: unknown;
      confidence?: unknown;
    };
    return {
      status: 'complete',
      category:
        isExpenseCategory(parsed.category) &&
        typeof parsed.confidence === 'number' &&
        parsed.confidence >= 0.72
          ? parsed.category
          : null,
    };
  } catch {
    return { status: 'retry' };
  }
}

export async function categorizeExpenseWithAI({
  description,
  account,
}: {
  description: string;
  account: string;
}): Promise<ExpenseCategory | null> {
  if (!geminiDataSharingAllowed()) return null;
  // Pix: a descrição é o nome de quem recebeu, que não sai do Vetra. Sem IA;
  // as regras aprendidas continuam valendo.
  if (account.trim().toLowerCase() === 'pix') return null;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  // No card number, CPF, phone or e-mail leaves for the model; the merchant
  // name itself is what there is to categorise (lib/ai-privacy.ts).
  const safeDescription = scrubIdentifiers(description);
  const safeAccount = scrubIdentifiers(account);

  const models = [
    process.env.GEMINI_CATEGORIZATION_MODEL ?? 'gemini-3.8-flash',
    process.env.GEMINI_CATEGORIZATION_FALLBACK_MODEL ?? 'gemini-3.5-flash-lite',
  ].filter((model, index, all) => all.indexOf(model) === index);

  for (const model of models) {
    const attempt = await requestGeminiCategory({
      apiKey,
      model,
      description: safeDescription,
      account: safeAccount,
    });
    if (attempt.status === 'complete') return attempt.category;
    if (attempt.status === 'stop') break;
  }
  return null;
}
