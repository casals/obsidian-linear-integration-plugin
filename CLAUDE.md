# CLAUDE.md

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

## Architecture Notes
- `src/sync/sync-manager.ts` — core sync logic. `findOrCreateNoteForIssue()` uses a vault-wide index
  (built once per sync) to find notes by `linear_id` / `linear_identifier` frontmatter across the entire vault,
  not just the sync folder. This prevents duplicate notes when issues originate from notes outside the sync folder.
