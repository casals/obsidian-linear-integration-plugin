import { App, Notice, TFile } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { LinearIssue, LinearPluginSettings, LinearWorkspace, NoteFrontmatter, SyncResult } from '../models/types';
import { MarkdownParser } from '../parsers/markdown-parser';
import { parseFrontmatter, replaceNoteBody, updateFrontmatter } from '../utils/frontmatter';
import {
    DEFAULT_COMMENT_SYNC_LABEL,
    ManagedNoteState,
    DOCUMENT_SECTION,
    parseManagedNoteState,
    renderManagedNoteBody
} from '../utils/synced-note';

interface IndexedNote {
    file: TFile;
    frontmatter: NoteFrontmatter;
    inSyncFolder: boolean;
}

interface LocalPushOutcome {
    issue: LinearIssue;
    managedState?: ManagedNoteState;
    frontmatterUpdates?: Partial<NoteFrontmatter>;
    skipPull: boolean;
    error?: string;
}

interface ResolvedDocumentSource {
    content: string;
    sourcePath: string;
    title: string;
}

export class SyncManager {
    constructor(
        private app: App,
        private settings: LinearPluginSettings,
        private plugin: any
    ) {}

    async syncAll(): Promise<SyncResult> {
        const result: SyncResult = { created: 0, updated: 0, errors: [], conflicts: [] };
        const enabled = this.settings.workspaces.filter(w => w.enabled);
        if (enabled.length === 0) return result;

        const settled = await Promise.allSettled(enabled.map(w => this.syncWorkspace(w)));

        settled.forEach((r, i) => {
            if (r.status === 'fulfilled') {
                result.created += r.value.created;
                result.updated += r.value.updated;
                result.errors.push(...r.value.errors);
                result.conflicts.push(...r.value.conflicts);
            } else {
                result.errors.push(`[${enabled[i].id}] Sync failed: ${r.reason}`);
            }
        });

        return result;
    }

    async updateNoteWithIssue(
        file: TFile,
        issue: LinearIssue,
        workspace: LinearWorkspace,
        managedState?: ManagedNoteState,
        frontmatterPatch: Partial<NoteFrontmatter> = {}
    ): Promise<boolean> {
        const frontmatter = await this.getFrontmatter(file);
        const isNewNote = !frontmatter.linear_id && !frontmatter.linear_identifier;
        const syncTimestamp = this.createBufferedSyncTimestamp();
        const currentContent = await this.app.vault.read(file);
        const nextManagedState = managedState ?? parseManagedNoteState(currentContent);
        const nextBody = renderManagedNoteBody(issue, nextManagedState, this.settings.includeComments);

        const updatedFrontmatter: NoteFrontmatter = {
            ...frontmatter,
            linear_workspace_id: workspace.id,
            linear_id: issue.id,
            linear_identifier: issue.identifier,
            linear_title: issue.title,
            linear_description: issue.description || '',
            linear_status: issue.state.name,
            linear_status_id: issue.state.id,
            linear_assignee: issue.assignee?.name || '',
            linear_assignee_id: issue.assignee?.id || '',
            linear_project: issue.project?.name || '',
            linear_project_id: issue.project?.id || '',
            linear_team: issue.team.name,
            linear_team_id: issue.team.id,
            linear_url: issue.url,
            linear_created: issue.createdAt,
            linear_updated: issue.updatedAt,
            linear_last_synced: syncTimestamp,
            linear_priority: issue.priority,
            linear_estimate: issue.estimate,
            linear_labels: issue.labels.nodes.map(label => label.name),
            ...frontmatterPatch
        };

        await replaceNoteBody(this.app, file, nextBody);
        await updateFrontmatter(this.app, file, updatedFrontmatter);

        return isNewNote;
    }

    async getFrontmatter(file: TFile): Promise<NoteFrontmatter> {
        return parseFrontmatter(this.app, file);
    }

    async getLinearIdFromNote(file: TFile): Promise<string | null> {
        const frontmatter = await this.getFrontmatter(file);
        return frontmatter.linear_id || null;
    }

