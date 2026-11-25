import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { CLASSIFICATION_SYSTEM_PROMPT, type ScanClassificationResult } from '@/lib/scan-classifier';

export const dynamic = 'force-dynamic';

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
    // Check if Gemini or OpenAI API keys are configured in environment
    const envRecord = env as unknown as Record<string, unknown>;
    const geminiKey = envRecord?.GEMINI_API_KEY as string | undefined;
    const openaiKey = envRecord?.OPENAI_API_KEY as string | undefined;

    // 1. Google Gemini Vision API (if key configured)
    if (geminiKey) {
      try {
        const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = imageDataUrl.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: CLASSIFICATION_SYSTEM_PROMPT },
                  {
                    inlineData: {
                      mimeType,
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          }),
        });

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (textResponse) {
            const parsed = JSON.parse(textResponse);
            return NextResponse.json(parsed);
          }
        }
      } catch (geminiErr) {
        console.error('Gemini vision error:', geminiErr);
      }
    }

    // 2. OpenAI GPT-4o-mini Vision (if key configured)
    if (openaiKey) {
      try {
        const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Classify this image as plant or item.' },
                  { type: 'image_url', image_url: { url: imageDataUrl } },
                ],
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
        });

        if (openaiRes.ok) {
          const openaiData = await openaiRes.json();
          const content = openaiData.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            return NextResponse.json(parsed);
          }
        }
      } catch (openaiErr) {
        console.error('OpenAI vision error:', openaiErr);
      }
    }

    // If no cloud AI key is configured, return 204 so client falls back to on-device vision
    return new NextResponse(null, { status: 204 });
  } catch (err: unknown) {
    console.error('Classification route error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
