# Multi-Workspace Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the plugin to connect to multiple Linear organizations (workspaces), each with its own API key, sync folder, and team filter — all syncing in parallel.

**Architecture:** Each `LinearWorkspace` carries its own `apiKey`, `syncFolder`, `teamIds[]`, and `lastSyncTime`. `SyncManager.syncAll()` fans out to per-workspace `syncWorkspace()` calls in parallel. A new `defaultWorkspaceId` setting controls which workspace drives autocomplete, Kanban/Agenda generation, and the issue-create modal default.

**Tech Stack:** TypeScript, Obsidian Plugin API (`app.fileManager.processFrontMatter`, `app.metadataCache`, `app.vault`), Linear GraphQL API via `LinearClient`.

**Build strategy — important:** This is a coordinated refactor across 6 files. After Chunk 1 removes fields from `LinearPluginSettings`, the build will remain broken until Chunk 5 (settings-tab.ts) is complete. **Do not attempt a clean build between Chunks 1 and 5.** The first green build checkpoint is after Task 5. Chunks 3 and 4 must also be committed together (Chunk 3 passes `LinearClient | null` to constructors; Chunk 4 updates those constructors to accept it — neither compiles alone).

Within Chunk 2, apply edits in this order: (1) replace `syncAll()`, (2) add `syncWorkspace()`, (3) update `findOrCreateNoteForIssue` and `ensureSyncFolder`, (4) delete `getLastSyncTime()` and `setLastSyncTime()`. Deletion last — the old `syncAll()` calls them; deleting before replacing `syncAll()` breaks compilation.

**Chunk dependency order:** Chunk 1 → Chunk 2 → Chunks 3+4 (together) → Chunk 5 → Chunk 6.

---

## Chunk 1: Data Model

### Task 1: Update `src/models/types.ts`

**Files:**
- Modify: `src/models/types.ts`

- [ ] **Step 1: Replace `LinearWorkspace` interface (lines 159-164)**

```typescript
export interface LinearWorkspace {
    id: string;           // locally-generated UUID
    name: string;         // user display name, e.g. "Work", "Personal"
    apiKey: string;
    syncFolder: string;   // vault path for this workspace's notes
    teamIds: string[];    // empty = sync all teams; non-empty = one call per teamId
    lastSyncTime?: string;
    enabled: boolean;
}
```

- [ ] **Step 2: Update `LinearPluginSettings` interface (lines 2-26)**

Remove: `apiKey`, `teamId`, `syncFolder`, `lastSyncTime`, `multiWorkspaceSupport`.
Add after `workspaces: LinearWorkspace[]`: `settingsVersion: number` and `defaultWorkspaceId: string`.

Full updated interface:

```typescript
export interface LinearPluginSettings {
    workspaces: LinearWorkspace[];
    settingsVersion: number;
    defaultWorkspaceId: string;
    autoSync: boolean;
    autoSyncInterval: number;
    includeDescription: boolean;
    includeComments: boolean;
    statusMapping: Record<string, string>;
    noteTemplate: string;
    secureTokenStorage: boolean;
    inlineCommentMirroring: boolean;
    kanbanGeneration: boolean;
    agendaGeneration: boolean;
    batchOperations: boolean;
    conflictResolution: 'manual' | 'linear-wins' | 'obsidian-wins' | 'timestamp';
    autocompleteEnabled: boolean;
    quickEditEnabled: boolean;
    tooltipsEnabled: boolean;
    autoFillFromExpressions: boolean;
    debugMode: boolean;
}
```

- [ ] **Step 3: Replace `DEFAULT_SETTINGS` (lines 28-71)**

```typescript
export const DEFAULT_SETTINGS: LinearPluginSettings = {
    workspaces: [],
    settingsVersion: 1,
    defaultWorkspaceId: '',
    autoSync: false,
    autoSyncInterval: 15,
    includeDescription: true,
    includeComments: false,
    statusMapping: {
        'Todo': '📋',
        'In Progress': '🔄',
        'Done': '✅',
        'Canceled': '❌'
    },
    noteTemplate: `# {{title}}

**Status:** {{status}}
**Assignee:** {{assignee}}
**Team:** {{team}}
**Created:** {{created}}
**Updated:** {{updated}}