    private async syncWorkspace(workspace: LinearWorkspace): Promise<SyncResult> {
        const result: SyncResult = { created: 0, updated: 0, errors: [], conflicts: [] };
        const client = new LinearClient(workspace.apiKey);

        try {
            await this.ensureSyncFolder(workspace.syncFolder);

            const linkedNotes = this.indexLinkedNotes(workspace.syncFolder);
            const shouldBootstrap = this.shouldBootstrapWorkspace(workspace, linkedNotes);
            const updatedAfter = shouldBootstrap ? undefined : workspace.lastSyncTime;
            const fetchedIssues = await this.getIssuesForWorkspace(client, workspace, updatedAfter);
            const issueMap = new Map(fetchedIssues.map(issue => [issue.id, issue]));
            await this.hydrateTrackedIssuesForComments(client, linkedNotes, workspace, issueMap);
            const skippedIssueIds = new Set<string>();
            const managedStateByIssueId = new Map<string, ManagedNoteState>();
            const frontmatterUpdatesByIssueId = new Map<string, Partial<NoteFrontmatter>>();

            const modifiedNotes = this.getLocallyModifiedNotes(linkedNotes, workspace.id);
            for (const note of modifiedNotes) {
                const issueId = note.frontmatter.linear_id;
                if (!issueId) continue;

                let issue = issueMap.get(issueId);
                if (!issue) {
                    issue = await client.getIssueById(issueId) ?? undefined;
                }
                if (!issue) continue;

                const pushOutcome = await this.pushLocalChanges(client, note, issue, workspace);
                issueMap.set(pushOutcome.issue.id, pushOutcome.issue);

                if (pushOutcome.managedState) {
                    managedStateByIssueId.set(pushOutcome.issue.id, pushOutcome.managedState);
                }

                if (pushOutcome.frontmatterUpdates) {
                    frontmatterUpdatesByIssueId.set(pushOutcome.issue.id, pushOutcome.frontmatterUpdates);
                }

                if (pushOutcome.skipPull) {
                    skippedIssueIds.add(pushOutcome.issue.id);
                }

                if (pushOutcome.error) {
                    result.errors.push(`[${workspace.id}] ${pushOutcome.error}`);
                }
            }

            workspace.lastSyncTime = new Date().toISOString();
            await this.plugin.saveSettings();

            if (issueMap.size === 0) return result;

            for (const issue of issueMap.values()) {
                if (skippedIssueIds.has(issue.id)) {
                    continue;
                }

                try {
                    const file = await this.findOrCreateNoteForIssue(issue, linkedNotes, workspace);
                    const wasCreated = await this.updateNoteWithIssue(
                        file,
                        issue,
                        workspace,
                        managedStateByIssueId.get(issue.id),
                        frontmatterUpdatesByIssueId.get(issue.id)
                    );
                    if (wasCreated) result.created++;
                    else result.updated++;
                } catch (error) {
                    result.errors.push(`[${workspace.id}] Failed to sync ${issue.identifier}: ${(error as Error).message}`);
                }
            }
        } catch (error) {
            result.errors.push(`[${workspace.id}] Sync failed: ${(error as Error).message}`);
        }

        return result;
    }

    async findOrCreateNoteForIssue(issue: LinearIssue, linkedNotes: IndexedNote[], workspace: LinearWorkspace): Promise<TFile> {
        const existing = this.findMatchingNote(issue, linkedNotes, workspace);
        if (existing) return existing;

        const filename = this.sanitizeFilename(`${issue.identifier} - ${issue.title}.md`);
        const filepath = `${workspace.syncFolder}/${filename}`;
        const content = renderManagedNoteBody(
            issue,
            { documentText: '', draftText: '', syncLabel: DEFAULT_COMMENT_SYNC_LABEL },
            this.settings.includeComments
        );
        return await this.app.vault.create(filepath, content);
    }

    private async pushLocalChanges(
        client: LinearClient,
        note: IndexedNote,
        issue: LinearIssue,
        workspace: LinearWorkspace
    ): Promise<LocalPushOutcome> {
        if (this.hasForbiddenTeamChange(note.frontmatter, issue)) {
            const message = `Team changes must be made in Linear: ${issue.identifier}`;
            new Notice(message);
            return { issue, skipPull: true, error: message };
        }

        const content = await this.app.vault.read(note.file);
        const managedState = parseManagedNoteState(content);
        const updates = await this.buildIssueUpdatePayload(client, note.frontmatter, issue, workspace);
        const frontmatterUpdates: Partial<NoteFrontmatter> = {};
        let documentSyncError: string | undefined;

        let nextIssue = issue;
        if (Object.keys(updates).length > 0) {
            nextIssue = await client.updateIssue(issue.id, updates);
        }

        try {
            Object.assign(
                frontmatterUpdates,
                await this.syncIssueDocument(client, note, issue.id, managedState)
            );
        } catch (error) {
            documentSyncError = `Failed to sync issue document for ${issue.identifier}: ${(error as Error).message}`;
        }

        if (managedState.draftText.trim()) {
            await client.addCommentToIssue(issue.id, managedState.draftText.trim());
            const refreshedIssue = await client.getIssueById(issue.id);
            if (refreshedIssue) {
                nextIssue = refreshedIssue;
            }

            return {
                issue: nextIssue,
                managedState: {
                    documentText: managedState.documentText,
                    draftText: '',
                    syncLabel: new Date().toLocaleString()
                },
                frontmatterUpdates,
                skipPull: false,
                error: documentSyncError
            };
        }

        if (Object.keys(updates).length > 0) {
            return {
                issue: nextIssue,
                managedState,
                frontmatterUpdates,
                skipPull: false,
                error: documentSyncError
            };
        }

        return {
            issue,
            managedState,
            frontmatterUpdates,
            skipPull: false,
            error: documentSyncError
        };
    }

