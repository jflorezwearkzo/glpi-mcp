import { loadConfig, type Config } from "../src/config.js";
import type { FetchLike } from "../src/glpi/http.js";

export interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

type Handler = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** A fake fetch that records calls and answers from a handler. */
export function mockFetch(handler: Handler): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const r = handler(call) ?? { status: 404, body: ["ERROR_NOT_FOUND", "no mock"] };
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json", ...(r.headers ?? {}) },
    });
  }) as FetchLike;
  return { fetch: fetchImpl, calls };
}

export function config(env: Record<string, string> = {}): Config {
  return loadConfig({ GLPI_URL: "https://glpi.test", ...env });
}
