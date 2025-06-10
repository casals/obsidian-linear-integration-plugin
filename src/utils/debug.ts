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
            debugLog.log('🐛 Linear Plugin Debug Mode: ENABLED');
        }
    }

    log(...args: any[]): void {
        if (this.debugEnabled) {
            debugLog.log('[Linear Plugin]', ...args);
        }
    }

    warn(...args: any[]): void {
        if (this.debugEnabled) {
            debugLog.warn('[Linear Plugin]', ...args);
        }
    }

    error(...args: any[]): void {
        // Always show errors, regardless of debug mode
        debugLog.error('[Linear Plugin]', ...args);
    }

    group(label: string): void {
        if (this.debugEnabled) {
            debugLog.group(`[Linear Plugin] ${label}`);
        }
    }

    groupEnd(): void {
        if (this.debugEnabled) {
            debugLog.groupEnd();
        }
    }

    table(data: any): void {
        if (this.debugEnabled) {
            debugLog.table(data);
        }
    }

    time(label: string): void {
        if (this.debugEnabled) {
            debugLog.time(`[Linear Plugin] ${label}`);
        }
    }

    timeEnd(label: string): void {
        if (this.debugEnabled) {
            debugLog.timeEnd(`[Linear Plugin] ${label}`);
        }
    }
}

// Export singleton instance
export const debugLog = DebugLogger.getInstance();