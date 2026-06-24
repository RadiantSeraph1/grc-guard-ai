const BACKEND_API_BASE_URL = process.env.BACKEND_API_BASE_URL || "http://127.0.0.1:8001";

async function proxyRequest(request, context) {
  try {
    const params = await context.params;
    const path = params.path.join("/");
    const url = new URL(request.url);
    const target = `${BACKEND_API_BASE_URL}/${path}${url.search}`;

    const headers = new Headers();
    const authorization = request.headers.get("authorization");
    const contentType = request.headers.get("content-type");
    const accept = request.headers.get("accept");
    const superAdminSession = request.headers.get("x-super-admin-session");
    if (authorization) headers.set("authorization", authorization);
    if (contentType) headers.set("content-type", contentType);
    if (accept) headers.set("accept", accept);
    if (superAdminSession) headers.set("x-super-admin-session", superAdminSession);

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = await request.text();
    }

    const response = await fetch(target, init);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return Response.json(
      { detail: `Backend proxy failed: ${error.message}` },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const OPTIONS = proxyRequest;
