/**
 * Safely assigns a property to an object with unknown structure
 */
export function setDynamicProperty<T extends Record<string, unknown>>(
    obj: T, 
    key: string, 
    value: unknown
): void {
    (obj as Record<string, unknown>)[key] = value;
}

/**
 * Safely gets a property from an object with unknown structure
 */
export function getDynamicProperty<T>(
    obj: Record<string, unknown>, 
    key: string
): T | undefined {
    return obj[key] as T;
}

/**
 * Type guard to check if an object has a specific property
 */
export function hasProperty<K extends string>(
    obj: Record<string, unknown>, 
    key: K
): obj is Record<K, unknown> {
    return key in obj && obj[key] !== undefined;
}