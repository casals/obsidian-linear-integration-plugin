import { assert, assertCommentMirrored, assertIssueMirrored, assertManagedNoteShape, assertWorkspaceBinding } from '../lib/assert';
import { readNoteFromDisk } from '../lib/note';
import { CaseDefinition, E2EContext, LinearIssue, WorkspaceRuntime } from '../types';

export const cases: CaseDefinition[] = [
    {
        id: 'WS-001',
        name: 'Create issues from note in both workspaces',
        summary: 'Create one temporary note per workspace and drive the create-from-note flow through Obsidian.',
        smoke: true,
        run: async (context) => {
            for (const workspace of Object.values(context.shared.workspacesById)) {
                await createIssueFromNote(context, workspace);
            }
        }
    },
    {
        id: 'WS-002',
        name: 'Pull sync updates frontmatter only',
        summary: 'Remote Linear updates should sync into frontmatter while the note body stays managed.',
        smoke: true,
        run: async (context) => {
            for (const workspace of Object.values(context.shared.workspacesById)) {
                const issue = requireIssue(workspace);
                workspace.issue = await workspace.client.updateIssue(issue.id, {
                    title: `Pulled ${context.runId} ${workspace.config.name}`,
                    description: `updated-from-linear ${context.runId} ${workspace.config.name}`,
                    stateId: workspace.state.id,
                    projectId: workspace.alternateProject?.id ?? workspace.project?.id ?? null,
                    priority: 1,
                    labelNames: [`e2e-pull-${context.runId.toLowerCase()}`],
                    teamId: workspace.team.id
                });
            }

            await syncAndCapture(context, 'ws-002');

            for (const workspace of Object.values(context.shared.workspacesById)) {
                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                assertManagedNoteShape(note);
                assertWorkspaceBinding(note.frontmatter, workspace);
                assertIssueMirrored(note.frontmatter, requireIssue(workspace));
                assert(!note.body.includes(requireIssue(workspace).description ?? ''), 'Managed body should not inline the issue description');
            }
        }
    },
    {
        id: 'WS-003',
        name: 'Push local frontmatter edits back to Linear',
        summary: 'Local frontmatter changes should be pushed back on the next sync and then normalized.',
        smoke: true,
        run: async (context) => {
            for (const workspace of Object.values(context.shared.workspacesById)) {
                await updateFrontmatterFields(context, workspace.tempNotePath, {
                    linear_title: `Pushed ${context.runId} ${workspace.config.name}`,
                    linear_description: `updated-from-obsidian ${context.runId} ${workspace.config.name}`,
                    linear_status: workspace.state.name,
                    linear_project: workspace.project?.name ?? '',
                    linear_project_id: '',
                    linear_priority: 2,
                    linear_labels: [`e2e-push-${context.runId.toLowerCase()}`, workspace.config.name.toLowerCase()]
                });
            }

            await syncAndCapture(context, 'ws-003');

            for (const workspace of Object.values(context.shared.workspacesById)) {
                const refreshed = await workspace.client.getIssueById(requireIssue(workspace).id);
                assert(refreshed, `Expected issue ${requireIssue(workspace).id} to exist`);
                workspace.issue = refreshed;

                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                assertIssueMirrored(note.frontmatter, refreshed);
                assertManagedNoteShape(note);
            }
        }
    },
    {
        id: 'WS-004',
        name: 'Reject local team edits',
        summary: 'Changing linear_team locally must be rejected and must not move the remote issue.',
        smoke: false,
        run: async (context) => {
            const [first, second] = Object.values(context.shared.workspacesById);
            await updateFrontmatterFields(context, first.tempNotePath, {
                linear_team: second.team.name
            });
            await syncAndCapture(context, 'ws-004');

            const note = await readNoteFromDisk(context.options.vaultPath, first.tempNotePath);
            assert(note.frontmatter.linear_team === second.team.name, 'The local forbidden edit should still be visible before normalization');

            const remote = await first.client.getIssueById(requireIssue(first).id);
            assert(remote?.team.id === first.team.id, 'Remote issue team changed unexpectedly');

            await updateFrontmatterFields(context, first.tempNotePath, {
                linear_team: first.team.name,
                linear_team_id: first.team.id
            });
            await syncAndCapture(context, 'ws-004-recover');
        }
    },
    {
        id: 'WS-005',
        name: 'Sync local draft comments to Linear',
        summary: 'Draft text in the managed note body should become exactly one Linear comment and then clear.',
        smoke: true,
        run: async (context) => {
            for (const workspace of Object.values(context.shared.workspacesById)) {
                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                const draft = `Local draft comment ${context.runId} ${workspace.config.name}`;
                const nextBody = note.body.replace(
                    /(^#{1,2} New Comment\s*\n+--- Synced to Linear at .*? ---\n+)/m,
                    `$1${draft}\n\n`
                );

                await writeManagedBody(context, workspace.tempNotePath, note.raw, nextBody);
            }

            await syncAndCapture(context, 'ws-005');

            for (const workspace of Object.values(context.shared.workspacesById)) {
                const refreshed = await workspace.client.getIssueById(requireIssue(workspace).id);
                assert(refreshed, `Expected issue ${requireIssue(workspace).id} to exist`);
                workspace.issue = refreshed;

                const expectedComment = `Local draft comment ${context.runId} ${workspace.config.name}`;
                assert(refreshed.comments?.nodes.some(comment => comment.body.includes(expectedComment)), 'Draft comment did not reach Linear');

                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                assert(!extractDraftSection(note.body).includes(expectedComment), 'Draft comment should be cleared from the local draft section after sync');
                assertCommentMirrored(note, expectedComment);
            }
        }
    },
    {
        id: 'WS-006',
        name: 'Mirror remote comments back to notes',
        summary: 'Remote Linear comments should appear in the managed comments section without affecting the draft area.',
        smoke: true,
        run: async (context) => {
            for (const workspace of Object.values(context.shared.workspacesById)) {
                const expectedComment = `Remote comment ${context.runId} ${workspace.config.name}`;
                await workspace.client.addComment(requireIssue(workspace).id, expectedComment);
                await waitForRemoteComment(workspace, expectedComment);
            }

            await syncAndCapture(context, 'ws-006');

            for (const workspace of Object.values(context.shared.workspacesById)) {
                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                assertCommentMirrored(note, `Remote comment ${context.runId} ${workspace.config.name}`);
                assert(/#{1,2} New Comment[\s\S]*?#{1,2} Comments/m.test(note.body), 'Managed comment sections are malformed');
            }
        }
    },
    {
        id: 'WS-007',
        name: 'Preserve workspace isolation',
        summary: 'Different workspace updates must stay on their own notes and not create duplicates.',
        smoke: false,
        run: async (context) => {
            const workspaces = Object.values(context.shared.workspacesById);
            for (const workspace of workspaces) {
                workspace.issue = await workspace.client.updateIssue(requireIssue(workspace).id, {
                    title: `Isolation ${context.runId} ${workspace.config.name}`,
                    description: `Isolation description ${context.runId} ${workspace.config.name}`,
                    teamId: workspace.team.id
                });
            }

            await syncAndCapture(context, 'ws-007');

            const issuesById = new Map<string, number>();
            for (const workspace of workspaces) {
                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                assertWorkspaceBinding(note.frontmatter, workspace);
                assertIssueMirrored(note.frontmatter, requireIssue(workspace));
                const issueId = String(note.frontmatter.linear_id);
                issuesById.set(issueId, (issuesById.get(issueId) ?? 0) + 1);
            }

            for (const [issueId, count] of issuesById.entries()) {
                assert(count === 1, `Expected exactly one note bound to issue ${issueId}, found ${count}`);
            }
        }
    },
    {
        id: 'WS-008',
        name: 'Sanity check existing sync state',
        summary: 'Ensure the configured workspaces still sync cleanly without duplicate test notes or plugin errors.',
        smoke: false,
        run: async (context) => {
            const before = await context.obsidian.evalJson<Array<{ path: string; linearId?: string; workspaceId?: string }>>(
                `
                    const files = app.vault.getMarkdownFiles();
                    const result = files
                        .map((file) => {
                            const cache = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
                            return {
                                path: file.path,
                                linearId: cache.linear_id,
                                workspaceId: cache.linear_workspace_id
                            };
                        })
                        .filter((entry) => entry.linearId && entry.workspaceId);
                    JSON.stringify(result);
                `
            );

            await syncAndCapture(context, 'ws-008');

            const after = await context.obsidian.evalJson<Array<{ path: string; linearId?: string; workspaceId?: string }>>(
                `
                    const files = app.vault.getMarkdownFiles();
                    const result = files
                        .map((file) => {
                            const cache = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
                            return {
                                path: file.path,
                                linearId: cache.linear_id,
                                workspaceId: cache.linear_workspace_id
                            };
                        })
                        .filter((entry) => entry.linearId && entry.workspaceId);
                    JSON.stringify(result);
                `
            );

            for (const workspace of Object.values(context.shared.workspacesById)) {
                assert(after.some(entry => entry.path === workspace.tempNotePath), `Expected test note ${workspace.tempNotePath} to remain indexed`);
            }

            assert(after.length >= before.length, 'Linked note count unexpectedly decreased after sanity sync');
        }
    },
    {
        id: 'WS-010',
        name: 'Repair missing managed sections',
        summary: 'Linked issue notes missing Document or New Comment sections should be normalized on the next sync.',
        smoke: false,
        run: async (context) => {
            const workspaces = Object.values(context.shared.workspacesById);
            for (const [index, workspace] of workspaces.entries()) {
                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                const nextBody = index % 2 === 0
                    ? note.body.replace(/#{1,2} Document\s*[\s\S]*?#{1,2} New Comment/m, '# New Comment')
                    : note.body.replace(/#{1,2} New Comment\s*[\s\S]*?#{1,2} Comments/m, '# Comments');

                await writeManagedBody(context, workspace.tempNotePath, note.raw, nextBody);
            }

            await syncAndCapture(context, 'ws-010');

            for (const workspace of workspaces) {
                const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
                assertManagedNoteShape(note);
            }
        }
    },
    {
        id: 'WS-011',
        name: 'Show sync summary notice',
        summary: 'A top-level Obsidian sync command should display the verbose sync summary notice.',
        smoke: false,
        run: async (context) => {
            const notices = await runSyncCommandAndCaptureNotices(context, 'ws-011');
            const summaryNotice = notices.find(notice =>
                notice.includes('Linear Integration') &&
                notice.includes('Created:') &&
                notice.includes('Updated:') &&
                notice.includes('Conflicts:') &&
                notice.includes('Errors:')
            );

            assert(summaryNotice, 'Expected the sync command to emit a summary notice');
            assert(summaryNotice.includes('Linear Integration'), 'Summary notice is missing the plugin title');
            assert(/Created:\s+\d+/.test(summaryNotice), 'Summary notice is missing the created count');
            assert(/Updated:\s+\d+/.test(summaryNotice), 'Summary notice is missing the updated count');
            assert(/Conflicts:\s+\d+/.test(summaryNotice), 'Summary notice is missing the conflict count');
            assert(/Errors:\s+\d+/.test(summaryNotice), 'Summary notice is missing the error count');
        }
    }
];

async function createIssueFromNote(context: E2EContext, workspace: WorkspaceRuntime): Promise<void> {
    const label = `e2e-${context.runId.toLowerCase()}`;
    const noteContent = [
        `# E2E ${workspace.config.name} ${context.runId}`,
        '',
        `@team/${workspace.team.name}`,
        `@status/${workspace.state.name}`,
        '@priority/2',
        `@label/${label}`,
        '',
        `seed-from-obsidian ${context.runId} ${workspace.config.name}`,
        '',
        'This note is created by the automated Obsidian CLI E2E suite.'
    ].join('\n');

    await context.obsidian.create(workspace.tempNotePath, noteContent, true);
    context.shared.localNotes.push(workspace.tempNotePath);
    await context.snapshotNote(`before-${workspace.config.name}`, workspace.tempNotePath);
    await waitForIndexedFile(context, workspace.tempNotePath);
    await context.obsidian.eval(
        `
            (async () => {
                const plugin = app.plugins.plugins["${context.options.pluginId}"];
                if (!plugin) throw new Error("Plugin not loaded");
                const workspace = plugin.settings.workspaces.find((entry) => entry.id === ${JSON.stringify(workspace.config.id)});
                if (!workspace) throw new Error("Workspace not found");
                workspace.defaultAssigneeId = ${JSON.stringify(workspace.user?.id ?? '')} || undefined;
                workspace.defaultProjectId = ${JSON.stringify(workspace.project?.id ?? '')} || undefined;
                await plugin.saveSettings();
                return JSON.stringify({ configured: true });
            })()
        `
    );

    const modalState = await context.obsidian.evalJson<{ modalText: string }>(
        `
            (async () => {
                const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
                const plugin = app.plugins.plugins["${context.options.pluginId}"];
                const file = app.vault.getAbstractFileByPath(${JSON.stringify(workspace.tempNotePath)});
                let modalPayload = null;
                if (!plugin) throw new Error("Plugin not loaded");
                if (!file) throw new Error("Test note not found");

                for (const element of Array.from(document.querySelectorAll('.modal button'))) {
                    if (element.textContent?.trim() === 'Cancel') {
                        element.click();
                    }
                }

                plugin.settings.defaultWorkspaceId = ${JSON.stringify(workspace.config.id)};
                await plugin.createIssueFromNote(file);

                for (let attempt = 0; attempt < 60; attempt++) {
                    const modal = document.querySelector('.modal, .modal-container');
                    const button = Array.from(document.querySelectorAll('button'))
                        .find((candidate) => candidate.textContent?.trim() === 'Create issue');

                    if (modal && button) {
                        const modalText = modal.textContent ?? '';
                        modalPayload = JSON.stringify({ modalText });
                        break;
                    }

                    await sleep(500);
                }

                if (!modalPayload) {
                    throw new Error('Timed out waiting for the Create Linear Issue modal');
                }

                return modalPayload;
            })()
        `
    );

    await context.captureArtifact(`ws-001/modal-${workspace.config.name}.txt`, modalState.modalText);

    const createResult = await context.obsidian.evalJson<{ clicked: boolean; linearId: string }>(
        `
            (async () => {
                const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
                const button = Array.from(document.querySelectorAll('button'))
                    .find((candidate) => candidate.textContent?.trim() === 'Create issue');
                let result = null;
                if (!button) throw new Error('Create issue button not found');
                button.click();

                for (let attempt = 0; attempt < 120; attempt++) {
                    const file = app.vault.getAbstractFileByPath(${JSON.stringify(workspace.tempNotePath)});
                    const linearId = app.metadataCache.getFileCache(file)?.frontmatter?.linear_id;
                    if (linearId) {
                        result = JSON.stringify({ clicked: true, linearId });
                        break;
                    }
                    await sleep(500);
                }

                if (!result) {
                    throw new Error('Timed out waiting for the note frontmatter to receive linear_id');
                }

                return result;
            })()
        `
    );

    await syncAndCapture(context, `ws-001-${workspace.config.name.toLowerCase()}`);
    const note = await readNoteFromDisk(context.options.vaultPath, workspace.tempNotePath);
    await context.captureArtifact(`ws-001/note-${workspace.config.name}.md`, note.raw);
    assertManagedNoteShape(note);
    assertWorkspaceBinding(note.frontmatter, workspace);
    assert(note.frontmatter.linear_title === `E2E ${workspace.config.name} ${context.runId}`, 'Expected linear_title to mirror the source note title');
    assert(String(note.frontmatter.linear_description).includes(`seed-from-obsidian ${context.runId}`), 'Expected description to contain the note body');
    assert(!String(note.frontmatter.linear_description).includes('@team/'), 'Expected description to strip inline tags');
    if (workspace.user) {
        assert(note.frontmatter.linear_assignee_id === workspace.user.id, 'Expected workspace default assignee to populate the created issue');
    } else {
        assert(!note.frontmatter.linear_assignee_id, 'Expected issue to stay unassigned when the workspace team has no human assignee candidate');
    }
    if (workspace.project) {
        assert(note.frontmatter.linear_project_id === workspace.project.id, 'Expected workspace default project to populate the created issue');
    } else {
        assert(!note.frontmatter.linear_project_id, 'Expected project to stay empty when the workspace has no available projects');
    }

    const issueId = createResult.linearId;
    const issue = await workspace.client.getIssueById(issueId);
    assert(issue, `Expected Linear issue ${issueId} to exist`);
    workspace.issue = issue;
    context.shared.remoteIssues.push({ workspaceId: workspace.config.id, issueId });

    await context.snapshotNote(`after-${workspace.config.name}`, workspace.tempNotePath);
}

async function syncAndCapture(context: E2EContext, artifactPrefix: string): Promise<void> {
    await context.obsidian.eval(
        `
            (async () => {
                const plugin = app.plugins.plugins["${context.options.pluginId}"];
                if (!plugin) throw new Error("Plugin not loaded");
                await plugin.syncManager.syncAll();
                return JSON.stringify({ synced: true });
            })()
        `
    );

    await context.captureArtifact(`${artifactPrefix}/dev-errors.txt`, await context.obsidian.getErrors());
    await context.captureArtifact(`${artifactPrefix}/console-errors.txt`, await context.obsidian.getConsole('error'));
}

async function runSyncCommandAndCaptureNotices(context: E2EContext, artifactPrefix: string): Promise<string[]> {
    await context.obsidian.eval(
        `
            (async () => {
                const commandId = "${context.options.pluginId}:sync-linear-issues";
                const plugin = app.plugins.plugins["${context.options.pluginId}"];
                if (!plugin) throw new Error("Plugin not loaded");

                const command = app.commands.commands[commandId];
                if (!command || typeof command.callback !== "function") {
                    throw new Error("Sync command callback not found");
                }

                await command.callback();
                await new Promise((resolve) => setTimeout(resolve, 300));
                return JSON.stringify({ completed: true });
            })()
        `
    );

    const summaryNotice = await context.obsidian.evalJson<string | null>(
        `
            (() => {
                const plugin = app.plugins.plugins["${context.options.pluginId}"];
                return JSON.stringify(plugin?.getLastSyncSummaryNotice?.() ?? null);
            })()
        `
    );
    const notices = summaryNotice ? [summaryNotice] : [];

    await context.captureArtifact(`${artifactPrefix}/notices.json`, JSON.stringify(notices, null, 2));
    await context.captureArtifact(`${artifactPrefix}/dev-errors.txt`, await context.obsidian.getErrors());
    await context.captureArtifact(`${artifactPrefix}/console-errors.txt`, await context.obsidian.getConsole('error'));
    return notices;
}

function requireIssue(workspace: WorkspaceRuntime): LinearIssue {
    if (!workspace.issue) {
        throw new Error(`Workspace ${workspace.config.name} does not have a test issue yet`);
    }
    return workspace.issue;
}

async function writeManagedBody(context: E2EContext, vaultRelativePath: string, originalRaw: string, newBody: string): Promise<void> {
    const frontmatterMatch = originalRaw.match(/^(---\n[\s\S]*?\n---\n?)/);
    const nextContent = `${frontmatterMatch?.[1] ?? ''}${newBody.endsWith('\n') ? newBody : `${newBody}\n`}`;
    await context.obsidian.eval(
        `
            (async () => {
                const file = app.vault.getAbstractFileByPath(${JSON.stringify(vaultRelativePath)});
                if (!file) throw new Error("File not found: ${vaultRelativePath}");
                await app.vault.modify(file, ${JSON.stringify(nextContent)});
                await app.fileManager.processFrontMatter(file, (frontmatter) => {
                    frontmatter.linear_last_synced = '1970-01-01T00:00:00.000Z';
                });
                return JSON.stringify({ modified: true });
            })()
        `
    );
}

async function updateFrontmatterFields(
    context: E2EContext,
    vaultRelativePath: string,
    updates: Record<string, string | number | string[]>
): Promise<void> {
    await context.obsidian.eval(
        `
            (async () => {
                const file = app.vault.getAbstractFileByPath(${JSON.stringify(vaultRelativePath)});
                if (!file) throw new Error("File not found: ${vaultRelativePath}");
                await app.fileManager.processFrontMatter(file, (frontmatter) => {
                    const updates = ${JSON.stringify(updates)};
                    Object.entries(updates).forEach(([key, value]) => {
                        frontmatter[key] = value;
                    });
                    frontmatter.linear_last_synced = '1970-01-01T00:00:00.000Z';
                });
                return JSON.stringify({ updated: true });
            })()
        `
    );
}

async function waitForIndexedFile(context: E2EContext, vaultRelativePath: string): Promise<void> {
    await context.obsidian.eval(
        `
            (async () => {
                const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
                const file = app.vault.getAbstractFileByPath(${JSON.stringify(vaultRelativePath)});
                if (!file) throw new Error("File not found: ${vaultRelativePath}");

                for (let attempt = 0; attempt < 60; attempt++) {
                    if (app.metadataCache.getFileCache(file)) {
                        return JSON.stringify({ indexed: true });
                    }
                    await sleep(250);
                }

                throw new Error('Timed out waiting for the file to be indexed by Obsidian');
            })()
        `
    );
}

function extractDraftSection(body: string): string {
    const match = body.match(/#{1,2} New Comment\s*([\s\S]*?)#{1,2} Comments/);
    return match?.[1] ?? '';
}

async function waitForRemoteComment(workspace: WorkspaceRuntime, expectedComment: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
        const issue = await workspace.client.getIssueById(requireIssue(workspace).id);
        if (issue?.comments?.nodes.some(comment => comment.body.includes(expectedComment))) {
            workspace.issue = issue;
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for remote comment propagation on ${workspace.config.name}`);
}
