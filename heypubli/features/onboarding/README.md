# onboarding

## What it does

6-step onboarding wizard for new influencers after signup.

## Files

- `OnboardingWizard.tsx` — main wizard with all 6 steps
- `StepIndicator.tsx` — numbered step progress bar
- `SectorGrid.tsx` — selectable grid of niches
- `Onboarding.test.tsx` — Vitest tests
- `copy.ts` — PT-BR strings
- `index.ts` — public exports

## Route

`/onboarding`

## Dependencies

`types/database.ts` for Sector type, `mocks/sectors.mock.ts` for test data.