## Description
{{description}}

## Linear Link
[Open in Linear]({{url}})

---
*Last synced: {{lastSync}}*`,
    secureTokenStorage: true,
    inlineCommentMirroring: true,
    kanbanGeneration: false,
    agendaGeneration: false,
    batchOperations: true,
    conflictResolution: 'manual',
    autocompleteEnabled: true,
    quickEditEnabled: true,
    tooltipsEnabled: true,
    autoFillFromExpressions: true,
    debugMode: false
};
```

- [ ] **Step 4: Verify build produces expected errors**

Run: `npm run build 2>&1 | head -40`

Expected: TypeScript errors at every call site reading `settings.apiKey`, `settings.teamId`, `settings.syncFolder`, `settings.lastSyncTime`. These are fixed in subsequent tasks.

---

## Chunk 2: SyncManager Refactor

### Task 2: Rewrite `src/sync/sync-manager.ts`

**Files:**
- Modify: `src/sync/sync-manager.ts`

- [ ] **Step 1: Update imports — add `LinearWorkspace`**

```typescript
import { LinearIssue, LinearWorkspace, LinearPluginSettings, NoteFrontmatter, SyncResult } from '../models/types';
```

- [ ] **Step 2: Remove `linearClient` from constructor (lines 8-13)**

```typescript
export class SyncManager {
    constructor(
        private app: App,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}
```

- [ ] **Step 3: Replace `syncAll()` with parallel multi-workspace version (lines 15-70)**

```typescript
async syncAll(): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, errors: [], conflicts: [] };
    const enabled = this.settings.workspaces.filter(w => w.enabled);
    if (enabled.length === 0) return result;

    const settled = await Promise.allSettled(enabled.map(w => this.syncWorkspace(w)));

    settled.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            result.created += r.value.created;
            result.updated += r.value.updated;
            result.errors.push(...r.value.errors);
            result.conflicts.push(...r.value.conflicts);
        } else {
            result.errors.push(`[${enabled[i].id}] Sync failed: ${r.reason}`);
        }
    });

    return result;
}
```

- [ ] **Step 4: Add `syncWorkspace()` private method — insert after `syncAll()`**

```typescript
private async syncWorkspace(workspace: LinearWorkspace): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, errors: [], conflicts: [] };
    const client = new LinearClient(workspace.apiKey);

    try {
        await this.ensureSyncFolder(workspace.syncFolder);

        let issues: LinearIssue[] = [];
        if (workspace.teamIds.length === 0) {
            issues = await client.getIssues(undefined, workspace.lastSyncTime);
        } else {
            const batches = await Promise.all(
                workspace.teamIds.map(tid => client.getIssues(tid, workspace.lastSyncTime))
            );
            issues = batches.flat();
        }

        if (issues.length === 0) return result;

        const linkedNotes = new Map<string, TFile>();
        for (const file of this.app.vault.getMarkdownFiles()) {
            const fm = parseFrontmatter(this.app, file);
            if (fm.linear_id) linkedNotes.set(fm.linear_id, file);
            if (fm.linear_identifier) linkedNotes.set(fm.linear_identifier, file);
        }

        for (const issue of issues) {
            try {
                const file = await this.findOrCreateNoteForIssue(issue, linkedNotes, workspace.syncFolder);
                const wasCreated = await this.updateNoteWithIssue(file, issue);
                if (wasCreated) result.created++;
                else result.updated++;
            } catch (error) {
                result.errors.push(`[${workspace.id}] Failed to sync ${issue.identifier}: ${(error as Error).message}`);
            }
        }

        // Only update lastSyncTime on success
        workspace.lastSyncTime = new Date().toISOString();
        await this.plugin.saveSettings();

    } catch (error) {
        result.errors.push(`[${workspace.id}] Sync failed: ${(error as Error).message}`);
        // Do NOT update lastSyncTime — next sync retries from last successful point
    }

    return result;
}
```

- [ ] **Step 5: Update `findOrCreateNoteForIssue()` — add `syncFolder` param (lines 72-82)**

