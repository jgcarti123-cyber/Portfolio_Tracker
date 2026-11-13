/**
 * Thin client for an OpenAI-compatible chat endpoint serving an open-weight model
 * (Groq by default). Configured only through server env vars; the key never
 * reaches the browser. Callers must send the minimum data needed.
 */

const BASE = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = process.env.LLM_MODEL || "openai/gpt-oss-120b";
const PROVIDER = process.env.LLM_PROVIDER_NAME || "Groq";

export const llmInfo = () => ({
  enabled: !!process.env.LLM_API_KEY,
  model: MODEL,
  provider: PROVIDER,
});

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** Sends a chat request and returns the parsed JSON object the model replied with. */
export async function chatJson<T>(
  messages: Message[],
  maxTokens = 1200,
  /** Used when the model answers in plain text instead of JSON (the provider rejects that as a failed generation). */
  fromText?: (text: string) => T,
): Promise<T> {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new LlmError("AI isn't set up on this server.", 501);

  const send = () =>
    fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0,
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });

  // Rate limits on hosted models are per minute; wait as told (up to ~35s in total) before giving up.
  let res = await send();
  for (let attempt = 0; res.status === 429 && attempt < 3; attempt++) {
    const hinted = Number(res.headers.get("retry-after"));
    const wait = Math.min(isFinite(hinted) && hinted > 0 ? hinted * 1000 + 250 : 3000 * 2 ** attempt, 12000);
    await new Promise((r) => setTimeout(r, wait));
    res = await send();
  }
  if (res.status === 429) throw new LlmError("The AI service is busy. Try again in a minute.", 429);
  if (res.status === 413) {
    console.error(`[llm] 413 from ${PROVIDER}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    throw new LlmError("That was too much for the AI service in one go. Try a shorter question, or wait a minute.", 413);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // The model wrote prose instead of JSON. Use what it wrote rather than failing the request.
    if (res.status === 400 && fromText) {
      try {
        const err = JSON.parse(detail) as { error?: { code?: string; failed_generation?: string } };
        const gen = err.error?.code === "json_validate_failed" ? err.error.failed_generation : undefined;
        if (gen && gen.trim()) {
          const obj = gen.match(/\{[\s\S]*\}/);
          if (obj) {
            try {
              return JSON.parse(obj[0]) as T;
            } catch {}
          }
          return fromText(gen.trim().replace(/^"|"$/g, ""));
        }
      } catch {}
    }
    console.error(`[llm] ${res.status} from ${PROVIDER}: ${detail.slice(0, 300)}`);
    throw new LlmError(res.status === 401 ? "The AI key was rejected. Check LLM_API_KEY." : "The AI service didn't answer.");
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  if (process.env.NODE_ENV !== "production" && json.usage) console.info(`[llm] ${json.usage.prompt_tokens} in / ${json.usage.completion_tokens} out tokens`);
  const text = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(text) as T;
  } catch {
    // Some models wrap JSON in prose or code fences; take the outermost object.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new LlmError("The AI reply couldn't be read.");
  }
}

/** Simple per-IP limiter: enough to stop one visitor running up the bill on a free app. */
const hits = new Map<string, number[]>();
export function rateLimit(req: Request, max = 20, windowMs = 10 * 60_000) {
  if (process.env.NODE_ENV !== "production") return; // local development and accuracy tests
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new LlmError("Too many AI requests. Try again in a few minutes.", 429);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) hits.delete(hits.keys().next().value as string);
}
