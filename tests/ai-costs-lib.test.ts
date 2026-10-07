// Admin, AI Costs: the sums and date maths behind the page.
import { describe, expect, it } from 'vitest';
import {
  addDays, bucketKey, bucketLabel, buildBuckets, daysBetween, gbp, londonToday, niceMax, OTHER_KEY, presetRange, stackSeries, tokens, usd,
  type SeriesPoint,
} from '../src/features/admin/lib/aiCosts';

describe('money and token formatting', () => {
  it('shows tiny costs with enough digits to be read and big ones without noise', () => {
    expect(usd(0)).toBe('$0');
    expect(usd(0.0003)).toBe('$0.0003');
    expect(usd(0.0456)).toBe('$0.046');
    expect(usd(3.456)).toBe('$3.46');
    expect(usd(1234.5)).toBe('$1,235');
    expect(usd(null)).toBe('$0');
  });
  it('shows the pound figure only when a rate is set', () => {
    expect(gbp(10, 0.75322)).toBe('£7.53');
    expect(gbp(10, 0)).toBe('');
    expect(gbp(10, null)).toBe('');
  });
  it('shortens token counts', () => {
    expect([tokens(0), tokens(950), tokens(1500), tokens(24_000), tokens(3_400_000), tokens(25_000_000)]).toEqual(['0', '950', '1.5k', '24k', '3.4M', '25M']);
  });
});

describe('the date range behind each button, in London days', () => {
  const today = '2026-10-07';
  it('today and yesterday are hour by hour, longer ranges day by day', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today, bucket: 'hour' });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-06', to: '2026-10-06', bucket: 'hour' });
    expect(presetRange('7d', today)).toEqual({ from: '2026-10-01', to: today, bucket: 'day' });
    expect(presetRange('30d', today)).toEqual({ from: '2026-09-08', to: today, bucket: 'day' });
    expect(presetRange('month', today)).toEqual({ from: '2026-10-01', to: today, bucket: 'day' });
  });
  it('steps over month and year ends', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-01', '2026-10-07')).toBe(7);
    expect(daysBetween('2026-10-07', '2026-10-07')).toBe(1);
  });
  it('says what day it is in London, not in UTC', () => {
    // 23:30 UTC on 7 Oct is already 00:30 on 8 Oct in London (summer time).
    expect(londonToday(new Date('2026-10-07T23:30:00Z'))).toBe('2026-10-08');
    expect(londonToday(new Date('2026-10-07T12:00:00Z'))).toBe('2026-10-07');
  });
});

describe('the bars', () => {
  it('has a bar for every day and every hour, even the quiet ones', () => {
    expect(buildBuckets('2026-10-05', '2026-10-07', 'day')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    const hours = buildBuckets('2026-10-07', '2026-10-07', 'hour');
    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe('2026-10-07T00:00');
    expect(hours[23]).toBe('2026-10-07T23:00');
  });
  it('reads the database bucket names', () => {
    expect(bucketKey('2026-10-07T00:00', 'day')).toBe('2026-10-07');
    expect(bucketKey('2026-10-07T09:00', 'hour')).toBe('2026-10-07T09:00');
    expect(bucketLabel('2026-10-07', 'day')).toBe('7 Oct');
    expect(bucketLabel('2026-10-07T09:00', 'hour')).toBe('7 Oct 09:00');
  });
  it('rounds the axis top to a round number', () => {
    expect([niceMax(0.37), niceMax(0.57), niceMax(8.2), niceMax(100), niceMax(0), niceMax(2.3), niceMax(1)]).toEqual([0.4, 0.6, 10, 100, 1, 2.5, 1]);
  });

  const point = (bucket: string, model: string, cost: number, provider = 'openai', calls = 1): SeriesPoint => ({ bucket, provider, model, cost, calls });
  it('stacks each bar by model, biggest first, and totals it', () => {
    const buckets = buildBuckets('2026-10-07', '2026-10-07', 'hour');
    const { models, rows, max } = stackSeries([
      point('2026-10-07T09:00', 'gpt-5.4-mini', 0.5), point('2026-10-07T09:00', 'jev', 0.1, 'typesafe'), point('2026-10-07T10:00', 'gpt-5.4-mini', 0.2),
    ], buckets, 'hour');
    expect(models.map((m) => m.model)).toEqual(['gpt-5.4-mini', 'jev']);
    expect(new Set(models.map((m) => m.colour)).size).toBe(2);
    expect(rows[9]).toMatchObject({ bucket: '2026-10-07T09:00', total: 0.6, calls: 2 });
    expect(rows[9].parts).toEqual({ 'openai|gpt-5.4-mini': 0.5, 'typesafe|jev': 0.1 });
    expect(rows[0].total).toBe(0);
    expect(max).toBeCloseTo(0.6);
  });
  it('folds models beyond the top few into one grey Other', () => {
    const buckets = ['2026-10-07'];
    const series = Array.from({ length: 11 }, (_, i) => point('2026-10-07T00:00', `m${i}`, 11 - i));
    const { models, rows } = stackSeries(series, buckets, 'day', 8);
    expect(models).toHaveLength(9);
    expect(models[8]).toMatchObject({ key: OTHER_KEY, model: 'Other (3 models)', total: 3 + 2 + 1 });
    expect(rows[0].parts[OTHER_KEY]).toBe(6);
    expect(rows[0].total).toBe(66);
  });
  it('ignores a point outside the range instead of crashing', () => {
    const { rows } = stackSeries([point('2026-09-01T00:00', 'x', 5)], ['2026-10-07'], 'day');
    expect(rows[0].total).toBe(0);
  });
});
