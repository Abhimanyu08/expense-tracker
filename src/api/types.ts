import type { User } from './db/schema'

export type AppEnv = {
  Bindings: Env
  Variables: { user: User }
}
