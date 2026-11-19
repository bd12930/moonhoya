import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

/**
 * GET /api/photos/:key
 * Streams a plant photo from the MOONHOYA_PHOTOS R2 bucket. Gallery photos are
 * stored as /api/photos/<key>, so they display without a public R2 domain.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    const { env } = await getCloudflareContext({ async: true });

    if (!env.MOONHOYA_PHOTOS) {
      return NextResponse.json({ error: 'R2 bucket binding not found' }, { status: 500 });
    }

    const object = await env.MOONHOYA_PHOTOS.get(key);
    if (!object) {
      return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=86400');

    return new Response(object.body, { headers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
