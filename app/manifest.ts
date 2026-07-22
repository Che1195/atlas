import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Atlas',
    short_name: 'Atlas',
    description: 'Transform experience into understanding.',
    start_url: '/capture',
    display: 'standalone',
    background_color: '#faf9f7', // --paper light
    theme_color: '#faf9f7',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