```typescript
async findOrCreateNoteForIssue(issue: LinearIssue, linkedNotes: Map<string, TFile>, syncFolder: string): Promise<TFile> {
    const existing = linkedNotes.get(issue.id) || linkedNotes.get(issue.identifier);
    if (existing) return existing;

    const filename = this.sanitizeFilename(`${issue.identifier} - ${issue.title}.md`);
    const filepath = `${syncFolder}/${filename}`;
    const content = this.generateNoteContent(issue);
    return await this.app.vault.create(filepath, content);
}
```

- [ ] **Step 6: Update `ensureSyncFolder()` — add path param (lines 141-146)**

```typescript
private async ensureSyncFolder(syncFolder: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(syncFolder);
    if (!folder) {
        await this.app.vault.createFolder(syncFolder);
    }
}
```

- [ ] **Step 7: Delete `getLastSyncTime()` and `setLastSyncTime()` (lines 155-170)**

Both methods are now replaced by direct `workspace.lastSyncTime` access inside `syncWorkspace()`. Delete them entirely.

- [ ] **Step 8: Verify build**

Run: `npm run build 2>&1 | grep "sync-manager"` — no errors from this file.

- [ ] **Step 9: Commit**

```bash
git add src/models/types.ts src/sync/sync-manager.ts
git commit -m "feat: update data model and refactor SyncManager for multi-workspace"
```

---

## Chunk 3: Plugin Class

### Task 3: Update `main.ts`

**Files:**
- Modify: `main.ts`

- [ ] **Step 1: Add `LinearWorkspace` to models import**

Find the import line for `LinearPluginSettings` and add `LinearWorkspace`:

```typescript
import { LinearPluginSettings, LinearWorkspace, DEFAULT_SETTINGS } from './src/models/types';
```

- [ ] **Step 2: Replace `linearClient` property with `_clientCache`**

Remove: `linearClient: LinearClient;`
Add: `private _clientCache = new Map<string, LinearClient>();`

- [ ] **Step 3: Add `getDefaultWorkspace()` and `getDefaultClient()` methods**

Insert just before `onload()`:

```typescript
getDefaultWorkspace(): LinearWorkspace | null {
    const id = this.settings.defaultWorkspaceId;
    return (id
        ? this.settings.workspaces.find(w => w.id === id && w.enabled)
        : this.settings.workspaces.find(w => w.enabled)) ?? null;
}

getDefaultClient(): LinearClient | null {
    const workspace = this.getDefaultWorkspace();
    if (!workspace) return null;
    if (!this._clientCache.has(workspace.id)) {
        this._clientCache.set(workspace.id, new LinearClient(workspace.apiKey));
    }
    return this._clientCache.get(workspace.id)!;
}
```

- [ ] **Step 4: Update `loadSettings()` — add version-reset guard**

```typescript
async loadSettings() {
    const stored = await this.loadData();
    if (!stored || stored.settingsVersion !== 1) {
        // Version mismatch or fresh install — reset to defaults, no migration
        await this.saveData(DEFAULT_SETTINGS);
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
    } else {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    }
}
```

- [ ] **Step 5: Update `saveSettings()` — clear client cache**

```typescript
async saveSettings() {
    this._clientCache.clear();
    await this.saveData(this.settings);
    debugLog.setDebugMode(this.settings.debugMode);
}
```

- [ ] **Step 6: Update `SyncManager` construction — remove `linearClient` arg**

```typescript
// Before:
this.syncManager = new SyncManager(this.app, this.linearClient, this.settings, this);
// After:
this.syncManager = new SyncManager(this.app, this.settings, this);
```

- [ ] **Step 7: Update feature component construction**

```typescript
this.kanbanGenerator = new KanbanGenerator(this.app.vault, this.getDefaultClient(), this.settings, this);
this.agendaGenerator = new AgendaGenerator(this.app.vault, this.getDefaultClient(), this.settings, this);
this.commentMirror = new CommentMirror(this.app.vault, this.getDefaultClient());
this.batchOperationManager = new BatchOperationManager(this.app, this.getDefaultClient(), this.syncManager);
```

- [ ] **Step 8: Update autocomplete initialization**

