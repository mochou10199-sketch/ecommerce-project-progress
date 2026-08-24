import { NextResponse } from "next/server";

const MAX_API_BODY_BYTES = 256 * 1024;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function withSecurityHeaders(response: Response, request: Request, url: URL) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (url.pathname.startsWith("/api/")) headers.set("Cache-Control", "no-store");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rejectedMutation(request: Request, url: URL) {
  if (!url.pathname.startsWith("/api/") || !MUTATING_METHODS.has(request.method)) return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const bodyBytes = Number(contentLength);
    if (!Number.isFinite(bodyBytes) || bodyBytes > MAX_API_BODY_BYTES) {
      return Response.json({ error: "请求内容过大。" }, {
        status: 413,
        headers: { "Cache-Control": "no-store", "Retry-After": "0" },
      });
    }
  }

  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    try {
      if (new URL(origin).origin === url.origin) return null;
    } catch {
      // Treat a malformed Origin header as untrusted.
    }
    return Response.json({ error: "不允许跨站提交。" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return null;
}

export function proxy(request: Request) {
  const url = new URL(request.url);
  const rejected = rejectedMutation(request, url);
  if (rejected) return withSecurityHeaders(rejected, request, url);
  return withSecurityHeaders(NextResponse.next(), request, url);
}

export const config = {
  matcher: ["/:path*"],
};
