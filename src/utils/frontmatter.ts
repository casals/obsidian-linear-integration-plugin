import { NoteFrontmatter, FrontmatterObject } from '../models/types';
import { setDynamicProperty } from './type-utils';


export function parseFrontmatter(content: string): NoteFrontmatter {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontmatterRegex);
    
    if (!match) {
        return {};
    }

    const frontmatterText = match[1];
    const frontmatter: NoteFrontmatter = {};

    // Simple YAML parser 
    const lines = frontmatterText.split('\n');
    let currentKey: string | null = null;
    let currentArray: string[] = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (!trimmedLine || trimmedLine.startsWith('#')) {
            continue;
        }

        // Check if this is an array item
        if (trimmedLine.startsWith('- ')) {
            if (currentKey) {
                currentArray.push(trimmedLine.substring(2).trim());
            }
            continue;
        }

        // If we were building an array, save it
        if (currentKey && currentArray.length > 0) {
            setDynamicProperty(frontmatter as FrontmatterObject, currentKey, currentArray);
            currentArray = [];
            currentKey = null;
        }

        // Parse key-value pairs
        const colonIndex = trimmedLine.indexOf(':');
        if (colonIndex > 0) {
            const key = trimmedLine.substring(0, colonIndex).trim();
            const value = trimmedLine.substring(colonIndex + 1).trim();

            if (value === '') {
                // This might be the start of an array
                currentKey = key;
                currentArray = [];
            } else {
                // Regular key-value pair
                setDynamicProperty(frontmatter as FrontmatterObject, key, parseValue(value));
            }
        }
    }

    // Handle last array if any
    if (currentKey && currentArray.length > 0) {
        setDynamicProperty(frontmatter as FrontmatterObject, currentKey, currentArray);
    }

    return frontmatter;
}

export function updateFrontmatter(content: string, newFrontmatter: NoteFrontmatter): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);
    
    const yamlContent = serializeFrontmatter(newFrontmatter);
    const newFrontmatterBlock = `---\n${yamlContent}\n---\n`;
    
    if (match) {
        // Replace existing frontmatter
        return content.replace(frontmatterRegex, newFrontmatterBlock);
    } else {
        // Add frontmatter to beginning
        return newFrontmatterBlock + content;
    }
}

function serializeFrontmatter(frontmatter: NoteFrontmatter): string {
    const lines: string[] = [];

    Object.entries(frontmatter).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }

        if (Array.isArray(value)) {
            if (value.length > 0) {
                lines.push(`${key}:`);
                value.forEach(item => {
                    lines.push(`  - ${serializeValue(item)}`);
                });
            }
        } else {
            lines.push(`${key}: ${serializeValue(value)}`);
        }
    });

    return lines.join('\n');
}

function parseValue(value: string): any {
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }

    // Parse numbers
    if (/^\d+$/.test(value)) {
        return parseInt(value, 10);
    }

    if (/^\d+\.\d+$/.test(value)) {
        return parseFloat(value);
    }

    // Parse booleans
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Return as string
    return value;
}

function serializeValue(value: any): string {
    if (typeof value === 'string') {
        // Quote strings that contain special characters
        if (value.includes(':') || value.includes('#') || value.includes('\n')) {
            return `"${value.replace(/"/g, '\\"')}"`;
        }
        return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    return String(value);
}