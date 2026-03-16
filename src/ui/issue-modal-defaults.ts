import { LinearProject, LinearTeam, LinearUser, LinearWorkspace } from '../models/types';

export interface IssueModalExpression {
    type: string;
    value: string;
}

export interface IssueModalResolvedDefaults {
    assigneeId: string;
    projectId: string;
}

interface ResolveIssueModalDefaultsInput {
    expressions: IssueModalExpression[];
    localConfig: {
        assignee?: string;
        project?: string;
    } | null | undefined;
    workspace: LinearWorkspace | null | undefined;
    users: LinearUser[];
    projects: LinearProject[];
}

export function resolveIssueModalDefaults(input: ResolveIssueModalDefaultsInput): IssueModalResolvedDefaults {
    const explicitAssignee = getLastExpressionValue(input.expressions, 'assignee');
    const explicitProject = getLastExpressionValue(input.expressions, 'project');

    return {
        assigneeId:
            matchUserId(input.users, explicitAssignee) ||
            matchUserId(input.users, input.localConfig?.assignee) ||
            matchUserId(input.users, input.workspace?.defaultAssigneeId) ||
            '',
        projectId:
            matchProjectId(input.projects, explicitProject) ||
            matchProjectId(input.projects, input.localConfig?.project) ||
            matchProjectId(input.projects, input.workspace?.defaultProjectId) ||
            ''
    };
}

export function matchUserId(users: LinearUser[], candidate?: string | null): string {
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) {
        return '';
    }

    const match = users.find(user =>
        user.id === normalizedCandidate ||
        user.name.toLowerCase() === normalizedCandidate.toLowerCase() ||
        user.email.toLowerCase() === normalizedCandidate.toLowerCase()
    );

    return match?.id || '';
}

export function matchTeamId(teams: LinearTeam[], candidate?: string | null): string {
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) {
        return '';
    }

    const match = teams.find(team =>
        team.id === normalizedCandidate ||
        team.name.toLowerCase() === normalizedCandidate.toLowerCase() ||
        team.key.toLowerCase() === normalizedCandidate.toLowerCase()
    );

    return match?.id || '';
}

export function matchProjectId(projects: LinearProject[], candidate?: string | null): string {
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate) {
        return '';
    }

    const match = projects.find(project =>
        project.id === normalizedCandidate ||
        project.name.toLowerCase() === normalizedCandidate.toLowerCase()
    );

    return match?.id || '';
}

export function filterProjectsByTeamId(projects: LinearProject[], teamId?: string | null): LinearProject[] {
    const normalizedTeamId = normalize(teamId);
    if (!normalizedTeamId) {
        return [];
    }

    return projects.filter(project =>
        !project.teamIds ||
        project.teamIds.length === 0 ||
        project.teamIds.includes(normalizedTeamId)
    );
}

function getLastExpressionValue(expressions: IssueModalExpression[], type: string): string {
    const matchingExpressions = expressions.filter(expression => expression.type === type);
    return normalize(matchingExpressions[matchingExpressions.length - 1]?.value);
}

function normalize(value?: string | null): string {
    return value?.trim() || '';
}
