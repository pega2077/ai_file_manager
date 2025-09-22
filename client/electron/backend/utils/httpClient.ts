import { logger } from "../../logger";

export interface HttpJsonResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { message: string };
}

export async function httpGetJson<T>(url: string, headers?: Record<string, string>, timeoutMs = 15000): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: controller.signal });
    const status = resp.status;
    const ok = resp.ok;
    const text = await resp.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch (e) { data = undefined; }
    return ok
      ? { ok, status, data: data as T }
      : { ok, status, error: { message: `HTTP ${status}` } };
  } catch (err) {
    logger.error("HTTP GET failed", { url, err: String(err) });
    return { ok: false, status: 0, error: { message: (err as Error).message } };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpPostJson<T>(url: string, body: unknown, headers?: Record<string, string>, timeoutMs = 30000): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const status = resp.status;
    const ok = resp.ok;
    const text = await resp.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch (e) { data = undefined; }
    return ok
      ? { ok, status, data: data as T }
      : { ok, status, error: { message: `HTTP ${status}` } };
  } catch (err) {
    logger.error("HTTP POST failed", { url, err: String(err) });
    return { ok: false, status: 0, error: { message: (err as Error).message } };
  } finally {
    clearTimeout(timer);
  }
}

export async function httpPostForm<T>(url: string, form: FormData, headers?: Record<string, string>, timeoutMs = 600000): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { ...(headers || {}) },
      body: form,
      signal: controller.signal,
    });
    const status = resp.status;
    const ok = resp.ok;
    const text = await resp.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : undefined; } catch (e) { data = undefined; }
    return ok
      ? { ok, status, data: data as T }
      : { ok, status, error: { message: `HTTP ${status}` } };
  } catch (err) {
    logger.error("HTTP POST form failed", { url, err: String(err) });
    return { ok: false, status: 0, error: { message: (err as Error).message } };
  } finally {
    clearTimeout(timer);
  }
}
