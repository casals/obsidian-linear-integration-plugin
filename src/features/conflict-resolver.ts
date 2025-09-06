import { debugLog } from '../utils/debug';
import { App, Modal, Setting, Notice } from 'obsidian';
import { LinearIssue, ConflictInfo, LinearPluginSettings } from '../models/types';
import { NoteFrontmatter } from '../models/types';

export class ConflictResolver {
    constructor(private app: App, private settings: LinearPluginSettings) {}

    detectConflicts(
        linearIssue: LinearIssue,
        noteFrontmatter: NoteFrontmatter,
        noteContent: string
    ): ConflictInfo[] {
        const conflicts: ConflictInfo[] = [];
        const noteTimestamp = noteFrontmatter.linear_last_synced;
        const linearTimestamp = linearIssue.updatedAt;

        // Only check for conflicts if both have been modified since last sync
        if (!noteTimestamp || new Date(linearTimestamp) <= new Date(noteTimestamp)) {
            return conflicts;
        }

        // Check title conflicts
        const noteTitle = this.extractTitleFromContent(noteContent);
        if (noteTitle && noteTitle !== linearIssue.title) {
            conflicts.push({
                issueId: linearIssue.id,
                field: 'title',
                linearValue: linearIssue.title,
                obsidianValue: noteTitle,
                timestamp: new Date().toISOString()
            });
        }

        // Check status conflicts
        if (noteFrontmatter.linear_status && noteFrontmatter.linear_status !== linearIssue.state.name) {
            conflicts.push({
                issueId: linearIssue.id,
                field: 'status',
                linearValue: linearIssue.state.name,
                obsidianValue: noteFrontmatter.linear_status,
                timestamp: new Date().toISOString()
            });
        }

        // Check assignee conflicts
        const noteAssignee = noteFrontmatter.linear_assignee;
        const linearAssignee = linearIssue.assignee?.name;
        if (noteAssignee !== linearAssignee) {
            conflicts.push({
                issueId: linearIssue.id,
                field: 'assignee',
                linearValue: linearAssignee || null,
                obsidianValue: noteAssignee || null,
                timestamp: new Date().toISOString()
            });
        }

        // Check priority conflicts
        if (noteFrontmatter.linear_priority !== linearIssue.priority) {
            conflicts.push({
                issueId: linearIssue.id,
                field: 'priority',
                linearValue: linearIssue.priority,
                obsidianValue: noteFrontmatter.linear_priority,
                timestamp: new Date().toISOString()
            });
        }

        // Check description conflicts (if content changed)
        const noteDescription = this.extractDescriptionFromContent(noteContent);
        if (noteDescription && noteDescription !== linearIssue.description) {
            conflicts.push({
                issueId: linearIssue.id,
                field: 'description',
                linearValue: linearIssue.description,
                obsidianValue: noteDescription,
                timestamp: new Date().toISOString()
            });
        }

        return conflicts;
    }

    async resolveConflicts(conflicts: ConflictInfo[]): Promise<Record<string, 'linear' | 'obsidian' | 'merge'>> {
        switch (this.settings.conflictResolution) {
            case 'linear-wins':
                return this.createResolutionMap(conflicts, 'linear');
            
            case 'obsidian-wins':
                return this.createResolutionMap(conflicts, 'obsidian');
            
            case 'timestamp':
                return this.resolveByTimestamp(conflicts);
            
            case 'manual':
            default:
                return this.showConflictResolutionModal(conflicts);
        }
    }

    private createResolutionMap(
        conflicts: ConflictInfo[], 
        winner: 'linear' | 'obsidian'
    ): Record<string, 'linear' | 'obsidian' | 'merge'> {
        const resolutions: Record<string, 'linear' | 'obsidian' | 'merge'> = {};
        conflicts.forEach(conflict => {
            resolutions[`${conflict.issueId}-${conflict.field}`] = winner;
        });
        return resolutions;
    }

    private async resolveByTimestamp(conflicts: ConflictInfo[]): Promise<Record<string, 'linear' | 'obsidian' | 'merge'>> {
        // For timestamp resolution, we'd need more sophisticated tracking
        // For now, default to Linear wins for simplicity
        return this.createResolutionMap(conflicts, 'linear');
    }

    private async showConflictResolutionModal(conflicts: ConflictInfo[]): Promise<Record<string, 'linear' | 'obsidian' | 'merge'>> {
        return new Promise((resolve) => {
            new ConflictResolutionModal(this.app, conflicts, resolve).open();
        });
    }

