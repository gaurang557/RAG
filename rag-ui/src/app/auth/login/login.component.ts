import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { httpErrorDetail } from '../../api-error';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: '../auth.scss',
})
export class LoginComponent {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  protected username = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected login(): void {
    if (this.busy()) return;

    const username = this.username.trim();
    const password = this.password;

    if (!username) {
      this.error.set('Username is required.');
      return;
    }
    if (username.length > 50) {
      this.error.set('Username must not exceed 50 characters.');
      return;
    }
    if (!password) {
      this.error.set('Password is required.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    this.authService
      .login(username, password)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          void this.router.navigate(['/home']);
        },
        error: (e: unknown) => {
          this.error.set(httpErrorDetail(e));
        },
      });
  }

  protected goToSignup(): void {
    void this.router.navigate(['/signup']);
  }
}
