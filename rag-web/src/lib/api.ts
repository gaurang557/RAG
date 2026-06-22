import { ApiError } from "./apiError";

export interface SessionInfo {
  session_id: string;
  authenticated: boolean;
  indexed: boolean;
  upload_pending?: boolean;
  upload_error?: string | null;
  username?: string;
}

export interface UploadResponse {
  ok: boolean;
  processing: boolean;
  indexed: boolean;
  authenticated: boolean;
  username?: string;
}

export interface AskResponse {
  answer: string;
  authenticated: boolean;
  cached?: boolean;
}

export interface NewSessionResponse {
  session_id: string;
  authenticated: boolean;
  indexed: boolean;
  username: string;
}

/** localStorage key holding the base64 `user:pass` for HTTP Basic auth. */
export const CREDENTIALS_KEY = "auth_credentials";

/**
 * Base URL of the FastAPI backend.
 *
 * Session cookies are keyed by registrable host. Browsers treat `localhost` and
 * `127.0.0.1` as different sites, so the API origin hostname must match the page
 * you open in the browser, or `/ask` would get a fresh session → 400 "Upload a PDF first".
 * In dev we therefore derive the API origin from the current hostname; in production
 * set `NEXT_PUBLIC_API_URL` to the deployed API origin.
 */
function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

function storedCredentials(): string | null {
  try {
    return localStorage.getItem(CREDENTIALS_KEY);
  } catch {
    return null;
  }
}

interface RequestOptions {
  method?: string;
  /** Explicit Authorization header (e.g. Basic creds during login). */
  authorization?: string;
  /** JSON body — serialized and sent with `Content-Type: application/json`. */
  json?: unknown;
  /** Raw body (e.g. FormData) — sent as-is. */
  body?: BodyInit;
}

/**
 * Performs a credentialed request to the backend. Sends session cookies
 * (`credentials: 'include'`) and attaches the stored Basic-auth header unless an
 * explicit `authorization` is supplied. Replaces the Angular HttpClient + interceptor.
 */
async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  const auth = opts.authorization ?? storedCredentials();
  if (auth) {
    headers["Authorization"] = opts.authorization
      ? opts.authorization
      : `Basic ${auth}`;
  }

  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  const res = await fetch(`${apiBase()}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
    credentials: "include",
  });

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed, res.statusText);
  }
  return parsed as T;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  session: () => request<SessionInfo>("/session"),

  /** Authenticates with explicit Basic credentials (used by login). */
  sessionWithBasic: (basic: string) =>
    request<{ username: string }>("/session", { authorization: `Basic ${basic}` }),

  signup: (username: string, password: string) =>
    request<{ message: string }>("/signup", {
      method: "POST",
      json: { username, password },
    }),

  uploadPdf: (file: File) => {
    const body = new FormData();
    body.append("file", file, file.name);
    return request<UploadResponse>("/upload", { method: "POST", body });
  },

  ask: (question: string) =>
    request<AskResponse>("/ask", { method: "POST", json: { question } }),

  newSession: () =>
    request<NewSessionResponse>("/new-session", { method: "POST", json: {} }),
};
