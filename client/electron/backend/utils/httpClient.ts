import { logger } from "../../logger";

export interface HttpJsonResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { message: string };
}

export async function httpGetJson<T>(url: string, headers?: Record<string, string>, timeoutMs = 15000, token?: string): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let mergedHeaders: Record<string, string> = { ...(headers || {}) };
  if (token) {
    mergedHeaders = { ...mergedHeaders, Authorization: `Bearer ${token}` };
  }
  try {
    const resp = await fetch(url, { headers: mergedHeaders, signal: controller.signal });
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

export async function httpPostJson<T>(url: string, body: unknown, headers?: Record<string, string>, timeoutMs = 30000, token?: string): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let mergedHeaders: Record<string, string> = { "Content-Type": "application/json", ...(headers || {}) };
  if (token) {
    mergedHeaders = { ...mergedHeaders, Authorization: `Bearer ${token}` };
  }
  try {
    console.log("HTTP POST request to:", url, "\nwith headers:\n", mergedHeaders, "\nwith body:\n", body);
    const resp = await fetch(url, {
      method: "POST",
      headers: mergedHeaders,
      body: JSON.stringify(body),
      //signal: controller.signal,
    });
    console.log("HTTP POST response status:", resp.status,resp.ok);
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

export async function httpPostForm<T>(url: string, form: FormData, headers?: Record<string, string>, timeoutMs = 600000, token?: string): Promise<HttpJsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let mergedHeaders: Record<string, string> = { ...(headers || {}) };
  if (token) {
    mergedHeaders = { ...mergedHeaders, Authorization: `Bearer ${token}` };
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: mergedHeaders,
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
