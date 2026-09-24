export async function ensureContentTypeHeader(response: Response): Promise<Response> {
  const currentType = response.headers.get("content-type");
  if (currentType) return response;

  const body = await response.clone().text();
  const isJsonLike = body.trim().startsWith("{") || body.trim().startsWith("[");
  const headers = new Headers(response.headers);
  headers.set("content-type", isJsonLike ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
