import { TFile } from 'obsidian';

export interface LinearWorkspace {
    id: string;           // locally-generated UUID
    name: string;         // user display name, e.g. "Work", "Personal"
    apiKey: string;
    syncFolder: string;   // vault path for this workspace's notes
    teamIds: string[];    // empty = sync all teams; non-empty = one call per teamId
    cachedTeams?: { id: string; name: string; key?: string }[];  // persisted after Test Connection
    cachedUsers?: { id: string; name: string; email: string }[];
    cachedProjects?: { id: string; name: string; description?: string; teamIds?: string[] }[];
    defaultTeamId?: string;
    defaultAssigneeId?: string;
    defaultProjectId?: string;
    lastSyncTime?: string;
    enabled: boolean;
}

export interface LinearPluginSettings {
    workspaces: LinearWorkspace[];
    settingsVersion: number;
    defaultWorkspaceId: string | null;
    autoSync: boolean;
    autoSyncInterval: number;
    includeComments: boolean;
    statusMapping: Record<string, string>;
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

export const DEFAULT_SETTINGS: LinearPluginSettings = {
    workspaces: [],
    settingsVersion: 2,
    defaultWorkspaceId: null,
    autoSync: false,
    autoSyncInterval: 15,
    includeComments: false,
    statusMapping: {
        'Todo': '📋',
        'In Progress': '🔄',
        'Done': '✅',
        'Canceled': '❌'
    },
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
    project?: {
        id: string;
        name: string;
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
            user?: {
                name: string;
            } | null;
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

export interface LinearProject {
    id: string;
    name: string;
    description?: string;
    teamIds?: string[];
}

export interface LinearDocument {
    id: string;
    title: string;
    content: string;
    url?: string;
    updatedAt: string;
}

export interface NoteFrontmatter {
    linear_workspace_id?: string;
    linear_id?: string;
    linear_identifier?: string;
    linear_title?: string;
    linear_description?: string;
    linear_status?: string;
    linear_status_id?: string;
    linear_assignee?: string;
    linear_assignee_id?: string;
    linear_project?: string;
    linear_project_id?: string;
    linear_team?: string;
    linear_team_id?: string;
    linear_url?: string;
    linear_created?: string;
    linear_updated?: string;
    linear_last_synced?: string;
    linear_priority?: number;
    linear_estimate?: number;
    linear_labels?: string[];
    linear_document_id?: string;
    linear_document_title?: string;
    linear_document_updated?: string;
    linear_document_source_path?: string;
}

export interface SyncResult {
    created: number;
    updated: number;
    errors: string[];
    conflicts: ConflictInfo[];
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
    type: 'team' | 'status' | 'assignee' | 'priority' | 'label' | 'project';
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
