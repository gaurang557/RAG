import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

export interface SessionInfo {
  session_id: string;
  authenticated: boolean;
  indexed: boolean;
}

export interface UploadResponse {
  ok: boolean;
  indexed: boolean;
  authenticated: boolean;
}

export interface AskResponse {
  answer: string;
  authenticated: boolean;
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
}
