import { LinearClientLike, LinearIssue, LinearProject, LinearState, LinearTeam, LinearUser } from '../types';

export class LinearApiClient implements LinearClientLike {
    private readonly baseUrl = 'https://api.linear.app/graphql';

    constructor(private apiKey: string) {}

    async getTeams(): Promise<LinearTeam[]> {
        const data = await this.request<{ teams: { nodes: LinearTeam[] } }>(`
            query {
                teams {
                    nodes {
                        id
                        name
                        key
                    }
                }
            }
        `);
        return data.teams.nodes;
    }

    async getUsers(): Promise<LinearUser[]> {
        const data = await this.request<{ users: { nodes: LinearUser[] } }>(`
            query {
                users {
                    nodes {
                        id
                        name
                        email
                    }
                }
            }
        `);
        return data.users.nodes;
    }

    async getTeamMembers(teamId: string): Promise<LinearUser[]> {
        const data = await this.request<{ team: { members: { nodes: LinearUser[] } } }>(
            `
                query($teamId: String!) {
                    team(id: $teamId) {
                        members {
                            nodes {
                                id
                                name
                                email
                            }
                        }
                    }
                }
            `,
            { teamId }
        );

        return data.team.members.nodes;
    }

    async getProjects(teamId?: string): Promise<LinearProject[]> {
        const data = await this.request<{ projects: { nodes: LinearProject[] } }>(
            `
                query {
                    projects {
                        nodes {
                            id
                            name
                            description
                            teams {
                                nodes {
                                    id
                                }
                            }
                        }
                    }
                }
            `
        );
        const projects = data.projects.nodes as Array<LinearProject & { teams?: { nodes?: Array<{ id: string }> } }>;
        if (!teamId) {
            return projects;
        }

        return projects.filter(project =>
            project.teams?.nodes?.some(team => team.id === teamId)
        );
    }

    async getTeamStates(teamId: string): Promise<LinearState[]> {
        const data = await this.request<{ team: { states: { nodes: LinearState[] } } }>(
            `
                query($teamId: String!) {
                    team(id: $teamId) {
                        states {
                            nodes {
                                id
                                name
                                type
                            }
                        }
                    }
                }
            `,
            { teamId }
        );
        return data.team.states.nodes;
    }

    async getIssueById(id: string): Promise<LinearIssue | null> {
        const data = await this.request<{ issue: LinearIssue | null }>(
            `
                query($id: String!) {
                    issue(id: $id) {
                        ${ISSUE_FIELDS}
                    }
                }
            `,
            { id }
        );
        return data.issue;
    }

    async searchIssues(query: string): Promise<LinearIssue[]> {
        const data = await this.request<{ issues: { nodes: LinearIssue[] } }>(
            `
                query($query: String!) {
                    issues(filter: { title: { containsIgnoreCase: $query } }) {
                        nodes {
                            ${ISSUE_FIELDS}
                        }
                    }
                }
            `,
            { query }
        );

        return data.issues.nodes;
    }

    async createIssue(input: {
        title: string;
        description: string;
        teamId: string;
        assigneeId?: string;
        stateId?: string;
        priority?: number;
        labelNames?: string[];
        projectId?: string;
    }): Promise<LinearIssue> {
        const mutationInput: Record<string, unknown> = {
            title: input.title,
            description: input.description,
            teamId: input.teamId
        };

        if (input.assigneeId) mutationInput.assigneeId = input.assigneeId;
        if (input.stateId) mutationInput.stateId = input.stateId;
        if (input.priority !== undefined) mutationInput.priority = input.priority;
        if (input.projectId) mutationInput.projectId = input.projectId;
        if (input.labelNames?.length) {
            mutationInput.labelIds = await this.resolveLabelIds(input.labelNames, input.teamId);
        }

        const data = await this.request<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
            `
                mutation($input: IssueCreateInput!) {
                    issueCreate(input: $input) {
                        success
                        issue {
                            ${ISSUE_FIELDS}
                        }
                    }
                }
            `,
            { input: mutationInput }
        );

        if (!data.issueCreate.success) {
            throw new Error('Failed to create Linear issue');
        }

