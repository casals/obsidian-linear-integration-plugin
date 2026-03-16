import { debugLog } from './src/utils/debug';
import { Plugin, TFile, Notice, MarkdownView, Editor } from 'obsidian';
import { LinearClient } from './src/api/linear-client';
import { SyncManager } from './src/sync/sync-manager';
import { formatSyncSummaryNoticeText, SYNC_NOTICE_DURATION } from './src/sync/sync-summary';
import { LinearSettingsTab } from './src/ui/settings-tab';
import { IssueCreateModal } from './src/ui/issue-modal';
import { LinearPluginSettings, LinearWorkspace, DEFAULT_SETTINGS, ConflictInfo, FileExplorerView, SyncResult } from './src/models/types';
import { LinearAutocompleteSystem, TooltipManager, QuickEditModal } from './src/features/autocomplete-system';
import { ConflictResolver, ConflictHistory } from './src/features/conflict-resolver';
import { LocalConfigManager, KanbanGenerator, AgendaGenerator, CommentMirror, BatchOperationManager } from './src/features/local-config-system';
import { MarkdownParser } from './src/parsers/markdown-parser';

export default class LinearPlugin extends Plugin {
    settings!: LinearPluginSettings;
    private _clientCache = new Map<string, LinearClient>();
    lastSyncSummaryNotice: string | null = null;
    syncManager!: SyncManager;
    autocompleteSystem?: LinearAutocompleteSystem;
    conflictResolver!: ConflictResolver;
    conflictHistory!: ConflictHistory;
    localConfigManager!: LocalConfigManager;
    kanbanGenerator!: KanbanGenerator;
    agendaGenerator!: AgendaGenerator;
    commentMirror!: CommentMirror;
    batchOperationManager!: BatchOperationManager;
    tooltipManager!: TooltipManager;

    getLastSyncSummaryNotice(): string | null {
        return this.lastSyncSummaryNotice;
    }

    getDefaultWorkspace(): LinearWorkspace | null {
        const id = this.settings.defaultWorkspaceId;
        if (id) {
            const explicit = this.settings.workspaces.find(w => w.id === id && w.enabled);
            if (explicit) return explicit;
            // Configured default is disabled — fall back to any enabled workspace
        }
        return this.settings.workspaces.find(w => w.enabled) ?? null;
    }

    getDefaultClient(): LinearClient | null {
        const workspace = this.getDefaultWorkspace();
        if (!workspace) return null;
        if (!this._clientCache.has(workspace.id)) {
            this._clientCache.set(workspace.id, new LinearClient(workspace.apiKey));
        }
        return this._clientCache.get(workspace.id)!;
    }

    async onload() {

        await this.loadSettings();

        // Initialize debug mode first
        debugLog.setDebugMode(this.settings.debugMode);
        debugLog.log('Loading Linear Plugin');

        this.syncManager = new SyncManager(this.app, this.settings, this);
        this.conflictResolver = new ConflictResolver(this.app, this.settings);
        this.conflictHistory = new ConflictHistory();
        this.localConfigManager = new LocalConfigManager(this.app.vault);
        this.tooltipManager = TooltipManager.getInstance();

        // Initialize feature components
        this.kanbanGenerator = new KanbanGenerator(this.app.vault, this.getDefaultClient(), this.settings, this);
        this.agendaGenerator = new AgendaGenerator(this.app.vault, this.getDefaultClient(), this.settings, this);
        this.commentMirror = new CommentMirror(this.app.vault, this.getDefaultClient());
        this.batchOperationManager = new BatchOperationManager(this.app, this.getDefaultClient(), this.syncManager);

        // Initialize autocomplete if enabled
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

        // Add ribbon icons
        this.addRibbonIcon('sync', 'Sync with Linear', async () => {
            await this.runTopLevelSync({ startNotice: 'Syncing with Linear...' });
        });

        this.addRibbonIcon('kanban', 'Generate Kanban board', async () => {
            try {
                const file = await this.kanbanGenerator.createKanbanNote(this.getDefaultWorkspace()?.syncFolder ?? '', undefined);
                await this.app.workspace.openLinkText(file.path, '', false);
                new Notice('Kanban board generated');
            } catch (error) {
                new Notice(`Failed to generate kanban: ${(error as Error).message}`);
            }
        });

        // Add core commands
        this.addCommand({
            id: 'create-linear-issue',
            name: 'Create Linear issue from note',
            checkCallback: (checking: boolean) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.file) {
                    if (!checking) {
                        this.createIssueFromNote(activeView.file);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'sync-linear-issues',
            name: 'Sync Linear issues',
            callback: async () => {
                await this.runTopLevelSync();
            }
        });

        this.addCommand({
            id: 'open-linear-issue',
            name: 'Open Linear issue in browser',
            checkCallback: (checking: boolean) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.file) {
                    if (!checking) {
                        this.openLinearIssue(activeView.file);
                    }
                    return true;
                }
                return false;
            }
        });

