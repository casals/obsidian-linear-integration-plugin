import { App, ExtraButtonComponent, PluginSettingTab, Setting, Notice, Modal, setIcon } from 'obsidian';
import LinearPlugin from '../../main';
import { LinearProject, LinearWorkspace } from '../models/types';
import { LinearClient } from '../api/linear-client';
import { filterProjectsByTeamId } from './issue-modal-defaults';

class StatusMappingModal extends Modal {
    private statusName: string = '';
    private iconValue: string = '';
    private onSubmit: (status: string, icon: string) => void;
    private existingStatuses: string[];

    constructor(
        app: App, 
        onSubmit: (status: string, icon: string) => void,
        existingStatuses: string[] = []
    ) {
        super(app);
        this.onSubmit = onSubmit;
        this.existingStatuses = existingStatuses;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        new Setting(contentEl).setName('Add custom status mapping').setHeading();

        // Show existing mappings for reference
        if (this.existingStatuses.length > 0) {
            const existingEl = contentEl.createEl('div', { cls: 'setting-item-description' });
            existingEl.createEl('strong', { text: 'Existing mappings: ' });
            existingEl.createSpan({ text: this.existingStatuses.join(', ') });
        }

        // Status name input
        new Setting(contentEl)
            .setName('Status name')
            .setDesc('Enter the Linear status name (case-sensitive)')
            .addText(text => {
                text.setPlaceholder('e.g., "In Review", "Blocked", "Ready for QA"')
                    .setValue(this.statusName)
                    .onChange(value => this.statusName = value);
                
                text.inputEl.focus();
                return text;
            });

        // Icon input with emoji suggestions
        new Setting(contentEl)
            .setName('Icon/Emoji')
            .setDesc('Enter an emoji or icon')
            .addText(text => {
                text.setPlaceholder('e.g., 👀, 🚫, ⭐, 🧪, 🚀')
                    .setValue(this.iconValue)
                    .onChange(value => this.iconValue = value);
                
                return text;
            });

        // Emoji quick picks
        const emojiContainer = contentEl.createDiv({ cls: 'emoji-quick-picks' });
        emojiContainer.createEl('span', { text: 'Quick picks: ', cls: 'emoji-label' });
        
        const commonEmojis = ['👀', '🚫', '⭐', '🧪', '🚀', '✋', '🔄', '⏸️', '🎯', '💡'];
        commonEmojis.forEach(emoji => {
            const emojiBtn = emojiContainer.createEl('button', { 
                text: emoji,
                cls: 'emoji-quick-pick'
            });
            emojiBtn.onclick = () => {
                this.iconValue = emoji;
                // Update the text input
                const iconInput = contentEl.querySelector('input[placeholder*="emoji"]') as HTMLInputElement;
                if (iconInput) {
                    iconInput.value = emoji;
                }
            };
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const addButton = buttonContainer.createEl('button', { 
            text: 'Add mapping',
            cls: 'mod-cta'
        });
        addButton.onclick = () => this.submit();

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });
        cancelButton.onclick = () => this.close();

        // Allow Enter key to submit
        contentEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submit();
            }
        });
    }

    private submit(): void {
        if (!this.statusName.trim()) {
            new Notice('Please enter a status name');
            return;
        }

        if (!this.iconValue.trim()) {
            new Notice('Please enter an icon or emoji');
            return;
        }

        // Check if status already exists
        if (this.existingStatuses.includes(this.statusName.trim())) {
            new Notice('This status mapping already exists. It will be updated.');
        }

        this.onSubmit(this.statusName.trim(), this.iconValue.trim());
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class LinearSettingsTab extends PluginSettingTab {
    plugin: LinearPlugin;

    constructor(app: App, plugin: LinearPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        let workspaceContentVersion = 0;

        // ── Workspaces ───────────────────────────────────────────────────────────
        containerEl.createEl('h3', { text: 'Workspaces' });

        // Default workspace selector
        const defaultWorkspaceSetting = new Setting(containerEl)
            .setName('Default workspace')
            .setDesc('Used for autocomplete, issue creation, and Kanban/Agenda generation.');

        const renderDefaultDropdown = () => {
            defaultWorkspaceSetting.controlEl.empty();
            const select = defaultWorkspaceSetting.controlEl.createEl('select');
            const enabled = this.plugin.settings.workspaces.filter((w: LinearWorkspace) => w.enabled);
            if (enabled.length === 0) {
                select.createEl('option', { text: 'No workspaces enabled', value: '' });
                select.disabled = true;
            } else {
                enabled.forEach((w: LinearWorkspace) => {
                    const opt = select.createEl('option', { text: w.name || w.id, value: w.id });
                    if (w.id === this.plugin.settings.defaultWorkspaceId) opt.selected = true;
                });
                select.addEventListener('change', async () => {
                    this.plugin.settings.defaultWorkspaceId = select.value || null;
                    await this.plugin.saveSettings();
                });
            }
        };
        renderDefaultDropdown();

        // ── Tab-based workspace UI ────────────────────────────────────────────────
        const tabsWrapper = containerEl.createDiv({ cls: 'linear-workspace-tabs' });
        const tabBar = tabsWrapper.createDiv({ cls: 'linear-workspace-tab-bar' });
        const tabContent = tabsWrapper.createDiv({ cls: 'linear-workspace-tab-content' });

        let activeTabIndex = 0;

        const renderWorkspaceContent = (workspace: LinearWorkspace, index: number) => {
            tabContent.empty();
            const renderVersion = ++workspaceContentVersion;

            // Enabled toggle
            new Setting(tabContent)
                .setName('Enabled')
                .setDesc('Include this workspace in sync operations')
                .addToggle(toggle => toggle
                    .setValue(workspace.enabled)
                    .onChange(async val => {
                        workspace.enabled = val;
                        await this.plugin.saveSettings();
                        renderDefaultDropdown();
                    })
                );

            // Name
            new Setting(tabContent).setName('Name').addText(text =>
                text.setValue(workspace.name).onChange(async val => {
                    workspace.name = val;
                    await this.plugin.saveSettings();
                    // Update tab label without full re-render
                    const tab = tabBar.querySelectorAll('.linear-workspace-tab')[index] as HTMLElement;
                    if (tab) tab.textContent = val || `Workspace ${index + 1}`;
                    renderDefaultDropdown();
                })
            );

            // Forward reference — assigned after teamsContainer is created below
            let renderTeamsCheckboxes: (teams: { id: string; name: string; key?: string }[]) => void;
            let renderDefaultTeamDropdown: (teams: { id: string; name: string; key?: string }[]) => void;
            let renderDefaultAssigneeDropdown: (users: { id: string; name: string; email: string }[]) => void;
            let renderDefaultProjectDropdown: (projects: LinearProject[]) => void;
            let connectionButton: HTMLButtonElement | null = null;
            let connectionStatusButton: ExtraButtonComponent | null = null;

            const isCurrentRender = (): boolean => renderVersion === workspaceContentVersion;
            const renderWorkspaceOptions = (teams: { id: string; name: string; key?: string }[], users: { id: string; name: string; email: string }[], projects: LinearProject[]) => {
                if (!isCurrentRender()) {
                    return;
                }

                renderTeamsCheckboxes(teams);
                renderDefaultTeamDropdown(teams);
                renderDefaultAssigneeDropdown(users);
                renderDefaultProjectDropdown(projects);
            };

            const setConnectionStatus = (status: 'idle' | 'testing' | 'success' | 'failure', label?: string): void => {
                if (!connectionStatusButton || !isCurrentRender()) {
                    return;
                }

                const buttonEl = connectionStatusButton.extraSettingsEl as HTMLAnchorElement | undefined;
                if (!buttonEl) {
                    return;
                }

                buttonEl.className = `clickable-icon extra-setting-button linear-connection-indicator is-${status}`;
                connectionStatusButton.setTooltip(label ?? '');
                buttonEl.removeAttribute('data-symbol');
                buttonEl.replaceChildren();

                switch (status) {
                    case 'testing':
                        setIcon(buttonEl, 'loader-circle');
                        break;
                    case 'success':
                        setIcon(buttonEl, 'check-circle-2');
                        break;
                    case 'failure':
                        setIcon(buttonEl, 'x-circle');
                        break;
                    default:
                        setIcon(buttonEl, 'circle');
                        break;
                }
            };

            const refreshWorkspaceOptions = async (options?: { showSuccessNotice?: boolean; showFailureNotice?: boolean }): Promise<void> => {
                if (!workspace.apiKey) {
                    setConnectionStatus('idle', 'No API key');
                    return;
                }

                const showSuccessNotice = options?.showSuccessNotice ?? false;
                const showFailureNotice = options?.showFailureNotice ?? false;
                const button = connectionButton;
                const previousLabel = button?.textContent || 'Test Connection';

                if (button) {
                    button.textContent = 'Refreshing…';
                    button.disabled = true;
                }
                setConnectionStatus('testing', 'Refreshing');

                try {
                    const client = new LinearClient(workspace.apiKey);
                    const ok = await client.testConnection();
                    if (!ok) {
                        setConnectionStatus('failure', 'Connection failed');
                        if (showFailureNotice) {
                            new Notice('Connection failed. Check the API key.');
                        }
                        return;
                    }

                    const [teams, users, projects] = await Promise.all([
                        client.getTeams(),
                        client.getUsers(),
                        client.getProjects()
                    ]);

                    workspace.cachedTeams = teams;
                    workspace.cachedUsers = users;
                    workspace.cachedProjects = projects;

                    const knownTeamIds = new Set(teams.map(team => team.id));
                    workspace.teamIds = workspace.teamIds.filter(teamId => knownTeamIds.has(teamId));

                    if (workspace.defaultTeamId && !knownTeamIds.has(workspace.defaultTeamId)) {
                        workspace.defaultTeamId = undefined;
                    }

                    const filteredProjects = filterProjectsByTeamId(projects, workspace.defaultTeamId);
                    if (workspace.defaultProjectId && !filteredProjects.some(project => project.id === workspace.defaultProjectId)) {
                        workspace.defaultProjectId = undefined;
                    }

                    await this.plugin.saveSettings();
                    renderWorkspaceOptions(teams, users, projects);
                    setConnectionStatus('success', 'Connected');

                    if (showSuccessNotice) {
                        new Notice('Connected!');
                    }
                } catch {
                    setConnectionStatus('failure', 'Connection failed');
                    if (showFailureNotice) {
                        new Notice('Connection failed.');
                    }
                } finally {
                    if (button && isCurrentRender()) {
                        button.textContent = previousLabel;
                        button.disabled = false;
                    }
                }
            };

            // API Key + Test Connection
            const apiKeySetting = new Setting(tabContent).setName('API Key').addText(text => {
                text.inputEl.type = 'password';
                text.setValue(workspace.apiKey).onChange(async val => {
                    workspace.apiKey = val;
                    await this.plugin.saveSettings();
                    setConnectionStatus('idle', val ? 'Ready to test' : 'No API key');
                });
            });
            apiKeySetting.addButton(btn =>
                btn.setButtonText('Test Connection').onClick(async () => {
                    if (!workspace.apiKey) { new Notice('Enter an API key first.'); return; }
                    await refreshWorkspaceOptions({ showSuccessNotice: true, showFailureNotice: true });
                })
            );
            connectionButton = apiKeySetting.controlEl.querySelector('button');
            apiKeySetting.addExtraButton(btn => {
                connectionStatusButton = btn;
                btn.extraSettingsEl.classList.add('linear-connection-indicator');
                btn.onClick(() => undefined);
            });
            setConnectionStatus('idle', workspace.apiKey ? 'Ready to test' : 'No API key');

            // Sync Folder
            new Setting(tabContent).setName('Sync folder').addText(text =>
                text.setPlaceholder('Linear/Work').setValue(workspace.syncFolder).onChange(async val => {
                    workspace.syncFolder = val;
                    await this.plugin.saveSettings();
                })
            );

            // Teams checkbox list
            const teamsSetting = new Setting(tabContent)
                .setName('Teams')
                .setDesc('Leave empty to sync all teams. Click "Test Connection" above to load options.');
            const teamsContainer = teamsSetting.controlEl.createDiv({ cls: 'linear-teams-container' });

            renderTeamsCheckboxes = (teams: { id: string; name: string }[]) => {
                teamsContainer.empty();
                if (teams.length === 0) {
                    if (workspace.teamIds.length > 0) {
                        workspace.teamIds.forEach(tid => {
                            const lbl = teamsContainer.createEl('label', { cls: 'linear-team-checkbox-label' });
                            const cb = lbl.createEl('input', { type: 'checkbox' });
                            cb.checked = true;
                            cb.value = tid;
                            cb.addEventListener('change', async () => {
                                if (!cb.checked) {
                                    workspace.teamIds = workspace.teamIds.filter(id => id !== tid);
                                    lbl.remove();
                                    await this.plugin.saveSettings();
                                }
                            });
                            lbl.createSpan({ text: ` ${tid}` });
                        });
                        teamsContainer.createDiv({ text: 'Test connection to see all teams', cls: 'linear-teams-hint' });
                    } else {
                        teamsContainer.createDiv({ text: 'All teams — test connection to filter by team', cls: 'linear-teams-hint' });
                    }
                    return;
                }
                teams.forEach(t => {
                    const lbl = teamsContainer.createEl('label', { cls: 'linear-team-checkbox-label' });
                    const cb = lbl.createEl('input', { type: 'checkbox' });
                    cb.checked = workspace.teamIds.includes(t.id);
                    cb.value = t.id;
                    cb.addEventListener('change', async () => {
                        if (cb.checked) {
                            if (!workspace.teamIds.includes(t.id)) workspace.teamIds.push(t.id);
                        } else {
                            workspace.teamIds = workspace.teamIds.filter(id => id !== t.id);
                        }
                        await this.plugin.saveSettings();
                    });
                    lbl.createSpan({ text: ` ${t.name}` });
                });
            };
            // Use cached teams if available, so list persists across settings re-opens
            renderTeamsCheckboxes(workspace.cachedTeams ?? []);

            const defaultTeamSetting = new Setting(tabContent)
                .setName('Default team')
                .setDesc('Used as the fallback team in the create modal when the note does not specify one.');

            renderDefaultTeamDropdown = (teams: { id: string; name: string; key?: string }[]) => {
                defaultTeamSetting.controlEl.empty();
                const select = defaultTeamSetting.controlEl.createEl('select');
                select.createEl('option', { text: teams.length > 0 ? 'No default team' : 'Test connection to load teams', value: '' });
                select.disabled = teams.length === 0;

                teams.forEach(team => {
                    const option = select.createEl('option', {
                        text: team.key ? `${team.name} (${team.key})` : team.name,
                        value: team.id
                    });
                    if (team.id === workspace.defaultTeamId) {
                        option.selected = true;
                    }
                });

                select.value = workspace.defaultTeamId ?? '';
                select.addEventListener('change', async () => {
                    workspace.defaultTeamId = select.value || undefined;

                    const filteredProjects = filterProjectsByTeamId(workspace.cachedProjects ?? [], workspace.defaultTeamId);
                    if (workspace.defaultProjectId && !filteredProjects.some(project => project.id === workspace.defaultProjectId)) {
                        workspace.defaultProjectId = undefined;
                    }

                    await this.plugin.saveSettings();
                    renderDefaultProjectDropdown(workspace.cachedProjects ?? []);
                });
            };
            renderDefaultTeamDropdown(workspace.cachedTeams ?? []);

            const defaultAssigneeSetting = new Setting(tabContent)
                .setName('Default assignee')
                .setDesc('Used as the fallback assignee in the create modal when the note does not specify one.');

            renderDefaultAssigneeDropdown = (users: { id: string; name: string; email: string }[]) => {
                defaultAssigneeSetting.controlEl.empty();
                const select = defaultAssigneeSetting.controlEl.createEl('select');
                select.createEl('option', { text: users.length > 0 ? 'Unassigned' : 'Test connection to load users', value: '' });
                select.disabled = users.length === 0;

                users.forEach(user => {
                    const option = select.createEl('option', { text: `${user.name} (${user.email})`, value: user.id });
                    if (user.id === workspace.defaultAssigneeId) {
                        option.selected = true;
                    }
                });

                select.value = workspace.defaultAssigneeId ?? '';
                select.addEventListener('change', async () => {
                    workspace.defaultAssigneeId = select.value || undefined;
                    await this.plugin.saveSettings();
                });
            };
            renderDefaultAssigneeDropdown(workspace.cachedUsers ?? []);

            const defaultProjectSetting = new Setting(tabContent)
                .setName('Default project')
                .setDesc('Used as the fallback project in the create modal after the selected or default team is known.');

            renderDefaultProjectDropdown = (projects: LinearProject[]) => {
                defaultProjectSetting.controlEl.empty();
                const filteredProjects = filterProjectsByTeamId(projects, workspace.defaultTeamId);
                const select = defaultProjectSetting.controlEl.createEl('select');
                let emptyText = 'Select a default team first';
                if (!workspace.defaultTeamId) {
                    emptyText = 'Select a default team first';
                } else if (filteredProjects.length > 0) {
                    emptyText = 'No project';
                } else if (projects.length > 0) {
                    emptyText = 'No projects for the default team';
                } else {
                    emptyText = 'Test connection to load projects';
                }

                select.createEl('option', { text: emptyText, value: '' });
                select.disabled = !workspace.defaultTeamId || filteredProjects.length === 0;

                filteredProjects.forEach(project => {
                    const option = select.createEl('option', { text: project.name, value: project.id });
                    option.title = project.description ?? '';
                    if (project.id === workspace.defaultProjectId) {
                        option.selected = true;
                    }
                });

                select.value = workspace.defaultProjectId ?? '';
                select.addEventListener('change', async () => {
                    workspace.defaultProjectId = select.value || undefined;
                    await this.plugin.saveSettings();
                });
            };
            renderDefaultProjectDropdown(workspace.cachedProjects ?? []);

            void refreshWorkspaceOptions();

            // Delete workspace
            new Setting(tabContent)
                .setName('Delete workspace')
                .setDesc('Remove this workspace and all its settings')
                .addButton(btn =>
                    btn.setButtonText('Delete').setWarning().onClick(async () => {
                        const msg = workspace.lastSyncTime
                            ? `Delete "${workspace.name || 'this workspace'}"? Sync history will be lost.`
                            : `Delete "${workspace.name || 'this workspace'}"?`;
                        if (confirm(msg)) {
                            this.plugin.settings.workspaces.splice(index, 1);
                            if (this.plugin.settings.defaultWorkspaceId === workspace.id) {
                                this.plugin.settings.defaultWorkspaceId = null;
                            }
                            await this.plugin.saveSettings();
                            activeTabIndex = Math.max(0, index - 1);
                            renderTabs();
                            renderDefaultDropdown();
                        }
                    })
                );
        };

        const renderTabs = () => {
            tabBar.empty();
            tabContent.empty();
            const workspaces = this.plugin.settings.workspaces;

            workspaces.forEach((ws: LinearWorkspace, i: number) => {
                const tab = tabBar.createEl('button', {
                    text: ws.name || `Workspace ${i + 1}`,
                    cls: `linear-workspace-tab${i === activeTabIndex ? ' is-active' : ''}`,
                });
                tab.addEventListener('click', () => {
                    activeTabIndex = i;
                    renderTabs();
                });
            });

            // "+" tab to add a workspace
            const addTab = tabBar.createEl('button', { text: '+', cls: 'linear-workspace-tab linear-workspace-tab-add' });
            addTab.addEventListener('click', async () => {
                this.plugin.settings.workspaces.push({
                    id: crypto.randomUUID(),
                    name: '',
                    apiKey: '',
                    syncFolder: '',
                    teamIds: [],
                    enabled: true,
                });
                activeTabIndex = this.plugin.settings.workspaces.length - 1;
                await this.plugin.saveSettings();
                renderTabs();
                renderDefaultDropdown();
            });

            if (workspaces.length > 0) {
                renderWorkspaceContent(workspaces[activeTabIndex], activeTabIndex);
            } else {
                tabContent.createDiv({ text: 'No workspaces configured. Click + to add one.', cls: 'linear-teams-hint' });
            }
        };

        renderTabs();

        new Setting(containerEl).setName('Synchronization').setHeading();

        // Auto sync toggle
        new Setting(containerEl)
            .setName('Auto sync')
            .setDesc('Automatically sync with Linear on startup')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSync)
                .onChange(async (value) => {
                    this.plugin.settings.autoSync = value;
                    await this.plugin.saveSettings();
                }));

        // Auto sync interval
        new Setting(containerEl)
            .setName('Auto sync interval')
            .setDesc('Minutes between automatic syncs (0 to disable)')
            .addSlider(slider => slider
                .setLimits(0, 120, 5)
                .setValue(this.plugin.settings.autoSyncInterval)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.autoSyncInterval = value;
                    await this.plugin.saveSettings();
                }));

        // Include comments toggle
        new Setting(containerEl)
            .setName('Include comments')
            .setDesc('Include Linear issue comments in notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeComments)
                .onChange(async (value) => {
                    this.plugin.settings.includeComments = value;
                    await this.plugin.saveSettings();
                }));

        // Add auto-fill from Note expressions setting
        new Setting(containerEl)
            .setName('Auto-fill from note expressions')
            .setDesc('Automatically fill Linear fields in the create modal based on @team/, @assignee/, @project/, @priority/ expressions found in the note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFillFromExpressions)
                .onChange(async (value) => {
                    this.plugin.settings.autoFillFromExpressions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Status mapping')
            .setDesc('Map Linear issue states to emoji icons in your notes:')
            .setHeading();

        // Status mapping settings
        Object.entries(this.plugin.settings.statusMapping).forEach(([status, icon]) => {
            new Setting(containerEl)
                .setName(status)
                .addText(text => text
                    .setValue(icon)
                    .onChange(async (value) => {
                        this.plugin.settings.statusMapping[status] = value;
                        await this.plugin.saveSettings();
                    }));
        });

        // Add custom status mapping
        new Setting(containerEl)
            .setName('Add custom status mapping')
            .setDesc('Add a new status → icon mapping')
            .addButton(button => button
                .setButtonText('Add')
                .onClick(() => {
                    const existingStatuses = Object.keys(this.plugin.settings.statusMapping);
                    new StatusMappingModal(this.app, async (status, icon) => {
                        this.plugin.settings.statusMapping[status] = icon;
                        await this.plugin.saveSettings();
                        new Notice(`Added mapping: ${status} → ${icon}`);
                        this.display();
                    }, existingStatuses).open();
                }));
        // Add debug mode 
        new Setting(containerEl)
            .setName('Debug mode')
            .setDesc('Enable debug logging in browser console for troubleshooting')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                    
                    // ✅ Update debug mode immediately
                    const { debugLog } = await import('../utils/debug');
                    debugLog.setDebugMode(value);
                    
                    // Show feedback
                    if (value) {
                        new Notice('🐛 Debug mode enabled - check browser console');
                    } else {
                        new Notice('Debug mode disabled');
                    }
                }));
    }

}
