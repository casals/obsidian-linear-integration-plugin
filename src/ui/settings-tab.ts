import { debugLog } from '../utils/debug';
import { setDefaultOption } from '../utils/dom-utils';
import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import LinearPlugin from '../../main';
import { TeamSyncConfig } from '../models/types';

class AddTeamModal extends Modal {
    private teamId: string = '';
    private teamName: string = '';
    private teamKey: string = '';
    private syncFolder: string = '';
    private onSubmit: (config: TeamSyncConfig) => void;
    private availableTeams: { id: string; name: string; key: string }[] = [];

    constructor(
        app: App,
        onSubmit: (config: TeamSyncConfig) => void,
        availableTeams: { id: string; name: string; key: string }[] = []
    ) {
        super(app);
        this.onSubmit = onSubmit;
        this.availableTeams = availableTeams;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        new Setting(contentEl).setName('Add team sync').setHeading();

        if (this.availableTeams.length > 0) {
            new Setting(contentEl)
                .setName('Team')
                .setDesc('Select a Linear team to sync')
                .addDropdown(dropdown => {
                    dropdown.addOption('', 'Select a team...');
                    this.availableTeams.forEach(t => dropdown.addOption(t.id, `${t.name} (${t.key})`));
                    dropdown.onChange(value => {
                        const team = this.availableTeams.find(t => t.id === value);
                        if (team) {
                            this.teamId = team.id;
                            this.teamName = team.name;
                            this.teamKey = team.key;
                            if (!this.syncFolder) {
                                this.syncFolder = `Linear Issues/${team.name}`;
                                const folderInput = contentEl.querySelector('input[placeholder*="Linear Issues"]') as HTMLInputElement;
                                if (folderInput) folderInput.value = this.syncFolder;
                            }
                        }
                    });
                });
        } else {
            new Setting(contentEl)
                .setName('Team ID')
                .setDesc('Linear team ID')
                .addText(text => text
                    .setPlaceholder('e.g. 3f67f930-...')
                    .onChange(value => { this.teamId = value; }));

            new Setting(contentEl)
                .setName('Team name')
                .addText(text => text
                    .setPlaceholder('e.g. Golden Wealth')
                    .onChange(value => { this.teamName = value; }));

            new Setting(contentEl)
                .setName('Team key')
                .addText(text => text
                    .setPlaceholder('e.g. GW')
                    .onChange(value => { this.teamKey = value; }));
        }

        new Setting(contentEl)
            .setName('Sync folder')
            .setDesc('Vault folder where this team\'s issues will be synced')
            .addText(text => {
                text.setPlaceholder('Linear Issues/Golden Wealth')
                    .setValue(this.syncFolder)
                    .onChange(value => { this.syncFolder = value; });
                return text;
            });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        const addButton = buttonContainer.createEl('button', { text: 'Add team', cls: 'mod-cta' });
        addButton.onclick = () => this.submit();
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => this.close();
    }

