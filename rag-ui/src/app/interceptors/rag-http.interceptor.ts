import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { AuthService } from '../auth/auth.service';

/** Sends session cookies (`withCredentials`) and Basic Auth credentials. */
export const ragHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  let out = req.clone({ withCredentials: true });
  const authHeaders = authService.getAuthHeaders();

  if (authHeaders['Authorization']) {
    out = out.clone({ setHeaders: authHeaders });
  }

  return next(out);
};
