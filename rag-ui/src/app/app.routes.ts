import { Routes } from '@angular/router';
import { LoginComponent } from './auth/login/login.component';
import { SignupComponent } from './auth/signup/signup.component';
import { authGuard } from './auth/auth.guard';
import { Home } from './home/home';

export const routes: Routes = [
  { path: 'signup', component: SignupComponent },
  { path: 'login', component: LoginComponent },
  { path: 'home', component: Home, canActivate: [authGuard] },
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // or 'home' if auto-login
  { path: '**', redirectTo: 'signup' }
];
