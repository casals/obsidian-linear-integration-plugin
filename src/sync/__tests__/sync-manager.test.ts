const noticeMock = jest.fn();

jest.mock('obsidian', () => ({
    Notice: function Notice(message: string) {
        noticeMock(message);
    }
}), { virtual: true });

import { SyncManager } from '../sync-manager';
import { LinearClient } from '../../api/linear-client';
import { DEFAULT_SETTINGS, LinearDocument, LinearIssue, LinearPluginSettings, LinearWorkspace, NoteFrontmatter } from '../../models/types';

type MockFile = {
    path: string;
    name: string;
    basename: string;
    extension: string;
    content: string;
    frontmatter?: NoteFrontmatter;
    stat: { mtime: number };
};

type MockApp = {
    vault: {
        getMarkdownFiles: jest.Mock<MockFile[], []>;
        getAbstractFileByPath: jest.Mock<MockFile | { path: string } | null, [string]>;
        createFolder: jest.Mock<Promise<void>, [string]>;
        create: jest.Mock<Promise<MockFile>, [string, string]>;
        read: jest.Mock<Promise<string>, [MockFile]>;
        modify: jest.Mock<Promise<void>, [MockFile, string]>;
    };
    metadataCache: {
        getFileCache: jest.Mock<{ frontmatter: NoteFrontmatter } | null, [MockFile]>;
        getFirstLinkpathDest: jest.Mock<MockFile | null, [string, string]>;
    };
    fileManager: {
        processFrontMatter: jest.Mock<Promise<void>, [MockFile, (frontmatter: Record<string, unknown>) => void]>;
    };
};

const getIssuesByApiKey = new Map<string, jest.Mock<Promise<LinearIssue[]>, [string | undefined, string | undefined]>>();
const getIssueByIdByApiKey = new Map<string, jest.Mock<Promise<LinearIssue | null>, [string]>>();
const updateIssueByApiKey = new Map<string, jest.Mock<Promise<LinearIssue>, [string, Record<string, unknown>]>>();
const addCommentByApiKey = new Map<string, jest.Mock<Promise<void>, [string, string]>>();
const getTeamStatesByApiKey = new Map<string, jest.Mock<Promise<Array<{ id: string; name: string; type: string; color: string }>>, [string]>>();
const getUsersByApiKey = new Map<string, jest.Mock<Promise<Array<{ id: string; name: string; email: string }>>, []>>();
const getProjectsByApiKey = new Map<string, jest.Mock<Promise<Array<{ id: string; name: string; description?: string }>>, [string | undefined]>>();
const createIssueDocumentByApiKey = new Map<string, jest.Mock<Promise<LinearDocument>, [string, string, string]>>();
const updateIssueDocumentByApiKey = new Map<string, jest.Mock<Promise<LinearDocument>, [string, string, string, string]>>();

function createWorkspace(overrides: Partial<LinearWorkspace> = {}): LinearWorkspace {
    return {
        id: 'workspace-1',
        name: 'Workspace 1',
        apiKey: 'api-key-1',
        syncFolder: 'Linear/Workspace 1',
        teamIds: [],
        enabled: true,
        ...overrides
    };
}

function createIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
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
        estimate: 3,
        labels: {
            nodes: [{ id: 'label-1', name: 'bug', color: '#ff0000' }]
        },
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        url: 'https://linear.app/issue/ENG-1',
        comments: {
            nodes: []
        },
        ...overrides
    };
}

function createFile(path: string, frontmatter?: NoteFrontmatter, content: string = '', mtime: number = Date.now()): MockFile {
    const name = path.split('/').pop() ?? path;
    return {
        path,
        name,
        basename: name.replace(/\.md$/, ''),
        extension: 'md',
        content,
        frontmatter,
        stat: { mtime }
    };
}

