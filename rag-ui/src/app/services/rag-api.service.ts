import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

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

@Injectable({ providedIn: 'root' })
export class RagApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl.replace(/\/$/, '');

  health(): Observable<{ status: string }> {
    return this.http.get<{ status: string }>(`${this.base}/health`);
  }

  session(): Observable<SessionInfo> {
    return this.http.get<SessionInfo>(`${this.base}/session`);
  }

  uploadPdf(file: File): Observable<UploadResponse> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<UploadResponse>(`${this.base}/upload`, body);
  }

  ask(question: string): Observable<AskResponse> {
    return this.http.post<AskResponse>(`${this.base}/ask`, { question });
  }

  newSession(): Observable<NewSessionResponse> {
    return this.http.post<NewSessionResponse>(`${this.base}/new-session`, {});
  }
}
