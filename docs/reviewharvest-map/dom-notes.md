# Review Harvest — DOM notes (captured 2026-07-20)

## Tech observations
- Dashboard app (`dash.reviewharvest.com`) is a React SPA using **shadcn/ui** components (sidebar-wrapper `group/sidebar-wrapper`, `data-[variant=inset]`, Card primitives with `@container/card-header` container queries) on **Tailwind v4** (`w-(--sidebar-width)` paren syntax).
- Sidebar = shadcn Sidebar component (floating/inset variants, `Toggle Sidebar` sr-only button, keyboard shortcut region "Notifications alt+T").
- Live chat + onboarding checklist = **Intercom** (`#intercom-container`, checklist lives in cross-origin Intercom iframe, badge "1").
- Sub-apps embedded as **cross-origin iframes** in the dash shell:
  - Widgets page -> `https://widget.reviewharvest.com/?businessId={uuid}`
  - Social Posting page -> `https://social-posting.reviewharvest.com/?code={uuid}`
- Onboarding app (`onboarding.reviewharvest.com`) is a **TanStack Start/Router** app (`createFileRoute`, `/_serverFn/` endpoints, `useServerFn`, `useMutation` chunks; Vite asset hashes). Routes: `/`, `/i/$userId` (referral), `/$emailHash/create`, `/$emailHash/google`, `/$emailHash/google-error`, `/$emailHash/select-business`, `/$emailHash/pricing`, `/$emailHash/pay`, `/$emailHash/success`.
- Tracking on onboarding: Facebook Pixel (469968110412937), Cometly (`t.cometlytrack.com`), Tolt affiliate js, Cloudflare Insights, Intercom (`zvdfcsxr` workspace).
- Payment: Stripe (payment method update shows Stripe Link "Onelink" saved-card UI; success route consumes a `setup_intent` param — Stripe SetupIntent flow).
- Widget embeds: `<script src="https://widget.reviewharvest.com/widget/review-popup?business-id=...&tag=review-popup&star-color=%23FFC107&text-color=...&card-background-color=...&position=left" defer></script>` (same pattern for carousel/grid via `tag`).
- Customer review link (Copy Review Link button) = raw Google URL: `https://search.google.com/local/writereview?placeid={PLACE_ID}` (no RH redirect for the copy-link; SMS presumably wraps it for click tracking — not observable without a send).

## Dashboard home (`/business/dashboard`) — condensed outline
```
body
  div.group/sidebar-wrapper.has-data-[variant=inset]:bg-sidebar.flex.min-h-svh
    div.group.peer.text-sidebar-foreground.hidden
      div.relative.w-(--sidebar-width).bg-transparent.transition-[width]
      div.fixed.inset-y-0.z-10.hidden
        div.bg-sidebar.group-data-[variant=floating]:border-sidebar-border.flex.h-full
          div.flex.flex-col.gap-3.p-4
            ul.flex.w-full.min-w-0.flex-col
              li.group/menu-item.relative
          hr.mx-4.my-1.border-sidebar-border
          div.flex.min-h-0.flex-1.flex-col
            div.relative.flex.w-full.min-w-0
              button.relative.flex.items-center.gap-3
            div.relative.flex.w-full.min-w-0
              ul.flex.w-full.min-w-0.flex-col
            div.relative.flex.w-full.min-w-0
              a.block.w-full.p-3.rounded-xl
          hr.mx-4.my-1.border-sidebar-border
          div.flex.flex-col.gap-3.p-4
            ul.flex.w-full.min-w-0.flex-col
              li.group/menu-item.relative
          button.hover:after:bg-sidebar-border.absolute.inset-y-0.z-20
    main.bg-background.relative.flex.w-full
      header.flex.h-14.shrink-0.items-center
        button.inline-flex.items-center.justify-center.gap-2
          svg
            rect
            path
          span.sr-only — "Toggle Sidebar"
        div.bg-border.shrink-0.data-[orientation=horizontal]:h-px.data-[orientation=horizontal]:w-full
        span.font-medium.text-sm.truncate — "Key Worker Contractor Accommodation in L"
      div.flex.flex-1.flex-col.gap-6
        div.grid.gap-6.lg:grid-cols-3
          div.lg:col-span-2.flex.flex-col.gap-6
            div.bg-card.text-card-foreground.flex.flex-col
              div.p-6
            div.bg-card.text-card-foreground.flex.flex-col
              div.@container/card-header.grid.auto-rows-min.grid-rows-[auto_auto]
              div.px-6
          div.lg:col-span-1
            div.bg-card.text-card-foreground.flex.flex-col
              div.@container/card-header.grid.auto-rows-min.grid-rows-[auto_auto]
              div.px-6.space-y-6
  section
  div#intercom-tooltips-container.intercom-namespace
  div#intercom-css-container
  div#intercom-container.intercom-namespace
    div.intercom-app
      div.intercom-messenger-frame.intercom-with-namespace-16wz7d7.eewivui0
      div.intercom-with-namespace-4wz414.edrs4yi0
        div.intercom-with-namespace-1sapft2.e1nq9v8t0
          span.intercom-with-namespace-10dlm1a.eobnxxl2 — "1"
      div
        div.intercom-with-namespace-5y1cnf.equ3uxk0
      div#intercom-modal-container

```

## Contacts list (`/business/contacts`) — main area outline
```
main.bg-background.relative.flex.w-full
  header.flex.h-14.shrink-0.items-center
    button.inline-flex.items-center.justify-center.gap-2
      svg
        rect
        path
      span.sr-only — "Toggle Sidebar"
    div.bg-border.shrink-0.data-[orientation=horizontal]:h-px.data-[orientation=horizontal]:w-full
    span.font-medium.text-sm.truncate — "Key Worker Contractor Accommodation in L"
  div.flex.flex-col.gap-4.p-6
    div
      h1.text-2xl.font-bold.tracking-tight — "Contacts"
      p.text-muted-foreground — "Manage your contacts and review requests"
    div.space-y-4
      div.flex.flex-col.sm:flex-row.items-start
        div.relative.w-full.sm:w-80
          svg
            circle
            path
          input.file:text-foreground.placeholder:text-muted-foreground.selection:bg-primary.selection:text-primary-foreground
        div.flex.items-center.gap-2.flex-wrap
          button.inline-flex.items-center.justify-center.whitespace-nowrap
            svg
              polygon
          label.flex.items-center.gap-2.cursor-pointer
            button.peer.border-input.dark:bg-input/30.data-[state=checked]:bg-primary
            span.text-sm — "Clicked"
          label.flex.items-center.gap-2.cursor-pointer
            button.peer.border-input.dark:bg-input/30.data-[state=checked]:bg-primary
            span.text-sm — "Stopped"
          label.flex.items-center.gap-2.cursor-pointer
            button.peer.border-input.dark:bg-input/30.data-[state=checked]:bg-primary
            span.text-sm — "Do Not Contact"
          label.flex.items-center.gap-2.cursor-pointer
            button.peer.border-input.dark:bg-input/30.data-[state=checked]:bg-primary
            span.text-sm — "Left Review"
        span.text-sm.text-muted-foreground.ml-auto — "0 contacts"
    div.rounded-lg.border.border-border/50.bg-card
      div.flex.flex-col.items-center.justify-center
        div.flex.h-14.w-14.items-center
          svg
            path
            circle
            path
            path
        h3.text-base.font-semibold.text-foreground.mb-1.5 — "No contacts found"
        p.text-muted-foreground.text-sm.max-w-[280px].leading-relaxed — "No contacts match your current filters. "

```
