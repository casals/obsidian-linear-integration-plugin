import { debugLog } from '../utils/debug';
import { TFile, TFolder, Vault } from 'obsidian';
import { LinearNoteConfig, LinearIssue, LinearPluginSettings, SyncResult } from '../models/types';
import { LinearClient } from '../api/linear-client';
import { SyncManager } from '../sync/sync-manager';
import { MarkdownParser } from '../parsers/markdown-parser';

export class LocalConfigManager {
    private static readonly CONFIG_FILENAME = '.linear.json';
    private configCache = new Map<string, LinearNoteConfig>();

    constructor(private vault: Vault) {}

    async getConfigForNote(file: TFile): Promise<LinearNoteConfig> {
        const configPath = this.findConfigPath(file.path);
        
        if (this.configCache.has(configPath)) {
            return this.configCache.get(configPath)!;
        }

        const config = await this.loadConfig(configPath);
        this.configCache.set(configPath, config);
        return config;
    }

    async saveConfigForNote(file: TFile, config: LinearNoteConfig): Promise<void> {
        const configDir = this.getDirectoryPath(file.path);
        const configPath = `${configDir}/${LocalConfigManager.CONFIG_FILENAME}`;
        
        const configFile = this.vault.getAbstractFileByPath(configPath);
        const configContent = JSON.stringify(config, null, 2);

        if (configFile instanceof TFile) {
            await this.vault.modify(configFile, configContent);
        } else {
            await this.vault.create(configPath, configContent);
        }

        this.configCache.set(configPath, config);
    }

    private findConfigPath(notePath: string): string {
        // Walk up the directory tree to find the nearest .linear.json
        let currentDir = this.getDirectoryPath(notePath);
        
        while (currentDir !== '') {
            const configPath = `${currentDir}/${LocalConfigManager.CONFIG_FILENAME}`;
            const configFile = this.vault.getAbstractFileByPath(configPath);
            
            if (configFile instanceof TFile) {
                return configPath;
            }
            
            // Move up one directory
            const lastSlash = currentDir.lastIndexOf('/');
            currentDir = lastSlash > 0 ? currentDir.substring(0, lastSlash) : '';
        }

        // Check root directory
        const rootConfigPath = LocalConfigManager.CONFIG_FILENAME;
        const rootConfig = this.vault.getAbstractFileByPath(rootConfigPath);
        if (rootConfig instanceof TFile) {
            return rootConfigPath;
        }

        // Return empty config path if no config found
        return '';
    }

    private async loadConfig(configPath: string): Promise<LinearNoteConfig> {
        if (!configPath) {
            return {};
        }

        try {
            const configFile = this.vault.getAbstractFileByPath(configPath) as TFile;
            if (!configFile) {
                return {};
            }

            const content = await this.vault.read(configFile);
            return JSON.parse(content);
        } catch (error) {
            debugLog.warn(`Failed to load config from ${configPath}:`, error);
            return {};
        }
    }

    private getDirectoryPath(filePath: string): string {
        const lastSlash = filePath.lastIndexOf('/');
        return lastSlash > 0 ? filePath.substring(0, lastSlash) : '';
    }

    // Clear cache when configs are updated externally
    clearCache(): void {
        this.configCache.clear();
    }

    // Get all config files for management
    async getAllConfigs(): Promise<{ path: string; config: LinearNoteConfig }[]> {
        const configs: { path: string; config: LinearNoteConfig }[] = [];
        
        const files = this.vault.getFiles();
        for (const file of files) {
            if (file.name === LocalConfigManager.CONFIG_FILENAME) {
                try {
                    const config = await this.loadConfig(file.path);
                    configs.push({ path: file.path, config });
                } catch (error) {
                    debugLog.warn(`Failed to load config ${file.path}:`, error);
                }
            }
        }
        
        return configs;
    }
}

export class KanbanGenerator {
    constructor(
        private vault: Vault,
        private linearClient: LinearClient,
        private settings: LinearPluginSettings
    ) {}

