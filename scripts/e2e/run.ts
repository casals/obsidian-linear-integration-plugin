import fs from 'node:fs/promises';
import path from 'node:path';
import { cases as allCases } from './cases';
import { ObsidianCli } from './lib/obsidian-cli';
import { LinearApiClient } from './lib/linear-api';
import { assertFilePathInsideVault, findRunNotePaths } from './lib/note';
import { selectDefaultAssigneeCandidate } from './lib/user-selection';
import { CaseDefinition, CaseResult, E2EContext, E2EOptions, LinearState, PluginSettingsSnapshot, WorkspaceRuntime } from './types';

const DEFAULT_PLUGIN_ID = 'linear-integration';
const DEFAULT_VAULT_PATH = '/Users/yubai/Obsidian/byheaven';

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const selectedCases = selectCases(options.suite);

    if (options.suite === 'list') {
        renderCaseList(selectedCases);
        return;
    }

    const runId = createRunId();
    const pluginSettings = await loadPluginSettings(options);
    const artifactRoot = path.join('tests', 'e2e', 'artifacts', runId);
    await fs.mkdir(artifactRoot, { recursive: true });

    const obsidian = new ObsidianCli(options.vaultName);
    const shared = await buildSharedState(pluginSettings, runId);
    const results: CaseResult[] = [];
    const logLines: string[] = [];

    const context: E2EContext = {
        options,
        runId,
        pluginSettings,
        artifactRoot,
        cases: selectedCases,
        results,
        shared,
        obsidian,
        captureArtifact: async (relativePath, content) => {
            const absolutePath = path.join(artifactRoot, relativePath);
            await fs.mkdir(path.dirname(absolutePath), { recursive: true });
            await fs.writeFile(absolutePath, content, 'utf8');
            return absolutePath;
        },
        snapshotNote: async (label, vaultRelativePath) => {
            const content = await obsidian.read(vaultRelativePath);
            return context.captureArtifact(path.join('snapshots', `${label}-${safeFileName(vaultRelativePath)}.md`), content);
        },
        log: (message) => {
            const line = `[${new Date().toISOString()}] ${message}`;
            logLines.push(line);
            console.log(line);
        }
    };

    try {
        await preflight(context);

        for (const testCase of selectedCases) {
            const startedAt = Date.now();
            context.log(`Running ${testCase.id} ${testCase.name}`);
            try {
                await testCase.run(context);
                results.push({
                    id: testCase.id,
                    name: testCase.name,
                    status: 'passed',
                    durationMs: Date.now() - startedAt,
                    artifacts: []
                });
            } catch (error) {
                results.push({
                    id: testCase.id,
                    name: testCase.name,
                    status: 'failed',
                    durationMs: Date.now() - startedAt,
                    artifacts: [],
                    error: error instanceof Error ? error.message : String(error)
                });
                throw error;
            }
        }
    } finally {
        await cleanup(context);
        await writeReports(context, logLines);
    }
}

function parseArgs(args: string[]): E2EOptions {
    let suite: E2EOptions['suite'] = 'full';
    let vaultPath = process.env.OBSIDIAN_VAULT_PATH ?? DEFAULT_VAULT_PATH;
    let pluginId = DEFAULT_PLUGIN_ID;

    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--suite' && args[index + 1]) {
            suite = args[index + 1] as E2EOptions['suite'];
            index++;
            continue;
        }

        if (arg === '--vault-path' && args[index + 1]) {
            vaultPath = path.resolve(args[index + 1]);
            index++;
            continue;
        }

        if (arg === '--plugin-id' && args[index + 1]) {
            pluginId = args[index + 1];
            index++;
        }
    }

    return {
        suite,
        vaultPath,
        vaultName: path.basename(vaultPath),
        pluginId
    };
}

function selectCases(suite: E2EOptions['suite']): CaseDefinition[] {
    if (suite === 'smoke') {
        return allCases.filter(testCase => testCase.smoke);
    }
    return allCases;
}

function renderCaseList(testCases: CaseDefinition[]): void {
    for (const testCase of testCases) {
        console.log(`${testCase.id}\t${testCase.smoke ? 'smoke' : 'full'}\t${testCase.name}`);
        console.log(`  ${testCase.summary}`);
    }
}

