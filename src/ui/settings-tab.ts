import { debugLog } from '../utils/debug';
import { App, PluginSettingTab, Setting, Notice, Modal } from 'obsidian'; 
import LinearPlugin from '../../main';

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

        contentEl.createEl('h2', { text: 'Add Custom Status Mapping' });

        // Show existing mappings for reference
        if (this.existingStatuses.length > 0) {
            const existingEl = contentEl.createEl('div', { cls: 'setting-item-description' });
            existingEl.createEl('strong', { text: 'Existing mappings: ' });
            existingEl.createSpan({ text: this.existingStatuses.join(', ') });
        }

        // Status name input
        new Setting(contentEl)
            .setName('Status Name')
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
            text: 'Add Mapping',
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

        containerEl.createEl('h2', { text: 'Linear Integration Settings' });

        // API Key setting
        new Setting(containerEl)
            .setName('Linear API Key')
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
            .setName('Test Connection')
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

        // Team selection
        new Setting(containerEl)
            .setName('Default Team')
            .setDesc('Select the Linear team to sync with')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'Select a team...');
                dropdown.setValue(this.plugin.settings.teamId);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.teamId = value;
                    await this.plugin.saveSettings();
                });

                // Load teams if API key is available
                if (this.plugin.settings.apiKey) {
                    this.loadTeamsIntoDropdown(dropdown);
                }
            });

        // Sync folder setting
        new Setting(containerEl)
            .setName('Sync Folder')
            .setDesc('Folder where Linear issues will be synced')
            .addText(text => text
                .setPlaceholder('Linear Issues')
                .setValue(this.plugin.settings.syncFolder)
                .onChange(async (value) => {
                    this.plugin.settings.syncFolder = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Sync Settings' });

        // Auto sync toggle
        new Setting(containerEl)
            .setName('Auto Sync')
            .setDesc('Automatically sync with Linear on startup')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSync)
                .onChange(async (value) => {
                    this.plugin.settings.autoSync = value;
                    await this.plugin.saveSettings();
                }));

        // Auto sync interval
        new Setting(containerEl)
            .setName('Auto Sync Interval')
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
            .setName('Include Description')
            .setDesc('Include Linear issue descriptions in notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeDescription)
                .onChange(async (value) => {
                    this.plugin.settings.includeDescription = value;
                    await this.plugin.saveSettings();
                }));

        // Include comments toggle
        new Setting(containerEl)
            .setName('Include Comments')
            .setDesc('Include Linear issue comments in notes')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeComments)
                .onChange(async (value) => {
                    this.plugin.settings.includeComments = value;
                    await this.plugin.saveSettings();
                }));

        // Add auto-fill from Note expressions setting
        new Setting(containerEl)
            .setName('Auto-fill from Note Expressions')
            .setDesc('Automatically fill Linear fields in the create modal based on @team/, @assignee/, @priority/ expressions found in the note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFillFromExpressions)
                .onChange(async (value) => {
                    this.plugin.settings.autoFillFromExpressions = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Note Template' });

        // Note template setting
        new Setting(containerEl)
            .setName('Note Template')
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

        containerEl.createEl('h3', { text: 'Status Mapping' });
        containerEl.createEl('p', { 
            text: 'Map Linear issue states to emoji icons in your notes:',
            cls: 'setting-item-description'
        });

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
            .setName('Add Custom Status Mapping')
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
            .setName('Debug Mode')
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
            dropdown.selectEl.innerHTML = '<option value="">Select a team...</option>';
            
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