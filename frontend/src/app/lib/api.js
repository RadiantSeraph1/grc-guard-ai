"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";

const API_BASE_URL = typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
  ? ""
  : (process.env.NEXT_PUBLIC_API_BASE_URL || "/api/backend");

/**
 * Error thrown by the API client. Carries the HTTP status and the parsed
 * response body so callers can branch on `status` (e.g. 403 -> access denied)
 * without re-parsing.
 */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function buildUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Low-level request used by the hook. Kept separate so non-component code can
 * call it with an explicit token getter.
 */
async function request(getToken, method, path, { body, headers, signal } = {}) {
  const token = await getToken();
  const finalHeaders = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  let payload = body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (body != null && !isFormData && typeof body !== "string") {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(buildUrl(path), {
    method,
    headers: finalHeaders,
    body: method === "GET" || method === "HEAD" ? undefined : payload,
    signal,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      (data && typeof data === "object" && (data.detail || data.message)) ||
      (typeof data === "string" && data) ||
      `Request failed (${response.status})`;
    throw new ApiError(detail, response.status, data);
  }

  return data;
}

/**
 * useApi — the single entry point every page should use to talk to the backend.
 *
 *   const api = useApi();
 *   const stats = await api.get("/api/dashboard/stats");
 *   await api.post("/api/risks", { title, impact, likelihood });
 *
 * Each method injects the Clerk bearer token, builds the URL, parses JSON, and
 * throws an `ApiError` on non-2xx so callers can use a single try/catch.
 */
export function useApi() {
  const { getToken } = useAuth();

  /**
   * raw — perform a request and return the underlying Response (not parsed).
   * Needed for redirect flows (e.g. OAuth authorize) that read `response.url`.
   */
  const raw = useCallback(
    async (method, path, { headers } = {}) => {
      const token = await getToken();
      return fetch(buildUrl(path), {
        method,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      });
    },
    [getToken]
  );

  const get = useCallback((path, opts) => request(getToken, "GET", path, opts), [getToken]);
  const post = useCallback((path, body, opts) => request(getToken, "POST", path, { ...opts, body }), [getToken]);
  const put = useCallback((path, body, opts) => request(getToken, "PUT", path, { ...opts, body }), [getToken]);
  const patch = useCallback((path, body, opts) => request(getToken, "PATCH", path, { ...opts, body }), [getToken]);
  const del = useCallback((path, opts) => request(getToken, "DELETE", path, opts), [getToken]);

  /**
   * getMany — fire several GETs in parallel and tolerate individual failures.
   * Returns an array aligned with `paths`; failed requests resolve to the
   * provided `fallback` (default null) instead of rejecting the whole batch.
   * Ideal for dashboards that aggregate many independent endpoints.
   */
  const getMany = useCallback(
    async (paths, fallback = null) => {
      const results = await Promise.allSettled(paths.map((p) => get(p)));
      return results.map((r) => (r.status === "fulfilled" ? r.value : fallback));
    },
    [get]
  );

  return useMemo(() => ({ get, post, put, patch, del, getMany, raw }), [get, post, put, patch, del, getMany, raw]);
}

export { API_BASE_URL };
