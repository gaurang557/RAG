import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import { environment } from '../../environments/environment';

export interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl.replace(/\/$/, '');
  
  private readonly authStateSubject = new BehaviorSubject<AuthState>({
    isAuthenticated: false,
    username: null
  });
  
  public readonly authState$ = this.authStateSubject.asObservable();

  login(username: string, password: string): Observable<void> {
    const credentials = btoa(`${username}:${password}`);
    
    return this.http.get<{ username: string }>(`${this.base}/session`, {
      headers: {
        'Authorization': `Basic ${credentials}`
      }
    }).pipe(
      tap(response => {
        this.authStateSubject.next({
          isAuthenticated: true,
          username: response.username
        });
        localStorage.setItem('auth_credentials', credentials);
      }),
      map(() => void 0)
    );
  }

  signup(username: string, password: string): Observable<void> {
    return this.http.post<{ message: string }>(`${this.base}/signup`, {
      username,
      password
    }).pipe(
      map(() => void 0)
    );
  }

  logout(): void {
    this.authStateSubject.next({
      isAuthenticated: false,
      username: null
    });
    localStorage.removeItem('auth_credentials');
  }

  getAuthHeaders(): { [key: string]: string } {
    const credentials = localStorage.getItem('auth_credentials');
    return credentials ? { 'Authorization': `Basic ${credentials}` } : {};
  }

  checkAuthStatus(): void {
    const credentials = localStorage.getItem('auth_credentials');
    if (credentials) {
      try {
        this.http.get<{ username: string }>(`${this.base}/session`, {
          headers: {
            'Authorization': `Basic ${credentials}`
          }
        }).subscribe({
          next: (response) => {
            this.authStateSubject.next({
              isAuthenticated: true,
              username: response.username
            });
          },
          error: () => {
            this.logout();
          }
        });
      } catch {
        this.logout();
      }
    } else {
      this.authStateSubject.next({
        isAuthenticated: false,
        username: null
      });
    }
  }
}
