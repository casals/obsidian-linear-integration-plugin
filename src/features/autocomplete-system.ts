import { debugLog } from '../utils/debug';
import { createColorDot, createIssueTooltip, applyLabelStyling, positionTooltip } from '../utils/dom-utils';
import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, App, Modal, Setting } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { AutocompleteItem, LinearUser, LinearState, LinearTeam, LinearIssue, LinearPluginSettings } from '../models/types';
import { LocalConfigManager } from './local-config-system';

interface ExtendedEditorSuggestTriggerInfo extends EditorSuggestTriggerInfo {
    file?: TFile;
    triggerType?: string;
}

export class LinearAutocompleteSystem extends EditorSuggest<AutocompleteItem> {
    private linearClient: LinearClient;
    private settings: LinearPluginSettings;
    private localConfigManager: LocalConfigManager;
    private cachedUsers: LinearUser[] = [];
    private cachedStates: Map<string, LinearState[]> = new Map();
    private cachedTeams: LinearTeam[] = [];
    private cachedProjects: Array<{id: string; name: string; description?: string}> = []; 
    //private cachedLabels: Array<{id: string; name: string; color: string}> = [];
    private cachedLabels: Array<{
        id: string; 
        name: string; 
        color: string; 
        parent?: { id: string; name: string; color: string };
        isGroup?: boolean;
    }> = [];
    private lastCacheUpdate = 0;     
    private currentTriggerType: string = 'label';    
    private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    constructor(app: App, linearClient: LinearClient, settings: LinearPluginSettings, localConfigManager: LocalConfigManager) {
        super(app);
        this.linearClient = linearClient;
        this.settings = settings;
        this.localConfigManager = localConfigManager;
        this.refreshCache();
    }
    
    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): ExtendedEditorSuggestTriggerInfo | null {
        if (!this.settings.autocompleteEnabled) return null;

        const line = editor.getLine(cursor.line);
        const beforeCursor = line.substring(0, cursor.ch);

        debugLog.log('onTrigger called with line:', line);
        debugLog.log('Before cursor:', beforeCursor);
        
        // Check for different trigger patterns        
        const triggers = [
            { pattern: /@assignee\/(\w*)$/, type: 'assignee' },
            { pattern: /@status\/([\w\s]*)$/, type: 'status' },            
            { pattern: /@project\/([\w\s]*)$/, type: 'project' },
            { pattern: /@team\/([\w\s]*)$/, type: 'team' },            
            //{ pattern: /@label\/([\w-]*)$/, type: 'label' },
            { pattern: /@label\/([\w-\/]*)$/, type: 'label' },
            { pattern: /@priority\/(\d*)$/, type: 'priority' }
        ];

        // Check triggers in reverse order of position (closest to cursor first)
        type TriggerMatch = {
            trigger: { pattern: RegExp; type: string; };
            match: RegExpExecArray;
            queryStart: number;
            matchEnd: number;
        };

        let bestMatch: TriggerMatch | null = null;
        let bestMatchPos = -1;

        for (const trigger of triggers) {
            const matches = [...beforeCursor.matchAll(new RegExp(trigger.pattern.source, 'g'))];
            
            for (const match of matches) {
                const matchEnd = match.index! + match[0].length;
                const queryStart = match.index! + match[0].length - match[1].length;
                
                // Check if cursor is within this match's query part
                if (queryStart <= cursor.ch && cursor.ch <= matchEnd) {
                    if (matchEnd > bestMatchPos) {
                        bestMatch = {
                            trigger,
                            match,
                            queryStart,
                            matchEnd
                        };
                        bestMatchPos = matchEnd;
                    }
                }
            }
        }

        if (bestMatch) {
            const { trigger, match, queryStart } = bestMatch;
            debugLog.log('Trigger matched:', trigger.type, 'with query:', match[1]);
            
            // Store the trigger type in the class
            this.currentTriggerType = trigger.type;
            
            return {
                start: { line: cursor.line, ch: queryStart },
                end: cursor,
                query: match[1],
                file: file,
                triggerType: trigger.type
            } as ExtendedEditorSuggestTriggerInfo;
        }

        debugLog.log('No trigger pattern matched');
        
        return null;
    }

    
    async getSuggestions(context: EditorSuggestContext): Promise<AutocompleteItem[]> {
        await this.ensureFreshCache();
        
        const { query } = context;
        const queryLower = query.toLowerCase();

        // Get context info from onTrigger             
        const triggerContext = context as EditorSuggestContext;
        const file = triggerContext.file;        
        
        let triggerType = this.currentTriggerType;

    
        // Fallback: if triggerType is missing, detect from editor content
        if (!triggerType) {
            const line = context.editor.getLine(context.start.line);
            const beforeStart = line.substring(0, context.start.ch);
            
            if (beforeStart.includes('@assignee/')) triggerType = 'assignee';
            else if (beforeStart.includes('@status/')) triggerType = 'status';
            else if (beforeStart.includes('@team/')) triggerType = 'team';
            else if (beforeStart.includes('@priority/')) triggerType = 'priority';
            else if (beforeStart.includes('#')) triggerType = 'label';
            else triggerType = 'label'; // final fallback
        }

        // DEBUG: Log what we're getting
        debugLog.log('=== AUTOCOMPLETE DEBUG ===');
        debugLog.log('Query:', query);
        debugLog.log('Trigger type:', triggerType);
        debugLog.log('File:', file?.name);
        debugLog.log('Context:', triggerContext);
        debugLog.log('Cached users count:', this.cachedUsers.length);
        debugLog.log('Cached teams count:', this.cachedTeams.length);
        debugLog.log('Cached states count:', this.cachedStates.size);
        
        const localConfig = file ? await this.localConfigManager.getConfigForNote(file) : null;
        debugLog.log('Local config:', localConfig);

        switch (triggerType) {
            case 'assignee':
                debugLog.log('Processing assignee suggestions...');
                // Filter by local config default assignee or show all
                let assigneeUsers = this.cachedUsers.filter(user => 
                    user.name.toLowerCase().includes(queryLower) ||
                    user.email.toLowerCase().includes(queryLower)
                );

                debugLog.log('Found assignee users:', assigneeUsers.length);
                
                // Prioritize default assignee from config
                if (localConfig?.assignee) {
                    assigneeUsers = assigneeUsers.sort((a, b) => {
                        if (a.email === localConfig.assignee || a.name === localConfig.assignee) return -1;
                        if (b.email === localConfig.assignee || b.name === localConfig.assignee) return 1;
                        return 0;
                    });
                }
                
                return assigneeUsers.map(user => ({
                    id: user.id,
                    label: user.name,
                    description: user.email + (user.email === localConfig?.assignee ? ' (default)' : ''),
                    type: 'user' as const,
                    icon: '👤'
                }));

            case 'status':
                debugLog.log('Processing status suggestions...');
                // Get states for current team or all teams
                const allStates: LinearState[] = [];
                this.cachedStates.forEach(states => allStates.push(...states));
                
                return allStates
                    .filter(state => state.name.toLowerCase().includes(queryLower))
                    .map(state => ({
                        id: state.id,
                        label: state.name,
                        description: state.type,
                        type: 'status' as const,
                        icon: this.getStatusIcon(state.type)
                    }));
            case 'team':
                debugLog.log('Processing team suggestions...');
                // Filter by local config team or show all
                let teamResults = this.cachedTeams.filter(team => 
                    team.name.toLowerCase().includes(queryLower) ||
                    team.key.toLowerCase().includes(queryLower)
                );
                
                // Prioritize configured team
                if (localConfig?.team) {
                    teamResults = teamResults.sort((a, b) => {
                        if (a.id === localConfig.team || a.name === localConfig.team) return -1;
                        if (b.id === localConfig.team || b.name === localConfig.team) return 1;
                        return 0;
                    });
                }
                
                return teamResults.map(team => ({
                    id: team.id,
                    label: team.name,
                    description: team.key + (team.id === localConfig?.team ? ' (default)' : ''),
                    type: 'team' as const,
                    icon: '🏢'
                }));

            case 'label':
                debugLog.log('Processing label suggestions...');

                // Check if query contains hierarchy (group/child)
                const isHierarchicalQuery = query.includes('/');
                
                if (isHierarchicalQuery) {
                    const [groupQuery, childQuery] = query.split('/');
                    
                    // Find matching groups first
                    const matchingGroups = this.cachedLabels
                        .filter(l => l.isGroup && l.name.toLowerCase().includes(groupQuery.toLowerCase()));
                    
                    // Then find children of those groups
                    const suggestions: AutocompleteItem[] = [];
                    
                    matchingGroups.forEach(group => {
                        const children = this.cachedLabels.filter(l => 
                            l.parent?.id === group.id && 
                            l.name.toLowerCase().includes((childQuery || '').toLowerCase())
                        );
                        
                        children.forEach(child => {
                            suggestions.push({
                                id: child.id,
                                label: `${group.name}/${child.name}`,
                                description: `📂 ${group.name} > ${child.name}`,
                                type: 'label' as const,
                                icon: '🏷️'
                            });
                        });
                    });
                    
                    return suggestions;
                } else {
                    debugLog.log('Cached labels:', this.cachedLabels);                   
                    
                    const configLabels = localConfig?.labels || [];                    

                    // Separate group labels from regular labels
                    const groupLabels = this.cachedLabels.filter(l => l.isGroup);
                    const childLabels = this.cachedLabels.filter(l => l.parent);
                    const standaloneLabels = this.cachedLabels.filter(l => !l.parent && !l.isGroup);

                    // Group suggestions by color with headers
                    const colorGroups = this.groupLabelsByColor(
                        standaloneLabels.filter(label => label.name.toLowerCase().includes(queryLower))
                    );

                     // Create suggestions with different formatting
                    const suggestions: AutocompleteItem[] = [];
                    
                    // Add group labels (show as expandable)
                    groupLabels
                        .filter(label => label.name.toLowerCase().includes(queryLower))
                        .forEach(label => {
                            suggestions.push({
                                id: label.id,
                                label: label.name,
                                description: '📁 Label Group',
                                type: 'label' as const,
                                icon: '📁',
                                color: label.color
                            });
                        });
                    
                    // Add child labels (show with parent context)
                    childLabels
                        .filter(label => 
                            label.name.toLowerCase().includes(queryLower) ||
                            label.parent?.name.toLowerCase().includes(queryLower)
                        )
                        .forEach(label => {
                            suggestions.push({
                                id: label.id,
                                label: label.name,
                                description: `📂 ${label.parent?.name} > ${label.name}`,
                                type: 'label' as const,
                                icon: '🏷️',
                                color: label.color
                            });
                        });                    
                    
                    // Add config labels
                    configLabels
                        .filter((label, index, arr) => arr.indexOf(label) === index)
                        .filter(label => label.toLowerCase().includes(queryLower))
                        .filter(label => !this.cachedLabels.some(l => l.name === label)) // Don't duplicate
                        .forEach(label => {
                            suggestions.push({
                                id: label,
                                label: label,
                                description: this.getLabelDescription(label, configLabels, []),
                                type: 'label' as const,
                                icon: '🏷️'
                            });
                        });
                    
                    const colorOrder = ['red', 'blue', 'green', 'purple', 'orange', 'yellow', 'pink', 'gray', 'other'];

                    colorOrder.forEach(colorGroup => {
                        const labelsInGroup = colorGroups[colorGroup];
                        if (labelsInGroup && labelsInGroup.length > 0) {                            
                            
                            // Add the labels in this color group
                            labelsInGroup
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .forEach(label => {
                                    suggestions.push({
                                        id: label.id,
                                        label: label.name,
                                        description: this.getLabelDescription(label.name, configLabels, standaloneLabels.map(l => l.name)),
                                        type: 'label' as const,
                                        icon: '🏷️',
                                        color: label.color
                                    });
                                });
                        }
                    });


                    return suggestions;
                }
                

            case 'project':
                debugLog.log('Processing project suggestions...');
                let projectResults = this.cachedProjects.filter(project => 
                    project.name.toLowerCase().includes(queryLower) ||
                    (project.description && project.description.toLowerCase().includes(queryLower))
                );
                
                // Prioritize configured project
                if (localConfig?.project) {
                    projectResults = projectResults.sort((a, b) => {
                        if (a.id === localConfig.project || a.name === localConfig.project) return -1;
                        if (b.id === localConfig.project || b.name === localConfig.project) return 1;
                        return 0;
                    });
                }
                
                return projectResults.map(project => ({
                    id: project.id,
                    label: project.name,
                    description: (project.description || '') + (project.id === localConfig?.project ? ' (default)' : ''),
                    type: 'project' as const,
                    icon: '📋'
                }));
            case 'priority':
                const priorities = [
                    { id: '1', label: 'Urgent', description: 'Priority 1' },
                    { id: '2', label: 'High', description: 'Priority 2' },
                    { id: '3', label: 'Medium', description: 'Priority 3' },
                    { id: '4', label: 'Low', description: 'Priority 4' }
                ];
                
                // Prioritize default priority from config
                return priorities
                    .filter(p => p.label.toLowerCase().includes(queryLower) || p.id.includes(query))
                    .sort((a, b) => {
                        if (localConfig?.priority && parseInt(a.id) === localConfig.priority) return -1;
                        if (localConfig?.priority && parseInt(b.id) === localConfig.priority) return 1;
                        return 0;
                    })
                    .map(p => ({
                        ...p,
                        description: p.description + (localConfig?.priority && parseInt(p.id) === localConfig.priority ? ' (default)' : ''),
                        type: 'label' as const,
                        icon: this.getPriorityIcon(p.id)
                    }));

            // ... other cases
            default:
                return [];
        }
    }

    renderSuggestion(item: AutocompleteItem, el: HTMLElement): void {
        el.createDiv({ cls: 'linear-autocomplete-item' }, (div) => {

            // Apply color-based styling for labels
            if (item.type === 'label' && item.color) {
                applyLabelStyling(div, item.color);
            }

            // Different styling for different label types
            if (item.description?.includes('Label Group')) {
                div.addClass('label-group');
            } else if (item.description?.includes('>')) {
                div.addClass('label-child');
            }

            // Use colored dot instead of emoji for labels with colors
            const iconEl = div.createSpan({ 
                cls: 'linear-autocomplete-icon'
            });

        
            if (item.type === 'label' && item.color) {
                // Create a colored dot instead of emoji
                createColorDot(iconEl, item.color);
            } else {
                iconEl.textContent = item.icon || '📝';
            }

            div.createSpan({ 
                cls: 'linear-autocomplete-label',
                text: item.label 
            });
            
            if (item.description) {
                div.createSpan({ 
                    cls: 'linear-autocomplete-description',
                    text: item.description 
                });
            }
        });
    }

    selectSuggestion(item: AutocompleteItem): void {
        if (!this.context) return;

        const { editor } = this.context;
        const { start, end } = this.context;
        
        // Replace the current query with the selected item
        editor.replaceRange(item.label, start, end);
        
        // Move cursor after the replacement
        const newPos = { 
            line: start.line, 
            ch: start.ch + item.label.length 
        };
        editor.setCursor(newPos);

        this.close();
    }

    private async ensureFreshCache(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCacheUpdate > this.CACHE_DURATION) {
            await this.refreshCache();
        }
    }

    private async refreshCache(): Promise<void> {
        try {
            debugLog.log('Refreshing autocomplete cache...');
            // Fetch all data in parallel
            const [users, teams, projects, labels] = await Promise.allSettled([
                this.linearClient.getUsers(),
                this.linearClient.getTeams(),
                this.linearClient.getProjects(),
                this.linearClient.getLabels()
            ]);

            // Process users
            if (users.status === 'fulfilled') {
                this.cachedUsers = users.value;
                debugLog.log('Fetched users:', users.value.length);
            } else {
                debugLog.error('Failed to fetch users:', users.reason);
            }

            // Process teams
            if (teams.status === 'fulfilled') {
                this.cachedTeams = teams.value;
                debugLog.log('Fetched teams:', teams.value.length);
            } else {
                debugLog.error('Failed to fetch teams:', teams.reason);
            }

            // Process projects
            if (projects.status === 'fulfilled') {
                this.cachedProjects = projects.value;
                debugLog.log('Fetched projects:', projects.value.length);
            } else {
                debugLog.error('Failed to fetch projects:', projects.reason);
                this.cachedProjects = []; // Fallback to empty array
            }

            // Process labels
            if (labels.status === 'fulfilled') {
                this.cachedLabels = labels.value;
                debugLog.log('Fetched labels:', labels.value.length);
                debugLog.log('First few labels with colors:', labels.value.slice(0, 5).map(l => ({
                    name: l.name,
                    color: l.color,
                    isGroup: l.isGroup
                })));
            } else {
                debugLog.error('Failed to fetch labels:', labels.reason);
                this.cachedLabels = []; // Fallback to empty array
            }

            // Fetch states for each team (only if teams were successfully fetched)
            if (teams.status === 'fulfilled') {
                for (const team of teams.value) {
                    try {
                        const states = await this.linearClient.getTeamStates(team.id);
                        this.cachedStates.set(team.id, states);
                        debugLog.log(`Fetched ${states.length} states for team ${team.name}`);
                    } catch (error) {
                        debugLog.warn(`Failed to fetch states for team ${team.name}:`, error);
                    }
                }
            }

            this.lastCacheUpdate = Date.now();
            debugLog.log('Cache refresh completed');
        } catch (error) {
            debugLog.error('Failed to refresh autocomplete cache:', error);
        }
    }

    private getStatusIcon(type: string): string {
        const icons: Record<string, string> = {
            'backlog': '📋',
            'unstarted': '⏸️',
            'started': '🔄',
            'completed': '✅',
            'cancelled': '❌'
        };
        return icons[type] || '📝';
    }

    private getPriorityIcon(priority: string): string {
        const icons: Record<string, string> = {
            '1': '🔴',
            '2': '🟠',
            '3': '🟡',
            '4': '🟢'
        };
        return icons[priority] || '⚪';
    }    

    private getLabelDescription(label: string, configLabels: string[], linearLabels: string[]): string {
        const sources: string[] = [];
        if (configLabels.includes(label)) sources.push('config');
        if (linearLabels.includes(label)) sources.push('Linear');        
        
        return sources.length > 0 ? `(${sources.join(', ')})` : '';
    }

    private groupLabelsByColor(labels: typeof this.cachedLabels): Record<string, typeof labels> {
        const colorGroups: Record<string, typeof labels> = {};
        
        labels.forEach(label => {
            const colorGroup = this.getColorGroup(label.color);
            if (!colorGroups[colorGroup]) {
                colorGroups[colorGroup] = [];
            }
            colorGroups[colorGroup].push(label);
        });
        
        return colorGroups;
    }

    private getColorGroup(color: string): string {
        // Simple color grouping by hue
        const colors: Record<string, string[]> = {
            'red': ['#ff5722', '#f44336', '#e53e3e', '#dc2626', '#b91c1c'],
            'blue': ['#1976d2', '#2196f3', '#03a9f4', '#00bcd4', '#0ea5e9', '#3b82f6'],
            'green': ['#4caf50', '#8bc34a', '#cddc39', '#009688', '#10b981', '#059669'],
            'purple': ['#9c27b0', '#673ab7', '#3f51b5', '#6366f1', '#8b5cf6', '#7c3aed'],
            'orange': ['#ff9800', '#ff5722', '#795548', '#f97316', '#ea580c'],
            'yellow': ['#ffeb3b', '#ffc107', '#ff9800', '#eab308', '#ca8a04'],
            'pink': ['#e91e63', '#f06292', '#ec4899', '#db2777'],
            'gray': ['#9e9e9e', '#607d8b', '#424242', '#6b7280', '#4b5563'],
            'teal': ['#009688', '#26a69a', '#14b8a6', '#0d9488'],
            'indigo': ['#3f51b5', '#5c6bc0', '#6366f1', '#4f46e5']
        };
        
        if (!color) return 'other';
        
        const lowerColor = color.toLowerCase();
        for (const [group, hexCodes] of Object.entries(colors)) {
            if (hexCodes.some(hex => lowerColor.startsWith(hex.toLowerCase()))) {
                return group;
            }
        }
        
        return 'other';
    }    
}

