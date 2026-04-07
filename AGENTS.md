# Repository Guidelines

## Project Structure & Module Organization

The main desktop app lives at the repository root. Put Electron main-process code in `src/main/`, preload glue in `src/preload.ts`, and Vue renderer code in `src/renderer/`. Keep static assets in `public/`, release and maintenance scripts in `scripts/`, and localized strings in `lang/`. The `moraya/` directory is a nested Git repository with its own toolchain; do not mix `moraya/` changes into root app work unless the task explicitly targets it.

## Build, Test, and Development Commands

Use `pnpm` only; `preinstall` blocks other package managers.

- `pnpm install`: install dependencies and register hooks.
- `pnpm run dev`: build preload/main once, then start the Vite renderer.
- `pnpm run start:electron`: launch the Electron shell against the built entry.
- `pnpm run build`: produce `dist/` and `dist-electron/`.
- `pnpm run dist` or `pnpm run dist:win-x64`: package installers with `electron-builder`.
- `pnpm run lint`: run `oxlint` plus `oxfmt --check`.
- `pnpm run format`: apply lint fixes and format tracked source files.

## Coding Style & Naming Conventions

Follow the existing TypeScript and Vue style: 2-space indentation, double quotes, and semicolon-free statements. Components use `PascalCase.vue` (`ThemeEditor.vue`), composables use `useX.ts` (`useTheme.ts`), and utility or main-process modules use descriptive camelCase filenames (`windowManager.ts`, `markdownFile.ts`). Let `oxlint` and `oxfmt` be the source of truth before opening a PR.

## Testing Guidelines

There is no dedicated `test` script yet. For behavior changes, run `pnpm run lint` and `pnpm run build`, then do a manual smoke test with `pnpm run start:electron`. After completing code changes, contributors should also start the live development service with `pnpm run dev` and confirm the Vite + Electron workflow still comes up. Validate the user path you changed, such as opening Markdown files, editor preview, settings dialogs, or packaging. The root `test-math.md` fixtures are useful for Markdown rendering regressions.

## Commit & Pull Request Guidelines

Visible history and the `commit-msg` hook follow Conventional Commits, for example `chore: v1.0.11`. Accepted prefixes are enforced by `scripts/verify-commit.js`, including `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, and `chore`. Keep subjects under 72 characters. Open PRs from a focused feature branch, link the related issue, summarize user-visible changes, and include screenshots or GIFs for renderer UI updates.
