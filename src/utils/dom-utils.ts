export interface ElementConfig {
    tag?: string;
    cls?: string | string[];
    text?: string;
    value?: string;
    style?: Partial<CSSStyleDeclaration>;
}

export interface TooltipIssue {
    identifier: string;
    state: { type: string; name: string };
    title: string;
    assignee?: { name: string };
    team: { name: string };
    priority?: number; 
    description?: string;
}

/**
 * Creates a default option element for dropdowns
 */
export function setDefaultOption(selectElement: HTMLSelectElement, text: string): void {
    selectElement.empty();
    selectElement.createEl('option', { value: '', text });
}

/**
 * Creates a color dot span with background color
 */
export function createColorDot(container: HTMLElement, color: string): void {
    container.empty();
    const span = container.createEl('span', { cls: 'color-dot' });
    span.style.backgroundColor = color;
}

/**
 * Creates a complete issue tooltip with all sections
 */
export function createIssueTooltip(container: HTMLElement, issue: TooltipIssue): void {
    container.empty();
    
    // Header
    const header = container.createEl('div', { cls: 'tooltip-header' });
    header.createEl('span', { cls: 'issue-identifier', text: issue.identifier });
    header.createEl('span', { 
        cls: `issue-status ${issue.state.type}`, 
        text: issue.state.name 
    });
    
    // Title
    container.createEl('div', { cls: 'tooltip-title', text: issue.title });
    
    // Meta
    const meta = container.createEl('div', { cls: 'tooltip-meta' });
    meta.createEl('span', { text: `Assignee: ${issue.assignee?.name || 'Unassigned'}` });
    meta.createEl('span', { text: `Team: ${issue.team.name}` });
    if (issue.priority) {
        meta.createEl('span', { text: `Priority: ${issue.priority.toString()}` }); // Convert to string
    }
    
    // Description
    const description = formatDescription(issue.description);
    container.createEl('div', { cls: 'tooltip-description', text: description });
    
    // Actions
    const actions = container.createEl('div', { cls: 'tooltip-actions' });
    actions.createEl('button', { cls: 'quick-edit-btn', text: 'Quick edit' });
    actions.createEl('button', { cls: 'open-linear-btn', text: 'Open in Linear' });
}

/**
 * Helper function to format description text
 */
function formatDescription(description?: string): string {
    const desc = description?.substring(0, 150) || 'No description';
    return desc + (description && description.length > 150 ? '...' : '');
}

/**
 * Applies label styling using CSS custom properties
 */
export function applyLabelStyling(element: HTMLElement, color: string): void {
    element.addClass('label-item');
    element.style.setProperty('--label-color', color);
    element.style.setProperty('--label-bg-color', `${color}15`); // 15 = ~8% opacity
}

/**
 * Positions tooltip relative to a target element
 */
export function positionTooltip(tooltip: HTMLElement, targetElement: HTMLElement, offset: number = 8): void {
    const rect = targetElement.getBoundingClientRect();
    tooltip.addClass('tooltip-positioned');
    tooltip.style.top = `${rect.bottom + offset}px`;
    tooltip.style.left = `${rect.left}px`;
}