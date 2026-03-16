import {
    DEFAULT_COMMENT_SYNC_LABEL,
    parseManagedNoteState,
    renderManagedNoteBody
} from '../synced-note';

const baseIssue = {
    id: 'issue-1',
    identifier: 'ENG-1',
    title: 'Issue title',
    description: 'Issue description',
    state: {
        id: 'state-1',
        name: 'Todo',
        type: 'unstarted'
    },
    assignee: {
        id: 'user-1',
        name: 'Jane Doe',
        email: 'jane@example.com'
    },
    team: {
        id: 'team-1',
        name: 'Engineering',
        key: 'ENG'
    },
    project: {
        id: 'project-1',
        name: 'Alpha'
    },
    priority: 2,
    estimate: 3,
    labels: {
        nodes: []
    },
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T00:00:00.000Z',
    url: 'https://linear.app/issue/ENG-1',
    comments: {
        nodes: []
    }
};

describe('synced-note helpers', () => {
    it('renders the managed note shell with document and draft sections', () => {
        const content = renderManagedNoteBody(baseIssue, {
            documentText: '',
            draftText: '',
            syncLabel: DEFAULT_COMMENT_SYNC_LABEL
        }, true);

        expect(content).toContain('# Linear Issue');
        expect(content).toContain('# Document');
        expect(content).toContain('# New Comment');
        expect(content).toContain('# Comments');
    });

    it('preserves editable document and new comment content across parse and render', () => {
        const original = [
            '# Linear Issue',
            '',
            '[ENG-1](https://linear.app/issue/ENG-1)',
            '',
            '# Document',
            '',
            '[[Source Note]]',
            '',
            '# New Comment',
            '',
            '--- Synced to Linear at Never ---',
            '',
            'Draft comment',
            '',
            '# Comments',
            '',
            '*No comments yet.*',
            ''
        ].join('\n');

        const state = parseManagedNoteState(original);
        expect(state.documentText).toBe('[[Source Note]]');
        expect(state.draftText).toBe('Draft comment');

        const rerendered = renderManagedNoteBody(baseIssue, state, true);
        expect(rerendered).toContain('[[Source Note]]');
        expect(rerendered).toContain('Draft comment');
    });

    it('repairs legacy notes that are missing the document section', () => {
        const legacy = [
            '## Linear Issue',
            '',
            '[ENG-1](https://linear.app/issue/ENG-1)',
            '',
            '## New Comment',
            '',
            '--- Synced to Linear at Never ---',
            '',
            '## Comments',
            '',
            '*No comments yet.*',
            ''
        ].join('\n');

        const state = parseManagedNoteState(legacy);
        expect(state.documentText).toBe('');
        expect(state.draftText).toBe('');

        const rerendered = renderManagedNoteBody(baseIssue, state, true);
        expect(rerendered).toContain('# Document');
        expect(rerendered).toContain('# New Comment');
    });
});
