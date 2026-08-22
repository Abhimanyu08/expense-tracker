import { defineConfig } from 'drizzle-kit'

// Generates SQL into ./drizzle, which wrangler.jsonc points at as the D1
// migrations_dir -- so `drizzle-kit generate` then
// `wrangler d1 migrations apply` is the whole workflow.
export default defineConfig({
  schema: './src/api/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'd1-http',
})
