/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { setRuntimeEnv } from "../db";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const MAX_API_BODY_BYTES = 256 * 1024;

function securityHeaders(response: Response, request: Request, url: URL) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (url.pathname.startsWith("/api/")) headers.set("Cache-Control", "no-store");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function oversizedApiRequest(request: Request, url: URL) {
  if (!url.pathname.startsWith("/api/") || !["POST", "PUT", "PATCH"].includes(request.method)) return null;
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;
  const bodyBytes = Number(contentLength);
  if (!Number.isFinite(bodyBytes) || bodyBytes <= MAX_API_BODY_BYTES) return null;
  return Response.json({ error: "请求内容过大。" }, {
    status: 413,
    headers: { "Cache-Control": "no-store", "Retry-After": "0" },
  });
}

function crossOriginMutation(request: Request, url: URL) {
  if (!url.pathname.startsWith("/api/") || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return null;
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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRuntimeEnv(env);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const response = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return securityHeaders(response, request, url);
    }

    const crossOriginResponse = crossOriginMutation(request, url);
    if (crossOriginResponse) return securityHeaders(crossOriginResponse, request, url);
    const oversizedResponse = oversizedApiRequest(request, url);
    if (oversizedResponse) return securityHeaders(oversizedResponse, request, url);
    return securityHeaders(await handler.fetch(request, env, ctx), request, url);
  },
};

export default worker;
