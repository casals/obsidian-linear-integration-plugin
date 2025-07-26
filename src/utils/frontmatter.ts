import { App, TFile, CachedMetadata } from 'obsidian';
import { NoteFrontmatter } from '../models/types';


export function parseFrontmatter(app: App, file: TFile): NoteFrontmatter {
    const cachedMetadata: CachedMetadata | null = app.metadataCache.getFileCache(file);
    
    if (!cachedMetadata?.frontmatter) {
        return {} as NoteFrontmatter;
    }
    
    const frontmatter = cachedMetadata.frontmatter;
    const result: NoteFrontmatter = {} as NoteFrontmatter;
    
    Object.entries(frontmatter).forEach(([key, value]) => {
        if (key !== 'position') {
            (result as any)[key] = value;
        }
    });
    
    return result;
}

export async function updateFrontmatter(app: App, file: TFile, newFrontmatter: NoteFrontmatter): Promise<void> {
    await app.fileManager.processFrontMatter(file, (frontmatter) => {
        // Clear existing frontmatter
        Object.keys(frontmatter).forEach(key => {
            if (key !== 'position') { // Don't delete Obsidian's internal position property
                delete frontmatter[key];
            }
        });
        
        // Add new frontmatter properties
        Object.entries(newFrontmatter).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                frontmatter[key] = value;
            }
        });
    });
}