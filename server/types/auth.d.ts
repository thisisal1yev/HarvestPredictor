// Server-side augmentation for the `#auth-utils` User type.
// The existing declaration in `app/types/auth.d.ts` only lands in the Nuxt
// client tsconfig — `tsconfig.server.json` doesn't include `app/types/**`,
// so `session.user.id` reads as `never` in every server handler.
// This file mirrors the same shape for Nitro.
declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    role: string
  }
}

export {}
