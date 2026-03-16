import { buildManagedBodyExpectations } from './note';
import { LinearIssue, NoteFrontmatter, ParsedNote, WorkspaceRuntime } from '../types';

export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

export function assertManagedNoteShape(note: ParsedNote): void {
    assert(buildManagedBodyExpectations(note.body), 'Managed note body does not match the expected shell');
}

export function assertWorkspaceBinding(frontmatter: NoteFrontmatter, workspace: WorkspaceRuntime): void {
    assert(frontmatter.linear_workspace_id === workspace.config.id, `Expected note to bind to workspace ${workspace.config.id}`);
    assert(frontmatter.linear_team_id === workspace.team.id, `Expected note team id ${workspace.team.id}`);
    assert(frontmatter.linear_team === workspace.team.name, `Expected note team name ${workspace.team.name}`);
}

export function assertIssueMirrored(frontmatter: NoteFrontmatter, issue: LinearIssue): void {
    assert(frontmatter.linear_id === issue.id, `Expected linear_id ${issue.id}`);
    assert(frontmatter.linear_identifier === issue.identifier, `Expected linear_identifier ${issue.identifier}`);
    assert(frontmatter.linear_title === issue.title, `Expected linear_title ${issue.title}`);
    assert(frontmatter.linear_description === (issue.description ?? ''), 'Expected linear_description to match Linear issue');
    assert(frontmatter.linear_status === issue.state.name, `Expected linear_status ${issue.state.name}`);
    assert(frontmatter.linear_status_id === issue.state.id, `Expected linear_status_id ${issue.state.id}`);
    assert(frontmatter.linear_assignee === (issue.assignee?.name ?? ''), 'Expected linear_assignee to match Linear issue');
    assert(frontmatter.linear_assignee_id === (issue.assignee?.id ?? ''), 'Expected linear_assignee_id to match Linear issue');
    assert(frontmatter.linear_project === (issue.project?.name ?? ''), 'Expected linear_project to match Linear issue');
    assert(frontmatter.linear_project_id === (issue.project?.id ?? ''), 'Expected linear_project_id to match Linear issue');
    assert(frontmatter.linear_priority === issue.priority, `Expected linear_priority ${issue.priority}`);
}

export function assertCommentMirrored(note: ParsedNote, expectedSnippet: string): void {
    assert(note.body.includes(expectedSnippet), `Expected note comments section to include "${expectedSnippet}"`);
}