function createManagedBody(options: {
    documentText?: string;
    draftText?: string;
    commentsText?: string;
    syncLabel?: string;
} = {}): string {
    const {
        documentText = '',
        draftText = '',
        commentsText = '*No comments yet.*',
        syncLabel = 'Never'
    } = options;

    const lines = [
        '# Linear Issue',
        '',
        '[ENG-1](https://linear.app/issue/ENG-1)',
        '',
        '# Document',
        ''
    ];

    if (documentText) {
        lines.push(documentText, '');
    }

    lines.push('# New Comment', '', `--- Synced to Linear at ${syncLabel} ---`, '');

    if (draftText) {
        lines.push(draftText, '');
    }

    lines.push('# Comments', '', commentsText);
    return `${lines.join('\n')}\n`;
}

function createMockApp(initialFiles: MockFile[] = []): MockApp {
    const files = [...initialFiles];
    const folders = new Set<string>(['Linear', 'Linear/Workspace 1', 'Linear/Workspace 2', 'Inbox']);
    let mtimeCounter = 1_000_000;

    const vault = {
        getMarkdownFiles: jest.fn(() => files),
        getAbstractFileByPath: jest.fn((path: string) => {
            if (folders.has(path)) return { path };
            return files.find(file => file.path === path) ?? null;
        }),
        createFolder: jest.fn(async (path: string) => {
            folders.add(path);
        }),
        create: jest.fn(async (path: string, content: string) => {
            const file = createFile(path, undefined, content, ++mtimeCounter);
            files.push(file);
            return file;
        }),
        read: jest.fn(async (file: MockFile) => file.content),
        modify: jest.fn(async (file: MockFile, content: string) => {
            file.content = content;
            file.stat.mtime = ++mtimeCounter;
        })
    };

    return {
        vault,
        metadataCache: {
            getFileCache: jest.fn((file: MockFile) =>
                file.frontmatter ? { frontmatter: file.frontmatter } : null
            ),
            getFirstLinkpathDest: jest.fn((linkpath: string, _sourcePath: string) =>
                files.find(file => file.basename === linkpath || file.path === linkpath || file.path === `${linkpath}.md`) ?? null
            )
        },
        fileManager: {
            processFrontMatter: jest.fn(async (file: MockFile, updater: (frontmatter: Record<string, unknown>) => void) => {
                const frontmatter = { ...(file.frontmatter ?? {}) };
                updater(frontmatter);
                file.frontmatter = frontmatter as NoteFrontmatter;
                file.stat.mtime = ++mtimeCounter;
            })
        }
    };
}

function createSettings(workspaces: LinearWorkspace[]): LinearPluginSettings {
    return {
        ...DEFAULT_SETTINGS,
        includeComments: true,
        workspaces
    };
}

