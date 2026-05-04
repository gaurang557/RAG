import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { httpErrorDetail } from '../../api-error';
import { AuthService } from '../auth.service';

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

@Component({
  selector: 'app-signup',
  imports: [CommonModule, FormsModule],
  templateUrl: './signup.component.html',
  standalone: true,
  styleUrl: '../auth.scss',
})
export class SignupComponent {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  protected username = '';
  protected password = '';
  protected confirmPassword = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected signup(): void {
    if (this.busy()) return;

    const username = this.username.trim();

    if (username.length < 3) {
      this.error.set('Username must be at least 3 characters.');
      return;
    }
    if (username.length > 50) {
      this.error.set('Username must not exceed 50 characters.');
      return;
    }
    if (!USERNAME_RE.test(username)) {
      this.error.set('Username may only contain letters, numbers, hyphens, and underscores.');
      return;
    }
    if (this.password.length < 6) {
      this.error.set('Password must be at least 6 characters.');
      return;
    }
    if (this.password.length > 100) {
      this.error.set('Password must not exceed 100 characters.');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    this.authService
      .signup(username, this.password)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          void this.router.navigate(['/login']);
        },
        error: (e: unknown) => {
          this.error.set(httpErrorDetail(e));
        },
      });
  }

  protected goToLogin(): void {
    void this.router.navigate(['/login']);
  }
}
