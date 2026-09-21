# Nilli Studio UX standard

Standing preference approved by Francis on September 21, 2026. Apply to future Nilli builds and UX/UI improvements without requiring the reference links again.

## Reference shelf

Consult these when planning interaction and visual polish:
- https://www.rareui.com/ — component and interaction inspiration.
- https://obsidianui.dev — user-selected UI reference; inspect current examples before attributing specific patterns.
- https://designspells.com — interaction details and visual inspiration.
- https://transitions.dev — transition patterns, panel reveals, resizing and state changes.

Use references thoughtfully, not as a requirement to install every library. If a reference is unavailable, retain it and use verified examples from the others.

## Baseline

- Layout-matched skeletons on initial loading; retain existing content during refresh.
- Smooth collapsible sections, tabs and panel resizing, usually 160–220 ms.
- Opaque, readable surfaces, consistent spacing and clear hierarchy.
- Local busy indicators, disabled duplicate actions, and success only after confirmed saves.
- Errors near their action or field. Preserve drafts on errors, tab changes and card collapse.
- Keyboard-operable controls, visible focus, meaningful accessible states and reduced-motion support.
- Uploads support choosing or dropping files, clear limits, file/image previews, replacement/removal and real progress. Never imply money was paid or records saved before confirmation.
- Keep navigation and scroll stable. Do not add motion delays to routine tasks.
- Reuse existing lightweight primitives. Avoid unnecessary dependencies, polling, network calls and Vercel compute.

## Review before shipping

Check loading, empty, error, busy and saved states; slow connections; keyboard and reduced motion; narrow screens; draft preservation; repeated actions. Report which checks were actually performed.
