import { LinearUser } from '../types';

const AGENT_USER_PATTERNS = [
    /\bcodex\b/i,
    /\bclaude\b/i,
    /\bcursor\b/i,
    /\bcopilot\b/i,
    /\bchatgpt\b/i,
    /\bgpt(?:-\d+)?\b/i,
    /\bagent\b/i,
    /\bbot\b/i
];

export function isAgentLikeUser(user: Pick<LinearUser, 'name' | 'email'>): boolean {
    const fingerprint = `${user.name} ${user.email}`.trim();
    return AGENT_USER_PATTERNS.some(pattern => pattern.test(fingerprint));
}

export function selectDefaultAssigneeCandidate(teamMembers: LinearUser[]): LinearUser | undefined {
    return teamMembers.find(member => !isAgentLikeUser(member));
}
