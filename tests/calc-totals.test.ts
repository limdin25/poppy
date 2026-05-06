import { describe, it, expect } from 'vitest'
import { calcQuoteTotals, calcInvoiceTotals } from '../api/lib/calc-totals'

describe('calcQuoteTotals', () => {
  it('calculates subtotal from qty * unit_price', () => {
    const result = calcQuoteTotals([
      { description: 'A', qty: 2, unit_price: 50 },
      { description: 'B', qty: 1, unit_price: 30 },
    ], false)
    expect(result.subtotal).toBe(130)
    expect(result.total).toBe(130)
  })

  it('adds 20% VAT when enabled', () => {
    const result = calcQuoteTotals([
      { description: 'A', qty: 1, unit_price: 100 },
    ], true)
    expect(result.subtotal).toBe(100)
    expect(result.vat_rate).toBe(20)
    expect(result.vat_amount).toBe(20)
    expect(result.total).toBe(120)
  })

  it('sets vat_rate to 0 when disabled', () => {
    const result = calcQuoteTotals([
      { description: 'A', qty: 1, unit_price: 100 },
    ], false)
    expect(result.vat_rate).toBe(0)
    expect(result.vat_amount).toBe(0)
  })

  it('handles empty items', () => {
    const result = calcQuoteTotals([], true)
    expect(result.subtotal).toBe(0)
    expect(result.total).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    const result = calcQuoteTotals([
      { description: 'A', qty: 3, unit_price: 33.33 },
    ], true)
    expect(result.subtotal).toBe(99.99)
    expect(result.vat_amount).toBe(20)
    expect(result.total).toBe(119.99)
  })
})

describe('calcInvoiceTotals', () => {
  it('calculates subtotal from amounts', () => {
    const result = calcInvoiceTotals([
      { description: 'Service', amount: 200 },
      { description: 'Materials', amount: 50 },
    ], false)
    expect(result.subtotal).toBe(250)
    expect(result.total).toBe(250)
  })

  it('adds VAT when enabled', () => {
    const result = calcInvoiceTotals([
      { description: 'Work', amount: 500 },
    ], true)
    expect(result.vat_amount).toBe(100)
    expect(result.total).toBe(600)
  })

  it('supports custom VAT rate', () => {
    const result = calcInvoiceTotals([
      { description: 'Work', amount: 100 },
    ], true, 5)
    expect(result.vat_rate).toBe(5)
    expect(result.vat_amount).toBe(5)
    expect(result.total).toBe(105)
  })
})
