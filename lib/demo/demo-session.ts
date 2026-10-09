/** Cookie que marca a "sessão" do protótipo. Nenhuma credencial é guardada. */
export const DEMO_SESSION_COOKIE = 'vetra_demo_session';

export function startDemoSession() {
  document.cookie = `${DEMO_SESSION_COOKIE}=1; path=/; max-age=2592000; samesite=lax`;
}

export function endDemoSession() {
  document.cookie = `${DEMO_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
