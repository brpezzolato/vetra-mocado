/**
 * "Atualizar o app" (Ctrl+F5): atualiza o service worker, apaga os caches, o
 * desliga e recarrega; o PwaRegister o registra de novo. Não muda o ícone do iOS.
 */
export async function updateApp() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) =>
          registration.update().catch(() => undefined),
        ),
      );
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } finally {
    window.location.reload();
  }
}
