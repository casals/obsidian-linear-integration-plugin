class DebugLogger {
    private static instance: DebugLogger;
    private debugEnabled: boolean = false;

    static getInstance(): DebugLogger {
        if (!DebugLogger.instance) {
            DebugLogger.instance = new DebugLogger();
        }
        return DebugLogger.instance;
    }

    setDebugMode(enabled: boolean): void {
        this.debugEnabled = enabled;
        if (enabled) {
            console.log('🐛 Linear Plugin Debug Mode: ENABLED');
        }
    }

    log(...args: any[]): void {
        if (this.debugEnabled) {
            console.log('[Linear Plugin]', ...args);
        }
    }

    warn(...args: any[]): void {
        if (this.debugEnabled) {
            console.warn('[Linear Plugin]', ...args);
        }
    }

    error(...args: any[]): void {
        // Always show errors, regardless of debug mode
        console.error('[Linear Plugin]', ...args);
    }

    group(label: string): void {
        if (this.debugEnabled) {
            console.group(`[Linear Plugin] ${label}`);
        }
    }

    groupEnd(): void {
        if (this.debugEnabled) {
            console.groupEnd();
        }
    }

    table(data: any): void {
        if (this.debugEnabled) {
            console.table(data);
        }
    }

    time(label: string): void {
        if (this.debugEnabled) {
            console.time(`[Linear Plugin] ${label}`);
        }
    }

    timeEnd(label: string): void {
        if (this.debugEnabled) {
            console.timeEnd(`[Linear Plugin] ${label}`);
        }
    }
}

// Export singleton instance
export const debugLog = DebugLogger.getInstance();