```typescript
if (this.settings.autocompleteEnabled) {
    setTimeout(() => {
        const client = this.getDefaultClient();
        if (client) {
            this.autocompleteSystem = new LinearAutocompleteSystem(
                this.app, client, this.settings, this.localConfigManager
            );
            this.registerEditorSuggest(this.autocompleteSystem);
        }
    }, 1000);
}
```

- [ ] **Step 9: Fix Kanban call sites — replace `this.settings.teamId`**

Find all `this.settings.teamId` in `onload()` (ribbon + command). Replace:

```typescript
await this.kanbanGenerator.createKanbanNote(this.getDefaultWorkspace()?.syncFolder ?? '', undefined);
```

- [ ] **Step 10: Update `createIssueFromNote()` — null guard + pass plugin**

```typescript
async createIssueFromNote(file: TFile): Promise<void> {
    const client = this.getDefaultClient();
    if (!client) {
        new Notice('No workspace configured. Add a workspace in Settings → Linear Integration.');
        return;
    }
    const localConfig = await this.localConfigManager.getConfigForNote(file);
    const modal = new IssueCreateModal(
        this.app,
        client,
        file,
        localConfig,
        this.settings,
        this,
        async (issue) => {
            await this.syncManager.updateNoteWithIssue(file, issue);
            const content = await this.app.vault.read(file);
            const reference = MarkdownParser.generateIssueReference(issue.id, issue.identifier);
            const updatedContent = MarkdownParser.embedIssueReference(content, reference, 'bottom');
            await this.app.vault.modify(file, updatedContent);
            new Notice(`Created Linear issue: ${issue.identifier} - ${issue.title}`);
        }
    );
    modal.open();
}
```

- [ ] **Step 11: Fix any remaining `this.linearClient` references**

```bash
grep -n "this\.linearClient" main.ts
```

For each hit: replace with `this.getDefaultClient()`. If the call site can't handle null, wrap with:
```typescript
const client = this.getDefaultClient();
if (!client) { new Notice('No workspace configured.'); return; }
```

- [ ] **Step 12: Do NOT build yet**

`main.ts` now passes `LinearClient | null` to constructors that still expect `LinearClient`. This will not compile until Chunk 4 updates those constructors. Continue directly to Chunk 4 and commit both together.

---

## Chunk 4: Feature Classes

### Task 4: Update `src/features/local-config-system.ts`

**Files:**
- Modify: `src/features/local-config-system.ts`

- [ ] **Step 1: Update `KanbanGenerator` constructor**

Change `linearClient: LinearClient` to `linearClient: LinearClient | null` and add `plugin: any`:

```typescript
export class KanbanGenerator {
    constructor(
        private vault: Vault,
        private linearClient: LinearClient | null,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}
```

- [ ] **Step 2: Add null guard to `generateKanbanBoard()`**

At the top of the method body:
```typescript
if (!this.linearClient) {
    new Notice('No workspace configured.');
    return '';
}
```

- [ ] **Step 3: Update `createKanbanNote()` — accept `syncFolder` param**

```typescript
async createKanbanNote(syncFolder: string, teamId?: string): Promise<TFile> {
    const content = await this.generateKanbanBoard(teamId);
    const filename = `Linear Kanban - ${new Date().toLocaleDateString()}.md`;
    const filepath = `${syncFolder}/${filename}`;
    const existingFile = this.vault.getAbstractFileByPath(filepath);
    if (existingFile instanceof TFile) {
        await this.vault.modify(existingFile, content);
        return existingFile;
    }
    return await this.vault.create(filepath, content);
}
```

Remove any reference to `this.settings.syncFolder` inside this method.

- [ ] **Step 4: Update `AgendaGenerator` constructor — same pattern**

```typescript
export class AgendaGenerator {
    constructor(
        private vault: Vault,
        private linearClient: LinearClient | null,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}
```

- [ ] **Step 5: Add null guard to `generateAgenda()`**

```typescript
if (!this.linearClient) {
    new Notice('No workspace configured.');
    return '';
}
```

- [ ] **Step 6: Update `createAgendaNote()` — accept `syncFolder` param**

