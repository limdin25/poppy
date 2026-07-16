import { readFileSync } from 'fs'
import { join } from 'path'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const csvPath = join(process.cwd(), '..', 'scraper', 'exports', 'usa_plumbers_2200_20260715-0036.csv')
    const csv = readFileSync(csvPath, 'utf-8')
    const lines = csv.split('\n')
    const header = lines[0].split(',').map((h) => h.replace(/["﻿\r]/g, '').trim().toLowerCase())
    const phoneIdx = header.findIndex((h) => h === 'phone')
    if (phoneIdx === -1) {
      return new Response(JSON.stringify({ error: 'No phone column' }), { status: 500 })
    }
    const numbers = lines
      .slice(1)
      .map((line) => {
        const cols = line.split(',')
        return (cols[phoneIdx] ?? '').replace(/"/g, '').trim()
      })
      .filter(Boolean)

    return new Response(JSON.stringify(numbers), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 })
  }
}
