import { debugLog } from '../utils/debug';
import { getFolderByPath } from '../utils/file-utils';
import { App, TFile } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { LinearIssue, LinearPluginSettings, NoteFrontmatter, SyncResult } from '../models/types';
import { parseFrontmatter, updateFrontmatter } from '../utils/frontmatter';

export class SyncManager {
    constructor(
        private app: App,
        private linearClient: LinearClient,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}

    async syncAll(): Promise<SyncResult> {
        const result: SyncResult = {
            created: 0,
            updated: 0,
            errors: [],
            conflicts: []
        };

        try {
            // Ensure sync folder exists
            await this.ensureSyncFolder();

            // Get last sync time
            const lastSync = await this.getLastSyncTime();

            // Fetch issues from Linear
            const issues = await this.linearClient.getIssues(
                this.settings.teamId || undefined,
                lastSync
            );

            // Process each issue
            for (const issue of issues) {
                try {
                    const file = await this.findOrCreateNoteForIssue(issue);
                    const wasCreated = await this.updateNoteWithIssue(file, issue);
                    
                    if (wasCreated) {
                        result.created++;
                    } else {
                        result.updated++;
                    }
                } catch (error) {
                    result.errors.push(`Failed to sync issue ${issue.identifier}: ${(error as Error).message}`);
                }
            }

            // Update last sync time
            await this.setLastSyncTime(new Date().toISOString());

        } catch (error) {
            result.errors.push(`Sync failed: ${(error as Error).message}`);
        }

        return result;
    }

    async findOrCreateNoteForIssue(issue: LinearIssue): Promise<TFile> {
        //Refactored to avoid type assertion
        const syncFolder = getFolderByPath(this.app.vault, this.settings.syncFolder);
        
        // Try to find existing note by Linear ID
        for (const file of syncFolder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const frontmatter = await this.getFrontmatter(file);
                if (frontmatter.linear_id === issue.id || frontmatter.linear_identifier === issue.identifier) {
                    return file;
                }
            }
        }

        // Create new note
        const filename = this.sanitizeFilename(`${issue.identifier} - ${issue.title}.md`);
        const filepath = `${this.settings.syncFolder}/${filename}`;
        
        const content = this.generateNoteContent(issue);
        return await this.app.vault.create(filepath, content);
    }

    generateNoteContent(issue: LinearIssue): string {
        const template = this.settings.noteTemplate;
        const statusIcon = this.settings.statusMapping[issue.state.name] || '📋';
        
        return template
            .replace(/{{title}}/g, issue.title)
            .replace(/{{status}}/g, `${statusIcon} ${issue.state.name}`)
            .replace(/{{assignee}}/g, issue.assignee?.name || 'Unassigned')
            .replace(/{{team}}/g, issue.team.name)
            .replace(/{{created}}/g, new Date(issue.createdAt).toLocaleDateString())
            .replace(/{{updated}}/g, new Date(issue.updatedAt).toLocaleDateString())
            .replace(/{{description}}/g, issue.description || 'No description')
            .replace(/{{url}}/g, issue.url)
            .replace(/{{lastSync}}/g, new Date().toLocaleString());
    }

    async updateNoteWithIssue(file: TFile, issue: LinearIssue): Promise<boolean> {
        
        const frontmatter = await this.getFrontmatter(file);
        
        const isNewNote = !frontmatter.linear_id;
        
        // Update frontmatter
        const updatedFrontmatter: NoteFrontmatter = {
            ...frontmatter,
            linear_id: issue.id,
            linear_identifier: issue.identifier,
            linear_status: issue.state.name,
            linear_assignee: issue.assignee?.name,
            linear_team: issue.team.name,
            linear_url: issue.url,
            linear_created: issue.createdAt,
            linear_updated: issue.updatedAt,
            linear_last_synced: new Date().toISOString(),
            linear_priority: issue.priority,
            linear_estimate: issue.estimate,
            linear_labels: issue.labels.nodes.map(label => label.name)
        };

        // For existing notes, only update frontmatter to preserve user content
        if (!isNewNote) {
            await updateFrontmatter(this.app, file, updatedFrontmatter);
        } else {
            // For new notes, generate full content with frontmatter
            const fullContent = this.addFrontmatterToContent(
                this.generateNoteContent(issue),
                updatedFrontmatter
            );
            await this.app.vault.modify(file, fullContent);
        }

        return isNewNote;
    }

    async getFrontmatter(file: TFile): Promise<NoteFrontmatter> {
        
        return parseFrontmatter(this.app, file);
    }

    async getLinearIdFromNote(file: TFile): Promise<string | null> {
        const frontmatter = await this.getFrontmatter(file);
        return frontmatter.linear_id || null;
    }

    private addFrontmatterToContent(content: string, frontmatter: NoteFrontmatter): string {
        const yamlLines = ['---'];
        
        Object.entries(frontmatter).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                if (Array.isArray(value)) {
                    yamlLines.push(`${key}:`);
                    value.forEach(item => yamlLines.push(`  - ${item}`));
                } else {
                    yamlLines.push(`${key}: ${value}`);
                }
            }
        });
        
        yamlLines.push('---', '');
        
        return yamlLines.join('\n') + content;
    }

    private async ensureSyncFolder(): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(this.settings.syncFolder);
        if (!folder) {
            await this.app.vault.createFolder(this.settings.syncFolder);
        }
    }

    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private async getLastSyncTime(): Promise<string | undefined> {
        // Get from plugin settings instead of separate file
        return this.settings.lastSyncTime;
    }

    private async setLastSyncTime(time: string): Promise<void> {
        try {
            // Update plugin settings
            this.settings.lastSyncTime = time;
            // Save settings (you'll need access to the plugin instance)
            await this.plugin.saveSettings();
            // This requires passing the plugin instance to SyncManager
        } catch (error) {
            debugLog.error('Failed to save last sync time:', error);
        }
    }    
}