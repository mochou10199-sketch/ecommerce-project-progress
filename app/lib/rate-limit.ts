type RateLimitState = {
  count: number;
  resetAt: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const buckets = new Map<string, RateLimitState>();

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown-client";
}

function pruneExpired(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  request: Request,
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);
  const key = `${scope}:${clientAddress(request)}:${subject}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true };
}

export function tooManyRequests(result: Extract<RateLimitResult, { allowed: false }>, message = "请求过于频繁，请稍后再试。") {
  return Response.json({ error: message }, {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(result.retryAfterSeconds),
    },
  });
}
