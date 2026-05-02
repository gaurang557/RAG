import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'rag.token';

@Injectable({ providedIn: 'root' })
export class ApiTokenStore {
  /** Optional Bearer token (matches backend `Authorization: Bearer …`). */
  readonly token = signal(this.readPersisted());

  setPersistedToken(raw: string): void {
    const v = raw.trim();
    this.token.set(v);
    try {
      if (v) {
        sessionStorage.setItem(STORAGE_KEY, v);
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore quota / privacy mode */
    }
  }

  private readPersisted(): string {
    try {
      return sessionStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  }
}