function registerClientMocks(apiKey: string, issue: LinearIssue): {
    getIssuesMock: jest.Mock<Promise<LinearIssue[]>, [string | undefined, string | undefined]>;
    getIssueByIdMock: jest.Mock<Promise<LinearIssue | null>, [string]>;
    updateIssueMock: jest.Mock<Promise<LinearIssue>, [string, Record<string, unknown>]>;
    addCommentMock: jest.Mock<Promise<void>, [string, string]>;
    createIssueDocumentMock: jest.Mock<Promise<LinearDocument>, [string, string, string]>;
    updateIssueDocumentMock: jest.Mock<Promise<LinearDocument>, [string, string, string, string]>;
} {
    const getIssuesMock = jest.fn<Promise<LinearIssue[]>, [string | undefined, string | undefined]>().mockResolvedValue([issue]);
    const getIssueByIdMock = jest.fn<Promise<LinearIssue | null>, [string]>().mockResolvedValue(issue);
    const updateIssueMock = jest.fn<Promise<LinearIssue>, [string, Record<string, unknown>]>().mockResolvedValue(issue);
    const addCommentMock = jest.fn<Promise<void>, [string, string]>().mockResolvedValue();
    const createIssueDocumentMock = jest.fn<Promise<LinearDocument>, [string, string, string]>().mockResolvedValue({
        id: 'document-1',
        title: 'ENG-1',
        content: 'Document content',
        updatedAt: '2026-03-02T00:00:00.000Z',
        url: 'https://linear.app/document/document-1'
    });
    const updateIssueDocumentMock = jest.fn<Promise<LinearDocument>, [string, string, string, string]>().mockResolvedValue({
        id: 'document-1',
        title: 'ENG-1',
        content: 'Document content',
        updatedAt: '2026-03-03T00:00:00.000Z',
        url: 'https://linear.app/document/document-1'
    });

    getIssuesByApiKey.set(apiKey, getIssuesMock);
    getIssueByIdByApiKey.set(apiKey, getIssueByIdMock);
    updateIssueByApiKey.set(apiKey, updateIssueMock);
    addCommentByApiKey.set(apiKey, addCommentMock);
    createIssueDocumentByApiKey.set(apiKey, createIssueDocumentMock);
    updateIssueDocumentByApiKey.set(apiKey, updateIssueDocumentMock);
    getTeamStatesByApiKey.set(apiKey, jest.fn().mockResolvedValue([
        { id: 'state-1', name: 'Todo', type: 'unstarted', color: '#cccccc' },
        { id: 'state-2', name: 'Done', type: 'completed', color: '#00ff00' }
    ]));
    getUsersByApiKey.set(apiKey, jest.fn().mockResolvedValue([
        { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' },
        { id: 'user-2', name: 'John Smith', email: 'john@example.com' }
    ]));
    getProjectsByApiKey.set(apiKey, jest.fn().mockResolvedValue([
        { id: 'project-1', name: 'Alpha' },
        { id: 'project-2', name: 'Beta' }
    ]));

    return { getIssuesMock, getIssueByIdMock, updateIssueMock, addCommentMock, createIssueDocumentMock, updateIssueDocumentMock };
}

describe('SyncManager frontmatter-first sync', () => {
    beforeEach(() => {
        noticeMock.mockReset();
        getIssuesByApiKey.clear();
        getIssueByIdByApiKey.clear();
        updateIssueByApiKey.clear();
        addCommentByApiKey.clear();
        getTeamStatesByApiKey.clear();
        getUsersByApiKey.clear();
        getProjectsByApiKey.clear();
        createIssueDocumentByApiKey.clear();
        updateIssueDocumentByApiKey.clear();

        jest.spyOn(LinearClient.prototype, 'getIssues').mockImplementation(function (
            this: { apiKey: string },
            teamId?: string,
            updatedAfter?: string
        ) {
            const mock = getIssuesByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No getIssues mock configured for ${this.apiKey}`);
            return mock(teamId, updatedAfter);
        });

        jest.spyOn(LinearClient.prototype, 'getIssueById').mockImplementation(function (this: { apiKey: string }, id: string) {
            const mock = getIssueByIdByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No getIssueById mock configured for ${this.apiKey}`);
            return mock(id);
        });

        jest.spyOn(LinearClient.prototype, 'updateIssue').mockImplementation(function (
            this: { apiKey: string },
            id: string,
            updates: Record<string, unknown>
        ) {
            const mock = updateIssueByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No updateIssue mock configured for ${this.apiKey}`);
            return mock(id, updates);
        });

        jest.spyOn(LinearClient.prototype, 'addCommentToIssue').mockImplementation(function (
            this: { apiKey: string },
            issueId: string,
            body: string
        ) {
            const mock = addCommentByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No addComment mock configured for ${this.apiKey}`);
            return mock(issueId, body);
        });

        jest.spyOn(LinearClient.prototype, 'getTeamStates').mockImplementation(function (this: { apiKey: string }, teamId: string) {
            const mock = getTeamStatesByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No getTeamStates mock configured for ${this.apiKey}`);
            return mock(teamId);
        });

        jest.spyOn(LinearClient.prototype, 'getUsers').mockImplementation(function (this: { apiKey: string }) {
            const mock = getUsersByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No getUsers mock configured for ${this.apiKey}`);
            return mock();
        });

        jest.spyOn(LinearClient.prototype, 'getProjects').mockImplementation(function (
            this: { apiKey: string },
            teamId?: string
        ) {
            const mock = getProjectsByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No getProjects mock configured for ${this.apiKey}`);
            return mock(teamId);
        });

        jest.spyOn(LinearClient.prototype, 'createIssueDocument').mockImplementation(function (
            this: { apiKey: string },
            issueId: string,
            title: string,
            content: string
        ) {
            const mock = createIssueDocumentByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No createIssueDocument mock configured for ${this.apiKey}`);
            return mock(issueId, title, content);
        });

        jest.spyOn(LinearClient.prototype, 'updateIssueDocument').mockImplementation(function (
            this: { apiKey: string },
            id: string,
            issueId: string,
            title: string,
            content: string
        ) {
            const mock = updateIssueDocumentByApiKey.get(this.apiKey);
            if (!mock) throw new Error(`No updateIssueDocument mock configured for ${this.apiKey}`);
            return mock(id, issueId, title, content);
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('pull sync writes title and description into frontmatter and renders the managed body', async () => {
        const workspace = createWorkspace();
        const issue = createIssue({
            comments: {
                nodes: [{ id: 'comment-1', body: 'Remote comment', user: { name: 'Jane Doe' }, createdAt: '2026-03-03T00:00:00.000Z' }]
            }
        });
        const app = createMockApp();
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock } = registerClientMocks(workspace.apiKey, issue);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(getIssuesMock).toHaveBeenCalledWith(undefined, undefined);
        expect(result.created).toBe(1);
        const createdFile = await app.vault.create.mock.results[0].value;
        expect(createdFile.frontmatter).toEqual(expect.objectContaining({
            linear_workspace_id: workspace.id,
            linear_id: issue.id,
            linear_title: issue.title,
            linear_description: issue.description,
            linear_status_id: issue.state.id,
            linear_assignee_id: issue.assignee?.id,
            linear_project_id: issue.project?.id,
            linear_team_id: issue.team.id
        }));
        expect(createdFile.content).toContain('# Linear Issue');
        expect(createdFile.content).toContain('[ENG-1](https://linear.app/issue/ENG-1)');
        expect(createdFile.content).toContain('# Document');
        expect(createdFile.content).toContain('# New Comment');
        expect(createdFile.content).toContain('# Comments');
        expect(createdFile.content).toContain('Remote comment');
        expect(createdFile.content).not.toContain('Issue description');
    });

    it('pushes local frontmatter edits back to Linear on sync', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const remoteIssue = createIssue();
        const app = createMockApp([
            createFile(
                'Linear/Workspace 1/ENG-1.md',
                {
                    linear_workspace_id: workspace.id,
                    linear_id: remoteIssue.id,
                    linear_identifier: remoteIssue.identifier,
                    linear_title: 'Updated locally',
                    linear_description: 'Local description',
                    linear_status: 'Done',
                    linear_status_id: remoteIssue.state.id,
                    linear_assignee: 'John Smith',
                    linear_assignee_id: remoteIssue.assignee?.id,
                    linear_project: 'Beta',
                    linear_project_id: '',
                    linear_team: remoteIssue.team.name,
                    linear_team_id: remoteIssue.team.id,
                    linear_priority: 1,
                    linear_labels: ['bug', 'backend'],
                    linear_last_synced: '2026-03-10T00:00:00.000Z'
                },
                createManagedBody(),
                Date.parse('2026-03-11T00:00:00.000Z')
            )
        ]);
        const updatedIssue = createIssue({
            title: 'Updated locally',
            description: 'Local description',
            state: { id: 'state-2', name: 'Done', type: 'completed' },
            assignee: { id: 'user-2', name: 'John Smith', email: 'john@example.com' },
            project: { id: 'project-2', name: 'Beta' },
            priority: 1,
            labels: { nodes: [{ id: 'label-2', name: 'backend', color: '#0000ff' }, { id: 'label-1', name: 'bug', color: '#ff0000' }] }
        });
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, updateIssueMock } = registerClientMocks(workspace.apiKey, remoteIssue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(remoteIssue);
        updateIssueMock.mockResolvedValue(updatedIssue);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(updateIssueMock).toHaveBeenCalledWith(remoteIssue.id, expect.objectContaining({
            title: 'Updated locally',
            description: 'Local description',
            stateId: 'state-2',
            assigneeId: 'user-2',
            projectId: 'project-2',
            priority: 1,
            labelNames: ['bug', 'backend'],
            teamId: remoteIssue.team.id
        }));
        expect(result.updated).toBe(1);
        const file = app.vault.getMarkdownFiles()[0];
        expect(file.frontmatter).toEqual(expect.objectContaining({
            linear_title: 'Updated locally',
            linear_description: 'Local description',
            linear_status: 'Done',
            linear_assignee: 'John Smith',
            linear_project: 'Beta',
            linear_priority: 1
        }));
    });

    it('rejects local team edits and leaves the note untouched', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: issue.id,
                linear_identifier: issue.identifier,
                linear_title: issue.title,
                linear_description: issue.description,
                linear_status: issue.state.name,
                linear_team: 'Another Team',
                linear_team_id: 'team-999',
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody(),
            Date.parse('2026-03-11T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, updateIssueMock } = registerClientMocks(workspace.apiKey, issue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(issue);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(updateIssueMock).not.toHaveBeenCalled();
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Team changes must be made in Linear')
        ]));
        expect(noticeMock).toHaveBeenCalledWith(expect.stringContaining('Team changes must be made in Linear'));
        expect(file.frontmatter?.linear_team).toBe('Another Team');
    });

    it('sends local draft text as a Linear comment and clears the draft area', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const baseIssue = createIssue();
        const refreshedIssue = createIssue({
            comments: {
                nodes: [{ id: 'comment-1', body: 'Draft comment from Obsidian', user: { name: 'Jane Doe' }, createdAt: '2026-03-12T00:00:00.000Z' }]
            }
        });
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: baseIssue.id,
                linear_identifier: baseIssue.identifier,
                linear_title: baseIssue.title,
                linear_description: baseIssue.description,
                linear_status: baseIssue.state.name,
                linear_team: baseIssue.team.name,
                linear_team_id: baseIssue.team.id,
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody({ draftText: 'Draft comment from Obsidian' }),
            Date.parse('2026-03-11T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, addCommentMock } = registerClientMocks(workspace.apiKey, baseIssue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValueOnce(baseIssue).mockResolvedValueOnce(refreshedIssue);

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();

        expect(addCommentMock).toHaveBeenCalledWith(baseIssue.id, 'Draft comment from Obsidian');
        expect(file.content).toContain('# Comments');
        expect(file.content).toContain('Draft comment from Obsidian');
        expect(file.content).not.toContain('--- Synced to Linear at Never ---\nDraft comment from Obsidian');
        expect(file.content).toMatch(/--- Synced to Linear at .* ---/);
    });

    it('does not push freshly synced notes back on the next sync', async () => {
        const workspace = createWorkspace();
        const initialIssue = createIssue({
            title: 'Initial title',
            description: 'Initial description'
        });
        const pulledIssue = createIssue({
            title: 'Pulled title',
            description: 'Pulled description',
            updatedAt: '2026-03-05T00:00:00.000Z'
        });
        const app = createMockApp();
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, updateIssueMock } = registerClientMocks(workspace.apiKey, initialIssue);
        getIssuesMock.mockResolvedValueOnce([initialIssue]).mockResolvedValueOnce([pulledIssue]);

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();
        await manager.syncAll();

        expect(updateIssueMock).not.toHaveBeenCalled();
        const file = app.vault.getMarkdownFiles()[0];
        expect(file.frontmatter).toEqual(expect.objectContaining({
            linear_title: 'Pulled title',
            linear_description: 'Pulled description'
        }));
    });

    it('refreshes tracked issues for comment-only remote changes', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const baseIssue = createIssue();
        const refreshedIssue = createIssue({
            comments: {
                nodes: [{ id: 'comment-2', body: 'Remote comment only', user: { name: 'Jane Doe' }, createdAt: '2026-03-12T00:00:00.000Z' }]
            }
        });
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: baseIssue.id,
                linear_identifier: baseIssue.identifier,
                linear_title: baseIssue.title,
                linear_description: baseIssue.description,
                linear_status: baseIssue.state.name,
                linear_team: baseIssue.team.name,
                linear_team_id: baseIssue.team.id,
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody(),
            Date.parse('2026-03-09T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, updateIssueMock } = registerClientMocks(workspace.apiKey, baseIssue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(refreshedIssue);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(getIssueByIdMock).toHaveBeenCalledWith(baseIssue.id);
        expect(updateIssueMock).not.toHaveBeenCalled();
        expect(result.updated).toBe(1);
        expect(file.content).toContain('Remote comment only');
    });

    it('repairs missing managed sections on linked notes during sync', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: issue.id,
                linear_identifier: issue.identifier,
                linear_title: issue.title,
                linear_description: issue.description,
                linear_status: issue.state.name,
                linear_team: issue.team.name,
                linear_team_id: issue.team.id,
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            '## Linear Issue\n\n[ENG-1](https://linear.app/issue/ENG-1)\n\n## Comments\n\n*No comments yet.*\n',
            Date.parse('2026-03-09T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock } = registerClientMocks(workspace.apiKey, issue);
        getIssuesMock.mockResolvedValue([issue]);

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();

        expect(file.content).toContain('# Document');
        expect(file.content).toContain('# New Comment');
        expect(file.content).toContain('# Comments');
    });

    it('creates an issue document from inline document text', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: issue.id,
                linear_identifier: issue.identifier,
                linear_title: issue.title,
                linear_description: issue.description,
                linear_status: issue.state.name,
                linear_team: issue.team.name,
                linear_team_id: issue.team.id,
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody({ documentText: 'Inline document body' }),
            Date.parse('2026-03-11T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, createIssueDocumentMock } = registerClientMocks(workspace.apiKey, issue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(issue);
        createIssueDocumentMock.mockResolvedValue({
            id: 'document-42',
            title: 'ENG-1',
            content: 'Inline document body',
            updatedAt: '2026-03-12T00:00:00.000Z',
            url: 'https://linear.app/document/document-42'
        });

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();

        expect(createIssueDocumentMock).toHaveBeenCalledWith(issue.id, 'ENG-1', 'Inline document body');
        expect(file.frontmatter).toEqual(expect.objectContaining({
            linear_document_id: 'document-42',
            linear_document_title: 'ENG-1',
            linear_document_updated: '2026-03-12T00:00:00.000Z',
            linear_document_source_path: ''
        }));
    });

    it('updates an issue document when the linked source note changes', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const issueNote = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: issue.id,
                linear_identifier: issue.identifier,
                linear_title: issue.title,
                linear_description: issue.description,
                linear_status: issue.state.name,
                linear_team: issue.team.name,
                linear_team_id: issue.team.id,
                linear_document_id: 'document-1',
                linear_document_source_path: 'Docs/Source Note.md',
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody({ documentText: '[[Source Note]]' }),
            Date.parse('2026-03-09T00:00:00.000Z')
        );
        const sourceNote = createFile(
            'Docs/Source Note.md',
            undefined,
            '# Source Note\n\nUpdated source body',
            Date.parse('2026-03-11T00:00:00.000Z')
        );
        const app = createMockApp([issueNote, sourceNote]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, updateIssueDocumentMock } = registerClientMocks(workspace.apiKey, issue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(issue);
        updateIssueDocumentMock.mockResolvedValue({
            id: 'document-1',
            title: 'Source Note',
            content: '# Source Note\n\nUpdated source body',
            updatedAt: '2026-03-12T00:00:00.000Z',
            url: 'https://linear.app/document/document-1'
        });

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();

        expect(updateIssueDocumentMock).toHaveBeenCalledWith(
            'document-1',
            issue.id,
            'Source Note',
            '# Source Note\n\nUpdated source body'
        );
        expect(issueNote.frontmatter).toEqual(expect.objectContaining({
            linear_document_id: 'document-1',
            linear_document_title: 'Source Note',
            linear_document_source_path: 'Docs/Source Note.md'
        }));
    });

    it('reports invalid document wikilinks without mutating the remote document', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const issue = createIssue();
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: issue.id,
                linear_identifier: issue.identifier,
                linear_title: issue.title,
                linear_description: issue.description,
                linear_status: issue.state.name,
                linear_team: issue.team.name,
                linear_team_id: issue.team.id,
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody({ documentText: '[[Missing Note]]' }),
            Date.parse('2026-03-11T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, createIssueDocumentMock, updateIssueDocumentMock } = registerClientMocks(workspace.apiKey, issue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(issue);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(createIssueDocumentMock).not.toHaveBeenCalled();
        expect(updateIssueDocumentMock).not.toHaveBeenCalled();
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Unable to resolve linked document note')
        ]));
    });

    it('clears the remote project when local project frontmatter is emptied', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const remoteIssue = createIssue();
        const app = createMockApp([
            createFile(
                'Linear/Workspace 1/ENG-1.md',
                {
                    linear_workspace_id: workspace.id,
                    linear_id: remoteIssue.id,
                    linear_identifier: remoteIssue.identifier,
                    linear_title: remoteIssue.title,
                    linear_description: remoteIssue.description,
                    linear_status: remoteIssue.state.name,
                    linear_project: '',
                    linear_project_id: '',
                    linear_team: remoteIssue.team.name,
                    linear_team_id: remoteIssue.team.id,
                    linear_last_synced: '2026-03-10T00:00:00.000Z'
                },
                createManagedBody(),
                Date.parse('2026-03-11T00:00:00.000Z')
            )
        ]);
        const updatedIssue = createIssue({ project: undefined });
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, updateIssueMock } = registerClientMocks(workspace.apiKey, remoteIssue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(remoteIssue);
        updateIssueMock.mockResolvedValue(updatedIssue);

        const manager = new SyncManager(app as never, settings, plugin);
        await manager.syncAll();

        expect(updateIssueMock).toHaveBeenCalledWith(remoteIssue.id, expect.objectContaining({
            projectId: null
        }));
        const file = app.vault.getMarkdownFiles()[0];
        expect(file.frontmatter).toEqual(expect.objectContaining({
            linear_project: '',
            linear_project_id: ''
        }));
    });

    it('reports an unknown local project and skips the remote update', async () => {
        const workspace = createWorkspace({ lastSyncTime: '2026-03-10T00:00:00.000Z' });
        const remoteIssue = createIssue();
        const file = createFile(
            'Linear/Workspace 1/ENG-1.md',
            {
                linear_workspace_id: workspace.id,
                linear_id: remoteIssue.id,
                linear_identifier: remoteIssue.identifier,
                linear_title: remoteIssue.title,
                linear_description: remoteIssue.description,
                linear_status: remoteIssue.state.name,
                linear_project: 'Unknown Project',
                linear_project_id: '',
                linear_team: remoteIssue.team.name,
                linear_team_id: remoteIssue.team.id,
                linear_last_synced: '2026-03-10T00:00:00.000Z'
            },
            createManagedBody(),
            Date.parse('2026-03-11T00:00:00.000Z')
        );
        const app = createMockApp([file]);
        const plugin = { saveSettings: jest.fn(async () => undefined) };
        const settings = createSettings([workspace]);
        const { getIssuesMock, getIssueByIdMock, updateIssueMock } = registerClientMocks(workspace.apiKey, remoteIssue);
        getIssuesMock.mockResolvedValue([]);
        getIssueByIdMock.mockResolvedValue(remoteIssue);

        const manager = new SyncManager(app as never, settings, plugin);
        const result = await manager.syncAll();

        expect(updateIssueMock).not.toHaveBeenCalled();
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Unknown project')
        ]));
    });
});
