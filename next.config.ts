import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Telas visitadas ficam montadas (Activity): voltar a elas é instantâneo,
  // com estado e rolagem. Ver docs/01-app/02-guides/preserving-ui-state.md.
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value:
              'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
          },
          // A Content-Security-Policy sai do proxy.ts, com nonce por pedido
          // (lib/csp.ts).
        ],
      },
    ];
  },
};

export default nextConfig;
