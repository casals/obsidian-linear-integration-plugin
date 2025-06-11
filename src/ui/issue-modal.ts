import { debugLog } from '../utils/debug';
import { setDefaultOption } from '../utils/dom-utils';
import { App, Modal, Setting, TFile, Notice } from 'obsidian';
import { LinearClient } from '../api/linear-client';
import { LinearIssue, LinearTeam, LinearState, LinearUser, LinearNoteConfig, LinearPluginSettings } from '../models/types';
import { MarkdownParser } from '../parsers/markdown-parser';

export class IssueCreateModal extends Modal {
    private title: string = '';
    private description: string = '';
    private teamId: string = '';
    private assigneeId: string = '';
    private stateId: string = '';
    private priority: number = 3;
    private labels: string[] = []; 
    
    private teams: LinearTeam[] = [];
    private states: LinearState[] = [];
    private users: LinearUser[] = [];
    // Note: availableLabels loaded but not used in UI yet - could be used for autocomplete later
    
    // UI elements to update after loading
    private teamDropdown: any = null;
    private stateDropdown: any = null;
    private assigneeDropdown: any = null;
    private prioritySlider: any = null; 
    private labelsInput: any = null; 
    private isLoading: boolean = true;

    constructor(
        app: App,
        private linearClient: LinearClient,
        private file: TFile,
        private localConfig: LinearNoteConfig,
        private settings: LinearPluginSettings,
        private onSuccess: (issue: LinearIssue) => void
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Create Linear Issue' });

        // Show loading indicator
        const loadingEl = contentEl.createDiv({ cls: 'loading-container' });
        loadingEl.createEl('p', { text: '⏳ Loading Linear data...' });

        try {
            // Load data first
            await this.loadInitialData();
            
            // Pre-fill with note content AFTER data is loaded
            await this.prefillFromNote();
            
            // Clear loading and build UI
            contentEl.empty();
            contentEl.createEl('h2', { text: 'Create Linear Issue' });
            this.buildForm(contentEl);
            
            // Update UI after form is built
            setTimeout(() => {
                this.updateUIWithPrefilledValues();
            }, 50); // Small delay to ensure DOM is ready
            
        } catch (error) {
            contentEl.empty();
            contentEl.createEl('h2', { text: 'Create Linear Issue' });
            contentEl.createEl('p', { 
                text: `❌ Failed to load Linear data: ${(error as Error).message}`,
                cls: 'error-message'
            });
            
            // Still show form but with limited functionality
            this.buildForm(contentEl);
        }
    }

    private buildForm(container: HTMLElement): void {
        // Title setting
        new Setting(container)
            .setName('Title')
            .setDesc('Issue title')
            .addText(text => text
                .setPlaceholder('Enter issue title...')
                .setValue(this.title)
                .onChange(value => this.title = value));

        // Description setting
        new Setting(container)
            .setName('Description')
            .setDesc('Issue description')
            .addTextArea(text => {
                text.setPlaceholder('Enter issue description...');
                text.setValue(this.description);
                text.inputEl.rows = 6;
                text.onChange(value => this.description = value);
            });

        // Team selection
        new Setting(container)
            .setName('Team')
            .setDesc('Select the team for this issue')
            .addDropdown(dropdown => {
                this.teamDropdown = dropdown;
                this.populateTeamDropdown();
                
                dropdown.onChange(async (value) => {
                    this.teamId = value;
                    if (value) {
                        await this.loadStatesForTeam(value);
                        this.populateStateDropdown();
                    }
                });
            });

        // State selection
        new Setting(container)
            .setName('Status')
            .setDesc('Initial status for the issue')
            .addDropdown(dropdown => {
                this.stateDropdown = dropdown;
                this.populateStateDropdown();
                dropdown.onChange(value => this.stateId = value);
            });

        // Assignee selection
        new Setting(container)
            .setName('Assignee')
            .setDesc('Assign this issue to someone (optional)')
            .addDropdown(dropdown => {
                this.assigneeDropdown = dropdown;
                this.populateAssigneeDropdown();
                dropdown.onChange(value => this.assigneeId = value);
            });

        // Priority
        new Setting(container)
            .setName('Priority')
            .setDesc('Set issue priority (1=Urgent, 4=Low)')
            .addSlider(slider => {
                this.prioritySlider = slider; // Store reference
                slider.setLimits(1, 4, 1);
                slider.setValue(this.priority);
                slider.setDynamicTooltip();
                slider.onChange(value => {
                    this.priority = value;
                });

                // Force immediate update if priority was set by auto-fill
                if (this.priority !== 3) {
                    setTimeout(() => {
                        debugLog.log('Force updating priority slider to:', this.priority);
                        slider.setValue(this.priority);
                    }, 10);
                }
            });

        // Labels field
        new Setting(container)
            .setName('Labels')
            .setDesc('Enter comma-separated labels or use @label/ expressions in your note')
            .addText(text => {
                this.labelsInput = text; // Store reference
                text.setPlaceholder('bug, feature, urgent...')
                    .setValue(this.labels.join(', '))
                    .onChange(value => {
                        this.labels = value.split(',').map(label => label.trim()).filter(Boolean);
                    });
            });

        // Action buttons
        const buttonContainer = container.createDiv({ cls: 'modal-button-container' });
        
        const createButton = buttonContainer.createEl('button', { 
            text: 'Create Issue',
            cls: 'mod-cta'
        });
        createButton.onclick = () => this.createIssue();

        const cancelButton = buttonContainer.createEl('button', { 
            text: 'Cancel'
        });
        cancelButton.onclick = () => this.close();
    }

