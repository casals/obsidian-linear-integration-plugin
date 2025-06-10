import { debugLog } from '../utils/debug';
import { LinearIssue, LinearTeam, LinearState, LinearUser } from '../models/types';

export class LinearClient {
    private apiKey: string;
    private baseUrl = 'https://api.linear.app/graphql';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        debugLog.log('LinearClient constructor - API key received:', !!apiKey);
        debugLog.log('LinearClient constructor - API key length:', apiKey?.length || 0);
    }

    private async makeRequest(query: string, variables: any = {}, maxRetries = 3): Promise<any> {
        
        debugLog.log('makeRequest called with API key:', !!this.apiKey);
        
        if (!this.apiKey) {
            throw new Error('API key is missing');
        }

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(this.baseUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': this.apiKey,
                    },
                    body: JSON.stringify({ query, variables }),
                });

                if (response.status === 429) { // Rate limited
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
                    if (attempt < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                        continue;
                    }
                }

                const data = await response.json();
                
                if (data.errors) {
                    throw new Error(`Linear API Error: ${data.errors[0].message}`);
                }

                return data.data;
            } catch (error) {
                if (attempt === maxRetries) throw error;
                
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }

    async getTeams(): Promise<LinearTeam[]> {
        const query = `
            query {
                teams {
                    nodes {
                        id
                        name
                        key
                    }
                }
            }
        `;

        const data = await this.makeRequest(query);
        return data.teams.nodes;
    }

    async getIssues(teamId?: string, updatedAfter?: string): Promise<LinearIssue[]> {
        const variables: any = { first: 100 };
        
        const filters: string[] = [];
        if (teamId) filters.push(`team: { id: { eq: "${teamId}" } }`);
        if (updatedAfter) filters.push(`updatedAt: { gt: "${updatedAfter}" }`);
        
        const filterString = filters.length > 0 ? `filter: { ${filters.join(', ')} }` : '';

        const query = `
            query($first: Int) {
                issues(first: $first ${filterString ? ', ' + filterString : ''}) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        state {
                            id
                            name
                            type
                        }
                        assignee {
                            id
                            name
                            email
                        }
                        team {
                            id
                            name
                            key
                        }
                        priority
                        estimate
                        labels {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        `;

        const data = await this.makeRequest(query, variables);
        return data.issues.nodes;
    }

    async getIssueById(id: string): Promise<LinearIssue | null> {
        const query = `
            query($id: String!) {
                issue(id: $id) {
                    id
                    identifier
                    title
                    description
                    state {
                        id
                        name
                        type
                    }
                    assignee {
                        id
                        name
                        email
                    }
                    team {
                        id
                        name
                        key
                    }
                    priority
                    estimate
                    labels {
                        nodes {
                            id
                            name
                            color
                        }
                    }
                    createdAt
                    updatedAt
                    url
                    comments {
                        nodes {
                            id
                            body
                            user {
                                name
                            }
                            createdAt
                        }
                    }
                }
            }
        `;

        const data = await this.makeRequest(query, { id });
        return data.issue;
    }

    async createIssue(title: string, description: string, teamId: string, assigneeId?: string, stateId?: string, priority?: number, labelNames?: string[]): Promise<LinearIssue> {
        // Convert label names to label IDs if provided
        let labelIds: string[] = [];
        if (labelNames && labelNames.length > 0) {
            labelIds = await this.convertLabelNamesToIds(labelNames, teamId);
        }
        const query = `
            mutation($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    success
                    issue {
                        id
                        identifier
                        title
                        description
                        state {
                            id
                            name
                            type
                        }
                        assignee {
                            id
                            name
                            email
                        }
                        team {
                            id
                            name
                            key
                        }
                        priority
                        estimate
                        labels {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        `;

        const input: any = {
            title,
            description,
            teamId,
        };

        if (assigneeId) input.assigneeId = assigneeId;
        if (stateId) input.stateId = stateId;
        if (priority !== undefined) input.priority = priority;
        if (labelIds.length > 0) input.labelIds = labelIds;

        const data = await this.makeRequest(query, { input });
        
        if (!data.issueCreate.success) {
            throw new Error('Failed to create Linear issue');
        }

        return data.issueCreate.issue;
    }

    // Helper method to convert label names to IDs
    private async convertLabelNamesToIds(labelNames: string[], teamId?: string): Promise<string[]> {
        try {
            // Get all available labels (with optional team filter)
            const labels = await this.getLabels(teamId);
            const labelIds: string[] = [];
            
            debugLog.log('Available labels:', labels.map(l => l.name));
            debugLog.log('Requested label names:', labelNames);
            
            for (const labelName of labelNames) {
                // Find exact match (case-insensitive)
                const existingLabel = labels.find(label => 
                    label.name.toLowerCase() === labelName.toLowerCase()
                );
                
                if (existingLabel) {
                    labelIds.push(existingLabel.id);
                    debugLog.log(`Found existing label: ${labelName} -> ${existingLabel.id}`);
                } else {
                    // Create new label if it doesn't exist
                    debugLog.log(`Creating new label: ${labelName}`);
                    const newLabel = await this.createLabel(labelName, teamId);
                    if (newLabel) {
                        labelIds.push(newLabel.id);
                    }
                }
            }
            
            return labelIds;
        } catch (error) {
            debugLog.error('Failed to convert label names to IDs:', error);
            return []; // Return empty array if conversion fails
        }
    }

    // Create a new label
    async createLabel(name: string, teamId?: string): Promise<{id: string; name: string; color: string} | null> {
        try {
            const query = `
                mutation($input: IssueLabelCreateInput!) {
                    issueLabelCreate(input: $input) {
                        success
                        issueLabel {
                            id
                            name
                            color
                        }
                    }
                }
            `;

            const input: any = {
                name: name,
                color: this.generateRandomLabelColor() // Generate a random color
            };

            // Add team association if provided
            if (teamId) {
                input.teamId = teamId;
            }

            const data = await this.makeRequest(query, { input });
            
            if (data.issueLabelCreate.success) {
                debugLog.log(`Created new label: ${name}`);
                return data.issueLabelCreate.issueLabel;
            } else {
                debugLog.error(`Failed to create label: ${name}`);
                return null;
            }
        } catch (error) {
            debugLog.error(`Error creating label ${name}:`, error);
            return null;
        }
    }

    // Generate random color for new labels
    private generateRandomLabelColor(): string {
        const colors = [
            '#ff5722', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5',
            '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50',
            '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    async updateIssue(id: string, updates: Partial<{ title: string; description: string; stateId: string; assigneeId: string }>): Promise<LinearIssue> {
        const query = `
            mutation($id: String!, $input: IssueUpdateInput!) {
                issueUpdate(id: $id, input: $input) {
                    success
                    issue {
                        id
                        identifier
                        title
                        description
                        state {
                            id
                            name
                            type
                        }
                        assignee {
                            id
                            name
                            email
                        }
                        team {
                            id
                            name
                            key
                        }
                        priority
                        estimate
                        labels {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        `;

        const data = await this.makeRequest(query, { id, input: updates });
        
        if (!data.issueUpdate.success) {
            throw new Error('Failed to update Linear issue');
        }

        return data.issueUpdate.issue;
    }

    async getTeamStates(teamId: string): Promise<LinearState[]> {
        const query = `
            query($teamId: String!) {
                team(id: $teamId) {
                    states {
                        nodes {
                            id
                            name
                            type
                            color
                        }
                    }
                }
            }
        `;

        const data = await this.makeRequest(query, { teamId });
        return data.team.states.nodes;
    }

    async getUsers(): Promise<LinearUser[]> {
        const query = `
            query {
                users {
                    nodes {
                        id
                        name
                        email
                    }
                }
            }
        `;

        const data = await this.makeRequest(query);
        return data.users.nodes;
    }

    async getIssuesByIdentifiers(identifiers: string[]): Promise<LinearIssue[]> {
        const query = `
            query($filter: IssueFilter) {
                issues(filter: $filter) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        state {
                            id
                            name
                            type
                        }
                        assignee {
                            id
                            name
                            email
                        }
                        team {
                            id
                            name
                            key
                        }
                        priority
                        estimate
                        dueDate
                        labels {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        `;

        const filter = {
            identifier: {
                in: identifiers
            }
        };

        const data = await this.makeRequest(query, { filter });
        return data.issues.nodes;
    }

    async searchIssues(searchTerm: string, teamId?: string): Promise<LinearIssue[]> {
        const variables: any = { first: 50 };
        
        const filters: string[] = [];
        
        // Add text search
        filters.push(`or: [
            { title: { containsIgnoreCase: "${searchTerm}" } },
            { description: { containsIgnoreCase: "${searchTerm}" } },
            { identifier: { containsIgnoreCase: "${searchTerm}" } }
        ]`);

        if (teamId) {
            filters.push(`team: { id: { eq: "${teamId}" } }`);
        }

        const filterString = filters.length > 0 ? `filter: { ${filters.join(', ')} }` : '';

        const query = `
            query($first: Int) {
                issues(first: $first ${filterString ? ', ' + filterString : ''}) {
                    nodes {
                        id
                        identifier
                        title
                        description
                        state {
                            id
                            name
                            type
                        }
                        assignee {
                            id
                            name
                            email
                        }
                        team {
                            id
                            name
                            key
                        }
                        priority
                        estimate
                        dueDate
                        labels {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        `;

        const data = await this.makeRequest(query, variables);
        return data.issues.nodes;
    }

    async getLabels(teamId?: string): Promise<Array<{ 
        id: string; 
        name: string; 
        color: string; 
        parent?: { id: string; name: string; color: string }; 
        isGroup?: boolean; 
    }>> {
        const teamFilter = teamId ? `team: { id: { eq: "${teamId}" } }` : '';        
        
        const query = `
            query {
                issueLabels(filter: { ${teamFilter} }) {
                    nodes {
                        id
                        name
                        color
                        parent {
                            id
                            name
                            color
                        }
                        children {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                    }
                }
            }
        `;

        const data = await this.makeRequest(query);
        //return data.issueLabels.nodes;
        const labels = data.issueLabels.nodes.map((label: any) => ({
            id: label.id,
            name: label.name,
            color: label.color,
            parent: label.parent ? {
                id: label.parent.id,
                name: label.parent.name,
                color: label.parent.color 
            } : undefined,
            isGroup: label.children?.nodes?.length > 0 // Has children = is a group
        }));
        
        return labels;
        }

    async getProjects(teamId?: string): Promise<Array<{ id: string; name: string; description?: string }>> {
        const teamFilter = teamId ? `team: { id: { eq: "${teamId}" } }` : '';
        
        const query = `
            query {
                projects(filter: { ${teamFilter} }) {
                    nodes {
                        id
                        name
                        description
                        state
                    }
                }
            }
        `;

        const data = await this.makeRequest(query);
        return data.projects.nodes;
    }

    async createIssueWithLabels(
        title: string, 
        description: string, 
        teamId: string, 
        options: {
            assigneeId?: string;
            stateId?: string;
            priority?: number;
            labelIds?: string[];
            projectId?: string;
            dueDate?: string;
        } = {}
    ): Promise<LinearIssue> {
        const query = `
            mutation($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    success
                    issue {
                        id
                        identifier
                        title
                        description
                        state {
                            id
                            name
                            type
                        }
                        assignee {
                            id
                            name
                            email
                        }
                        team {
                            id
                            name
                            key
                        }
                        priority
                        estimate
                        dueDate
                        labels {
                            nodes {
                                id
                                name
                                color
                            }
                        }
                        createdAt
                        updatedAt
                        url
                    }
                }
            }
        `;

        const input: any = {
            title,
            description,
            teamId,
        };

        if (options.assigneeId) input.assigneeId = options.assigneeId;
        if (options.stateId) input.stateId = options.stateId;
        if (options.priority) input.priority = options.priority;
        if (options.labelIds && options.labelIds.length > 0) input.labelIds = options.labelIds;
        if (options.projectId) input.projectId = options.projectId;
        if (options.dueDate) input.dueDate = options.dueDate;

        const data = await this.makeRequest(query, { input });
        
        if (!data.issueCreate.success) {
            throw new Error('Failed to create Linear issue');
        }

        return data.issueCreate.issue;
    }

    async addCommentToIssue(issueId: string, body: string): Promise<void> {
        const query = `
            mutation($input: CommentCreateInput!) {
                commentCreate(input: $input) {
                    success
                    comment {
                        id
                    }
                }
            }
        `;

        const input = {
            issueId,
            body
        };

        const data = await this.makeRequest(query, { input });
        
        if (!data.commentCreate.success) {
            throw new Error('Failed to add comment to Linear issue');
        }
    }

    async getWorkspaces(): Promise<Array<{ id: string; name: string; urlKey: string }>> {
        const query = `
            query {
                organization {
                    id
                    name
                    urlKey
                }
            }
        `;

        const data = await this.makeRequest(query);
        // Linear API returns the current organization, not multiple workspaces
        // This is a simplified implementation
        return [{
            id: data.organization.id,
            name: data.organization.name,
            urlKey: data.organization.urlKey
        }];
    }

    async batchUpdateIssues(updates: Array<{ issueId: string; updates: Partial<LinearIssue> }>): Promise<void> {
        // Linear doesn't have a native batch update mutation, so we'll do them sequentially
        // In a production environment, you might want to implement proper batching with promise pooling
        
        const batchSize = 5; // Limit concurrent updates
        const batches: Array<{ issueId: string; updates: Partial<LinearIssue> }[]> = [];
        
        for (let i = 0; i < updates.length; i += batchSize) {
            batches.push(updates.slice(i, i + batchSize));
        }

        for (const batch of batches) {
            const promises = batch.map(({ issueId, updates: updateData }) => 
                this.updateIssue(issueId, updateData).catch(error => {
                    debugLog.error(`Failed to update issue ${issueId}:`, error);
                    return null;
                })
            );
            
            await Promise.all(promises);
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const query = `
                query {
                    viewer {
                        id
                        name
                    }
                }
            `;
            
            await this.makeRequest(query);
            return true;
        } catch (error) {
            return false;
        }
    }
}