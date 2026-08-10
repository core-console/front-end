# Core Console desktop shell

The Core Console desktop shell is implemented from the two approved Figma frames:

- [Expanded frame](https://www.figma.com/design/ZMRbByFTGcHg5CgjXU6ZbX/Core-Console-UI?node-id=7-106)
- [Collapsed frame](https://www.figma.com/design/ZMRbByFTGcHg5CgjXU6ZbX/Core-Console-UI?node-id=7-61)

## Layout contract

- The reference viewport is `1280 × 1024`; it is not an application max-width.
- Desktop layout remains fluid at widths `>=1024px`.
- Expanded sidebar width is `240px`; collapsed width is `56px`.
- Header height is `56px` in both states.
- Home content uses `32px` top and horizontal padding.
- Sidebar state is local to the current render and is not persisted.
- Users is an implemented route and navigation destination. Settings remains visual-only until its route is approved and must not become a fake link.
- Mobile drawers and responsive mobile navigation are outside this shell's scope.

## Semantic visual tokens

The Figma palette is mapped in `src/index.css` to semantic shadcn tokens:

- `background` / `foreground`: Home surface and primary text
- `card`: header and sidebar surfaces
- `border`: shell dividers
- `muted-foreground`: secondary copy and inactive navigation
- `sidebar-accent`: expanded active navigation surface
- `sidebar-active-collapsed`: collapsed active navigation surface
- `account` / `avatar`: the display-only account identity surface

The approved typeface is Inter, loaded from `@fontsource-variable/inter` with a system sans fallback.
