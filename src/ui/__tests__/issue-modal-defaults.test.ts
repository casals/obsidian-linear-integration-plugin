import { LinearProject, LinearTeam, LinearUser, LinearWorkspace } from '../../models/types';
import { filterProjectsByTeamId, matchProjectId, matchTeamId, matchUserId, resolveIssueModalDefaults } from '../issue-modal-defaults';

const teams: LinearTeam[] = [
    { id: 'team-1', name: 'Product', key: 'PROD' },
    { id: 'team-2', name: 'Platform', key: 'PLAT' }
];

const users: LinearUser[] = [
    { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' },
    { id: 'user-2', name: 'John Smith', email: 'john@example.com' }
];

const projects: LinearProject[] = [
    { id: 'project-1', name: 'Alpha', teamIds: ['team-1'] },
    { id: 'project-2', name: 'Beta', teamIds: ['team-2'] },
    { id: 'project-3', name: 'Shared' }
];

const workspace: LinearWorkspace = {
    id: 'workspace-1',
    name: 'Workspace',
    apiKey: 'api-key',
    syncFolder: 'Linear/Workspace',
    teamIds: [],
    enabled: true,
    defaultTeamId: 'team-2',
    defaultAssigneeId: 'user-2',
    defaultProjectId: 'project-2'
};

describe('issue modal defaults', () => {
    it('uses workspace defaults when note inputs are empty', () => {
        expect(resolveIssueModalDefaults({
            expressions: [],
            localConfig: {},
            workspace,
            users,
            projects
        })).toEqual({
            assigneeId: 'user-2',
            projectId: 'project-2'
        });
    });

    it('applies precedence of explicit expressions over local config over workspace defaults', () => {
        expect(resolveIssueModalDefaults({
            expressions: [
                { type: 'assignee', value: 'Jane Doe' },
                { type: 'project', value: 'Alpha' }
            ],
            localConfig: {
                assignee: 'John Smith',
                project: 'Beta'
            },
            workspace,
            users,
            projects
        })).toEqual({
            assigneeId: 'user-1',
            projectId: 'project-1'
        });
    });

    it('matches workspace defaults by stable ids', () => {
        expect(matchUserId(users, 'user-1')).toBe('user-1');
        expect(matchTeamId(teams, 'PLAT')).toBe('team-2');
        expect(matchProjectId(projects, 'project-2')).toBe('project-2');
    });

    it('filters workspace projects by the selected default team', () => {
        expect(filterProjectsByTeamId(projects, workspace.defaultTeamId).map(project => project.id)).toEqual([
            'project-2',
            'project-3'
        ]);
    });
});
