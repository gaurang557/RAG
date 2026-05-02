import { CommonModule } from '@angular/common';
import { Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

import { httpErrorDetail } from './api-error';
import { environment } from '../environments/environment';
import { ApiTokenStore } from './services/api-token.store';
import type { SessionInfo } from './services/rag-api.service';
import { RagApiService } from './services/rag-api.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly api = inject(RagApiService);
  protected readonly tokens = inject(ApiTokenStore);

  protected readonly apiUrlDisplay = signal(environment.apiUrl);

  protected readonly session = signal<SessionInfo | null>(null);
  protected readonly sessionBusy = signal(false);
  protected readonly sessionError = signal<string | null>(null);

  protected readonly uploadBusy = signal(false);
  protected readonly uploadSuccess = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  protected readonly askBusy = signal(false);
  protected readonly answer = signal<string | null>(null);
  protected readonly askError = signal<string | null>(null);

  protected bearerDraft = '';

  /** Question textarea */
  protected question = '';

  protected readonly chosenFileMeta = signal<{ name: string; size: number } | null>(null);
  private pendingFile: File | null = null;

  readonly fileChooser = viewChild<ElementRef<HTMLInputElement>>('fileChooser');

  constructor() {
    this.bearerDraft = this.tokens.token();
    afterNextRender(() => {
      void this.refreshSession();
    });
  }

  protected shortenId(id: string): string {
    if (id.length <= 14) return id;
    return `${id.slice(0, 6)}…${id.slice(-6)}`;
  }

  protected persistBearer(): void {
    this.tokens.setPersistedToken(this.bearerDraft);
    void this.refreshSession();
  }

  protected triggerFileChooser(): void {
    this.fileChooser()?.nativeElement.click();
  }

  protected onFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) {
      return;
    }
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      this.uploadError.set('Choose a PDF file.');
      this.pendingFile = null;
      this.chosenFileMeta.set(null);
      input.value = '';
      return;
    }
    this.uploadError.set(null);
    this.pendingFile = f;
    this.chosenFileMeta.set({ name: f.name, size: f.size });
  }

  protected clearChosenFile(): void {
    const el = this.fileChooser()?.nativeElement;
    if (el) {
      el.value = '';
    }
    this.pendingFile = null;
    this.chosenFileMeta.set(null);
    this.uploadError.set(null);
  }

  protected upload(): void {
    const file = this.pendingFile;
    if (!file || this.uploadBusy()) {
      return;
    }

    this.uploadBusy.set(true);
    this.uploadError.set(null);

    this.api
      .uploadPdf(file)
      .pipe(finalize(() => this.uploadBusy.set(false)))
      .subscribe({
        next: () => {
          this.uploadSuccess.set(true);
          this.answer.set(null);
          this.askError.set(null);
          void this.refreshSession();
        },
        error: (e) => {
          this.uploadError.set(httpErrorDetail(e));
          this.uploadSuccess.set(false);
          void this.refreshSession();
        },
      });
  }

  protected ask(): void {
    const q = this.question.trim();
    if (!q || this.askBusy()) {
      return;
    }

    this.askBusy.set(true);
    this.answer.set(null);
    this.askError.set(null);

    this.api
      .ask(q)
      .pipe(finalize(() => this.askBusy.set(false)))
      .subscribe({
        next: (r) => {
          this.answer.set(r.answer ?? '');
          void this.refreshSession();
        },
        error: (e) => {
          this.askError.set(httpErrorDetail(e));
        },
      });
  }

  refreshSession(): void {
    if (this.sessionBusy()) return;
    this.sessionBusy.set(true);
    this.sessionError.set(null);
    this.api
      .session()
      .pipe(finalize(() => this.sessionBusy.set(false)))
      .subscribe({
        next: (s) => {
          this.session.set(s);
          this.sessionError.set(null);
        },
        error: (e) => {
          this.session.set(null);
          this.sessionError.set(httpErrorDetail(e));
        },
      });
  }
}