    private async buildIssueUpdatePayload(
        client: LinearClient,
        frontmatter: NoteFrontmatter,
        issue: LinearIssue,
        workspace: LinearWorkspace
    ): Promise<Partial<{
        title: string;
        description: string;
        stateId: string;
        assigneeId: string | null;
        projectId: string | null;
        priority: number;
        labelNames: string[];
        teamId: string;
    }>> {
        const updates: Partial<{
            title: string;
            description: string;
            stateId: string;
            assigneeId: string | null;
            projectId: string | null;
            priority: number;
            labelNames: string[];
            teamId: string;
        }> = {};

        const localTitle = this.normalizeString(frontmatter.linear_title);
        if (frontmatter.linear_title !== undefined && localTitle !== issue.title) {
            updates.title = localTitle;
        }

        const localDescription = this.normalizeString(frontmatter.linear_description);
        if (frontmatter.linear_description !== undefined && localDescription !== (issue.description || '')) {
            updates.description = localDescription;
        }

        if (frontmatter.linear_priority !== undefined && frontmatter.linear_priority !== issue.priority) {
            updates.priority = frontmatter.linear_priority;
        }

        const localStatus = this.normalizeString(frontmatter.linear_status);
        if (frontmatter.linear_status !== undefined && localStatus !== issue.state.name) {
            const states = await client.getTeamStates(issue.team.id);
            const matchedState = states.find(state => state.name.toLowerCase() === localStatus.toLowerCase());
            if (!matchedState) {
                throw new Error(`Unknown status for ${issue.identifier}: ${localStatus}`);
            }
            updates.stateId = matchedState.id;
        }

        const localAssignee = this.normalizeString(frontmatter.linear_assignee);
        const remoteAssignee = issue.assignee?.name || '';
        if (frontmatter.linear_assignee !== undefined && localAssignee !== remoteAssignee) {
            if (!localAssignee) {
                updates.assigneeId = null;
            } else {
                const users = await client.getUsers();
                const matchedUser = users.find(user =>
                    user.name.toLowerCase() === localAssignee.toLowerCase() ||
                    user.email.toLowerCase() === localAssignee.toLowerCase()
                );
                if (!matchedUser) {
                    throw new Error(`Unknown assignee for ${issue.identifier}: ${localAssignee}`);
                }
                updates.assigneeId = matchedUser.id;
            }
        }

        const localProjectName = this.normalizeString(frontmatter.linear_project);
        const localProjectId = this.normalizeString(frontmatter.linear_project_id);
        const remoteProjectName = issue.project?.name || '';
        const remoteProjectId = issue.project?.id || '';
        if (
            frontmatter.linear_project !== undefined ||
            frontmatter.linear_project_id !== undefined
        ) {
            const localProjectMatchesRemote =
                localProjectName === remoteProjectName &&
                localProjectId === remoteProjectId;

            if (!localProjectMatchesRemote) {
                if (!localProjectName && !localProjectId) {
                    updates.projectId = null;
                } else {
                    const projects = await client.getProjects(issue.team.id);
                    const matchedProject = projects.find(project =>
                        (localProjectId && project.id === localProjectId) ||
                        project.name.toLowerCase() === localProjectName.toLowerCase()
                    );

                    if (!matchedProject) {
                        throw new Error(`Unknown project for ${issue.identifier}: ${localProjectName || localProjectId}`);
                    }

                    updates.projectId = matchedProject.id;
                }
            }
        }

        const localLabels = this.normalizeLabels(frontmatter.linear_labels);
        const remoteLabels = this.normalizeLabels(issue.labels.nodes.map(label => label.name));
        if (frontmatter.linear_labels !== undefined && !this.haveSameLabels(localLabels, remoteLabels)) {
            updates.labelNames = localLabels;
            updates.teamId = issue.team.id;
        }

        if (!workspace.teamIds.includes(issue.team.id) && workspace.teamIds.length > 0) {
            throw new Error(`Issue ${issue.identifier} is outside the configured workspace team filter.`);
        }

        return updates;
    }