        // Add enhanced commands
        this.addCommand({
            id: 'quick-edit-issue',
            name: 'Quick edit Linear issue',
            checkCallback: (checking: boolean) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.file && this.settings.quickEditEnabled) {
                    if (!checking) {
                        this.quickEditIssue(activeView.file);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'generate-kanban',
            name: 'Generate Kanban board',
            callback: async () => {
                await this.kanbanGenerator.createKanbanNote(this.getDefaultWorkspace()?.syncFolder ?? '', undefined);
            }
        });

        this.addCommand({
            id: 'generate-agenda',
            name: 'Generate agenda',
            callback: async () => {
                await this.agendaGenerator.createAgendaNote(this.getDefaultWorkspace()?.syncFolder ?? '');
            }
        });

        this.addCommand({
            id: 'mirror-comments',
            name: 'Mirror Linear comments',
            checkCallback: (checking: boolean) => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView?.file && this.settings.inlineCommentMirroring) {
                    if (!checking) {
                        this.mirrorComments(activeView.file);
                    }
                    return true;
                }
                return false;
            }
        });

        this.addCommand({
            id: 'batch-create-issues',
            name: 'Batch create issues from selection',
            callback: async () => {
                await this.batchCreateIssues();
            }
        });

        this.addCommand({
            id: 'insert-issue-reference',
            name: 'Insert issue reference',
            editorCallback: (editor: Editor) => {
                this.insertIssueReference(editor);
            }
        });

        // Add settings tab
        this.addSettingTab(new LinearSettingsTab(this.app, this));

        // Set up event listeners
        this.setupEventListeners();

        // Auto-sync on startup if enabled
        if (this.settings.autoSync) {
            setTimeout(() => {
                void this.runTopLevelSync();
            }, 2000);
        }

        // Set up periodic sync if enabled
        if (this.settings.autoSyncInterval > 0) {
            this.registerInterval(
                window.setInterval(
                    () => {
                        void this.runTopLevelSync();
                    },
                    this.settings.autoSyncInterval * 60000
                )
            );
        }
    }

    private setupEventListeners(): void {
        // Listen for file changes to detect potential conflicts
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.handleFileModification(file);
                }
            })
        );

        // Listen for hover events for tooltips
        if (this.settings.tooltipsEnabled) {
            this.registerDomEvent(document, 'mouseover', (evt) => {
                this.handleMouseOver(evt);
            });
        }

        // Listen for config file changes
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.name === '.linear.json') {
                    this.localConfigManager.clearCache();
                }
            })
        );
    }

    private async handleFileModification(file: TFile): Promise<void> {
        // Check if this is a Linear-synced note
        const frontmatter = await this.syncManager.getFrontmatter(file);
        if (!frontmatter.linear_id) return;

        // Mark for potential conflict detection on next sync
        // This is a simplified implementation - in practice you'd want more sophisticated tracking
        debugLog.log(`File ${file.name} modified, marking for conflict check`);
    }

    private handleMouseOver(evt: MouseEvent): void {
        const target = evt.target as HTMLElement;
        
        // Check if hovering over a Linear issue reference
        const linkElement = target.closest('a[href*="linear.app/issue"]');
        if (linkElement) {
            const href = linkElement.getAttribute('href');
            const issueId = this.extractIssueIdFromUrl(href);
            if (issueId) {
                // Show tooltip with issue info
                this.showIssueTooltip(linkElement as HTMLElement, issueId);
            }
        }
    }

    private extractIssueIdFromUrl(url: string | null): string | null {
        if (!url) return null;
        const match = url.match(/linear\.app\/issue\/([^/?#]+)/);
        return match ? match[1] : null;
    }

    private async showIssueTooltip(element: HTMLElement, issueId: string): Promise<void> {
        try {
            const issue = await this.getDefaultClient()?.getIssueById(issueId);
            if (issue) {
                this.tooltipManager.showIssueTooltip(element, issue);
            }
        } catch (error) {
            debugLog.warn('Failed to load issue for tooltip:', error);
        }
    }

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
            async (issue, workspaceId) => {
                const workspace = this.settings.workspaces.find(w => w.id === workspaceId) ?? this.getDefaultWorkspace();
                if (!workspace) {
                    throw new Error('No workspace configured.');
                }

                try {
                    await this.syncManager.updateNoteWithIssue(file, issue, workspace, {
                        documentText: '',
                        draftText: '',
                        syncLabel: new Date().toLocaleString()
                    });
                } catch (error) {
                    debugLog.error('Failed to update note after creating a Linear issue:', error);
                    throw error;
                }
                new Notice(`Created Linear issue: ${issue.identifier} - ${issue.title}`);
            }
        );
        modal.open();
    }

    async openLinearIssue(file: TFile): Promise<void> {
        const issueId = await this.syncManager.getLinearIdFromNote(file);
        if (issueId) {
            const url = `https://linear.app/issue/${issueId}`;
            window.open(url, '_blank');
        } else {
            new Notice('No Linear issue linked to this note');
        }
    }

    async quickEditIssue(file: TFile): Promise<void> {
        const issueId = await this.syncManager.getLinearIdFromNote(file);
        if (!issueId) {
            new Notice('No Linear issue linked to this note');
            return;
        }

        const linearClient = this.getDefaultClient();
        if (!linearClient) {
            new Notice('No workspace configured.');
            return;
        }

        try {
            const issue = await linearClient.getIssueById(issueId);
            if (!issue) {
                new Notice('Issue not found in Linear');
                return;
            }

            const modal = new QuickEditModal(
                this.app,
                issue,
                async (updates) => {
                    await linearClient.updateIssue(issueId, updates);
                    await this.syncManager.syncAll();
                    new Notice('Issue updated successfully');
                }
            );
            modal.open();
        } catch (error) {
            new Notice(`Failed to load issue: ${(error as Error).message}`);
        }
    }

    async mirrorComments(file: TFile): Promise<void> {
        const issueId = await this.syncManager.getLinearIdFromNote(file);
        if (!issueId) {
            new Notice('No Linear issue linked to this note');
            return;
        }

        try {
            await this.commentMirror.mirrorCommentsToNote(file, issueId);
            new Notice('Comments mirrored successfully');
        } catch (error) {
            new Notice(`Failed to mirror comments: ${(error as Error).message}`);
        }
    }

    async batchCreateIssues(): Promise<void> {
        const selectedFiles = this.getSelectedFiles();
        if (selectedFiles.length === 0) {
            new Notice('No files selected');
            return;
        }

        new Notice(`Creating issues for ${selectedFiles.length} files...`);
        
        try {
            const results = await this.batchOperationManager.batchCreateIssues(selectedFiles);
            
            let message = `Created ${results.successes} issues successfully`;
            if (results.failures.length > 0) {
                message += `. ${results.failures.length} failed.`;
                debugLog.error('Batch creation failures:', results.failures);
            }
            
            new Notice(message);
        } catch (error) {
            new Notice(`Batch creation failed: ${(error as Error).message}`);
        }
    }

    async insertIssueReference(editor: Editor): Promise<void> {
        const issueIdentifier = await this.promptForIssueIdentifier();
        if (issueIdentifier) {
            try {
                const linearClient = this.getDefaultClient();
                if (!linearClient) return;
                const issues = await linearClient.getIssues();
                const issue = issues.find(i => i.identifier === issueIdentifier);

                if (issue) {
                    const reference = MarkdownParser.generateIssueReference(issue.id, issue.identifier);
                    editor.replaceSelection(reference);
                } else {
                    new Notice('Issue not found');
                }
            } catch (error) {
                new Notice(`Failed to find issue: ${(error as Error).message}`);
            }
        }
    }

    private async promptForIssueIdentifier(): Promise<string | null> {
        // In a real implementation, this would be a proper modal with search
        return prompt('Enter issue identifier (e.g., LIN-123):');
    }

    private getSelectedFiles(): TFile[] {
        const selectedFiles: TFile[] = [];
        
        // Get selected files from file explorer
        const fileExplorer = this.app.workspace.getLeavesOfType('file-explorer')[0];
        if (fileExplorer) {
            const explorerView = fileExplorer.view as FileExplorerView;
            if (explorerView.selectedFiles) {
                explorerView.selectedFiles.forEach((file: TFile) => {
                    if (file.extension === 'md') {
                        selectedFiles.push(file);
                    }
                });
            }
        }

        // Fallback to current file if no selection
        if (selectedFiles.length === 0) {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView?.file) {
                selectedFiles.push(activeView.file);
            }
        }

        return selectedFiles;
    }

    // Enhanced sync with conflict detection
    async syncWithConflictResolution(): Promise<void> {
        try {
            const syncResult = await this.runTopLevelSync({
                startNotice: 'Syncing with conflict detection...',
                resolveConflicts: true
            });

            if (!syncResult) {
                return;
            }
        } catch (error) {
            debugLog.error('Sync with conflict resolution failed unexpectedly:', error);
        }
    }

    private async runTopLevelSync(options: {
        startNotice?: string;
        resolveConflicts?: boolean;
    } = {}): Promise<SyncResult | null> {
        const { startNotice, resolveConflicts = false } = options;
        this.lastSyncSummaryNotice = null;

        if (startNotice) {
            new Notice(startNotice);
        }

        try {
            const syncResult = await this.syncManager.syncAll();

            if (resolveConflicts) {
                await this.resolveSyncConflicts(syncResult);
            }

            if (syncResult.errors.length > 0) {
                debugLog.error('Sync errors:', syncResult.errors);
            }

            const summary = formatSyncSummaryNoticeText(syncResult);
            this.lastSyncSummaryNotice = summary;
            new Notice(summary, SYNC_NOTICE_DURATION);
            return syncResult;
        } catch (error) {
            new Notice(`Sync failed: ${(error as Error).message}`);
            debugLog.error('Sync error:', error);
            return null;
        }
    }

    private async resolveSyncConflicts(syncResult: SyncResult): Promise<void> {
        if (syncResult.conflicts.length === 0) {
            return;
        }

        new Notice(`${syncResult.conflicts.length} conflicts detected`);
        const resolutions = await this.conflictResolver.resolveConflicts(syncResult.conflicts);

        for (const [conflictKey, resolution] of Object.entries(resolutions)) {
            const [issueId, field] = conflictKey.split('-');
            const conflict = syncResult.conflicts.find(c => c.issueId === issueId && c.field === field);

            if (conflict) {
                await this.applyConflictResolution(conflict, resolution);
                this.conflictHistory.addConflict(conflict);
            }
        }
    }

    private async applyConflictResolution(
        conflict: ConflictInfo, 
        resolution: 'linear' | 'obsidian' | 'merge'
    ): Promise<void> {
        // Implementation would depend on the specific field and resolution type
        debugLog.log(`Applying ${resolution} resolution for ${conflict.field} on ${conflict.issueId}`);
        
        switch (resolution) {
            case 'linear':
                // Update Obsidian with Linear value
                break;
            case 'obsidian':
                // Update Linear with Obsidian value
                break;
            case 'merge':
                // Implement field-specific merge logic
                break;
        }
    }

    onunload() {
        debugLog.log('Unloading Linear Plugin');
        
        // Clean up tooltips
        this.tooltipManager.hideTooltip();
        
        // Clear autocomplete cache
        if (this.autocompleteSystem) {
            // Remove any cached data
            this.autocompleteSystem = undefined;
        }

        // Clear local config cache
        this.localConfigManager.clearCache();
    }

    async loadSettings() {
        const stored = await this.loadData();
        if (!stored || stored.settingsVersion !== 2) {
            if (stored) {
                // Preserve backup so the user can recover manually
                await this.saveData({ _backup: stored, ...DEFAULT_SETTINGS });
                new Notice(
                    'Linear Integration: settings were reset due to a version change. ' +
                    'Your previous settings are backed up under the "_backup" key.',
                    8000
                );
            } else {
                await this.saveData(DEFAULT_SETTINGS);
            }
            this.settings = Object.assign({}, DEFAULT_SETTINGS);
        } else {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
        }
    }

    async saveSettings() {
        this._clientCache.clear();
        await this.saveData(this.settings);
        debugLog.setDebugMode(this.settings.debugMode);
    }
}
