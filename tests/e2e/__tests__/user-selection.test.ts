import { isAgentLikeUser, selectDefaultAssigneeCandidate } from '../../../scripts/e2e/lib/user-selection';

describe('user-selection', () => {
    it('marks agent-like users as ineligible assignee candidates', () => {
        expect(isAgentLikeUser({ name: 'Codex', email: 'codex@example.com' })).toBe(true);
        expect(isAgentLikeUser({ name: 'Claude Agent', email: 'claude@example.com' })).toBe(true);
        expect(isAgentLikeUser({ name: 'Cursor Bot', email: 'cursor@example.com' })).toBe(true);
        expect(isAgentLikeUser({ name: 'Yu Bai', email: 'yubai@example.com' })).toBe(false);
    });

    it('selects the first non-agent team member', () => {
        const selected = selectDefaultAssigneeCandidate([
            { id: '1', name: 'Codex', email: 'codex@example.com' },
            { id: '2', name: 'Yu Bai', email: 'yubai@example.com' }
        ]);

        expect(selected?.id).toBe('2');
    });

    it('returns undefined when a team only contains agent-like users', () => {
        const selected = selectDefaultAssigneeCandidate([
            { id: '1', name: 'Codex', email: 'codex@example.com' },
            { id: '2', name: 'Claude Agent', email: 'claude@example.com' }
        ]);

        expect(selected).toBeUndefined();
    });
});