    private hasForbiddenTeamChange(frontmatter: NoteFrontmatter, issue: LinearIssue): boolean {
        const localTeamName = this.normalizeString(frontmatter.linear_team);
        const localTeamId = this.normalizeString(frontmatter.linear_team_id);

        if (frontmatter.linear_team !== undefined && localTeamName !== issue.team.name) {
            return true;
        }

        if (frontmatter.linear_team_id !== undefined && localTeamId !== issue.team.id) {
            return true;
        }

        return false;
    }

    private getLocallyModifiedNotes(linkedNotes: IndexedNote[], workspaceId: string): IndexedNote[] {
        return linkedNotes.filter(note => {
            if (note.frontmatter.linear_workspace_id !== workspaceId) return false;
            if (!note.frontmatter.linear_id) return false;

            const lastSynced = Date.parse(note.frontmatter.linear_last_synced || '');
            if (Number.isNaN(lastSynced)) return true;

            if (note.file.stat.mtime > lastSynced) {
                return true;
            }

            const sourcePath = this.normalizeString(note.frontmatter.linear_document_source_path);
            if (!sourcePath) {
                return false;
            }

            const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
            return this.isMarkdownFile(sourceFile) && sourceFile.stat.mtime > lastSynced;
        });
    }

    private indexLinkedNotes(syncFolder: string): IndexedNote[] {
        return this.app.vault.getMarkdownFiles().map((file: TFile) => ({
            file,
            frontmatter: parseFrontmatter(this.app, file),
            inSyncFolder: this.isFileInSyncFolder(file.path, syncFolder)
        }));
    }

    private shouldBootstrapWorkspace(workspace: LinearWorkspace, linkedNotes: IndexedNote[]): boolean {
        if (!workspace.lastSyncTime) return true;

        return !linkedNotes.some(({ frontmatter }) =>
            frontmatter.linear_workspace_id === workspace.id &&
            Boolean(frontmatter.linear_id || frontmatter.linear_identifier)
        );
    }

    private async getIssuesForWorkspace(
        client: LinearClient,
        workspace: LinearWorkspace,
        updatedAfter?: string
    ): Promise<LinearIssue[]> {
        if (workspace.teamIds.length === 0) {
            return client.getIssues(undefined, updatedAfter);
        }

        const batches = await Promise.all(
            workspace.teamIds.map(tid => client.getIssues(tid, updatedAfter))
        );
        return batches.flat();
    }

    private async hydrateTrackedIssuesForComments(
        client: LinearClient,
        linkedNotes: IndexedNote[],
        workspace: LinearWorkspace,
        issueMap: Map<string, LinearIssue>
    ): Promise<void> {
        if (!this.settings.includeComments) {
            return;
        }

        const trackedIssueIds = linkedNotes
            .filter(({ frontmatter }) => frontmatter.linear_workspace_id === workspace.id && Boolean(frontmatter.linear_id))
            .map(({ frontmatter }) => frontmatter.linear_id as string)
            .filter(issueId => !issueMap.has(issueId));

        for (const issueId of trackedIssueIds) {
            const issue = await client.getIssueById(issueId);
            if (issue) {
                issueMap.set(issue.id, issue);
            }
        }
    }

    private findMatchingNote(issue: LinearIssue, linkedNotes: IndexedNote[], workspace: LinearWorkspace): TFile | null {
        const workspaceMatchById = linkedNotes.find(({ frontmatter }) =>
            frontmatter.linear_workspace_id === workspace.id &&
            frontmatter.linear_id === issue.id
        );
        if (workspaceMatchById) return workspaceMatchById.file;

        const workspaceMatchByIdentifier = linkedNotes.find(({ frontmatter }) =>
            frontmatter.linear_workspace_id === workspace.id &&
            frontmatter.linear_identifier === issue.identifier
        );
        if (workspaceMatchByIdentifier) return workspaceMatchByIdentifier.file;

        const legacyMatchById = linkedNotes.find(({ frontmatter, inSyncFolder }) =>
            !frontmatter.linear_workspace_id &&
            inSyncFolder &&
            frontmatter.linear_id === issue.id
        );
        if (legacyMatchById) return legacyMatchById.file;

        const legacyMatchByIdentifier = linkedNotes.find(({ frontmatter, inSyncFolder }) =>
            !frontmatter.linear_workspace_id &&
            inSyncFolder &&
            frontmatter.linear_identifier === issue.identifier
        );
        if (legacyMatchByIdentifier) return legacyMatchByIdentifier.file;

        return null;
    }