```typescript
async createAgendaNote(syncFolder: string): Promise<TFile> {
    const content = await this.generateAgenda();
    const filename = `Linear Agenda - ${new Date().toLocaleDateString()}.md`;
    const filepath = `${syncFolder}/${filename}`;
    const existingFile = this.vault.getAbstractFileByPath(filepath);
    if (existingFile instanceof TFile) {
        await this.vault.modify(existingFile, content);
        return existingFile;
    }
    return await this.vault.create(filepath, content);
}
```

- [ ] **Step 7: Update `CommentMirror` constructor to accept `LinearClient | null`**

```typescript
constructor(private vault: Vault, private linearClient: LinearClient | null) {}
```

Add null guard at the start of its main sync method:
```typescript
if (!this.linearClient) { new Notice('No workspace configured.'); return; }
```

- [ ] **Step 8: Verify build — first green build since Chunk 1**

Run: `npm run build 2>&1 | head -60`

After Chunks 3+4 are complete, the only remaining compile errors should be in `settings-tab.ts` and `issue-modal.ts`. If you see errors in `main.ts`, `sync-manager.ts`, or `local-config-system.ts`, fix them before continuing.

- [ ] **Step 9: Commit Chunks 3+4 together**

```bash
git add src/models/types.ts src/sync/sync-manager.ts main.ts src/features/local-config-system.ts
git commit -m "feat: wire multi-workspace into SyncManager, plugin class, and feature generators"
```

---

## Chunk 5: Settings UI

### Task 5: Rewrite workspace section in `src/ui/settings-tab.ts`

**Files:**
- Modify: `src/ui/settings-tab.ts`

- [ ] **Step 1: Add `LinearWorkspace` to imports**

```typescript
import { LinearPluginSettings, LinearWorkspace } from '../models/types';
```

- [ ] **Step 2: Delete the old API Key / Test Connection / Team / Sync Folder block**

Delete from `display()`: the four `new Setting(containerEl)` blocks for API Key, Test Connection, Default team, and Sync folder (lines 144-211). Also delete the `loadTeams()` and `loadTeamsIntoDropdown()` methods (lines 343-368).

- [ ] **Step 3: Insert workspace management section in place of deleted block**

