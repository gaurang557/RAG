/**
 * Override to the deployed API hostname. For cookie sessions it should match where users load
 * the SPA from (avoid mixing `localhost` vs `127.0.0.1` vs a real domain).
 */
export const environment = {
  production: true,
  apiUrl: 'http://localhost:8000',
};
