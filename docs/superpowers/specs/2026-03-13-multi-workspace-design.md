# Multi-Workspace Support — Design Spec

**Date:** 2026-03-13
**Status:** Approved

---

## Overview

Add full multi-workspace support to the Linear ↔ Obsidian plugin. A "workspace" maps to a single Linear organization (one API key per organization). Each workspace has its own sync folder, team filter, and last-sync timestamp. All enabled workspaces sync in parallel when the user triggers a sync.

No migration from existing settings. A `settingsVersion` guard resets stored data to defaults on version mismatch, so users reconfigure from scratch after the update. The reset calls `await this.saveData(DEFAULT_SETTINGS)` first (not a merge), then continues with `DEFAULT_SETTINGS` — this ensures old top-level fields (`apiKey`, `teamId`, etc.) are fully purged from storage, not just hidden by the TypeScript interface.

---

## Data Model

### `LinearWorkspace` (replaces current definition)

```typescript
export interface LinearWorkspace {
    id: string;           // locally-generated UUID
    name: string;         // user-defined display name, e.g. "Work", "Personal"
    apiKey: string;
    syncFolder: string;   // vault path for this workspace's notes
    teamIds: string[];    // empty array = sync all teams; otherwise one call per teamId
    lastSyncTime?: string;
    enabled: boolean;
    // NOTE: the previous `isDefault` field is removed — default workspace is tracked via settings.defaultWorkspaceId
}
```

**Multi-team fetch strategy:** When `teamIds` is non-empty, `syncWorkspace()` calls `getIssues(teamId, lastSyncTime)` once per `teamId` and concatenates results. Linear issue identifiers are org-scoped, so there is no cross-team deduplication needed.

### `LinearPluginSettings` (updated)

**Removed fields** (all move into `LinearWorkspace`):
- `apiKey`
- `teamId`
- `syncFolder`
- `lastSyncTime`
- `multiWorkspaceSupport`
- `isDefault` (via `LinearWorkspace`)

**Added fields:**
- `settingsVersion: number` — currently `1`. On plugin load, if stored version differs from the current version, the plugin resets to `DEFAULT_SETTINGS` and saves. This is the clean-break mechanism that replaces migration.
- `defaultWorkspaceId: string` — the `id` of the workspace used for autocomplete, `IssueCreateModal` default, Kanban/Agenda generation, and all other single-client features. Empty string = no default set. Configurable in the Settings UI.

**Retained fields** (complete list):
- `workspaces: LinearWorkspace[]`
- `settingsVersion: number`
- `autoSync: boolean`
- `autoSyncInterval: number`
- `noteTemplate: string`
- `statusMapping: { [key: string]: string }`
- `includeDescription: boolean`
- `includeComments: boolean`
- `autocompleteEnabled: boolean`
- `debugMode: boolean`
- `secureTokenStorage: boolean`
- `inlineCommentMirroring: boolean`
- `kanbanGeneration: boolean`
- `agendaGeneration: boolean`
- `batchOperations: boolean`
- `conflictResolution: ConflictResolutionStrategy`
- `quickEditEnabled: boolean`
- `tooltipsEnabled: boolean`
- `autoFillFromExpressions: boolean`

**`DEFAULT_SETTINGS`** must be updated to remove the five deleted fields and add `workspaces: []`, `settingsVersion: 1`, and `defaultWorkspaceId: ''`.

---

## SyncManager Architecture

### Constructor

Remove the `LinearClient` parameter. SyncManager creates clients on demand inside `syncWorkspace()`.

```typescript
// Before
new SyncManager(app, linearClient, settings, plugin)

// After
new SyncManager(app, settings, plugin)
```

### `syncAll()` — parallel across workspaces

```typescript
async syncAll(): Promise<SyncResult> {
    const enabled = this.settings.workspaces.filter(w => w.enabled);
    if (enabled.length === 0) return emptyResult();

    const settled = await Promise.allSettled(
        enabled.map(w => this.syncWorkspace(w))
    );

    // Aggregate: sum counts, prefix errors with [workspace.id] for uniqueness
    return aggregateResults(enabled, settled);
}
```

### `syncWorkspace(workspace: LinearWorkspace)` — single workspace

Refactored from the current `syncAll()` logic. Key changes versus current code:

- Creates `new LinearClient(workspace.apiKey)` at entry
- **Team fetch:** if `workspace.teamIds` is empty, calls `getIssues(undefined, workspace.lastSyncTime)` once; otherwise calls once per `teamId` and concatenates all issue arrays
- Uses `workspace.syncFolder` everywhere `this.settings.syncFolder` was used
- Calls a parameterized `ensureSyncFolder(workspace.syncFolder)` instead of the current hardcoded version
- Uses `workspace.lastSyncTime` for the `updatedAfter` filter
- On success: mutates `workspace.lastSyncTime = new Date().toISOString()`, then calls `this.plugin.saveSettings()`
- **On failure (exception or all-error result): does NOT update `workspace.lastSyncTime`**, so the next sync retries from the last successful point

The vault-wide note index is built fresh inside each `syncWorkspace()` call. Each workspace runs independently with no shared mutable state, so parallel execution is safe. Two workspaces sharing the same API key (same org) is an unsupported configuration — the spec does not add a guard for it.

### Error prefix

Error strings use `[workspace.id]` (not `workspace.name`) as the prefix to avoid ambiguity when two workspaces share a display name.

### Return type

`SyncResult` is unchanged (`created`, `updated`, `errors[]`, `conflicts[]`).

---

## `plugin.getDefaultClient()` and client lifecycle

Replaces the single `this.linearClient` field on the plugin class. To avoid creating a new instance on every call, the plugin maintains a `Map<string, LinearClient>` cache keyed by workspace `id`. The cache is invalidated (cleared) whenever `saveSettings()` is called.