        return data.issueCreate.issue;
    }

    async updateIssue(
        id: string,
        updates: Partial<{
            title: string;
            description: string;
            stateId: string;
            assigneeId: string | null;
            projectId: string | null;
            priority: number;
            labelNames: string[];
            teamId: string;
        }>
    ): Promise<LinearIssue> {
        const input: Record<string, unknown> = {};
        if (updates.title !== undefined) input.title = updates.title;
        if (updates.description !== undefined) input.description = updates.description;
        if (updates.stateId !== undefined) input.stateId = updates.stateId;
        if (updates.assigneeId !== undefined) input.assigneeId = updates.assigneeId;
        if (updates.projectId !== undefined) input.projectId = updates.projectId;
        if (updates.priority !== undefined) input.priority = updates.priority;
        if (updates.labelNames !== undefined) {
            if (!updates.teamId) {
                throw new Error('teamId is required when updating labels');
            }
            input.labelIds = await this.resolveLabelIds(updates.labelNames, updates.teamId);
        }

        const data = await this.request<{ issueUpdate: { success: boolean; issue: LinearIssue } }>(
            `
                mutation($id: String!, $input: IssueUpdateInput!) {
                    issueUpdate(id: $id, input: $input) {
                        success
                        issue {
                            ${ISSUE_FIELDS}
                        }
                    }
                }
            `,
            { id, input }
        );

        if (!data.issueUpdate.success) {
            throw new Error(`Failed to update Linear issue ${id}`);
        }

        return data.issueUpdate.issue;
    }

    async addComment(issueId: string, body: string): Promise<void> {
        const data = await this.request<{ commentCreate: { success: boolean } }>(
            `
                mutation($input: CommentCreateInput!) {
                    commentCreate(input: $input) {
                        success
                    }
                }
            `,
            { input: { issueId, body } }
        );

        if (!data.commentCreate.success) {
            throw new Error(`Failed to add comment to issue ${issueId}`);
        }
    }

    async deleteIssue(issueId: string): Promise<void> {
        const data = await this.request<{ issueDelete: { success: boolean } }>(
            `
                mutation($id: String!, $permanentlyDelete: Boolean!) {
                    issueDelete(id: $id, permanentlyDelete: $permanentlyDelete) {
                        success
                    }
                }
            `,
            {
                id: issueId,
                permanentlyDelete: true
            }
        );

        if (!data.issueDelete.success) {
            throw new Error(`Failed to delete Linear issue ${issueId}`);
        }
    }

    private async resolveLabelIds(labelNames: string[], teamId?: string): Promise<string[]> {
        const labels = await this.getLabels(teamId);
        const result: string[] = [];
        for (const labelName of labelNames) {
            const existing = labels.find(label => label.name.toLowerCase() === labelName.toLowerCase());
            if (existing) {
                result.push(existing.id);
                continue;
            }

            const created = await this.createLabel(labelName, teamId);
            result.push(created.id);
        }
        return result;
    }

    private async getLabels(teamId?: string): Promise<Array<{ id: string; name: string; color: string }>> {
        const teamFilter = teamId ? `team: { id: { eq: "${teamId}" } }` : '';
        const data = await this.request<{ issueLabels: { nodes: Array<{ id: string; name: string; color: string }> } }>(
            `
                query {
                    issueLabels(filter: { ${teamFilter} }) {
                        nodes {
                            id
                            name
                            color
                        }
                    }
                }
            `
        );
        return data.issueLabels.nodes;
    }

    private async createLabel(name: string, teamId?: string): Promise<{ id: string; name: string; color: string }> {
        const data = await this.request<{ issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string; color: string } } }>(
            `
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
            `,
            {
                input: {
                    name,
                    color: '#2196f3',
                    ...(teamId ? { teamId } : {})
                }
            }
        );

        if (!data.issueLabelCreate.success) {
            throw new Error(`Failed to create label ${name}`);
        }

        return data.issueLabelCreate.issueLabel;
    }

    private async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.apiKey
            },
            body: JSON.stringify({ query, variables })
        });

        if (!response.ok) {
            const responseBody = await response.text();
            throw new Error(`Linear API request failed with status ${response.status}: ${responseBody}`);
        }

        const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> };
        if (payload.errors?.length) {
            throw new Error(payload.errors[0].message);
        }
        if (!payload.data) {
            throw new Error('Linear API returned no data');
        }

        return payload.data;
    }
}

const ISSUE_FIELDS = `
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
    project {
        id
        name
    }
    priority
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
            createdAt
            user {
                name
            }
        }
    }
`;
