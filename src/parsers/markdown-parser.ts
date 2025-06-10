import { InlineTag, LinearNoteConfig } from '../models/types';

export class MarkdownParser {
    private static readonly TAG_PATTERNS = {
        status: /@status\/([^\s]+)/g,
        assignee: /@assignee\/([^\s]+)/g,
        priority: /@priority\/(\d+)/g,
        label: /#([^\s#]+)/g,
        project: /@project\/([^\s]+)/g
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

    static parseNoteConfig(content: string): LinearNoteConfig {
        const config: LinearNoteConfig = {};
        
        // Parse frontmatter config
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            const frontmatter = frontmatterMatch[1];
            
            // Extract linear-specific config
            const linearConfigMatch = frontmatter.match(/linear_config:\s*\n([\s\S]*?)(?=\n\w+:|$)/);
            if (linearConfigMatch) {
                const configText = linearConfigMatch[1];
                
                // Parse YAML-like config
                const workspace = configText.match(/\s*workspace:\s*(.+)/)?.[1]?.trim();
                const team = configText.match(/\s*team:\s*(.+)/)?.[1]?.trim();
                const project = configText.match(/\s*project:\s*(.+)/)?.[1]?.trim();
                const assignee = configText.match(/\s*assignee:\s*(.+)/)?.[1]?.trim();
                const priority = configText.match(/\s*priority:\s*(\d+)/)?.[1];
                const autoSync = configText.match(/\s*autoSync:\s*(true|false)/)?.[1];
                const template = configText.match(/\s*template:\s*(.+)/)?.[1]?.trim();
                
                if (workspace) config.workspace = workspace;
                if (team) config.team = team;
                if (project) config.project = project;
                if (assignee) config.assignee = assignee;
                if (priority) config.priority = parseInt(priority);
                if (autoSync) config.autoSync = autoSync === 'true';
                if (template) config.template = template;
                
                // Parse labels array
                const labelsMatch = configText.match(/\s*labels:\s*\n((?:\s*-\s*.+\n)*)/);
                if (labelsMatch) {
                    const labels = labelsMatch[1]
                        .split('\n')
                        .filter(line => line.trim().startsWith('-'))
                        .map(line => line.trim().substring(1).trim())
                        .filter(Boolean);
                    if (labels.length > 0) config.labels = labels;
                }
            }
        }

        // Parse inline tags and merge with config
        const inlineTags = this.parseInlineTags(content);
        inlineTags.forEach(tag => {
            switch (tag.type) {
                case 'assignee':
                    config.assignee = tag.value;
                    break;
                case 'priority':
                    config.priority = parseInt(tag.value);
                    break;
                case 'project':
                    config.project = tag.value;
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
        let description = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
        
        // Remove inline tags for cleaner Linear description
        Object.values(this.TAG_PATTERNS).forEach(pattern => {
            description = description.replace(pattern, '');
            pattern.lastIndex = 0;
        });
        
        // Convert Obsidian-specific markdown to Linear-compatible format
        description = this.convertObsidianToLinear(description);
        
        return description.trim();
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