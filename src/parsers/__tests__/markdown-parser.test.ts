import { MarkdownParser } from '../markdown-parser';

describe('MarkdownParser', () => {
    it('keeps body text when inline tags are placed on separate lines', () => {
        const content = [
            '# Parser Regression',
            '',
            '@team/Dev',
            '@status/Backlog',
            '@project/Alpha',
            '@priority/2',
            '@label/e2e-regression',
            '',
            'seed-from-obsidian parser regression',
            '',
            'This text should survive tag stripping.'
        ].join('\n');

        expect(MarkdownParser.convertToLinearDescription(content)).toBe([
            'seed-from-obsidian parser regression',
            '',
            'This text should survive tag stripping.'
        ].join('\n'));
    });

    it('keeps headings when converting note content for Linear documents', () => {
        const content = [
            '---',
            'foo: bar',
            '---',
            '# Source Note',
            '',
            'Body text',
            '',
            '[[Another Note]]'
        ].join('\n');

        expect(MarkdownParser.convertToLinearDocumentContent(content)).toBe([
            '# Source Note',
            '',
            'Body text',
            '',
            '[Another Note]'
        ].join('\n'));
    });
});
