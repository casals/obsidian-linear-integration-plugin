import { LinearIssue } from '../models/types';

export const LINEAR_ISSUE_SECTION = '# Linear Issue';
export const DOCUMENT_SECTION = '# Document';
export const NEW_COMMENT_SECTION = '# New Comment';
export const COMMENTS_SECTION = '# Comments';
const LEGACY_DOCUMENT_SECTION = '## Document';
const LEGACY_NEW_COMMENT_SECTION = '## New Comment';
const LEGACY_COMMENTS_SECTION = '## Comments';
export const COMMENT_SYNC_PREFIX = '--- Synced to Linear at ';
export const COMMENT_SYNC_SUFFIX = ' ---';
export const DEFAULT_COMMENT_SYNC_LABEL = 'Never';

export interface ManagedNoteState {
    documentText: string;
    draftText: string;
    syncLabel: string;
}

export function createCommentSyncMarker(syncLabel: string): string {
    return `${COMMENT_SYNC_PREFIX}${syncLabel}${COMMENT_SYNC_SUFFIX}`;
}

export function parseManagedNoteState(content: string): ManagedNoteState {
    const documentSection = readManagedSection(content, [DOCUMENT_SECTION, LEGACY_DOCUMENT_SECTION], [NEW_COMMENT_SECTION, LEGACY_NEW_COMMENT_SECTION, COMMENTS_SECTION, LEGACY_COMMENTS_SECTION]);
    const draftSection = readManagedSection(content, [NEW_COMMENT_SECTION, LEGACY_NEW_COMMENT_SECTION], [COMMENTS_SECTION, LEGACY_COMMENTS_SECTION]);

    if (!draftSection) {
        return {
            documentText: documentSection?.trim() ?? '',
            draftText: '',
            syncLabel: DEFAULT_COMMENT_SYNC_LABEL
        };
    }

    const lines = draftSection.split('\n');
    const markerLine = lines[0]?.trim();
    const syncLabel = extractSyncLabel(markerLine) ?? DEFAULT_COMMENT_SYNC_LABEL;
    const draftText = (extractSyncLabel(markerLine) ? lines.slice(1) : lines).join('\n').trim();

    return {
        documentText: documentSection?.trim() ?? '',
        draftText,
        syncLabel
    };
}

export function renderManagedNoteBody(
    issue: LinearIssue,
    state: ManagedNoteState,
    includeComments: boolean
): string {
    const comments = issue.comments?.nodes ?? [];
    const lines = [
        LINEAR_ISSUE_SECTION,
        '',
        `[${issue.identifier}](${issue.url})`,
        '',
        DOCUMENT_SECTION,
        ''
    ];

    if (state.documentText) {
        lines.push(state.documentText.trimEnd(), '');
    }

    lines.push(
        NEW_COMMENT_SECTION,
        '',
        createCommentSyncMarker(state.syncLabel),
        ''
    );

    if (state.draftText) {
        lines.push(state.draftText.trimEnd(), '');
    }

    lines.push(COMMENTS_SECTION, '');

    if (!includeComments) {
        lines.push('*Comment mirroring is disabled.*');
    } else if (comments.length === 0) {
        lines.push('*No comments yet.*');
    } else {
        comments.forEach((comment, index) => {
            const authorName = comment.user?.name || 'Linear';
            lines.push(`### ${authorName} - ${new Date(comment.createdAt).toLocaleString()}`, '');
            lines.push(comment.body, '');
            if (index < comments.length - 1) {
                lines.push('---', '');
            }
        });
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

function extractSyncLabel(markerLine?: string): string | null {
    if (!markerLine) return null;
    if (!markerLine.startsWith(COMMENT_SYNC_PREFIX) || !markerLine.endsWith(COMMENT_SYNC_SUFFIX)) {
        return null;
    }

    return markerLine.slice(COMMENT_SYNC_PREFIX.length, markerLine.length - COMMENT_SYNC_SUFFIX.length).trim() || null;
}

function readManagedSection(content: string, sectionHeadings: string[], nextHeadings: string[]): string | null {
    const startHeading = sectionHeadings
        .map(heading => ({ heading, index: content.indexOf(heading) }))
        .filter(item => item.index >= 0)
        .sort((left, right) => left.index - right.index)[0];

    if (!startHeading) {
        return null;
    }

    const bodyStart = startHeading.index + startHeading.heading.length;
    const bodyEnd = nextHeadings
        .map(heading => content.indexOf(heading, bodyStart))
        .filter(index => index >= 0)
        .sort((left, right) => left - right)[0];

    return content
        .slice(bodyStart, bodyEnd)
        .replace(/^\n+/, '')
        .trimEnd();
}