    private async ensureSyncFolder(syncFolder: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(syncFolder);
        if (!folder) {
            await this.app.vault.createFolder(syncFolder);
        }
    }

    private isFileInSyncFolder(filePath: string, syncFolder: string): boolean {
        const normalizedSyncFolder = syncFolder.replace(/\/+$/, '');
        if (!normalizedSyncFolder) return false;

        return filePath.startsWith(`${normalizedSyncFolder}/`);
    }

    private sanitizeFilename(filename: string): string {
        return filename
            .replace(/[\\/:*?"<>|]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private normalizeString(value?: string | null): string {
        return (value || '').trim();
    }

    private normalizeLabels(labels?: string[]): string[] {
        return [...new Set((labels || []).map(label => label.trim()).filter(Boolean))];
    }

    private haveSameLabels(left: string[], right: string[]): boolean {
        if (left.length !== right.length) return false;

        const normalizedLeft = left.map(label => label.toLowerCase()).sort();
        const normalizedRight = right.map(label => label.toLowerCase()).sort();
        return normalizedLeft.every((label, index) => label === normalizedRight[index]);
    }

    // Obsidian updates file mtimes after plugin-managed writes. Keep a small buffer so
    // the next sync does not immediately treat a freshly synced note as a local edit.
    private createBufferedSyncTimestamp(): string {
        return new Date(Date.now() + 5000).toISOString();
    }

    private async syncIssueDocument(
        client: LinearClient,
        note: IndexedNote,
        issueId: string,
        managedState: ManagedNoteState
    ): Promise<Partial<NoteFrontmatter>> {
        const resolved = await this.resolveDocumentSource(note, managedState);
        if (!resolved) {
            return { linear_document_source_path: '' };
        }

        const nextFrontmatter: Partial<NoteFrontmatter> = {
            linear_document_title: resolved.title,
            linear_document_source_path: resolved.sourcePath
        };

        if (!resolved.content.trim()) {
            return nextFrontmatter;
        }

        const documentId = this.normalizeString(note.frontmatter.linear_document_id);
        if (!documentId) {
            const created = await client.createIssueDocument(issueId, resolved.title, resolved.content);
            return {
                ...nextFrontmatter,
                linear_document_id: created.id,
                linear_document_title: created.title,
                linear_document_updated: created.updatedAt
            };
        }

        try {
            const updated = await client.updateIssueDocument(documentId, issueId, resolved.title, resolved.content);
            return {
                ...nextFrontmatter,
                linear_document_id: updated.id,
                linear_document_title: updated.title,
                linear_document_updated: updated.updatedAt
            };
        } catch {
            const recreated = await client.createIssueDocument(issueId, resolved.title, resolved.content);
            return {
                ...nextFrontmatter,
                linear_document_id: recreated.id,
                linear_document_title: recreated.title,
                linear_document_updated: recreated.updatedAt
            };
        }
    }

    private async resolveDocumentSource(
        note: IndexedNote,
        managedState: ManagedNoteState
    ): Promise<ResolvedDocumentSource | null> {
        const documentText = managedState.documentText.trim();
        if (!documentText) {
            return null;
        }

        const linkMatch = documentText.match(/\[\[([^\]]+)\]\]/);
        if (!linkMatch) {
            return {
                content: MarkdownParser.convertToLinearDocumentContent(documentText),
                sourcePath: '',
                title: note.file.basename
            };
        }

        const linkTarget = linkMatch[1].split('|')[0].trim();
        if (!linkTarget) {
            throw new Error(`${DOCUMENT_SECTION} contains an empty wikilink.`);
        }

        if (linkTarget.includes('#') || linkTarget.includes('^')) {
            throw new Error(`Only plain note wikilinks are supported in ${DOCUMENT_SECTION}.`);
        }

        const sourceFile = this.app.metadataCache.getFirstLinkpathDest?.(linkTarget, note.file.path);
        if (!this.isMarkdownFile(sourceFile)) {
            throw new Error(`Unable to resolve linked document note: ${linkTarget}`);
        }

        if (sourceFile.path === note.file.path) {
            throw new Error('The managed issue note cannot reference itself as the document source.');
        }

        const sourceContent = await this.app.vault.read(sourceFile);
        return {
            content: MarkdownParser.convertToLinearDocumentContent(sourceContent),
            sourcePath: sourceFile.path,
            title: sourceFile.basename
        };
    }

    private isMarkdownFile(file: unknown): file is TFile {
        return Boolean(
            file &&
            typeof (file as TFile).path === 'string' &&
            typeof (file as TFile).basename === 'string' &&
            typeof (file as TFile).extension === 'string' &&
            (file as TFile).extension === 'md'
        );
    }
}
