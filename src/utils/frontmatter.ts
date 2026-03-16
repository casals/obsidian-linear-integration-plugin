import { App, TFile, CachedMetadata } from 'obsidian';
import { NoteFrontmatter } from '../models/types';

// Obsidian injects a `position` key into every frontmatter object — never read or write it.
const OBSIDIAN_INTERNAL_FM_KEY = 'position';

export function parseFrontmatter(app: App, file: TFile): NoteFrontmatter {
    const cachedMetadata: CachedMetadata | null = app.metadataCache.getFileCache(file);
    
    if (!cachedMetadata?.frontmatter) {
        return {} as NoteFrontmatter;
    }
    
    const frontmatter = cachedMetadata.frontmatter;
    const result: NoteFrontmatter = {} as NoteFrontmatter;
    
    Object.entries(frontmatter).forEach(([key, value]) => {
        if (key !== OBSIDIAN_INTERNAL_FM_KEY) {
            (result as any)[key] = value;
        }
    });
    
    return result;
}

export async function updateFrontmatter(app: App, file: TFile, newFrontmatter: NoteFrontmatter): Promise<void> {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
        // Only update/add the provided keys — never delete user-defined properties.
        // This preserves wikilink values like "[[AMIO]]" that the user set manually,
        // since Obsidian's YAML serializer strips quotes from [[...]] strings when
        // it rewrites the entire frontmatter block.
        Object.entries(newFrontmatter).forEach(([key, value]) => {
            if (key !== OBSIDIAN_INTERNAL_FM_KEY && value !== undefined && value !== null) {
                frontmatter[key] = value;
            }
        });
    });
}

export function splitFrontmatter(content: string): { frontmatterBlock: string; body: string } {
    const frontmatterMatch = content.match(/^(---\n[\s\S]*?\n---\n?)/);
    if (!frontmatterMatch) {
        return { frontmatterBlock: '', body: content };
    }

    return {
        frontmatterBlock: frontmatterMatch[1],
        body: content.slice(frontmatterMatch[1].length)
    };
}

export async function replaceNoteBody(app: App, file: TFile, newBody: string): Promise<void> {
    const content = await app.vault.read(file);
    const { frontmatterBlock } = splitFrontmatter(content);
    const normalizedBody = newBody.endsWith('\n') ? newBody : `${newBody}\n`;
    await app.vault.modify(file, `${frontmatterBlock}${normalizedBody}`);
}