export class QuickEditModal extends Modal {
    private issue: LinearIssue;
    private callback: (updates: Partial<LinearIssue>) => Promise<void>;

    constructor(app: App, issue: LinearIssue, callback: (updates: Partial<LinearIssue>) => Promise<void>) {
        super(app);
        this.issue = issue;
        this.callback = callback;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: `Quick edit: ${this.issue.identifier}` });

        // Status dropdown
        new Setting(contentEl)
            .setName('Status')
            .addDropdown(dropdown => {
                // This would be populated with actual statuses
                dropdown.addOption(this.issue.state.id, this.issue.state.name);
                dropdown.setValue(this.issue.state.id);
            });

        // Assignee dropdown
        new Setting(contentEl)
            .setName('Assignee')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'Unassigned');
                if (this.issue.assignee) {
                    dropdown.addOption(this.issue.assignee.id, this.issue.assignee.name);
                    dropdown.setValue(this.issue.assignee.id);
                }
            });

        // Priority
        new Setting(contentEl)
            .setName('Priority')
            .addSlider(slider => {
                slider.setLimits(0, 4, 1);
                slider.setValue(this.issue.priority || 0);
                slider.setDynamicTooltip();
            });

        // Action buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        buttonContainer.createEl('button', { 
            text: 'Save',
            cls: 'mod-cta'
        }).onclick = () => this.save();

        buttonContainer.createEl('button', { 
            text: 'Cancel'
        }).onclick = () => this.close();
    }

    private async save(): Promise<void> {
        // Collect updates from form fields
        const updates: Partial<LinearIssue> = {};
        
        // You would gather the actual form data here
        // For example: updates.priority = this.priorityValue;
        
        try {
            await this.callback(updates);
            this.close();
        } catch (error) {
            debugLog.error('Failed to save issue updates:', error);
        }
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class TooltipManager {
    private static instance: TooltipManager;
    private activeTooltip: HTMLElement | null = null;

    static getInstance(): TooltipManager {
        if (!TooltipManager.instance) {
            TooltipManager.instance = new TooltipManager();
        }
        return TooltipManager.instance;
    }

    showIssueTooltip(element: HTMLElement, issue: LinearIssue): void {
        this.hideTooltip();

        const tooltip = document.createElement('div');
        tooltip.className = 'linear-tooltip';
        createIssueTooltip(tooltip, issue);        

        // Position tooltip
        positionTooltip(tooltip, element);

        document.body.appendChild(tooltip);
        this.activeTooltip = tooltip;

        // Add event listeners for actions
        tooltip.querySelector('.quick-edit-btn')?.addEventListener('click', () => {
            // Open quick edit modal
            this.hideTooltip();
        });

        tooltip.querySelector('.open-linear-btn')?.addEventListener('click', () => {
            window.open(issue.url, '_blank');
            this.hideTooltip();
        });

        // Auto-hide after delay
        setTimeout(() => this.hideTooltip(), 5000);
    }

    hideTooltip(): void {
        if (this.activeTooltip) {
            this.activeTooltip.remove();
            this.activeTooltip = null;
        }
    }
}