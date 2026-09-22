# UI styles

The visual system is **slate & jade**, with DM Sans body text and Manrope headings.
Fonts are self-hosted by `next/font` in `app/layout.tsx`. `app/globals.css` is the
single ordered stylesheet entrypoint; Leaflet loads first.

| File            | Owns                                                         |
| --------------- | ------------------------------------------------------------ |
| `tokens.css`    | Light/dark semantic colors, font stacks, radii, shadows      |
| `base.css`      | Element defaults, shared accessibility/focus, reduced motion |
| `workspace.css` | Navigation, panels, settings/intake, mobile detail overlay   |
| `listings.css`  | Listing rows, facts, review controls, comments, edit dialog  |
| `media.css`     | Photos, thumbnails, Map selector, enlarged photo dialog      |
| `maps.css`      | Map layout, Leaflet styling, pins, synchronized list/details |
| `runs.css`      | Run summaries, expanded history, metrics and source coverage |

Keep responsive rules beside the component they affect. Change theme tokens
instead of adding theme-specific component overrides. Status color is semantic;
labels and icons remain visible so color is never the only signal.
Each listing status has its own light/dark token: New blue, Review amber,
Interested jade, Touring violet, Unavailable slate, Gone orange, and Rejected red.
Keep all seven distinct; badge fills and dropdown dots use the same status token.

## Layout safeguards

- Listing rows use content-sized grid tracks. When the desktop list reaches its
  height limit, it scrolls instead of squeezing cards and clipping their bottom padding.
- The listings scrollbar has a rounded slate thumb, transparent track, and jade
  hover state. Standard thin/color styling is the fallback for browsers without
  scrollbar pseudo-element support; scrolling remains browser-managed.

- Detail panels use content-sized grid rows so mobile scrolling cannot collapse
  the facts strip. Date values stay on one line; whole fact cells reflow at narrow
  widths. Mobile facts keep the existing stacked arrangement.
- The Map thumbnail uses a centered flex column with a 5px gap. Thumbnail width
  comes from `--media-thumb-size`, shared with the adjacent photo strip.
- Keep the list/detail split, mobile overlay, navigation, field dialogs, and
  existing interactions intact when adjusting styling.

## Verification

Run `pnpm check` and `pnpm test:e2e`. Inspect both themes at desktop and phone sizes,
including long dates, expanded run history, edit/photo dialogs, focus states, and
200% text sizing. Check both the text bounds and the containing fact-strip height.
