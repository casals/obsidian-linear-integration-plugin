import { TFile } from 'obsidian';
export interface LinearPluginSettings {
    apiKey: string;
    teamId: string;
    syncFolder: string;
    autoSync: boolean;
    autoSyncInterval: number; // minutes
    includeDescription: boolean;
    includeComments: boolean;
    statusMapping: Record<string, string>;
    noteTemplate: string;
    secureTokenStorage: boolean;
    multiWorkspaceSupport: boolean;
    workspaces: LinearWorkspace[];
    inlineCommentMirroring: boolean;
    kanbanGeneration: boolean;
    agendaGeneration: boolean;
    batchOperations: boolean;
    conflictResolution: 'manual' | 'linear-wins' | 'obsidian-wins' | 'timestamp';
    autocompleteEnabled: boolean;
    quickEditEnabled: boolean;
    tooltipsEnabled: boolean;
    lastSyncTime?: string;
    autoFillFromExpressions: boolean;
    debugMode: boolean;
}

export const DEFAULT_SETTINGS: LinearPluginSettings = {
    apiKey: '',
    teamId: '',
    syncFolder: 'Linear Issues',
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
    multiWorkspaceSupport: false,
    workspaces: [],
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

export interface LinearIssue {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: {
        id: string;
        name: string;
        type: string;
    };
    assignee?: {
        id: string;
        name: string;
        email: string;
    };
    team: {
        id: string;
        name: string;
        key: string;
    };
    priority: number;
    estimate?: number;
    dueDate?: string;
    labels: {
        nodes: Array<{
            id: string;
            name: string;
            color: string;
        }>;
    };
    createdAt: string;
    updatedAt: string;
    url: string;
    comments?: {
        nodes: Array<{
            id: string;
            body: string;
            user: {
                name: string;
            };
            createdAt: string;
        }>;
    };
}

export interface LinearTeam {
    id: string;
    name: string;
    key: string;
}

export interface LinearState {
    id: string;
    name: string;
    type: string;
    color: string;
}

export interface LinearUser {
    id: string;
    name: string;
    email: string;
}

export interface NoteFrontmatter {
    linear_id?: string;
    linear_identifier?: string;
    linear_status?: string;
    linear_assignee?: string;
    linear_team?: string;
    linear_url?: string;
    linear_created?: string;
    linear_updated?: string;
    linear_last_synced?: string;
    linear_priority?: number;
    linear_estimate?: number;
    linear_labels?: string[];
}

export interface SyncResult {
    created: number;
    updated: number;
    errors: string[];
    conflicts: ConflictInfo[];
}

export interface LinearWorkspace {
    id: string;
    name: string;
    apiKey: string;
    isDefault: boolean;
}

export interface ConflictInfo {
    issueId: string;
    field: string;
    linearValue: any;
    obsidianValue: any;
    timestamp: string;
}

export interface LinearNoteConfig {
    workspace?: string;
    team?: string;
    project?: string;
    labels?: string[];
    assignee?: string;
    priority?: number;
    autoSync?: boolean;
    template?: string;
}

export interface InlineTag {
    type: 'status' | 'assignee' | 'priority' | 'label' | 'project';
    value: string;
    position: { start: number; end: number };
}

export interface AutocompleteItem {
    id: string;
    label: string;
    description?: string;
    type: 'user' | 'status' | 'label' | 'project' | 'team';
    icon?: string;
    color?: string;
}

export interface FrontmatterObject extends Record<string, unknown> {
    [key: string]: string | number | boolean | string[] | unknown;
}

export interface FileExplorerView {
    selectedFiles?: TFile[];
}