```typescript
// ── Workspaces ───────────────────────────────────────────────────────────
containerEl.createEl('h3', { text: 'Workspaces' });

// Default workspace selector
const defaultWorkspaceSetting = new Setting(containerEl)
    .setName('Default workspace')
    .setDesc('Used for autocomplete, issue creation, and Kanban/Agenda generation.');

const renderDefaultDropdown = () => {
    defaultWorkspaceSetting.controlEl.empty();
    const select = defaultWorkspaceSetting.controlEl.createEl('select');
    const enabled = this.plugin.settings.workspaces.filter((w: LinearWorkspace) => w.enabled);
    if (enabled.length === 0) {
        select.createEl('option', { text: 'No workspaces enabled', value: '' });
        select.disabled = true;
    } else {
        enabled.forEach((w: LinearWorkspace) => {
            const opt = select.createEl('option', { text: w.name || w.id, value: w.id });
            if (w.id === this.plugin.settings.defaultWorkspaceId) opt.selected = true;
        });
        select.addEventListener('change', async () => {
            this.plugin.settings.defaultWorkspaceId = select.value;
            await this.plugin.saveSettings();
        });
    }
};
renderDefaultDropdown();

// Workspace list
const workspaceListEl = containerEl.createDiv({ cls: 'linear-workspace-list' });

const renderWorkspaceList = () => {
    workspaceListEl.empty();
    this.plugin.settings.workspaces.forEach((workspace: LinearWorkspace, index: number) => {
        const row = workspaceListEl.createDiv({ cls: 'linear-workspace-row' });
        const header = row.createDiv({ cls: 'linear-workspace-header' });

        // Enabled toggle
        const toggle = header.createEl('input', { type: 'checkbox' });
        toggle.checked = workspace.enabled;
        toggle.addEventListener('change', async () => {
            workspace.enabled = toggle.checked;
            await this.plugin.saveSettings();
            renderDefaultDropdown();
        });

        header.createSpan({ text: ` ${workspace.name || `Workspace ${index + 1}`}` });
        if (workspace.syncFolder) header.createSpan({ text: ` · ${workspace.syncFolder}`, cls: 'linear-workspace-folder' });

        // Expand button
        let expanded = !workspace.name; // auto-expand new workspaces
        const expandBtn = header.createEl('button', { text: expanded ? '▲' : '▼' });
        const details = row.createDiv({ cls: 'linear-workspace-details' });
        details.style.display = expanded ? 'block' : 'none';
        expandBtn.addEventListener('click', () => {
            expanded = !expanded;
            details.style.display = expanded ? 'block' : 'none';
            expandBtn.textContent = expanded ? '▲' : '▼';
        });

        // Delete button
        const deleteBtn = header.createEl('button', { text: '✕' });
        deleteBtn.addEventListener('click', async () => {
            const msg = workspace.lastSyncTime
                ? `Delete "${workspace.name || 'this workspace'}"? Sync history will be lost.`
                : `Delete "${workspace.name || 'this workspace'}"?`;
            if (confirm(msg)) {
                this.plugin.settings.workspaces.splice(index, 1);
                if (this.plugin.settings.defaultWorkspaceId === workspace.id) {
                    this.plugin.settings.defaultWorkspaceId = '';
                }
                await this.plugin.saveSettings();
                renderWorkspaceList();
                renderDefaultDropdown();
            }
        });

        // ── Expanded details ──────────────────────────────────────────────

        // Name field
        new Setting(details).setName('Name').addText(text =>
            text.setValue(workspace.name).onChange(async val => {
                workspace.name = val;
                await this.plugin.saveSettings();
                renderWorkspaceList();
                renderDefaultDropdown();
            })
        );

        // API Key + Test Connection
        let teamsSelect: HTMLSelectElement | null = null;
        const apiKeySetting = new Setting(details).setName('API Key').addText(text => {
            text.inputEl.type = 'password';
            text.setValue(workspace.apiKey).onChange(async val => {
                workspace.apiKey = val;
                await this.plugin.saveSettings();
            });
        });
        apiKeySetting.addButton(btn =>
            btn.setButtonText('Test Connection').onClick(async () => {
                if (!workspace.apiKey) { new Notice('Enter an API key first.'); return; }
                btn.setButtonText('Testing…').setDisabled(true);
                try {
                    const client = new LinearClient(workspace.apiKey);
                    const ok = await client.testConnection();
                    if (ok) {
                        new Notice('Connected!');
                        const teams = await client.getTeams();
                        if (teamsSelect) {
                            teamsSelect.replaceChildren(); // clear old options
                            teams.forEach(t => {
                                const opt = teamsSelect!.createEl('option', { text: t.name, value: t.id });
                                opt.selected = workspace.teamIds.includes(t.id);
                            });
                        }
                    } else {
                        new Notice('Connection failed. Check the API key.');
                    }
                } catch {
                    new Notice('Connection failed.');
                } finally {
                    btn.setButtonText('Test Connection').setDisabled(false);
                }
            })
        );

        // Sync Folder
        new Setting(details).setName('Sync folder').addText(text =>
            text.setPlaceholder('Linear/Work').setValue(workspace.syncFolder).onChange(async val => {
                workspace.syncFolder = val;
                await this.plugin.saveSettings();
            })
        );

        // Teams multi-select
        const teamsSetting = new Setting(details)
            .setName('Teams')
            .setDesc('Leave empty to sync all teams. Click "Test Connection" to load options.');
        teamsSelect = teamsSetting.controlEl.createEl('select');
        teamsSelect.multiple = true;
        teamsSelect.style.minHeight = '80px';
        // Show previously saved teamIds as placeholder options until Test Connection is clicked
        workspace.teamIds.forEach(tid => {
            teamsSelect!.createEl('option', { text: tid, value: tid }).selected = true;
        });
        teamsSelect.addEventListener('change', async () => {
            workspace.teamIds = Array.from(teamsSelect!.selectedOptions).map(o => o.value);
            await this.plugin.saveSettings();
        });
    });
};
renderWorkspaceList();

// Add Workspace button
new Setting(containerEl).addButton(btn =>
    btn.setButtonText('+ Add Workspace').onClick(async () => {
        this.plugin.settings.workspaces.push({
            id: crypto.randomUUID(),
            name: '',
            apiKey: '',
            syncFolder: '',
            teamIds: [],
            enabled: true,
        });
        await this.plugin.saveSettings();
        renderWorkspaceList();
        renderDefaultDropdown();
    })
);
```

