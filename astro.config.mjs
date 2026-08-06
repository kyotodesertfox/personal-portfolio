// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'https://jax-web-services.netlify.app',

  server: {
    host: true,
  },

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['tweetnacl'],
    },
  },

  integrations: [react()]
});