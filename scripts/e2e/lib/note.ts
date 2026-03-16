import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { NoteFrontmatter, ParsedNote } from '../types';

export function parseNote(content: string): ParsedNote {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) {
        return {
            raw: content,
            frontmatter: {},
            body: content
        };
    }

    return {
        raw: content,
        frontmatter: (YAML.parse(match[1]) ?? {}) as NoteFrontmatter,
        body: content.slice(match[0].length)
    };
}

export async function readNoteFromDisk(vaultPath: string, vaultRelativePath: string): Promise<ParsedNote> {
    const absolutePath = path.join(vaultPath, vaultRelativePath);
    const raw = await fs.readFile(absolutePath, 'utf8');
    return parseNote(raw);
}

export function assertFilePathInsideVault(vaultRelativePath: string): void {
    if (path.isAbsolute(vaultRelativePath) || vaultRelativePath.startsWith('../')) {
        throw new Error(`Unsafe vault relative path: ${vaultRelativePath}`);
    }
}

export function buildManagedBodyExpectations(body: string): boolean {
    return (body.includes('# Linear Issue') || body.includes('## Linear Issue'))
        && (body.includes('# Document') || body.includes('## Document'))
        && (body.includes('# New Comment') || body.includes('## New Comment'))
        && (body.includes('# Comments') || body.includes('## Comments'))
        && body.includes('--- Synced to Linear at ');
}

export async function findRunNotePaths(
    vaultPath: string,
    runId: string,
    issueIds: string[],
    searchRoots: string[]
): Promise<string[]> {
    const matches = new Set<string>();
    const normalizedRoots = Array.from(new Set(searchRoots.filter(Boolean)));

    for (const root of normalizedRoots) {
        assertFilePathInsideVault(root);
        const absoluteRoot = path.join(vaultPath, root);
        for (const absolutePath of await collectMarkdownFiles(absoluteRoot)) {
            const raw = await fs.readFile(absolutePath, 'utf8');
            const parsed = parseNote(raw);
            const vaultRelativePath = path.relative(vaultPath, absolutePath).split(path.sep).join(path.posix.sep);
            const linearId = typeof parsed.frontmatter.linear_id === 'string' ? parsed.frontmatter.linear_id : '';

            if (vaultRelativePath.includes(runId) || raw.includes(runId) || (linearId && issueIds.includes(linearId))) {
                matches.add(vaultRelativePath);
            }
        }
    }

    return Array.from(matches);
}

async function collectMarkdownFiles(rootPath: string): Promise<string[]> {
    try {
        const stats = await fs.stat(rootPath);
        if (!stats.isDirectory()) {
            return rootPath.endsWith('.md') ? [rootPath] : [];
        }
    } catch {
        return [];
    }

    const results: string[] = [];
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...await collectMarkdownFiles(absolutePath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith('.md')) {
            results.push(absolutePath);
        }
    }

    return results;
}
