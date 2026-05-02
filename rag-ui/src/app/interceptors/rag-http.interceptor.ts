import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { ApiTokenStore } from '../services/api-token.store';

/** Sends session cookies (`withCredentials`) and optional Bearer token. */
export const ragHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStore = inject(ApiTokenStore).token();

  let out = req.clone({ withCredentials: true });
  const t = tokenStore.trim();

  if (t) {
    out = out.clone({ setHeaders: { Authorization: `Bearer ${t}` } });
  }

  return next(out);
};
