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

## Visual authority

Approved Core Console shell Figma frames and the existing semantic token and component system remain authoritative for global application styling.

Feature-specific Figma mockups and generated prototypes are implementation references for layout, hierarchy, density, workflow composition, and interaction states. They do not independently redefine global shell styling or semantic design tokens.

Feature implementation should reuse existing Core Console components and semantic tokens rather than introduce page-specific replacements for typography, global navigation, colors, borders, radii, or other shared visual primitives solely to reproduce incidental differences in generated prototype output.

Inter remains the application typeface. Feature work must not replace the global font family merely to match generated prototype output.

## Finance v1 authority

Finance v1 uses a layered authority model:

1. The [approved Finance interaction specification](docs/finance-v1-frontend-interaction-spec.md) owns frontend workflows, interaction behavior, user-facing state transitions, and navigation semantics.
2. The complete [Finance reference-image set](docs/design/finance-v1/README.md) owns information architecture, page composition, major desktop layout relationships, and visual direction.
3. This document, the existing Core Console shell, checked-in shadcn components, and semantic design tokens own the global visual and implementation constraints within which Finance is built.

The Finance reference images are not pixel-perfect implementation requirements. Implementation may refine spacing, density, borders, radii, typography, responsive behavior, and component composition while preserving the interaction specification, information architecture, major desktop relationships, and visual direction. Refinements should retain a neutral, restrained, data-dense enterprise character similar to PrimeVue without introducing PrimeVue or another UI framework.