async function loadPluginSettings(options: E2EOptions): Promise<PluginSettingsSnapshot> {
    const pluginDataPath = path.join(options.vaultPath, '.obsidian', 'plugins', options.pluginId, 'data.json');
    const payload = JSON.parse(await fs.readFile(pluginDataPath, 'utf8')) as PluginSettingsSnapshot;
    return {
        workspaces: payload.workspaces ?? [],
        defaultWorkspaceId: payload.defaultWorkspaceId ?? null,
        includeComments: Boolean(payload.includeComments),
        debugMode: Boolean(payload.debugMode)
    };
}

async function buildSharedState(settings: PluginSettingsSnapshot, runId: string): Promise<E2EContext['shared']> {
    const enabled = settings.workspaces.filter(workspace => workspace.enabled);
    if (enabled.length < 2) {
        throw new Error('E2E suite requires at least two enabled workspaces');
    }

    const selected = enabled.slice(0, 2);
    const runtimes: Record<string, WorkspaceRuntime> = {};
    const originalWorkspaceDefaults: Record<string, { defaultAssigneeId?: string; defaultProjectId?: string }> = {};

    for (const workspace of selected) {
        const client = new LinearApiClient(workspace.apiKey);
        const teams = await client.getTeams();
        const team = resolveWorkspaceTeam(workspace.teamIds, teams);
        const states = await client.getTeamStates(team.id);
        const state = resolveOpenState(states);
        const teamMembers = await client.getTeamMembers(team.id);
        const projects = await client.getProjects(team.id);
        const user = selectDefaultAssigneeCandidate(teamMembers);
        const tempNotePath = path.posix.join(
            'E2E',
            'linear-integration',
            runId,
            `${safeFileName(workspace.name)}.md`
        );

        assertFilePathInsideVault(tempNotePath);
        originalWorkspaceDefaults[workspace.id] = {
            defaultAssigneeId: workspace.defaultAssigneeId,
            defaultProjectId: workspace.defaultProjectId
        };

        runtimes[workspace.id] = {
            config: workspace,
            client,
            team,
            state,
            user,
            project: projects[0],
            alternateProject: projects[1] ?? projects[0],
            tempNotePath
        };
    }

    return {
        originalDefaultWorkspaceId: settings.defaultWorkspaceId,
        originalWorkspaceDefaults,
        workspacesById: runtimes,
        localNotes: [],
        remoteIssues: []
    };
}

function resolveWorkspaceTeam(teamIds: string[], availableTeams: Array<{ id: string; name: string; key: string }>) {
    if (teamIds.length === 0) {
        if (availableTeams.length === 0) {
            throw new Error('Workspace does not expose any teams');
        }
        return availableTeams[0];
    }

    const team = availableTeams.find(candidate => teamIds.includes(candidate.id));
    if (!team) {
        throw new Error('None of the configured teamIds resolved to a workspace team');
    }
    return team;
}

function resolveOpenState(states: LinearState[]): LinearState {
    const openState = states.find(candidate => !['completed', 'canceled'].includes(candidate.type.toLowerCase()));
    if (!openState) {
        throw new Error('Could not resolve an open state for the configured team');
    }
    return openState;
}

async function preflight(context: E2EContext): Promise<void> {
    context.log(`Artifact directory: ${context.artifactRoot}`);
    await context.obsidian.reloadPlugin(context.options.pluginId);

    const pluginState = await context.obsidian.evalJson<{
        debugMode: boolean;
        includeComments: boolean;
        enabledWorkspaces: Array<{ id: string; name: string; syncFolder: string; lastSyncTime?: string }>;
    }>(
        `
            const plugin = app.plugins.plugins["${context.options.pluginId}"];
            if (!plugin) throw new Error("Plugin not loaded");
            JSON.stringify({
                debugMode: plugin.settings.debugMode,
                includeComments: plugin.settings.includeComments,
                enabledWorkspaces: plugin.settings.workspaces
                    .filter((workspace) => workspace.enabled)
                    .map((workspace) => ({
                        id: workspace.id,
                        name: workspace.name,
                        syncFolder: workspace.syncFolder,
                        lastSyncTime: workspace.lastSyncTime
                    }))
            });
        `
    );

    await context.captureArtifact('preflight/plugin-state.json', JSON.stringify(pluginState, null, 2));
    await context.captureArtifact('preflight/dev-errors.txt', await context.obsidian.getErrors());
    await context.captureArtifact('preflight/console-errors.txt', await context.obsidian.getConsole('error'));
}