    private extractTitleFromContent(content: string): string | null {
        // Remove frontmatter
        const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
        
        // Look for first heading
        const headingMatch = withoutFrontmatter.match(/^#\s+(.+)$/m);
        return headingMatch ? headingMatch[1].trim() : null;
    }

    private extractDescriptionFromContent(content: string): string | null {
        // Remove frontmatter
        let description = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
        
        // Remove first heading
        description = description.replace(/^#\s+.+\n/, '');
        
        // Extract content until Linear Link section
        const linearLinkIndex = description.indexOf('## Linear Link');
        if (linearLinkIndex > 0) {
            description = description.substring(0, linearLinkIndex);
        }
        
        // Clean up
        description = description.trim();
        
        return description || null;
    }
}

class ConflictResolutionModal extends Modal {
    private resolutions: Record<string, 'linear' | 'obsidian' | 'merge'> = {};

    constructor(
        app: App,
        private conflicts: ConflictInfo[],
        private onResolve: (resolutions: Record<string, 'linear' | 'obsidian' | 'merge'>) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Resolve sync conflicts' });
        contentEl.createEl('p', { 
            text: 'The following conflicts were detected. Choose how to resolve each one:',
            cls: 'conflict-intro'
        });

        this.conflicts.forEach((conflict) => {
            this.createConflictSection(contentEl, conflict);
        });

        // Action buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        buttonContainer.createEl('button', { 
            text: 'Apply all Linear',
            cls: 'conflict-batch-btn'
        }).onclick = () => this.applyBatchResolution('linear');

        buttonContainer.createEl('button', { 
            text: 'Apply all Obsidian',
            cls: 'conflict-batch-btn'
        }).onclick = () => this.applyBatchResolution('obsidian');

        buttonContainer.createEl('button', { 
            text: 'Resolve selected',
            cls: 'mod-cta'
        }).onclick = () => this.resolveSelected();

        buttonContainer.createEl('button', { 
            text: 'Cancel'
        }).onclick = () => this.close();
    }

    private createConflictSection(container: HTMLElement, conflict: ConflictInfo): void {
        const section = container.createDiv({ cls: 'conflict-section' });
        
        // Add timestamp information
        const lastSync = new Date(conflict.timestamp).toLocaleString();
        section.createEl('p', { 
            text: `Conflict detected at ${lastSync}`,
            cls: 'conflict-timestamp'
        });

        // Header
        section.createEl('h3', { 
            text: `${conflict.issueId} - ${conflict.field}`,
            cls: 'conflict-header'
        });

        // Values comparison
        const comparison = section.createDiv({ cls: 'conflict-comparison' });
        
        const linearDiv = comparison.createDiv({ cls: 'conflict-option' });
        linearDiv.createEl('h4', { text: 'Linear value' });
        linearDiv.createEl('div', { 
            text: this.formatValue(conflict.linearValue),
            cls: 'conflict-value linear-value'
        });

        const obsidianDiv = comparison.createDiv({ cls: 'conflict-option' });
        obsidianDiv.createEl('h4', { text: 'Obsidian value' });
        obsidianDiv.createEl('div', { 
            text: this.formatValue(conflict.obsidianValue),
            cls: 'conflict-value obsidian-value'
        });

        // Resolution options
        const resolutionDiv = section.createDiv({ cls: 'conflict-resolution' });
        resolutionDiv.createEl('h4', { text: 'Resolution' });

        const conflictKey = `${conflict.issueId}-${conflict.field}`;
        
        new Setting(resolutionDiv)
            .addDropdown(dropdown => {
                dropdown.addOption('', 'Choose resolution...');
                dropdown.addOption('linear', 'Use Linear value');
                dropdown.addOption('obsidian', 'Use Obsidian value');
                
                if (this.canMerge(conflict.field)) {
                    dropdown.addOption('merge', 'Merge both values');
                }
                
                dropdown.onChange(value => {
                    this.resolutions[conflictKey] = value as 'linear' | 'obsidian' | 'merge';
                });
            });
    }

    private formatValue(value: any): string {
        if (value === null || value === undefined) {
            return '(empty)';
        }
        if (typeof value === 'string' && value.length > 100) {
            return value.substring(0, 100) + '...';
        }
        return String(value);
    }

    private canMerge(field: string): boolean {
        // Only certain fields can be merged
        return ['description', 'labels'].includes(field);
    }

    private applyBatchResolution(resolution: 'linear' | 'obsidian'): void {
        this.conflicts.forEach(conflict => {
            const key = `${conflict.issueId}-${conflict.field}`;
            this.resolutions[key] = resolution;
        });
        this.resolveSelected();
    }

    private resolveSelected(): void {
        // Check if all conflicts have resolutions
        const unresolved = this.conflicts.filter(conflict => {
            const key = `${conflict.issueId}-${conflict.field}`;
            return !this.resolutions[key];
        });

        if (unresolved.length > 0) {
            new Notice(`Please resolve all conflicts. ${unresolved.length} remaining.`);
            return;
        }

        this.onResolve(this.resolutions);
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class ConflictHistory {
    private static readonly STORAGE_KEY = 'linear-conflicts-history';
    private conflicts: ConflictInfo[] = [];

    constructor() {
        this.loadHistory();
    }

    addConflict(conflict: ConflictInfo): void {
        this.conflicts.push(conflict);
        this.saveHistory();
    }

    getRecentConflicts(days: number = 7): ConflictInfo[] {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        
        return this.conflicts.filter(conflict => 
            new Date(conflict.timestamp) > cutoff
        );
    }

    getConflictsByIssue(issueId: string): ConflictInfo[] {
        return this.conflicts.filter(conflict => conflict.issueId === issueId);
    }

    private loadHistory(): void {
        try {
            const stored = localStorage.getItem(ConflictHistory.STORAGE_KEY);
            if (stored) {
                this.conflicts = JSON.parse(stored);
            }
        } catch (error) {
            debugLog.warn('Failed to load conflict history:', error);
            this.conflicts = [];
        }
    }

    private saveHistory(): void {
        try {
            // Keep only last 100 conflicts
            const recent = this.conflicts.slice(-100);
            localStorage.setItem(ConflictHistory.STORAGE_KEY, JSON.stringify(recent));
        } catch (error) {
            debugLog.warn('Failed to save conflict history:', error);
        }
    }
}