import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  
  let isAuthenticated = false;
  authService.authState$.pipe(take(1)).subscribe(state => {
    isAuthenticated = state.isAuthenticated;
  });
  
  if (isAuthenticated) {
    return true;
  }
  
  return router.parseUrl('/login');
};
