const mockNotice = jest.fn();
const mockSyncAll = jest.fn();
const mockGetLinearIdFromNote = jest.fn();
const mockUpdateNoteWithIssue = jest.fn();
const mockGetFrontmatter = jest.fn();
const mockGetIssueById = jest.fn();
const mockUpdateIssue = jest.fn();
const mockGetIssues = jest.fn();
const mockResolveConflicts = jest.fn();
const mockAddConflict = jest.fn();
const mockQuickEditOpen = jest.fn();

const mockApp = {
    vault: {
        on: jest.fn(() => jest.fn())
    },
    workspace: {
        getActiveViewOfType: jest.fn(),
        getLeavesOfType: jest.fn(() => []),
        openLinkText: jest.fn()
    }
};

jest.mock('obsidian', () => {
    class MockPlugin {
        app = mockApp;
        addRibbonIcon = jest.fn((_icon: string, _title: string, callback: () => Promise<void> | void) => {
            this.__ribbonCallbacks.push(callback);
            return {};
        });
        addCommand = jest.fn((command: Record<string, unknown>) => {
            this.__commands.push(command);
            return command;
        });
        addSettingTab = jest.fn();
        registerEvent = jest.fn();
        registerDomEvent = jest.fn();
        registerEditorSuggest = jest.fn();
        registerInterval = jest.fn();
        loadData = jest.fn(async () => ({
            settingsVersion: 2,
            workspaces: [{
                id: 'workspace-1',
                name: 'Workspace 1',
                apiKey: 'api-key-1',
                syncFolder: 'Linear/Workspace 1',
                teamIds: [],
                enabled: true
            }],
            defaultWorkspaceId: 'workspace-1',
            autoSync: false,
            autoSyncInterval: 0,
            includeComments: false,
            statusMapping: {},
            secureTokenStorage: true,
            inlineCommentMirroring: true,
            kanbanGeneration: false,
            agendaGeneration: false,
            batchOperations: true,
            conflictResolution: 'manual',
            autocompleteEnabled: false,
            quickEditEnabled: true,
            tooltipsEnabled: false,
            autoFillFromExpressions: true,
            debugMode: false
        }));
        saveData = jest.fn(async () => undefined);
        __commands: Array<Record<string, unknown>> = [];
        __ribbonCallbacks: Array<() => Promise<void> | void> = [];
    }

    class MockNotice {
        constructor(message: string, duration?: number) {
            mockNotice(message, duration);
        }
    }

    return {
        Plugin: MockPlugin,
        Notice: MockNotice,
        MarkdownView: class MarkdownView {},
        Editor: class Editor {},
        TFile: class TFile {}
    };
}, { virtual: true });

jest.mock('../src/api/linear-client', () => ({
    LinearClient: jest.fn().mockImplementation(() => ({
        getIssueById: mockGetIssueById,
        updateIssue: mockUpdateIssue,
        getIssues: mockGetIssues
    }))
}));

jest.mock('../src/sync/sync-manager', () => ({
    SyncManager: jest.fn().mockImplementation(() => ({
        syncAll: mockSyncAll,
        getLinearIdFromNote: mockGetLinearIdFromNote,
        updateNoteWithIssue: mockUpdateNoteWithIssue,
        getFrontmatter: mockGetFrontmatter
    }))
}));

jest.mock('../src/ui/settings-tab', () => ({
    LinearSettingsTab: jest.fn().mockImplementation(() => ({}))
}));

jest.mock('../src/ui/issue-modal', () => ({
    IssueCreateModal: jest.fn().mockImplementation(() => ({
        open: jest.fn()
    }))
}));

jest.mock('../src/features/conflict-resolver', () => ({
    ConflictResolver: jest.fn().mockImplementation(() => ({
        resolveConflicts: mockResolveConflicts
    })),
    ConflictHistory: jest.fn().mockImplementation(() => ({
        addConflict: mockAddConflict
    }))
}));

