// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui", "nuxt-auth-utils", "@nuxtjs/i18n"],

  runtimeConfig: {
    cvServiceUrl: process.env.CV_SERVICE_URL || 'http://localhost:8100',
    cvApiKey: process.env.CV_API_KEY || '',
    minioPublicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || '',
    minioAccessKey: process.env.MINIO_ACCESS_KEY || '',
    minioSecretKey: process.env.MINIO_SECRET_KEY || '',
    minioBucket: process.env.MINIO_BUCKET || 'harvest-snapshots',
    minioPresignedTtl: process.env.MINIO_PRESIGNED_TTL || '3600'
    // NOTE: encryptionKey intentionally NOT here — master key lives only in cv-service
  },

  i18n: {
    locales: [
      { code: "en", name: "English", file: "en.json" },
      { code: "uz", name: "O'zbekcha", file: "uz.json" }
    ],
    defaultLocale: "en",
    strategy: "no_prefix",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      fallbackLocale: 'en'
    }
  },

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  routeRules: {},

  components: [
    {
      path: "~/components",
      pathPrefix: false,
    },
  ],

  compatibilityDate: "2025-01-15",

  eslint: {
    config: {
      stylistic: {
        commaDangle: "never",
        braceStyle: "1tbs",
      },
    },
  },

  fonts: {
    families: [{ name: "Montserrat", provider: "google" }],
    defaults: {
      weights: [400, 500, 600, 700, 800],
    },
    processCSSVariables: true,
  },
});
