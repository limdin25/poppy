import { supabaseAdmin } from '../../../src/integrations/supabase/client.js'

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401 })

  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user } } = await supabaseAdmin.auth.getUser(jwt)
  if (!user?.email) return new Response('Unauthorized', { status: 401 })

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('email')
    .eq('email', user.email)
    .single()
  if (!admin) return new Response('Forbidden', { status: 403 })

  const checks = await Promise.all([
    checkService('Supabase (Database)', async () => {
      await supabaseAdmin.from('businesses').select('id').limit(1)
    }),
    checkService('Supabase (Auth)', async () => {
      await supabaseAdmin.auth.getUser(jwt)
    }),
    checkService('Retell AI', async () => {
      const res = await fetch('https://api.retellai.com/v2/agent', {
        headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
    }),
    checkService('Unipile', async () => {
      const res = await fetch(`${process.env.UNIPILE_DSN}/api/v1/users/me`, {
        headers: { 'X-API-KEY': process.env.UNIPILE_TOKEN || '' },
      })
      if (!res.ok) throw new Error(`${res.status}`)
    }),
    checkService('Twilio', async () => {
      const sid = process.env.TWILIO_ACCOUNT_SID || ''
      const token = process.env.TWILIO_AUTH_TOKEN || ''
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
        headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
    }),
  ])

  return Response.json({ checks, timestamp: new Date().toISOString() })
}

async function checkService(name: string, fn: () => Promise<void>) {
  const start = Date.now()
  try {
    await fn()
    return { service: name, status: 'healthy' as const, latency: `${Date.now() - start}ms` }
  } catch {
    return { service: name, status: 'down' as const, latency: `${Date.now() - start}ms` }
  }
}
