# AGENTS.md

Plugin repo for the Linear ↔ Obsidian integration, forked from `casals/obsidian-linear-integration-plugin`.

## Remotes
- `origin` — `byheaven/obsidian-linear-integration-plugin` (this fork, push here)
- `upstream` — `casals/obsidian-linear-integration-plugin` (original, pull upstream changes from here)

## Build & Deploy (local dev)

```bash
npm run build
cp main.js manifest.json styles.css /Users/yubai/Obsidian/byheaven/.obsidian/plugins/linear-integration/
obsidian plugin:reload id=linear-integration
obsidian dev:errors   # verify no errors
```

## Release (triggers BRAT update in vault)

```bash
git tag x.y.z
git push origin master && git push origin x.y.z
# GitHub Actions auto-builds and publishes release assets
```

- Every version release must include GitHub release notes.
- Every version release with user-visible behavior changes must update `README.md`.

## Architecture Notes
- `src/sync/sync-manager.ts` — core sync logic. `findOrCreateNoteForIssue()` uses a vault-wide index
  (built once per sync) to match notes by `linear_workspace_id` + `linear_id` / `linear_identifier`.
  Legacy notes without `linear_workspace_id` are only claimed from the current workspace sync folder to avoid
  cross-workspace misbinding while still allowing gradual migration.

## E2E Rules
- Run the local Obsidian CLI E2E suite before and after any substantial change that affects sync behavior,
  managed note structure, issue creation, comments, workspace routing, or settings.
- Any change to `SyncManager`, `LinearClient`, managed frontmatter fields, managed note body structure, or the
  create-issue flow must add or update at least one case under `tests/e2e/cases/`.
- The E2E runner must never select agent-like Linear users as default assignee candidates. Only human team members
  may be used; otherwise the test issue must remain unassigned.
