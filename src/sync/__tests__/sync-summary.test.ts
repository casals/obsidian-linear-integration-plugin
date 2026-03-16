import { SyncResult } from '../../models/types';
import { formatSyncSummary, formatSyncSummaryNoticeText } from '../sync-summary';

function createResult(overrides: Partial<SyncResult> = {}): SyncResult {
    return {
        created: 0,
        updated: 0,
        errors: [],
        conflicts: [],
        ...overrides
    };
}

describe('formatSyncSummary', () => {
    it('renders created and updated counts for a normal sync', () => {
        const summary = formatSyncSummary(createResult({
            created: 2,
            updated: 5
        }));

        expect(summary).toBe([
            'Created: 2',
            'Updated: 5',
            'Conflicts: 0',
            'Errors: 0'
        ].join('\n'));
    });

    it('appends a no-change message when the sync result is empty', () => {
        const summary = formatSyncSummary(createResult());

        expect(summary).toBe([
            'Created: 0',
            'Updated: 0',
            'Conflicts: 0',
            'Errors: 0',
            'No changes detected.'
        ].join('\n'));
    });

    it('renders the error count when sync errors are present', () => {
        const summary = formatSyncSummary(createResult({
            errors: ['[workspace-1] Sync failed: boom']
        }));

        expect(summary).toBe([
            'Created: 0',
            'Updated: 0',
            'Conflicts: 0',
            'Errors: 1'
        ].join('\n'));
    });

    it('renders the conflict count when conflicts are present', () => {
        const summary = formatSyncSummary(createResult({
            conflicts: [{
                issueId: 'issue-1',
                field: 'linear_title',
                linearValue: 'Remote',
                obsidianValue: 'Local',
                timestamp: '2026-03-15T00:00:00.000Z'
            }]
        }));

        expect(summary).toBe([
            'Created: 0',
            'Updated: 0',
            'Conflicts: 1',
            'Errors: 0'
        ].join('\n'));
    });

    it('prefixes the notice text with the plugin title', () => {
        const noticeText = formatSyncSummaryNoticeText(createResult({
            created: 1,
            updated: 2
        }));

        expect(noticeText).toBe([
            'Linear Integration',
            'Created: 1',
            'Updated: 2',
            'Conflicts: 0',
            'Errors: 0'
        ].join('\n'));
    });
});