jest.mock('../src/features/local-config-system', () => ({
    LocalConfigManager: jest.fn().mockImplementation(() => ({
        clearCache: jest.fn(),
        getConfigForNote: jest.fn(async () => ({}))
    })),
    KanbanGenerator: jest.fn().mockImplementation(() => ({
        createKanbanNote: jest.fn()
    })),
    AgendaGenerator: jest.fn().mockImplementation(() => ({
        createAgendaNote: jest.fn()
    })),
    CommentMirror: jest.fn().mockImplementation(() => ({
        mirrorCommentsToNote: jest.fn()
    })),
    BatchOperationManager: jest.fn().mockImplementation(() => ({
        batchCreateIssues: jest.fn()
    }))
}));

jest.mock('../src/features/autocomplete-system', () => ({
    LinearAutocompleteSystem: jest.fn().mockImplementation(() => ({})),
    TooltipManager: {
        getInstance: jest.fn(() => ({
            hideTooltip: jest.fn(),
            showIssueTooltip: jest.fn()
        }))
    },
    QuickEditModal: jest.fn().mockImplementation((_app: unknown, _issue: unknown, onSubmit: (updates: Record<string, unknown>) => Promise<void>) => ({
        open: () => mockQuickEditOpen(onSubmit)
    }))
}));

jest.mock('../src/parsers/markdown-parser', () => ({
    MarkdownParser: {
        generateIssueReference: jest.fn(() => '[[ENG-1]]')
    }
}));

import { formatSyncSummaryNoticeText, SYNC_NOTICE_DURATION } from '../src/sync/sync-summary';
// Import the TypeScript source explicitly so Jest uses the mocked dependency graph.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const LinearPlugin = require('../main.ts').default as typeof import('../main').default;

const mockManifest = {
    id: 'linear-integration',
    name: 'Linear Integration',
    version: '1.2.0',
    minAppVersion: '1.0.0',
    description: 'Test manifest',
    author: 'Test',
    authorUrl: '',
    isDesktopOnly: false
};

function createSyncResult(overrides: Partial<{
    created: number;
    updated: number;
    errors: string[];
    conflicts: Array<{
        issueId: string;
        field: string;
        linearValue: string;
        obsidianValue: string;
        timestamp: string;
    }>;
}> = {}) {
    return {
        created: 0,
        updated: 0,
        errors: [],
        conflicts: [],
        ...overrides
    };
}

