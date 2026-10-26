import pg from 'pg'

const { Pool } = pg

export type AppRole = 'teacher' | 'admin' | 'representative' | 'pending'

export type AppContext = {
  userId: string
  organizationId: string
  role: AppRole
}

let admin: pg.Pool | null = null
let app: pg.Pool | null = null

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name}가 없습니다. .env.example을 확인하세요.`)
  return value
}

export function adminPool() {
  if (!admin) admin = new Pool({ connectionString: requireEnv('DATABASE_ADMIN_URL') })
  return admin
}

export function appPool() {
  if (!app) app = new Pool({ connectionString: requireEnv('DATABASE_URL') })
  return app
}

export async function withUser<T>(ctx: AppContext, fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await appPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(`select set_config('app.user_id', $1, true)`, [ctx.userId])
    await client.query(`select set_config('app.organization_id', $1, true)`, [ctx.organizationId])
    await client.query(`select set_config('app.role', $1, true)`, [ctx.role])
    const value = await fn(client)
    await client.query('COMMIT')
    return value
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The connection may already be closed.
    }
    throw error
  } finally {
    client.release()
  }
}

export async function closePools() {
  const closing = [admin?.end(), app?.end()]
  admin = null
  app = null
  await Promise.all(closing)
}
