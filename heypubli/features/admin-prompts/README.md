# admin-prompts

The **Prompts** page in the admin menu (`/admin/prompts`).

A library of Seedance 2.5 video prompts taken from X on 4 August 2026. Each row is one
post that names Seedance 2.5 and carries a real prompt.

## Why it exists

Seedance 2.5 is the video model creators are using right now, and the accounts that get
the best results publish the exact wording they used. This page keeps those in one place
so we can reuse them rather than guess at prompts.

## The four kinds of row

| Style     | What it means                                                                    |
| --------- | -------------------------------------------------------------------------------- |
| `post`    | The creator labelled the prompt and wrote it out. Copy button, safe to reuse.    |
| `likely`  | A long scene description with no label. Usually the prompt, sometimes just talk. |
| `replies` | The creator said "prompt below" or "prompt in the comments". Open the post.      |
| `named`   | A prompt is mentioned but not pasted. Open the post to judge it.                 |

## Files

| File               | What it is                                                     |
| ------------------ | -------------------------------------------------------------- |
| `AdminPrompts.tsx` | The page. Search, filter by style, sort, copy, open on X.      |
| `prompts.data.ts`  | The dataset, 255 posts from 132 creators. Static, no database. |
| `types.ts`         | `PromptEntry` and `PromptStyle`.                               |
| `copy.ts`          | Every string on the page.                                      |
| `mock.ts`          | Four rows for the tests, one of each style.                    |

## Notes

- The post text is stored exactly as the creator wrote it. Nothing is tidied up, because
  a reworded prompt is a different prompt.
- The data is a plain TypeScript file, so adding prompts means editing `prompts.data.ts`.
  If this ever needs to be edited from the browser it wants a Supabase table instead.
- Follower counts are a snapshot from the day they were collected, they will drift.
