# Design Tokens

## Colors

| Element              | Color                       | CSS Variable             | Usage                             |
| -------------------- | --------------------------- | ------------------------ | --------------------------------- |
| Background           | #FFFFFF                     | `--background`           | Main background                   |
| Background secondary | #F9FAFB                     | `--background-secondary` | Cards, content areas              |
| Accent primary       | #E1306C                     | `--accent`               | Buttons, highlights, active icons |
| Accent gradient      | #F56040 → #E1306C → #C13584 | —                        | Headers, badges, special CTAs     |
| Text primary         | #1A1A1A                     | `--foreground`           | Titles, important text            |
| Text secondary       | #6B7280                     | `--foreground-secondary` | Descriptions, labels              |
| Borders              | #E5E7EB                     | `--border`               | Cards, tables, dividers           |
| Success              | #10B981                     | `--success`              | Connected, published, active      |
| Error                | #EF4444                     | `--error`                | Failed, disconnected, pending     |
| Warning              | #F59E0B                     | `--warning`              | Scheduled, expiring, attention    |

## Gradient

```css
background: linear-gradient(135deg, #f56040, #e1306c, #c13584);
```

## Typography

- Font: Geist Sans (primary), Geist Mono (code)
- Loaded via `next/font/google`

## Spacing & Radius

- Cards: `rounded-xl`, `p-6`
- Buttons: `rounded-full` or `rounded-lg`
- Input fields: `rounded-lg`
