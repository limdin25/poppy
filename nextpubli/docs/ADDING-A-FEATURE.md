# Adding a Feature

Every feature lives in `features/<kebab-case>/`. Use this template for the README.md:

```markdown
# <Feature Name>

## What it does

One sentence.

## Files

- `<Name>.tsx` — main component
- `<Name>.test.tsx` — Vitest tests
- `copy.ts` — PT-BR strings
- `mock.ts` — test/mock data
- `index.ts` — public exports

## Route

`/path/to/page` (if applicable)

## Dependencies

List any shared components or lib utilities used.
```

## Checklist

1. Create folder `features/<name>/`
2. Write `<Name>.test.tsx` FIRST (TDD)
3. Run test — see it FAIL
4. Create `<Name>.tsx` component
5. Run test — see it PASS
6. Create `copy.ts` with PT-BR strings
7. Create `mock.ts` with test data
8. Create `index.ts` barrel export
9. Create `README.md` from template above
10. Run `pnpm exec tsc --noEmit` and `pnpm exec eslint .`