    private submit(): void {
        if (!this.teamId || !this.teamName || !this.syncFolder) {
            new Notice('Please fill in all fields');
            return;
        }
        this.onSubmit({ teamId: this.teamId, teamName: this.teamName, teamKey: this.teamKey, syncFolder: this.syncFolder, enabled: true });
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

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

        //containerEl.createEl('h2', { text: 'Linear integration' });

        // API Key setting
        new Setting(containerEl)
            .setName('Linear API key')
            .setDesc('Your Linear API key. Get it from Linear Settings > API.')
            .addText(text => text
                .setPlaceholder('lin_api_...')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                    
                    // Update Linear client
                    this.plugin.linearClient = new (await import('../api/linear-client')).LinearClient(value);
                }));

        // Test connection button
        new Setting(containerEl)
            .setName('Test connection')
            .setDesc('Test your Linear API connection')
            .addButton(button => button
                .setButtonText('Test')
                .onClick(async () => {
                    if (!this.plugin.settings.apiKey) {
                        new Notice('Please enter your API key first');
                        return;
                    }

                    try {
                        const isConnected = await this.plugin.linearClient.testConnection();
                        if (isConnected) {
                            new Notice('✅ Connection successful!');
                            await this.loadTeams();
                        } else {
                            new Notice('❌ Connection failed. Check your API key.');
                        }
                    } catch (error) {
                        new Notice(`❌ Connection failed: ${(error as Error).message}`);
                    }
                }));


        // ── Multi-team sync configuration ──────────────────────────────────────
        new Setting(containerEl).setName('Team sync').setHeading();
        new Setting(containerEl)
            .setName('Team sync configurations')
            .setDesc('Sync multiple Linear teams into separate vault folders. Each team gets its own folder.');

        const configs = this.plugin.settings.teamSyncConfigs ?? [];

        if (configs.length === 0) {
            containerEl.createEl('p', {
                text: 'No teams configured. Add a team below.',
                cls: 'setting-item-description'
            });
        }

        configs.forEach((config, index) => {
            const setting = new Setting(containerEl)
                .setName(`${config.teamName} (${config.teamKey || config.teamId.slice(0, 8)})`)
                .setDesc(`→ ${config.syncFolder}`)
                .addToggle(toggle => toggle
                    .setValue(config.enabled)
                    .setTooltip('Enable/disable sync for this team')
                    .onChange(async (value) => {
                        this.plugin.settings.teamSyncConfigs[index].enabled = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('Remove')
                    .setWarning()
                    .onClick(async () => {
                        this.plugin.settings.teamSyncConfigs.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    }));
            setting.settingEl.style.borderLeft = config.enabled ? '3px solid var(--interactive-accent)' : '3px solid var(--background-modifier-border)';
        });

        new Setting(containerEl)
            .setName('Add team')
            .setDesc('Add a new team to sync')
            .addButton(button => button
                .setButtonText('+ Add team')
                .setCta()
                .onClick(async () => {
                    let teams: { id: string; name: string; key: string }[] = [];
                    if (this.plugin.settings.apiKey) {
                        try {
                            teams = await this.plugin.linearClient.getTeams();
                        } catch {
                            // proceed without team list
                        }
                    }
                    new AddTeamModal(this.app, async (config) => {
                        if (!this.plugin.settings.teamSyncConfigs) {
                            this.plugin.settings.teamSyncConfigs = [];
                        }
                        this.plugin.settings.teamSyncConfigs.push(config);
                        await this.plugin.saveSettings();
                        new Notice(`✅ Added team "${config.teamName}" → ${config.syncFolder}`);
                        this.display();
                    }, teams).open();
                }));

        // ── Legacy single-team fallback (shown only when no multi-team configs) ──
        if (configs.length === 0) {
            new Setting(containerEl).setName('Legacy fallback').setHeading();
            new Setting(containerEl)
                .setName('Default team')
                .setDesc('Used only when no team sync configs are defined above')
                .addDropdown(dropdown => {
                    dropdown.addOption('', 'Select a team...');
                    dropdown.setValue(this.plugin.settings.teamId);
                    dropdown.onChange(async (value) => {
                        this.plugin.settings.teamId = value;
                        await this.plugin.saveSettings();
                    });
                    if (this.plugin.settings.apiKey) {
                        this.loadTeamsIntoDropdown(dropdown);
                    }
                });

            new Setting(containerEl)
                .setName('Sync folder')
                .setDesc('Folder where Linear issues will be synced (legacy single-team)')
                .addText(text => text
                    .setPlaceholder('Linear Issues')
                    .setValue(this.plugin.settings.syncFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.syncFolder = value;
                        await this.plugin.saveSettings();
                    }));
        }

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

        // Include description toggle
        new Setting(containerEl)
            .setName('Include description')
            .setDesc('Include Linear issue descriptions in notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeDescription)
                .onChange(async (value) => {
                    this.plugin.settings.includeDescription = value;
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
            .setDesc('Automatically fill Linear fields in the create modal based on @team/, @assignee/, @priority/ expressions found in the note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFillFromExpressions)
                .onChange(async (value) => {
                    this.plugin.settings.autoFillFromExpressions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Note template').setHeading();

        // Note template setting
        new Setting(containerEl)
            .setName('Note template')
            .setDesc('Template for generated notes. Available variables: {{title}}, {{status}}, {{assignee}}, {{team}}, {{created}}, {{updated}}, {{description}}, {{url}}, {{lastSync}}')
            .addTextArea(text => {
                text.setValue(this.plugin.settings.noteTemplate);
                text.inputEl.rows = 10;
                text.inputEl.cols = 50;
                text.onChange(async (value) => {
                    this.plugin.settings.noteTemplate = value;
                    await this.plugin.saveSettings();
                });
            });

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

    private async loadTeams(): Promise<void> {
        try {
            const teams = await this.plugin.linearClient.getTeams();
            debugLog.log('Available teams:', teams);
        } catch (error) {
            debugLog.error('Failed to load teams:', error);
        }
    }

    private async loadTeamsIntoDropdown(dropdown: any): Promise<void> {
        try {
            const teams = await this.plugin.linearClient.getTeams();
            
            // Clear existing options except the first one
            setDefaultOption(dropdown.selectEl, 'Select a team...');
            
            teams.forEach(team => {
                dropdown.addOption(team.id, `${team.name} (${team.key})`);
            });
            
            // Restore selected value
            dropdown.setValue(this.plugin.settings.teamId);
        } catch (error) {
            new Notice(`Failed to load teams: ${(error as Error).message}`);
        }
    }
}