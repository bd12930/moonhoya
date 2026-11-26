import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { CLASSIFICATION_SYSTEM_PROMPT, type ScanClassificationResult } from '@/lib/scan-classifier';

export const dynamic = 'force-dynamic';

/** Retries transient overload (429/503) with a short backoff; other responses are returned as-is. */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 1; i < attempts && (res.status === 429 || res.status === 503); i++) {
    await new Promise((r) => setTimeout(r, 2000 * i));
    res = await fetch(url, init);
  }
  return res;
}

/**
 * Calls an OpenAI-compatible chat completions endpoint with the image.
 * Returns the parsed classification, or a short failure reason. Never logs the URL or key.
 */
async function callChatVision(
  label: string,
  url: string,
  apiKey: string,
  model: string,
  imageDataUrl: string
): Promise<{ result?: ScanClassificationResult; failure?: string }> {
  try {
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Identify and classify this image according to instructions.' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`${label} (${model}) HTTP ${res.status}:`, errBody.slice(0, 500));
      return { failure: `${label} HTTP ${res.status}` };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error(`${label} (${model}) returned no content:`, JSON.stringify(data).slice(0, 500));
      return { failure: `${label} returned no content` };
    }
    return { result: JSON.parse(content) as ScanClassificationResult };
  } catch (err) {
    console.error(`${label} request error:`, err);
    return { failure: `${label} request error` };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const imageDataUrl: string = body?.image;

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return NextResponse.json(
        {
          classification: null,
          confidence: 'low',
          message: 'No image provided. Please take or choose a photo closer.',
        } satisfies ScanClassificationResult,
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext({ async: true });
    const envRecord = env as unknown as Record<string, unknown>;
    const readSecret = (name: string) =>
      (process.env[name] || envRecord?.[name]) as string | undefined;

    let geminiKey = readSecret('GEMINI_API_KEY');
    let openaiKey = readSecret('OPENAI_API_KEY');
    const openrouterKey = readSecret('OPENROUTER_API_KEY');
    // Free vision model (zero cost on OpenRouter). Override with OPENROUTER_MODEL.
    const openrouterModel = readSecret('OPENROUTER_MODEL') || 'google/gemma-4-31b-it:free';

    // Check D1 AppSetting table if not set in environment
    if (env.DB && !geminiKey && !openaiKey && !openrouterKey) {
      try {
        const row = await env.DB.prepare(
          "SELECT key, value FROM AppSetting WHERE key IN ('geminiApiKey', 'openaiApiKey')"
        ).all<{ key: string; value: string }>();

        for (const r of row.results || []) {
          if (r.key === 'geminiApiKey' && !geminiKey) {
            try { geminiKey = JSON.parse(r.value); } catch { geminiKey = r.value; }
          }
          if (r.key === 'openaiApiKey' && !openaiKey) {
            try { openaiKey = JSON.parse(r.value); } catch { openaiKey = r.value; }
          }
        }
      } catch {
        // AppSetting table read failed
      }
    }

    const failures: string[] = [];

    // 1. Google Gemini Vision API (if key configured)
    if (geminiKey) {
      try {
        const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        // gemini-2.0-flash / 1.5-flash / 2.5-flash are no longer available to new users (HTTP 404).
        const model = 'gemini-3.8-flash';
        // The request URL contains the key, so it is never logged.
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const geminiRes = await fetchWithRetry(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: CLASSIFICATION_SYSTEM_PROMPT },
                  { inlineData: { mimeType, data: base64Data } },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textResponse) {
            console.info(`Scan identified by Gemini (${model})`);
            return NextResponse.json(JSON.parse(textResponse));
          }
          console.error(`Gemini (${model}) returned no text:`, JSON.stringify(geminiData).slice(0, 500));
          failures.push(`Gemini ${model} returned no text`);
        } else {
          const errBody = await geminiRes.text();
          console.error(`Gemini (${model}) HTTP ${geminiRes.status}:`, errBody.slice(0, 500));
          failures.push(`Gemini ${model} HTTP ${geminiRes.status}`);
        }
      } catch (geminiErr) {
        console.error('Gemini vision error:', geminiErr);
        failures.push('Gemini request error');
      }
    }

    // 2. OpenRouter (if key configured). OpenAI-compatible; model set by OPENROUTER_MODEL.
    if (openrouterKey) {
      const { result, failure } = await callChatVision(
        'OpenRouter',
        'https://openrouter.ai/api/v1/chat/completions',
        openrouterKey,
        openrouterModel,
        imageDataUrl
      );
      if (result) {
        console.info(`Scan identified by OpenRouter (${openrouterModel})`);
        return NextResponse.json(result);
      }
      if (failure) failures.push(failure);
    }

    // 3. OpenAI GPT-4o-mini Vision (if key configured)
    if (openaiKey) {
      const { result, failure } = await callChatVision(
        'OpenAI',
        'https://api.openai.com/v1/chat/completions',
        openaiKey,
        'gpt-4o-mini',
        imageDataUrl
      );
      if (result) {
        console.info('Scan identified by OpenAI (gpt-4o-mini)');
        return NextResponse.json(result);
      }
      if (failure) failures.push(failure);
    }

    // A key exists but every provider call failed: report that, not a missing key.
    if (geminiKey || openaiKey || openrouterKey) {
      const reason = failures.length ? ` (${failures.join('; ')})` : '';
      return NextResponse.json({
        classification: null,
        confidence: 'low',
        message: `Cloud identification failed${reason}. Please try again, or fill in the details manually.`,
      } satisfies ScanClassificationResult);
    }

    // No cloud AI key is configured: tell the user clearly instead of returning a fake guess
    return NextResponse.json({
      classification: null,
      confidence: 'low',
      message: 'AI Vision key not connected. Add your free Google Gemini API Key in Settings (⚙️) to identify any plant or item accurately.',
    } satisfies ScanClassificationResult);
  } catch (err: unknown) {
    console.error('Classification route error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
