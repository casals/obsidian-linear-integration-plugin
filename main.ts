import { debugLog } from './src/utils/debug';
import { Plugin, TFile, Notice, MarkdownView, Editor } from 'obsidian';
import { LinearClient } from './src/api/linear-client';
import { SyncManager } from './src/sync/sync-manager';
import { LinearSettingsTab } from './src/ui/settings-tab';
import { IssueCreateModal } from './src/ui/issue-modal';
import { LinearPluginSettings, DEFAULT_SETTINGS, ConflictInfo } from './src/models/types';
import { LinearAutocompleteSystem, TooltipManager, QuickEditModal } from './src/features/autocomplete-system';
import { ConflictResolver, ConflictHistory } from './src/features/conflict-resolver';
import { LocalConfigManager, KanbanGenerator, AgendaGenerator, CommentMirror, BatchOperationManager } from './src/features/local-config-system';
import { MarkdownParser } from './src/parsers/markdown-parser';

export default class LinearPlugin extends Plugin {
    settings!: LinearPluginSettings;
    linearClient!: LinearClient;
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

    async onload() {        
        
        await this.loadSettings();

        // Initialize debug mode first
        debugLog.setDebugMode(this.settings.debugMode);
        debugLog.log('Loading Linear Plugin');

        // Check API key loading
        debugLog.log('=== LINEAR PLUGIN DEBUG ===');
        debugLog.log('API Key present:', !!this.settings.apiKey);
        debugLog.log('API Key length:', this.settings.apiKey?.length || 0);
        debugLog.log('API Key starts with lin_api:', this.settings.apiKey?.startsWith('lin_api_') || false);
        debugLog.log('Autocomplete enabled:', this.settings.autocompleteEnabled);
        
        // Initialize core components
        this.linearClient = new LinearClient(this.settings.apiKey);

        // DEBUG: Test LinearClient immediately
        try {
            debugLog.log('Testing LinearClient connection...');
            const testResult = await this.linearClient.testConnection();
            debugLog.log('LinearClient test result:', testResult);
        } catch (error) {
            debugLog.error('LinearClient test failed:', error);
        }


        //this.syncManager = new SyncManager(this.app, this.linearClient, this.settings);
        this.syncManager = new SyncManager(this.app, this.linearClient, this.settings, this);
        this.conflictResolver = new ConflictResolver(this.app, this.settings);
        this.conflictHistory = new ConflictHistory();
        this.localConfigManager = new LocalConfigManager(this.app.vault);
        this.tooltipManager = TooltipManager.getInstance();

        // Initialize feature components
        this.kanbanGenerator = new KanbanGenerator(this.app.vault, this.linearClient, this.settings);
        this.agendaGenerator = new AgendaGenerator(this.app.vault, this.linearClient, this.settings);
        this.commentMirror = new CommentMirror(this.app.vault, this.linearClient);
        this.batchOperationManager = new BatchOperationManager(this.app.vault, this.linearClient, this.syncManager);

        // Initialize autocomplete if enabled        
        if (this.settings.autocompleteEnabled) {
            // Delay autocomplete initialization to ensure everything is ready
            setTimeout(() => {
                debugLog.log('Initializing autocomplete system...');
                this.autocompleteSystem = new LinearAutocompleteSystem(
                    this.app, 
                    this.linearClient, 
                    this.settings, 
                    this.localConfigManager
                );
                this.registerEditorSuggest(this.autocompleteSystem);
                debugLog.log('Autocomplete system initialized');
            }, 1000); // 1 second delay
        }

        // Add ribbon icons
        this.addRibbonIcon('sync', 'Sync with Linear', async () => {
            new Notice('Syncing with Linear...');
            try {
                await this.syncManager.syncAll();
                new Notice('Linear sync completed');
            } catch (error) {
                new Notice(`Sync failed: ${(error as Error).message}`);
                debugLog.error('Linear sync error:', error);
            }
        });

        this.addRibbonIcon('kanban', 'Generate Kanban Board', async () => {
            try {
                const file = await this.kanbanGenerator.createKanbanNote(this.settings.teamId);
                await this.app.workspace.openLinkText(file.path, '', false);
                new Notice('Kanban board generated');
            } catch (error) {
                new Notice(`Failed to generate kanban: ${(error as Error).message}`);
            }
        });

        // Add core commands
        this.addCommand({
            id: 'create-linear-issue',
            name: 'Create Linear Issue from Note',
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
            name: 'Sync Linear Issues',
            callback: async () => {
                await this.syncManager.syncAll();
            }
        });

        this.addCommand({
            id: 'open-linear-issue',
            name: 'Open Linear Issue in Browser',
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
            name: 'Quick Edit Linear Issue',
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
            name: 'Generate Kanban Board',
            callback: async () => {
                await this.kanbanGenerator.createKanbanNote(this.settings.teamId);
            }
        });

        this.addCommand({
            id: 'generate-agenda',
            name: 'Generate Agenda',
            callback: async () => {
                await this.agendaGenerator.createAgendaNote();
            }
        });

        this.addCommand({
            id: 'mirror-comments',
            name: 'Mirror Linear Comments',
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
            name: 'Batch Create Issues from Selection',
            callback: async () => {
                await this.batchCreateIssues();
            }
        });

        this.addCommand({
            id: 'insert-issue-reference',
            name: 'Insert Issue Reference',
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
            setTimeout(() => this.syncManager.syncAll(), 2000);
        }

        // Set up periodic sync if enabled
        if (this.settings.autoSyncInterval > 0) {
            this.registerInterval(
                window.setInterval(
                    () => this.syncManager.syncAll(),
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
            const issue = await this.linearClient.getIssueById(issueId);
            if (issue) {
                this.tooltipManager.showIssueTooltip(element, issue);
            }
        } catch (error) {
            debugLog.warn('Failed to load issue for tooltip:', error);
        }
    }

    async createIssueFromNote(file: TFile): Promise<void> {
        // Get local config for this note
        const localConfig = await this.localConfigManager.getConfigForNote(file);
        
        const modal = new IssueCreateModal(
            this.app,
            this.linearClient,
            file,
            localConfig,
            this.settings,
            async (issue) => {
                // Update note with Linear issue metadata
                await this.syncManager.updateNoteWithIssue(file, issue);
                
                // Embed issue reference if enabled
                const content = await this.app.vault.read(file);
                const reference = MarkdownParser.generateIssueReference(issue.id, issue.identifier);
                const updatedContent = MarkdownParser.embedIssueReference(content, reference, 'bottom');
                await this.app.vault.modify(file, updatedContent);
                
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

        try {
            const issue = await this.linearClient.getIssueById(issueId);
            if (!issue) {
                new Notice('Issue not found in Linear');
                return;
            }

            const modal = new QuickEditModal(
                this.app,
                issue,
                async (updates) => {
                    await this.linearClient.updateIssue(issueId, updates);
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
        // This would open a modal to search and select an issue
        // For now, we'll implement a simple version
        const issueIdentifier = await this.promptForIssueIdentifier();
        if (issueIdentifier) {
            try {
                const issues = await this.linearClient.getIssues();
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
            const explorerView = fileExplorer.view as any;
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
        new Notice('Syncing with conflict detection...');
        
        try {
            const syncResult = await this.syncManager.syncAll();
            
            if (syncResult.conflicts.length > 0) {
                new Notice(`${syncResult.conflicts.length} conflicts detected`);
                
                const resolutions = await this.conflictResolver.resolveConflicts(syncResult.conflicts);
                
                // Apply resolutions
                for (const [conflictKey, resolution] of Object.entries(resolutions)) {
                    const [issueId, field] = conflictKey.split('-');
                    const conflict = syncResult.conflicts.find(c => c.issueId === issueId && c.field === field);
                    
                    if (conflict) {
                        await this.applyConflictResolution(conflict, resolution);
                        this.conflictHistory.addConflict(conflict);
                    }
                }
                
                new Notice('Conflicts resolved and sync completed');
            } else {
                new Notice(`Sync completed: ${syncResult.created} created, ${syncResult.updated} updated`);
            }
            
            if (syncResult.errors.length > 0) {
                debugLog.error('Sync errors:', syncResult.errors);
                new Notice(`${syncResult.errors.length} errors occurred during sync`);
            }
        } catch (error) {
            new Notice(`Sync failed: ${(error as Error).message}`);
            debugLog.error('Sync error:', error);
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
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        debugLog.log('Settings loaded:', {
            apiKey: !!this.settings.apiKey,
            teamId: !!this.settings.teamId,
            autocompleteEnabled: this.settings.autocompleteEnabled
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);

        // Update debug mode when settings change        
        debugLog.setDebugMode(this.settings.debugMode);
        
        // Reinitialize components that depend on settings
        if (this.settings.autocompleteEnabled && !this.autocompleteSystem) {
            this.autocompleteSystem = new LinearAutocompleteSystem(this.app, this.linearClient, this.settings, this.localConfigManager);
            this.registerEditorSuggest(this.autocompleteSystem);
        } else if (!this.settings.autocompleteEnabled && this.autocompleteSystem) {
            // Would need to unregister autocomplete
        }
    }
}

