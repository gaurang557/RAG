import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { httpErrorDetail } from '../api-error';
import { AuthService } from '../auth/auth.service';
import type { SessionInfo } from '../services/rag-api.service';
import { RagApiService } from '../services/rag-api.service';

interface ChatMessage {
  type: 'user' | 'ai';
  content: string;
  isError?: boolean;
}

const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_QUESTION_LEN = 2000;
const POLL_INTERVAL_MS = 1500;

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit, OnDestroy {
  private readonly api = inject(RagApiService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly session = signal<SessionInfo | null>(null);
  protected readonly sessionBusy = signal(false);
  protected readonly sessionError = signal<string | null>(null);

  protected readonly uploadBusy = signal(false);
  protected readonly uploadProcessing = signal(false);
  protected readonly uploadSuccess = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  protected readonly askBusy = signal(false);
  protected readonly chatHistory = signal<ChatMessage[]>([]);

  protected readonly isDragging = signal(false);
  protected question = '';

  protected readonly chosenFileMeta = signal<{ name: string; size: number } | null>(null);
  private pendingFile: File | null = null;
  private _pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly fileChooser = viewChild<ElementRef<HTMLInputElement>>('fileChooser');
  readonly chatScroll = viewChild<ElementRef<HTMLDivElement>>('chatScroll');

  readonly maxQuestionLen = MAX_QUESTION_LEN;

  ngOnInit(): void {
    void this.refreshSession();
  }

  ngOnDestroy(): void {
    this._clearPoll();
  }

  protected get username(): string {
    return this.session()?.username ?? '';
  }

  protected get userInitial(): string {
    return this.username.charAt(0).toUpperCase() || '?';
  }

  protected get questionTooLong(): boolean {
    return this.question.length > MAX_QUESTION_LEN;
  }

  protected shortenId(id: string): string {
    if (id.length <= 14) return id;
    return `${id.slice(0, 6)}…${id.slice(-6)}`;
  }

  protected logout(): void {
    this._clearPoll();
    this.authService.logout();
    void this.router.navigate(['/login']);
  }

  protected createNewSession(): void {
    if (this.sessionBusy()) return;
    this._clearPoll();
    this.sessionBusy.set(true);
    this.api
      .newSession()
      .pipe(finalize(() => this.sessionBusy.set(false)))
      .subscribe({
        next: (s) => {
          this.session.set(s);
          this.uploadSuccess.set(false);
          this.uploadError.set(null);
          this.uploadProcessing.set(false);
          this.chosenFileMeta.set(null);
          this.pendingFile = null;
          this.chatHistory.set([]);
        },
        error: (e: unknown) => {
          this.sessionError.set(httpErrorDetail(e));
        },
      });
  }

  protected triggerFileChooser(): void {
    this.fileChooser()?.nativeElement.click();
  }

  private _validateFile(f: File): string | null {
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      return 'Only PDF files are supported.';
    }
    if (f.size === 0) {
      return 'The selected file is empty.';
    }
    if (f.size > MAX_FILE_BYTES) {
      return `File is too large. Maximum size is ${MAX_FILE_MB} MB.`;
    }
    return null;
  }

  protected onFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;

    const err = this._validateFile(f);
    if (err) {
      this.uploadError.set(err);
      this.pendingFile = null;
      this.chosenFileMeta.set(null);
      input.value = '';
      return;
    }
    this.uploadError.set(null);
    this.uploadSuccess.set(false);
    this.pendingFile = f;
    this.chosenFileMeta.set({ name: f.name, size: f.size });
  }

  protected onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging.set(true);
  }

  protected onDragLeave(): void {
    this.isDragging.set(false);
  }

  protected onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.isDragging.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (!f) return;

    const err = this._validateFile(f);
    if (err) {
      this.uploadError.set(err);
      return;
    }
    this.uploadError.set(null);
    this.uploadSuccess.set(false);
    this.pendingFile = f;
    this.chosenFileMeta.set({ name: f.name, size: f.size });
  }

  protected clearChosenFile(): void {
    const el = this.fileChooser()?.nativeElement;
    if (el) el.value = '';
    this.pendingFile = null;
    this.chosenFileMeta.set(null);
    this.uploadError.set(null);
  }

  protected upload(): void {
    const file = this.pendingFile;
    if (!file || this.uploadBusy() || this.uploadProcessing()) return;

    this.uploadBusy.set(true);
    this.uploadError.set(null);
    this._clearPoll();

    this.api
      .uploadPdf(file)
      .pipe(finalize(() => this.uploadBusy.set(false)))
      .subscribe({
        next: (r) => {
          if (r.processing) {
            this.uploadProcessing.set(true);
            this.uploadSuccess.set(false);
            this._startPolling();
          } else {
            this.uploadSuccess.set(true);
            this.uploadProcessing.set(false);
            this.chatHistory.set([]);
            void this.refreshSession();
          }
        },
        error: (e: unknown) => {
          this.uploadError.set(httpErrorDetail(e));
          this.uploadSuccess.set(false);
          this.uploadProcessing.set(false);
        },
      });
  }

  private _startPolling(): void {
    const check = () => {
      this.api.session().subscribe({
        next: (s) => {
          this.session.set(s);
          if (s.indexed) {
            this.uploadProcessing.set(false);
            this.uploadSuccess.set(true);
            this.chatHistory.set([]);
          } else if (s.upload_pending) {
            this._pollTimer = setTimeout(check, POLL_INTERVAL_MS);
          } else if (s.upload_error) {
            this.uploadProcessing.set(false);
            this.uploadError.set(s.upload_error);
          } else {
            this._pollTimer = setTimeout(check, POLL_INTERVAL_MS);
          }
        },
        error: () => {
          this.uploadProcessing.set(false);
          this.uploadError.set('Failed to check processing status. Please try uploading again.');
        },
      });
    };
    this._pollTimer = setTimeout(check, POLL_INTERVAL_MS);
  }

  private _clearPoll(): void {
    if (this._pollTimer !== null) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  protected ask(): void {
    const q = this.question.trim();
    if (!q || this.askBusy()) return;

    if (q.length > MAX_QUESTION_LEN) {
      this.chatHistory.update((h) => [
        ...h,
        { type: 'ai', content: `Question is too long (max ${MAX_QUESTION_LEN} characters).`, isError: true },
      ]);
      return;
    }

    this.question = '';
    this.askBusy.set(true);
    this.chatHistory.update((h) => [...h, { type: 'user', content: q }]);
    this.scrollToBottom();

    this.api
      .ask(q)
      .pipe(finalize(() => this.askBusy.set(false)))
      .subscribe({
        next: (r) => {
          this.chatHistory.update((h) => [...h, { type: 'ai', content: r.answer ?? '' }]);
          this.scrollToBottom();
        },
        error: (e: unknown) => {
          this.chatHistory.update((h) => [
            ...h,
            { type: 'ai', content: httpErrorDetail(e), isError: true },
          ]);
          this.scrollToBottom();
        },
      });
  }

  protected onEnterKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.ask();
    }
  }

  refreshSession(): void {
    if (this.sessionBusy()) return;
    this.sessionBusy.set(true);
    this.sessionError.set(null);
    this.api
      .session()
      .pipe(finalize(() => this.sessionBusy.set(false)))
      .subscribe({
        next: (s) => this.session.set(s),
        error: (e: unknown) => {
          this.session.set(null);
          this.sessionError.set(httpErrorDetail(e));
          if ((e as { status?: number })?.status === 401) {
            this.authService.logout();
            void this.router.navigate(['/login']);
          }
        },
      });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.chatScroll()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }
}
