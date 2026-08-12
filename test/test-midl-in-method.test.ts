import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { app } from './server'
import Diesel from '../lib/main'
import type { ContextType } from '../index'

const port = 3001
const baseUrl = `http://localhost:${port}`

// Tracks which middlewares ran for the current request
let ranMiddlewares: string[] = []

const auth_check = (_ctx: ContextType) => {
  ranMiddlewares.push('auth_check')
}

const auth_check_post = (_ctx: ContextType) => {
  ranMiddlewares.push('auth_check_post')
}

const get_user = (ctx: ContextType) => {
  return ctx.json({ role: 'user', method: 'GET' })
}

const create_user = (ctx: ContextType) => {
  return ctx.json({ role: 'user', method: 'POST' })
}

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const user_router = new Diesel()
  user_router.get('/', auth_check as any, get_user as any)
  user_router.post('/', auth_check_post as any, create_user as any)

  app.mount('/users', user_router)

  server = Bun.serve({ port, fetch: app.fetch() })
  console.log('Server running on ' + port)
})

afterAll(async () => {
  server.stop(true)
  console.log('Server closed.')
})

beforeEach(() => {
  ranMiddlewares = []
})

describe('Middleware isolation — GET /users', () => {
  it('should return 200', async () => {
    const res = await fetch(`${baseUrl}/users`)
    expect(res.status).toBe(200)
  })

  it('auth_check should run for GET', async () => {
    await fetch(`${baseUrl}/users`)
    expect(ranMiddlewares).toContain('auth_check')
  })

  // main test
  it('auth_check_post should NOT run for GET', async () => {
    await fetch(`${baseUrl}/users`)
    expect(ranMiddlewares).not.toContain('auth_check_post')
  })

  it('auth_check should run exactly once for GET', async () => {
    await fetch(`${baseUrl}/users`)
    const count = ranMiddlewares.filter(m => m === 'auth_check').length
    expect(count).toBe(1)
  })
})

describe('Middleware isolation — POST /users', () => {
  it('should return 200', async () => {
    const res = await fetch(`${baseUrl}/users`, { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('auth_check_post should run for POST', async () => {
    await fetch(`${baseUrl}/users`, { method: 'POST' })
    expect(ranMiddlewares).toContain('auth_check_post')
  })

  // main test
  it('auth_check should NOT run for POST', async () => {
    await fetch(`${baseUrl}/users`, { method: 'POST' })
    expect(ranMiddlewares).not.toContain('auth_check')
  })

  it('auth_check_post should run exactly once for POST', async () => {
    await fetch(`${baseUrl}/users`, { method: 'POST' })
    const count = ranMiddlewares.filter(m => m === 'auth_check_post').length
    expect(count).toBe(1)
  })
})
