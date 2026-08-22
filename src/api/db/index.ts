import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export const db = (d1: D1Database) => drizzle(d1, { schema })
export type DB = ReturnType<typeof db>
