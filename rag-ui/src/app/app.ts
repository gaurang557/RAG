import { Component, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet></router-outlet>',
  styles: [':host { display: block; height: 100%; }'],
})
export class App {
  private readonly authService = inject(AuthService);

  constructor() {
    afterNextRender(() => {
      this.authService.checkAuthStatus();
    });
  }
}