- [ ] **Step 4: Verify build**

Run: `npm run build 2>&1 | grep "settings-tab"` — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings-tab.ts
git commit -m "feat: replace single-workspace settings with workspace management UI"
```

---

## Chunk 6: Issue Create Modal

### Task 6: Add workspace selector to `src/ui/issue-modal.ts`

**Files:**
- Modify: `src/ui/issue-modal.ts`

- [ ] **Step 1: Add `plugin: any` to constructor (after `settings` param)**

```typescript
constructor(
    app: App,
    private linearClient: LinearClient,
    private file: TFile,
    private localConfig: LinearNoteConfig,
    private settings: LinearPluginSettings,
    private plugin: any,
    private onSuccess: (issue: LinearIssue) => void
) {
    super(app);
}
```

- [ ] **Step 2: Add `selectedWorkspaceId` field**

Add with the other private fields at the top of the class:
```typescript
private selectedWorkspaceId: string = '';
```

- [ ] **Step 3: Initialize `selectedWorkspaceId` in `onOpen()` before `loadInitialData()`**

```typescript
this.selectedWorkspaceId = this.plugin.settings.defaultWorkspaceId ||
    (this.plugin.settings.workspaces.find((w: any) => w.enabled)?.id ?? '');
```

- [ ] **Step 4: Add workspace dropdown at the top of `buildForm()`**

Insert before the title input:

```typescript
const enabledWorkspaces = this.plugin.settings.workspaces.filter((w: any) => w.enabled);
if (enabledWorkspaces.length > 1) {
    new Setting(contentEl)
        .setName('Workspace')
        .addDropdown(async dropdown => {
            enabledWorkspaces.forEach((w: any) => dropdown.addOption(w.id, w.name));
            dropdown.setValue(this.selectedWorkspaceId);
            dropdown.onChange(async (workspaceId: string) => {
                this.selectedWorkspaceId = workspaceId;
                const ws = this.plugin.settings.workspaces.find((w: any) => w.id === workspaceId);
                if (ws) {
                    this.linearClient = new LinearClient(ws.apiKey);
                    this.teamId = '';
                    this.stateId = '';
                    this.teams = [];
                    this.states = [];
                    contentEl.empty();
                    contentEl.createEl('h2', { text: 'Create Linear issue' });
                    await this.loadInitialData();
                }
            });
        });
}
```

- [ ] **Step 5: Full clean build**

Run: `npm run build 2>&1`

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/issue-modal.ts main.ts
git commit -m "feat: add workspace selector to issue create modal"
```

---

## Chunk 7: Deploy and Smoke Test

### Task 7: Deploy to vault and verify

- [ ] **Step 1: Build and copy to vault**

```bash
npm run build && cp main.js manifest.json styles.css /Users/yubai/Obsidian/byheaven/.obsidian/plugins/linear-integration/
```

- [ ] **Step 2: Reload plugin**

```bash
obsidian plugin:reload id=linear-integration && obsidian dev:errors
```

- [ ] **Step 3: Configure a workspace**

In Settings → Linear Integration:
1. Click "+ Add Workspace"
2. Enter name, API key, sync folder
3. Click "Test Connection" → should show "Connected!" and populate Teams dropdown
4. Select teams or leave empty
5. Enable the toggle
6. Confirm it appears in "Default workspace" dropdown

- [ ] **Step 4: Test sync**

Run "Sync Linear issues" command. Verify notes appear in the configured sync folder.

- [ ] **Step 5: Test create issue**

Open any note → "Create Linear issue from note". With 2+ enabled workspaces, workspace selector should appear at the top.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete multi-workspace support"
```

---

## Known Limitations (out of scope)

- `BatchOperationManager.createIssueFromFile()` passes `config.team` name string to `createIssue()` which expects a UUID — pre-existing bug
- Two workspaces with identical API keys (same org) — unsupported, no guard
- Autocomplete shows only default workspace data — by design