async function cleanup(context: E2EContext): Promise<void> {
    const trackedIssueIds = new Set(context.shared.remoteIssues.map(remote => remote.issueId));
    const notePaths = new Set(context.shared.localNotes);
    const searchRoots = new Set<string>([path.posix.join('E2E', 'linear-integration', context.runId)]);

    for (const workspace of Object.values(context.shared.workspacesById)) {
        searchRoots.add(workspace.config.syncFolder);
        try {
            const discoveredIssues = await workspace.client.searchIssues(context.runId);
            for (const issue of discoveredIssues) {
                trackedIssueIds.add(issue.id);
            }
        } catch (error) {
            context.log(`Failed to sweep remote issues for ${workspace.config.name}: ${String(error)}`);
        }
    }

    try {
        const discoveredNotes = await findRunNotePaths(
            context.options.vaultPath,
            context.runId,
            Array.from(trackedIssueIds),
            Array.from(searchRoots)
        );

        for (const notePath of discoveredNotes) {
            notePaths.add(notePath);
        }
    } catch (error) {
        context.log(`Failed to sweep local notes for cleanup: ${String(error)}`);
    }

    for (const remote of context.shared.remoteIssues) {
        const workspace = context.shared.workspacesById[remote.workspaceId];
        try {
            await workspace.client.deleteIssue(remote.issueId);
        } catch (error) {
            context.log(`Remote cleanup failed for ${remote.issueId}: ${String(error)}`);
        }
    }

    const untrackedIssueIds = Array.from(trackedIssueIds).filter(
        issueId => !context.shared.remoteIssues.some(remote => remote.issueId === issueId)
    );
    for (const issueId of untrackedIssueIds) {
        for (const workspace of Object.values(context.shared.workspacesById)) {
            try {
                await workspace.client.deleteIssue(issueId);
                break;
            } catch {
                continue;
            }
        }
    }

    for (const notePath of notePaths) {
        try {
            await context.obsidian.delete(notePath);
        } catch (error) {
            context.log(`Local cleanup failed for ${notePath}: ${String(error)}`);
        }
    }

    const tempRunDir = path.join(context.options.vaultPath, 'E2E', 'linear-integration', context.runId);
    await fs.rm(tempRunDir, { recursive: true, force: true });

    try {
        await context.obsidian.eval(
            `
                (async () => {
                    const plugin = app.plugins.plugins["${context.options.pluginId}"];
                    if (plugin) {
                        plugin.settings.defaultWorkspaceId = ${JSON.stringify(context.shared.originalDefaultWorkspaceId)};
                        const workspaceDefaults = ${JSON.stringify(context.shared.originalWorkspaceDefaults)};
                        plugin.settings.workspaces.forEach((workspace) => {
                            const defaults = workspaceDefaults[workspace.id] ?? {};
                            workspace.defaultAssigneeId = defaults.defaultAssigneeId;
                            workspace.defaultProjectId = defaults.defaultProjectId;
                        });
                        await plugin.saveSettings();
                    }
                    return JSON.stringify({ restored: true });
                })()
            `
        );
    } catch (error) {
        context.log(`Failed to restore default workspace: ${String(error)}`);
    }
}

async function writeReports(context: E2EContext, logLines: string[]): Promise<void> {
    const report = {
        runId: context.runId,
        suite: context.options.suite,
        vaultPath: context.options.vaultPath,
        cases: context.results
    };

    await context.captureArtifact('report.json', JSON.stringify(report, null, 2));
    await context.captureArtifact('runner.log', logLines.join('\n'));

    const markdown = [
        `# E2E Report ${context.runId}`,
        '',
        `- Suite: \`${context.options.suite}\``,
        `- Vault: \`${context.options.vaultPath}\``,
        '',
        '## Results',
        '',
        '| Case | Status | Duration | Error |',
        '| --- | --- | ---: | --- |',
        ...context.results.map(result => `| ${result.id} ${result.name} | ${result.status} | ${result.durationMs}ms | ${result.error ?? ''} |`)
    ].join('\n');

    await context.captureArtifact('report.md', markdown);
}

function createRunId(): string {
    const now = new Date();
    const parts = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0')
    ];
    return `E2E-${parts.slice(0, 3).join('')}-${parts.slice(3).join('')}`;
}

function safeFileName(input: string): string {
    return input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
