import { getCatalogPage } from '../../catalog-data';

/** Same-origin facade: browser code never contacts the private API URL, and
 * the upstream host/path cannot be overridden through request parameters. */
export async function GET(request: Request): Promise<Response> {
  try {
    const data = await getCatalogPage(new URL(request.url).searchParams);
    return Response.json({ data });
  } catch {
    return Response.json({ error: 'دریافت محصولات انجام نشد. دوباره تلاش کنید.' }, { status: 503 });
  }
}
