import { TAbstractFile, TFile, TFolder, Vault } from 'obsidian';

/**
 * Safely gets a folder by path with type checking
 */
export function getFolderByPath(vault: Vault, path: string): TFolder {
    const file = vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFolder)) {
        throw new Error(`Sync folder not found or is not a directory: ${path}`);
    }
    return file;
}

/**
 * Safely gets a file by path with type checking
 */
export function getFileByPath(vault: Vault, path: string): TFile {
    const file = vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
        throw new Error(`Config file not found or is not a file: ${path}`);
    }
    return file;
}

/**
 * Type predicate to check if a file is a markdown file
 */
export function isMdFile(child: TAbstractFile): child is TFile {
    return child instanceof TFile && child.extension === 'md';
}

/**
 * Filters folder children to get only markdown files
 */
export function getMdFilesFromFolder(folder: TFolder): TFile[] {
    return folder.children.filter(isMdFile);
}