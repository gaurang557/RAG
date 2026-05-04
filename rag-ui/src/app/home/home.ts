import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
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

@Component({
  selector: 'app-home',
  imports: [CommonModule, FormsModule],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private readonly api = inject(RagApiService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly session = signal<SessionInfo | null>(null);
  protected readonly sessionBusy = signal(false);
  protected readonly sessionError = signal<string | null>(null);

  protected readonly uploadBusy = signal(false);
  protected readonly uploadSuccess = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  protected readonly askBusy = signal(false);
  protected readonly chatHistory = signal<ChatMessage[]>([]);

  protected readonly isDragging = signal(false);
  protected question = '';

  protected readonly chosenFileMeta = signal<{ name: string; size: number } | null>(null);
  private pendingFile: File | null = null;

  readonly fileChooser = viewChild<ElementRef<HTMLInputElement>>('fileChooser');
  readonly chatScroll = viewChild<ElementRef<HTMLDivElement>>('chatScroll');

  ngOnInit(): void {
    void this.refreshSession();
  }

  protected get username(): string {
    return this.session()?.username ?? '';
  }

  protected get userInitial(): string {
    return this.username.charAt(0).toUpperCase() || '?';
  }

  protected shortenId(id: string): string {
    if (id.length <= 14) return id;
    return `${id.slice(0, 6)}…${id.slice(-6)}`;
  }

  protected logout(): void {
    this.authService.logout();
    void this.router.navigate(['/login']);
  }

  protected createNewSession(): void {
    if (this.sessionBusy()) return;
    this.sessionBusy.set(true);
    this.api
      .newSession()
      .pipe(finalize(() => this.sessionBusy.set(false)))
      .subscribe({
        next: (s) => {
          this.session.set(s);
          this.uploadSuccess.set(false);
          this.uploadError.set(null);
          this.chosenFileMeta.set(null);
          this.pendingFile = null;
          this.chatHistory.set([]);
        },
        error: (e: any) => {
          this.sessionError.set(httpErrorDetail(e));
        },
      });
  }

  protected triggerFileChooser(): void {
    this.fileChooser()?.nativeElement.click();
  }

  protected onFilePicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      this.uploadError.set('Only PDF files are supported.');
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
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      this.uploadError.set('Only PDF files are supported.');
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
    if (!file || this.uploadBusy()) return;

    this.uploadBusy.set(true);
    this.uploadError.set(null);

    this.api
      .uploadPdf(file)
      .pipe(finalize(() => this.uploadBusy.set(false)))
      .subscribe({
        next: () => {
          this.uploadSuccess.set(true);
          this.chatHistory.set([]);
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
    if (!q || this.askBusy()) return;

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
        error: (e) => {
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
        error: (e) => {
          this.session.set(null);
          this.sessionError.set(httpErrorDetail(e));
          if (e?.status === 401) {
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