    async generateKanbanBoard(teamId?: string): Promise<string> {
        const issues = await this.linearClient.getIssues(teamId);
        
        // Group issues by status
        const statusGroups = new Map<string, LinearIssue[]>();
        issues.forEach(issue => {
            const status = issue.state.name;
            if (!statusGroups.has(status)) {
                statusGroups.set(status, []);
            }
            statusGroups.get(status)!.push(issue);
        });

        // Generate kanban markdown
        let kanban = `# Linear Kanban Board\n\n`;
        kanban += `*Generated: ${new Date().toLocaleString()}*\n\n`;

        statusGroups.forEach((issues, status) => {
            kanban += `## ${status} (${issues.length})\n\n`;
            
            issues.forEach(issue => {
                const priority = this.getPriorityIcon(issue.priority);
                const assignee = issue.assignee ? `@${issue.assignee.name}` : 'Unassigned';
                
                kanban += `- [ ] ${priority} **[${issue.identifier}](${issue.url})** ${issue.title}\n`;
                kanban += `  - Assignee: ${assignee}\n`;
                kanban += `  - Team: ${issue.team.name}\n`;
                if (issue.estimate) {
                    kanban += `  - Estimate: ${issue.estimate}pts\n`;
                }
                kanban += `\n`;
            });
            
            kanban += `---\n\n`;
        });

        return kanban;
    }

    async createKanbanNote(teamId?: string): Promise<TFile> {
        const content = await this.generateKanbanBoard(teamId);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `Linear Kanban ${timestamp}.md`;
        const filepath = `${this.settings.syncFolder}/${filename}`;
        
        return await this.vault.create(filepath, content);
    }

    private getPriorityIcon(priority?: number): string {
        const icons = ['⚪', '🔴', '🟠', '🟡', '🟢'];
        return icons[priority || 0] || '⚪';
    }
}

export class AgendaGenerator {
    constructor(
        private vault: Vault,
        private linearClient: LinearClient,
        private settings: LinearPluginSettings
    ) {}

    async generateAgenda(userId?: string, days: number = 7): Promise<string> {
        const issues = await this.linearClient.getIssues();
        
        // Filter issues for user and time range
        const userIssues = userId 
            ? issues.filter(issue => issue.assignee?.id === userId)
            : issues;

        const now = new Date();
        const upcoming = userIssues.filter(issue => {
            // For demo purposes, we'll use updatedAt as a proxy for due date
            // since Linear's dueDate field might not be available
            const checkDate = new Date(issue.updatedAt);
            const diffTime = checkDate.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return diffDays >= -7 && diffDays <= days; // Include recent and upcoming
        });

        // Sort by updated date (as proxy for due date)
        upcoming.sort((a, b) => {
            const aDate = new Date(a.updatedAt);
            const bDate = new Date(b.updatedAt);
            return aDate.getTime() - bDate.getTime();
        });

        // Generate agenda
        let agenda = `# Linear Agenda\n\n`;
        agenda += `*Generated: ${new Date().toLocaleString()}*\n\n`;

        if (upcoming.length === 0) {
            agenda += `No issues due in the next ${days} days.\n`;
            return agenda;
        }

        // Group by date (using updatedAt as proxy)
        const dateGroups = new Map<string, LinearIssue[]>();
        upcoming.forEach(issue => {
            const dateKey = new Date(issue.updatedAt).toDateString();
            if (!dateGroups.has(dateKey)) {
                dateGroups.set(dateKey, []);
            }
            dateGroups.get(dateKey)!.push(issue);
        });

        dateGroups.forEach((issues, dateKey) => {
            agenda += `## ${dateKey}\n\n`;
            
            issues.forEach(issue => {
                const priority = this.getPriorityIcon(issue.priority);
                const status = this.settings.statusMapping[issue.state.name] || '📝';
                
                agenda += `- ${status} ${priority} **[${issue.identifier}](${issue.url})** ${issue.title}\n`;
                agenda += `  - Status: ${issue.state.name}\n`;
                agenda += `  - Team: ${issue.team.name}\n`;
                if (issue.estimate) {
                    agenda += `  - Estimate: ${issue.estimate}pts\n`;
                }
                agenda += `\n`;
            });
        });

        return agenda;
    }

