import { HttpErrorResponse } from '@angular/common/http';

export function httpErrorDetail(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const detail = err.error?.detail as unknown;
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      try {
        return JSON.stringify(detail);
      } catch {
        /* fall through */
      }
    }
    if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
      return (detail as { message: string }).message;
    }
    if (err.message) {
      return err.message;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