    // Update UI after auto-fill values are set
    private updateUIWithPrefilledValues(): void {
        debugLog.log('=== UPDATING UI WITH PREFILLED VALUES ===');
        debugLog.log('Priority to set:', this.priority);
        debugLog.log('Team ID to set:', this.teamId);
        debugLog.log('Assignee ID to set:', this.assigneeId);
        debugLog.log('State ID to set:', this.stateId);
        debugLog.log('Labels to set:', this.labels);
        // Update team dropdown
        if (this.teamDropdown && this.teamId) {
            debugLog.log('Setting team dropdown to:', this.teamId);
            this.teamDropdown.setValue(this.teamId);
        }
        
        // Update assignee dropdown
        if (this.assigneeDropdown && this.assigneeId) {
            debugLog.log('Setting assignee dropdown to:', this.assigneeId);
            this.assigneeDropdown.setValue(this.assigneeId);
        }
        
        // Update state dropdown
        if (this.stateDropdown && this.stateId) {
            debugLog.log('Setting state dropdown to:', this.stateId);
            this.stateDropdown.setValue(this.stateId);
        }

        // Update priority slider
        if (this.prioritySlider && this.priority >= 1 && this.priority <= 4) {
            debugLog.log('Updating priority slider to:', this.priority);
            try {
                // Method 1: Direct setValue
                this.prioritySlider.setValue(this.priority);
                
                // Method 2: Update DOM element directly
                const sliderEl = this.prioritySlider.sliderEl as HTMLInputElement;
                if (sliderEl) {
                    debugLog.log('Updating slider DOM element');
                    sliderEl.value = this.priority.toString();
                    
                    // Method 3: Trigger events to update display
                    sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
                    sliderEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                // Method 4: Use requestAnimationFrame for next render cycle
                requestAnimationFrame(() => {
                    if (this.prioritySlider) {
                        debugLog.log('Final priority update via requestAnimationFrame');
                        this.prioritySlider.setValue(this.priority);
                    }
                });
                
            } catch (error) {
                debugLog.error('Error updating priority slider:', error);
            }
        } else {
            debugLog.log('Priority slider not updated - slider:', !!this.prioritySlider, 'priority:', this.priority);
        }

        // Update labels input
        if (this.labelsInput && this.labels.length > 0) {
            debugLog.log('Setting labels input to:', this.labels.join(', '));
            this.labelsInput.setValue(this.labels.join(', '));
        }
    }

    private async loadInitialData(): Promise<void> {
        try {
            this.isLoading = true;
            [this.teams, this.users] = await Promise.all([
                this.linearClient.getTeams(),
                this.linearClient.getUsers()
                // Note: Could load labels here for future autocomplete functionality
                // this.linearClient.getLabels()
            ]);
            this.isLoading = false;
        } catch (error) {
            this.isLoading = false;
            debugLog.error('Failed to load Linear data:', (error as Error).message);
            throw error;
        }
    }

    private populateTeamDropdown(): void {
        if (!this.teamDropdown) return;
        
        // Clear existing options
        setDefaultOption(this.teamDropdown.selectEl, 'Select team...');
        
        this.teams.forEach(team => {
            this.teamDropdown.addOption(team.id, `${team.name} (${team.key})`);
        });
        
        // Set value if already determined
        if (this.teamId) {
            this.teamDropdown.setValue(this.teamId);
        }
    }

    private populateStateDropdown(): void {
        if (!this.stateDropdown) return;
        
        // Clear existing options
        setDefaultOption(this.stateDropdown.selectEl, 'Select status...');
        
        this.states.forEach(state => {
            this.stateDropdown.addOption(state.id, state.name);
        });
        
        // Set value if already determined
        if (this.stateId) {
            this.stateDropdown.setValue(this.stateId);
        }
    }

    private populateAssigneeDropdown(): void {
        if (!this.assigneeDropdown) return;
        
        // Clear existing options
        setDefaultOption(this.assigneeDropdown.selectEl, 'Unassigned');
        
        this.users.forEach(user => {
            this.assigneeDropdown.addOption(user.id, user.name);
        });
        
        // Set value if already determined
        if (this.assigneeId) {
            this.assigneeDropdown.setValue(this.assigneeId);
        }
    }

    private async loadStatesForTeam(teamId: string): Promise<void> {
        try {
            this.states = await this.linearClient.getTeamStates(teamId);
            this.populateStateDropdown();
        } catch (error) {
            debugLog.error('Failed to load team states:', (error as Error).message);
        }
    }

    private async prefillFromNote(): Promise<void> {
        try {
            const content = await this.app.vault.read(this.file);
            
            // Extract title from filename or first heading
            this.title = this.file.basename.replace(/^\d+\s*-\s*/, '');
            
            const firstHeading = content.match(/^#\s+(.+)$/m);
            if (firstHeading) {
                this.title = firstHeading[1];
            }

            // Extract description from content
            let description = content;
            description = description.replace(/^---\n[\s\S]*?\n---\n/, '');
            description = description.replace(/^#\s+.+\n/, '');
            this.description = description.trim().substring(0, 2000);
            
            // Auto-fill based on expressions if enabled
            if (this.settings.autoFillFromExpressions) {
                await this.autoFillFromExpressions(content);
            }
            
            // Apply local config defaults (lower priority than expressions)
            this.applyLocalConfigDefaults();
            
        } catch (error) {
            debugLog.error('Failed to prefill from note:', error);
        }
    }

    // Auto-fill from autocomplete expressions
    private async autoFillFromExpressions(content: string): Promise<void> {
        try {
            debugLog.log('Auto-filling from expressions...');
            
            // Parse frontmatter config
            const config = MarkdownParser.parseNoteConfig(content);
            debugLog.log('Parsed frontmatter config:', config);
            
            // Parse inline expressions with FIXED regex patterns
            const inlineExpressions = this.parseInlineExpressions(content);
            debugLog.log('Parsed inline expressions:', inlineExpressions);
            
            // Apply frontmatter config first
            if (config.team) {
                const teamName = config.team;
                const team = this.teams.find(t => 
                    t.name.toLowerCase() === teamName.toLowerCase() || 
                    t.key.toLowerCase() === teamName.toLowerCase() ||
                    t.id === teamName
                );
                if (team) {
                    debugLog.log('Setting team from config:', team.name);
                    this.teamId = team.id;
                    await this.loadStatesForTeam(team.id);
                }
            }
            
            if (config.assignee) {
                const assigneeName = config.assignee;
                const user = this.users.find(u => 
                    u.name.toLowerCase() === assigneeName.toLowerCase() || 
                    u.email.toLowerCase() === assigneeName.toLowerCase()
                );
                if (user) {
                    debugLog.log('Setting assignee from config:', user.name);
                    this.assigneeId = user.id;
                }
            }
            
            if (config.priority) {
                debugLog.log('Setting priority from config:', config.priority);
                // Handle both numeric and string priorities
                if (typeof config.priority === 'number') {
                    this.priority = config.priority;
                } else if (typeof config.priority === 'string') {
                    this.priority = this.convertPriorityLabelToNumber(config.priority);
                }
            }

            // Handle labels from config
            if (config.labels && config.labels.length > 0) {
                debugLog.log('Setting labels from config:', config.labels);
                this.labels = [...config.labels];
            }
            
            // Apply inline expressions (they override config)
            for (const expr of inlineExpressions) {
                switch (expr.type) {
                    case 'team':
                        const team = this.teams.find(t => 
                            t.name.toLowerCase() === expr.value.toLowerCase() || 
                            t.key.toLowerCase() === expr.value.toLowerCase()
                        );
                        if (team) {
                            debugLog.log('Setting team from inline expression:', team.name);
                            this.teamId = team.id;
                            await this.loadStatesForTeam(team.id);
                        }
                        break;
                    case 'assignee':
                        const user = this.users.find(u => 
                            u.name.toLowerCase() === expr.value.toLowerCase() || 
                            u.email.toLowerCase() === expr.value.toLowerCase()
                        );
                        if (user) {
                            debugLog.log('Setting assignee from inline expression:', user.name);
                            this.assigneeId = user.id;
                        }
                        break;
                    case 'priority':
                        // Convert priority label to number
                        const priorityNumber = this.convertPriorityLabelToNumber(expr.value);
                        if (priorityNumber >= 1 && priorityNumber <= 4) {
                            debugLog.log('=== SETTING PRIORITY FROM INLINE EXPRESSION ===');
                            debugLog.log('Priority label:', expr.value);
                            debugLog.log('Priority number:', priorityNumber);
                            debugLog.log('Previous priority:', this.priority);
                            this.priority = priorityNumber;
                            debugLog.log('New priority:', this.priority);
                        } else {
                            debugLog.warn('Invalid priority value:', expr.value);
                        }
                        break;
                    // Handle status expressions
                    case 'status':
                        if (this.states.length > 0) {
                            const state = this.states.find(s => 
                                s.name.toLowerCase() === expr.value.toLowerCase()
                            );
                            if (state) {
                                debugLog.log('Setting status from inline expression:', state.name);
                                this.stateId = state.id;
                            }
                        }
                        break;
                    // Handle label expressions
                    case 'label':
                        if (!this.labels.includes(expr.value)) {
                            debugLog.log('Adding label from inline expression:', expr.value);
                            this.labels.push(expr.value);
                        }
                        break;
                }
            }
            
        } catch (error) {
            debugLog.error('Failed to auto-fill from expressions:', error);
        }
    }

    // Parse inline expressions 
    private parseInlineExpressions(content: string): Array<{type: string, value: string}> {
        const expressions: Array<{type: string, value: string}> = [];
        
        // IMPROVED regex patterns that handle spaces and special characters
        const patterns = [
            { pattern: /@team\/([^@\s]+(?:\s+[^@\s]+)*)/g, type: 'team' },
            { pattern: /@assignee\/([^@\s]+(?:\s+[^@\s]+)*)/g, type: 'assignee' },            
            { pattern: /@priority\/([^@\s]+(?:\s+[^@\s]+)*)/g, type: 'priority' },
            { pattern: /@status\/([^@\s]+(?:\s+[^@\s]+)*)/g, type: 'status' }, // Add status
            { pattern: /@label\/([^@\s]+(?:\s+[^@\s]+)*)/g, type: 'label' } // Add label
        ];
        
        patterns.forEach(({ pattern, type }) => {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const value = match[1].trim();
                if (value) {
                    expressions.push({
                        type: type,
                        value: value
                    });
                    debugLog.log(`Found ${type} expression:`, value);
                }
            }
            pattern.lastIndex = 0; // Reset regex
        });
        
        return expressions;
    }

    // Convert priority labels to numbers
    private convertPriorityLabelToNumber(label: string): number {
        const priorityMap: Record<string, number> = {
            // Linear's standard priorities
            'urgent': 1,
            'high': 2,
            'medium': 3,
            'low': 4,
            // Alternative spellings
            'critical': 1,
            'normal': 3,
            // Numeric strings (fallback)
            '1': 1,
            '2': 2,
            '3': 3,
            '4': 4
        };
        
        const normalizedLabel = label.toLowerCase().trim();
        const priorityNumber = priorityMap[normalizedLabel];
        
        debugLog.log(`Converting priority label "${label}" to number:`, priorityNumber);
        
        return priorityNumber || 3; // Default to medium if not found
    }

    // Apply local config defaults
    private applyLocalConfigDefaults(): void {
        // Only apply if not already set by expressions
        if (!this.teamId && this.localConfig?.team) {
            const team = this.teams.find(t => 
                t.name === this.localConfig.team || 
                t.id === this.localConfig.team
            );
            if (team) {
                this.teamId = team.id;
                this.loadStatesForTeam(team.id);
            }
        }
        
        if (!this.assigneeId && this.localConfig?.assignee) {
            const user = this.users.find(u => 
                u.name === this.localConfig.assignee || 
                u.email === this.localConfig.assignee
            );
            if (user) {
                this.assigneeId = user.id;
            }
        }
        
        if (this.priority === 0 && this.localConfig?.priority) {
            this.priority = this.localConfig.priority;
        }

        // Apply default labels from local config
        if (this.labels.length === 0 && this.localConfig?.labels) {
            this.labels = [...this.localConfig.labels];
        }
    }

    private async createIssue(): Promise<void> {
        if (this.isLoading) { 
            new Notice('Please wait for data to load...');
            return;
        }

        if (!this.title.trim()) {
            new Notice('Please enter a title');
            return;
        }

        if (!this.teamId) {
            new Notice('Please select a team');
            return;
        }

        try {
            const issue = await this.linearClient.createIssue(
                this.title,
                this.description,
                this.teamId,
                this.assigneeId || undefined,
                this.stateId || undefined,
                this.priority || undefined,
                this.labels.length > 0 ? this.labels : undefined // Pass labels
            );

            debugLog.log('Created issue with labels:', this.labels);
            this.onSuccess(issue);
            this.close();
        } catch (error) {
            new Notice(`Failed to create issue: ${(error as Error).message}`);
            debugLog.error('Failed to create issue:', (error as Error).message);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}