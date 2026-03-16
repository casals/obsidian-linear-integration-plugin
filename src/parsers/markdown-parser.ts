import { App, TFile } from 'obsidian';
import { InlineTag, LinearNoteConfig } from '../models/types';
import { parseFrontmatter } from '../utils/frontmatter';

export class MarkdownParser {
    private static readonly TAG_PATTERNS = {
        team: /@team\/([^@\r\n]+)/g,
        status: /@status\/([^@\r\n]+)/g,
        assignee: /@assignee\/([^@\r\n]+)/g,
        priority: /@priority\/(\d+)/g,
        label: /@label\/([^@\r\n]+)/g,
        project: /@project\/([^@\r\n]+)/g
    };

    static parseInlineTags(content: string): InlineTag[] {
        const tags: InlineTag[] = [];

        Object.entries(this.TAG_PATTERNS).forEach(([type, pattern]) => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                tags.push({
                    type: type as InlineTag['type'],
                    value: match[1],
                    position: {
                        start: match.index,
                        end: match.index + match[0].length
                    }
                });
            }
            pattern.lastIndex = 0; // Reset regex
        });

        return tags.sort((a, b) => a.position.start - b.position.start);
    }

    static parseNoteConfig(app: App, file: TFile, content: string): LinearNoteConfig {
        const config: LinearNoteConfig = {};
        
        // Parse frontmatter config using the shared parseFrontmatter utility
        const linearConfig = (parseFrontmatter(app, file) as any).linear_config;

        if (linearConfig) {
            if (linearConfig.workspace) config.workspace = linearConfig.workspace;
            if (linearConfig.team) config.team = linearConfig.team;
            if (linearConfig.project) config.project = linearConfig.project;
            if (linearConfig.assignee) config.assignee = linearConfig.assignee;
            if (linearConfig.priority !== undefined) config.priority = linearConfig.priority;
            if (linearConfig.autoSync !== undefined) config.autoSync = linearConfig.autoSync;
            if (linearConfig.template) config.template = linearConfig.template;
            if (Array.isArray(linearConfig.labels) && linearConfig.labels.length > 0) {
                config.labels = linearConfig.labels;
            }
        }
        
        // Parse inline tags and merge with config
        const inlineTags = this.parseInlineTags(content);
        inlineTags.forEach(tag => {
            switch (tag.type) {
                case 'assignee':
                    config.assignee = tag.value;
                    break;
                case 'team':
                    config.team = tag.value;
                    break;
                case 'priority':
                    config.priority = parseInt(tag.value);
                    break;
                case 'project':
                    config.project = tag.value;
                    break;
                case 'status':
                    break;
                case 'label':
                    if (!config.labels) config.labels = [];
                    if (!config.labels.includes(tag.value)) {
                        config.labels.push(tag.value);
                    }
                    break;
            }
        });
        
        return config;
    }

    static convertToLinearDescription(content: string): string {
        // Remove frontmatter
        let description = this.stripFrontmatter(content);

        // Remove the first heading because title is stored separately.
        description = description.replace(/^#\s+.+\n/, '');
        
        // Remove inline tags for cleaner Linear description
        Object.values(this.TAG_PATTERNS).forEach(pattern => {
            description = description.replace(pattern, '');
            pattern.lastIndex = 0;
        });
        
        // Convert Obsidian-specific markdown to Linear-compatible format
        description = this.convertObsidianToLinear(description);
        
        return description.trim();
    }

    static convertToLinearDocumentContent(content: string): string {
        return this.convertObsidianToLinear(this.stripFrontmatter(content)).trim();
    }

    private static convertObsidianToLinear(content: string): string {
        // Convert wikilinks to regular links
        content = content.replace(/\[\[([^\]]+)\]\]/g, '[$1]');
        
        // Convert block references
        content = content.replace(/\^\w+/g, '');
        
        // Convert highlights
        content = content.replace(/==(.*?)==/g, '**$1**');
        
        // Convert callouts to blockquotes
        content = content.replace(/> \[!(\w+)\]\s*(.*)?\n((?:> .*\n?)*)/g, (_fullMatch, type, title, body) => {
            const blockquote = body.replace(/^> /gm, '');
            return `> **${type.toUpperCase()}${title ? ': ' + title : ''}**\n> \n${blockquote.split('\n').map(line => '> ' + line).join('\n')}\n`;
        });
        
        return content;
    }

    private static stripFrontmatter(content: string): string {
        return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    }

    static extractTitle(content: string): string {
        // Try to get title from first heading
        const headingMatch = content.match(/^#\s+(.+)$/m);
        if (headingMatch) {
            return headingMatch[1].trim();
        }
        
        // Fallback to first line if no heading
        const firstLine = content.split('\n')[0]?.trim();
        return firstLine || 'Untitled Issue';
    }

    static replaceInlineTags(content: string, replacements: Record<string, string>): string {
        let result = content;
        
        Object.entries(replacements).forEach(([oldTag, newTag]) => {
            result = result.replace(new RegExp(oldTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newTag);
        });
        
        return result;
    }

    static generateIssueReference(issueId: string, identifier: string): string {
        return `[${identifier}](https://linear.app/issue/${issueId})`;
    }

    static embedIssueReference(content: string, reference: string, position?: 'top' | 'bottom'): string {
        const referenceBlock = `\n---\n**Linear Issue:** ${reference}\n---\n`;
        
        if (position === 'top') {
            // Add after frontmatter if it exists
            const frontmatterMatch = content.match(/^(---\n[\s\S]*?\n---\n?)/);
            if (frontmatterMatch) {
                return content.replace(frontmatterMatch[0], frontmatterMatch[0] + referenceBlock);
            } else {
                return referenceBlock + content;
            }
        } else {
            // Add at bottom
            return content + referenceBlock;
        }
    }
}
