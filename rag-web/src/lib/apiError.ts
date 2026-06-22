/**
 * Error thrown by the API layer. Mirrors the shape the Angular app relied on:
 * a `status` code plus the parsed JSON body (FastAPI returns `{ detail: ... }`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** Extracts a human-readable message from an unknown error (ports `httpErrorDetail`). */
export function httpErrorDetail(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      try {
        return JSON.stringify(detail);
      } catch {
        /* fall through */
      }
    }
    if (
      detail &&
      typeof detail === "object" &&
      typeof (detail as { message?: unknown }).message === "string"
    ) {
      return (detail as { message: string }).message;
    }
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