```typescript
private _clientCache = new Map<string, LinearClient>();

getDefaultClient(): LinearClient | null {
    const id = this.settings.defaultWorkspaceId;
    const workspace = id
        ? this.settings.workspaces.find(w => w.id === id && w.enabled)
        : this.settings.workspaces.find(w => w.enabled); // fallback if none set
    if (!workspace) return null;
    if (!this._clientCache.has(workspace.id)) {
        this._clientCache.set(workspace.id, new LinearClient(workspace.apiKey));
    }
    return this._clientCache.get(workspace.id)!;
}

getDefaultWorkspace(): LinearWorkspace | null {
    const id = this.settings.defaultWorkspaceId;
    return (id
        ? this.settings.workspaces.find(w => w.id === id && w.enabled)
        : this.settings.workspaces.find(w => w.enabled)) ?? null;
}

// Called inside saveSettings():
this._clientCache.clear();
```

**Startup initialization:** `KanbanGenerator`, `AgendaGenerator`, `CommentMirror`, `LinearAutocompleteSystem`, and `BatchOperationManager` are constructed at startup with `plugin.getDefaultClient()` (which may be `null`). Each class must accept `LinearClient | null` in its constructor and guard at method entry: show `new Notice('No workspace configured.')` and return early when the client is null.

**`KanbanGenerator` and `AgendaGenerator` sync folder:** These classes use `plugin.getDefaultWorkspace()?.syncFolder ?? ''` at generation time.

**Empty/disabled state:** Plugin loads normally. Commands that need a client show the Notice above. Auto-sync fires `syncAll()` which returns an empty result silently.

---

## Settings UI

### Workspace Management Section

Replaces the current top-level API Key / Team / Sync Folder fields. Positioned at the top of the settings tab.

**Default workspace selector** — a dropdown at the top of the section listing all enabled workspaces by name. Selection updates `settings.defaultWorkspaceId`. Used by autocomplete, `IssueCreateModal` initial selection, Kanban/Agenda generation.

**List view** — each workspace renders as a collapsed row:
```
[enabled toggle]  Work  ·  Linear/Work  [▼ expand]  [delete]
```

**Expanded view** — revealed configuration fields:

| Field | Control |
|---|---|
| Name | Text input |
| API Key | Password input + "Test Connection" button |
| Sync Folder | Text input |
| Teams | Multi-select dropdown — loaded lazily when the user expands the workspace row (not on every settings-tab open); empty selection = all teams |

**"+ Add Workspace"** button at the bottom of the list. New workspaces are added expanded, with a generated default name ("Workspace 1", "Workspace 2", etc.) and a UUID `id`.

**Interaction details:**
- Test Connection calls `new LinearClient(apiKey).testConnection()`; on success, fetches and populates the Teams dropdown
- Delete triggers `confirm()`. If workspace has `lastSyncTime` set, the confirm message notes that sync history will be lost
- Every field change calls `saveSettings()` immediately

### `IssueCreateModal` changes

**Null-client guard at open time:** The command that opens `IssueCreateModal` checks `plugin.getDefaultClient()` before constructing the modal. If null, show `new Notice('No workspace configured.')` and abort — the modal is never opened. The modal itself always receives a non-null `LinearClient`.

A workspace selector dropdown is added above the existing team dropdown:
- Options: all enabled workspaces by name
- Default: first enabled workspace
- On workspace change: create a new `LinearClient(workspace.apiKey)`, re-fetch teams, clear team/state selections

The `workspace` field in `LinearNoteConfig` (currently `workspace?: string`) resolves by matching `LinearWorkspace.name`. If the name matches an enabled workspace, that workspace's client is used for issue creation. If it doesn't match, fall back to the selected workspace in the modal.

### `local-config-system.ts` changes

`BatchOperationManager.createIssueFromFile()` currently calls `plugin.getDefaultClient()` (after the simplify refactor). No additional changes needed — it already uses the default workspace's client.

---

## File Change Summary

| File | Change |
|---|---|
| `src/models/types.ts` | Update `LinearWorkspace`; remove 5 top-level fields; add `settingsVersion`, `defaultWorkspaceId`; update `DEFAULT_SETTINGS` |
| `src/sync/sync-manager.ts` | Remove `LinearClient` constructor param; add `syncWorkspace()`; rewrite `syncAll()`; parameterize `ensureSyncFolder()`, `getLastSyncTime()`, `setLastSyncTime()` |
| `src/ui/settings-tab.ts` | Replace API Key/Team/Folder section with workspace management UI; add default workspace dropdown |
| `main.ts` | Remove `this.linearClient` field; add `getDefaultClient()`, `getDefaultWorkspace()`; add version-check reset on load; update `SyncManager` constructor; replace `this.settings.teamId` call sites with `undefined` |
| `src/ui/issue-modal.ts` | Add workspace selector; workspace-change triggers team re-fetch |

| `src/features/local-config-system.ts` | `KanbanGenerator` and `AgendaGenerator`: replace `settings.syncFolder` with first-enabled-workspace `syncFolder`. `BatchOperationManager`: constructor accepts `LinearClient \| null` and guards at method entry. |

**Note:** `BatchOperationManager.createIssueFromFile()` has a pre-existing bug where `config.team` is a team name string but `createIssue()` expects a UUID. This is out of scope for this spec.

---

## Out of Scope

- Two workspaces sharing the same API key (same org) — unsupported, no guard
- Sync folder collision between workspaces — permitted, no guard
- Per-workspace note templates or status mappings (global settings apply to all)
- Per-workspace auto-sync schedules (one global interval)
