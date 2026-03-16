import { SyncResult } from '../models/types';

export const SYNC_NOTICE_TITLE = 'Linear Integration';
export const SYNC_NOTICE_DURATION = 10000;

export function formatSyncSummary(result: SyncResult): string {
    const lines = [
        `Created: ${result.created}`,
        `Updated: ${result.updated}`,
        `Conflicts: ${result.conflicts.length}`,
        `Errors: ${result.errors.length}`
    ];

    if (
        result.created === 0 &&
        result.updated === 0 &&
        result.conflicts.length === 0 &&
        result.errors.length === 0
    ) {
        lines.push('No changes detected.');
    }

    return lines.join('\n');
}

export function formatSyncSummaryNoticeText(result: SyncResult): string {
    return `${SYNC_NOTICE_TITLE}\n${formatSyncSummary(result)}`;
}
