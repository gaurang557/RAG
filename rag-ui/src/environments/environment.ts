/**
 * Session cookies are keyed by registrable host. Browsers treat `localhost` and `127.0.0.1`
 * as different sites, so the API origin hostname must match the page you open in the browser
 * (e.g. both `localhost`) or `/ask` will get a fresh session → 400 "Upload a PDF first".
 */
function devApiOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `http://${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
}

export const environment = {
  production: false,
  apiUrl: devApiOrigin(),
};