function createIssue() {
    return {
        id: 'issue-1',
        identifier: 'ENG-1',
        title: 'Issue title',
        description: 'Issue description',
        state: {
            id: 'state-1',
            name: 'Todo',
            type: 'unstarted'
        },
        assignee: {
            id: 'user-1',
            name: 'Jane Doe',
            email: 'jane@example.com'
        },
        team: {
            id: 'team-1',
            name: 'Engineering',
            key: 'ENG'
        },
        project: {
            id: 'project-1',
            name: 'Alpha'
        },
        priority: 2,
        labels: {
            nodes: []
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        url: 'https://linear.app/issue/ENG-1',
        comments: {
            nodes: []
        }
    };
}

function createPlugin() {
    const plugin = new LinearPlugin(mockApp as never, mockManifest as never) as any;

    plugin.settings = {
        settingsVersion: 2,
        workspaces: [{
            id: 'workspace-1',
            name: 'Workspace 1',
            apiKey: 'api-key-1',
            syncFolder: 'Linear/Workspace 1',
            teamIds: [],
            enabled: true
        }],
        defaultWorkspaceId: 'workspace-1',
        autoSync: false,
        autoSyncInterval: 0,
        includeComments: false,
        statusMapping: {},
        secureTokenStorage: true,
        inlineCommentMirroring: true,
        kanbanGeneration: false,
        agendaGeneration: false,
        batchOperations: true,
        conflictResolution: 'manual',
        autocompleteEnabled: false,
        quickEditEnabled: true,
        tooltipsEnabled: false,
        autoFillFromExpressions: true,
        debugMode: false
    };
    plugin.syncManager = {
        syncAll: mockSyncAll,
        getLinearIdFromNote: mockGetLinearIdFromNote,
        updateNoteWithIssue: mockUpdateNoteWithIssue,
        getFrontmatter: mockGetFrontmatter
    };
    plugin.conflictResolver = {
        resolveConflicts: mockResolveConflicts
    };
    plugin.conflictHistory = {
        addConflict: mockAddConflict
    };
    plugin.getDefaultClient = jest.fn(() => ({
        getIssueById: mockGetIssueById,
        updateIssue: mockUpdateIssue,
        getIssues: mockGetIssues
    }));

    return plugin;
}

describe('LinearPlugin top-level sync notices', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSyncAll.mockResolvedValue(createSyncResult());
        mockGetLinearIdFromNote.mockResolvedValue('issue-1');
        mockGetIssueById.mockResolvedValue(createIssue());
        mockUpdateIssue.mockResolvedValue(createIssue());
        mockGetIssues.mockResolvedValue([createIssue()]);
        mockResolveConflicts.mockResolvedValue({});
        mockQuickEditOpen.mockImplementation(async (onSubmit: (updates: Record<string, unknown>) => Promise<void>) => {
            await onSubmit({ title: 'Updated title' });
        });
    });

    it('shows a formatted summary notice for the top-level sync command', async () => {
        mockSyncAll.mockResolvedValue(createSyncResult({
            created: 2,
            updated: 3
        }));

        const plugin = createPlugin();
        await (plugin as any).runTopLevelSync();

        expect(mockSyncAll).toHaveBeenCalledTimes(1);
        expect(mockNotice).toHaveBeenCalledTimes(1);
        expect(mockNotice).toHaveBeenCalledWith(formatSyncSummaryNoticeText(createSyncResult({
            created: 2,
            updated: 3
        })), SYNC_NOTICE_DURATION);
    });

    it('reuses the summary notice after conflict resolution syncs', async () => {
        const syncResult = createSyncResult({
            conflicts: [{
                issueId: 'issue1',
                field: 'linear_title',
                linearValue: 'Remote title',
                obsidianValue: 'Local title',
                timestamp: '2026-03-15T00:00:00.000Z'
            }]
        });
        mockSyncAll.mockResolvedValue(syncResult);
        mockResolveConflicts.mockResolvedValue({
            'issue1-linear_title': 'linear'
        });

        const plugin = createPlugin();
        await plugin.syncWithConflictResolution();

        expect(mockResolveConflicts).toHaveBeenCalledWith(syncResult.conflicts);
        expect(mockAddConflict).toHaveBeenCalledTimes(1);
        expect(mockNotice).toHaveBeenNthCalledWith(1, 'Syncing with conflict detection...', undefined);
        expect(mockNotice).toHaveBeenNthCalledWith(2, '1 conflicts detected', undefined);
        expect(mockNotice).toHaveBeenNthCalledWith(3, formatSyncSummaryNoticeText(syncResult), SYNC_NOTICE_DURATION);
    });

    it('does not show the summary notice for internal quick-edit refresh syncs', async () => {
        const plugin = createPlugin();
        await plugin.quickEditIssue({ path: 'Linear/Workspace 1/ENG-1.md' } as never);
        await new Promise(resolve => setImmediate(resolve));

        expect(mockSyncAll).toHaveBeenCalledTimes(1);
        expect(mockNotice).toHaveBeenCalledTimes(1);
        expect(mockNotice).toHaveBeenCalledWith('Issue updated successfully', undefined);
        expect(mockNotice).not.toHaveBeenCalledWith(formatSyncSummaryNoticeText(createSyncResult()), SYNC_NOTICE_DURATION);
    });
});
