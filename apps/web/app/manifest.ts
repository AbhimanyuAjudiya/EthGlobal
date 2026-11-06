import type { MetadataRoute } from 'next';

/** PWA manifest (web.md §5): standalone, start at the stored plan, colours = sRGB of --bg-canvas. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Recharge',
    short_name: 'Recharge',
    description: "Prove you're one human and a sponsor pays for your first 1 GB.",
    start_url: '/plan',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'en',
    categories: ['travel', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
