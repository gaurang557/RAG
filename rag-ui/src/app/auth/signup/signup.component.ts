import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { httpErrorDetail } from '../../api-error';
import { AuthService } from '../auth.service';

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

    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    if (this.password.length < 6) {
      this.error.set('Password must be at least 6 characters.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    this.authService
      .signup(this.username, this.password)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: () => {
          void this.router.navigate(['/login']);
        },
        error: (e: any) => {
          this.error.set(httpErrorDetail(e));
        },
      });
  }

  protected goToLogin(): void {
    void this.router.navigate(['/login']);
  }
}
