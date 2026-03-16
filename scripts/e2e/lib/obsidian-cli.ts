import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ParamValue = string | number | boolean;

export class ObsidianCli {
    constructor(private vaultName: string) {}

    async reloadPlugin(pluginId: string): Promise<void> {
        await this.run('plugin:reload', { id: pluginId });
    }

    async getErrors(): Promise<string> {
        return this.run('dev:errors');
    }

    async getConsole(level: 'log' | 'warn' | 'error' | 'info' | 'debug' = 'error'): Promise<string> {
        return this.run('dev:console', { level, limit: 200 });
    }

    async screenshot(destination: string): Promise<void> {
        await this.run('dev:screenshot', { path: destination });
    }

    async domText(selector: string, all = false): Promise<string> {
        return this.run('dev:dom', { selector }, all ? ['text', 'all'] : ['text']);
    }

    async eval<T = string>(code: string): Promise<T> {
        const output = await this.run('eval', { code });
        return this.normalizeEvalOutput(output) as T;
    }

    async evalJson<T>(code: string): Promise<T> {
        const payload = await this.eval<string>(code);
        return JSON.parse(payload) as T;
    }

    async open(path: string, newTab = false): Promise<void> {
        await this.run('open', { path }, newTab ? ['newtab'] : []);
    }

    async read(path: string): Promise<string> {
        return this.run('read', { path });
    }

    async create(path: string, content: string, open = false): Promise<void> {
        await this.run('create', { path, content }, open ? ['open', 'overwrite'] : ['overwrite']);
    }

    async setProperty(
        path: string,
        name: string,
        value: string | number | boolean | string[],
        type: 'text' | 'list' | 'number' | 'checkbox' | 'date' | 'datetime' = 'text'
    ): Promise<void> {
        const normalized = Array.isArray(value) ? value.join(', ') : String(value);
        await this.run('property:set', { path, name, value: normalized, type });
    }

    async delete(path: string): Promise<void> {
        await this.run('delete', { path }, ['permanent']);
    }

    private async run(command: string, params: Record<string, ParamValue> = {}, flags: string[] = []): Promise<string> {
        const args = [`vault=${this.vaultName}`, command];
        for (const [key, value] of Object.entries(params)) {
            args.push(`${key}=${String(value)}`);
        }
        args.push(...flags);

        const { stdout, stderr } = await execFileAsync('obsidian', args, {
            maxBuffer: 10 * 1024 * 1024
        });

        return `${stdout}${stderr}`.trim();
    }

    private normalizeEvalOutput(output: string): string {
        const markerIndex = output.lastIndexOf('=>');
        if (markerIndex >= 0) {
            return output.slice(markerIndex + 2).trim();
        }

        const lines = output
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        return lines[lines.length - 1] ?? '';
    }
}