    async createAgendaNote(userId?: string, days: number = 7): Promise<TFile> {
        const content = await this.generateAgenda(userId, days);
        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `Linear Agenda ${timestamp}.md`;
        const filepath = `${this.settings.syncFolder}/${filename}`;
        
        return await this.vault.create(filepath, content);
    }

    private getPriorityIcon(priority?: number): string {
        const icons = ['⚪', '🔴', '🟠', '🟡', '🟢'];
        return icons[priority || 0] || '⚪';
    }
}

export class CommentMirror {
    constructor(
        private vault: Vault,
        private linearClient: LinearClient
    ) {}

    async mirrorCommentsToNote(file: TFile, issueId: string): Promise<void> {
        const issue = await this.linearClient.getIssueById(issueId);
        if (!issue || !issue.comments) return;

        const content = await this.vault.read(file);
        const commentsSection = this.generateCommentsSection(issue.comments.nodes);
        
        // Find existing comments section or add new one
        const commentsStart = content.indexOf('## Comments');
        
        if (commentsStart >= 0) {
            // Replace existing comments section
            const nextSection = content.indexOf('##', commentsStart + 1);
            const beforeComments = content.substring(0, commentsStart);
            const afterComments = nextSection >= 0 ? content.substring(nextSection) : '';
            
            const newContent = beforeComments + commentsSection + '\n\n' + afterComments;
            await this.vault.modify(file, newContent);
        } else {
            // Add comments section at the end
            const newContent = content + '\n\n' + commentsSection;
            await this.vault.modify(file, newContent);
        }
    }

    private generateCommentsSection(comments: any[]): string {
        if (comments.length === 0) {
            return '## Comments\n\n*No comments yet.*';
        }

        let section = '## Comments\n\n';
        
        comments.forEach(comment => {
            const author = comment.user.name;
            const date = new Date(comment.createdAt).toLocaleString();
            
            section += `### ${author} - ${date}\n\n`;
            section += `${comment.body}\n\n`;
            section += `---\n\n`;
        });

        return section;
    }
}

export class BatchOperationManager {
    constructor(
        private vault: Vault,
        private linearClient: LinearClient,
        private syncManager: SyncManager
    ) {}

    async batchCreateIssues(files: TFile[]): Promise<{ successes: number; failures: string[] }> {
        const results = { successes: 0, failures: [] as string[] };
        
        for (const file of files) {
            try {
                await this.createIssueFromFile(file);
                results.successes++;
            } catch (error) {
                results.failures.push(`${file.name}: ${(error as Error).message}`);
            }
        }

        return results;
    }

    async batchSyncNotes(folder: TFolder): Promise<SyncResult> {
        const files = folder.children.filter(child => 
            child instanceof TFile && child.extension === 'md'
        ) as TFile[];

        const result: SyncResult = {
            created: 0,
            updated: 0,
            errors: [],
            conflicts: []
        };

        for (const file of files) {
            try {
                const fileResult = await this.syncManager.syncAll();
                result.created += fileResult.created;
                result.updated += fileResult.updated;
                result.errors.push(...fileResult.errors);
                result.conflicts.push(...fileResult.conflicts);
            } catch (error) {
                result.errors.push(`${file.name}: ${(error as Error).message}`);
            }
        }

        return result;
    }

    async batchUpdateStatus(issueIds: string[], newStatusId: string): Promise<void> {
        const updatePromises = issueIds.map(id => 
            this.linearClient.updateIssue(id, { stateId: newStatusId })
        );

        await Promise.allSettled(updatePromises);
    }

    private async createIssueFromFile(file: TFile): Promise<LinearIssue> {
        const content = await this.vault.read(file);
        const config = MarkdownParser.parseNoteConfig(content);
        const title = MarkdownParser.extractTitle(content);
        const description = MarkdownParser.convertToLinearDescription(content);

        if (!config.team) {
            throw new Error('No team specified in note config');
        }

        return await this.linearClient.createIssue(
            title,
            description,
            config.team,
            config.assignee,
            undefined // status
        );
    }
}