import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import opentype from 'opentype.js'
import sharp from 'sharp'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key'

const { renderNameOntoImage, DEFAULT_TEMPLATE } = await import('../api/lib/render-review-image.js')

const fontBuf = readFileSync(path.join(__dirname, 'fixtures/Poppins-SemiBold.ttf'))
const imgBuf = readFileSync(path.join(__dirname, 'fixtures/default-template.png'))
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength))

describe('renderNameOntoImage (the personalized-image trick)', () => {
  it('produces a valid JPEG with the same dimensions as the template', async () => {
    const out = await renderNameOntoImage(imgBuf, font, DEFAULT_TEMPLATE, 'Sally')
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(900)
  }, 20000)

  it('different names render different pixels', async () => {
    const a = await renderNameOntoImage(imgBuf, font, DEFAULT_TEMPLATE, 'Sally')
    const b = await renderNameOntoImage(imgBuf, font, DEFAULT_TEMPLATE, 'Muhammad')
    expect(a.equals(b)).toBe(false)
  }, 20000)

  it('actually draws glyphs (output differs from the no-name baseline)', async () => {
    const withName = await renderNameOntoImage(imgBuf, font, DEFAULT_TEMPLATE, 'Alexandra')
    const baseline = await sharp(imgBuf).jpeg({ quality: 85 }).toBuffer()
    expect(withName.equals(baseline)).toBe(false)
  }, 20000)

  it('sanitises hostile names', async () => {
    const out = await renderNameOntoImage(imgBuf, font, DEFAULT_TEMPLATE, '<script>"&x')
    expect((await sharp(out).metadata()).format).toBe('jpeg')
  }, 20000)
})
