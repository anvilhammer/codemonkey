// src/services/types.ts
import { Message } from '../vscode/types/chat';

export type CacheLevel = 0 | 1 | 2 | 3;

export interface CacheEntry {
    id: string;
    level: CacheLevel;
    content: string;
    tags: string[];
    parentId?: string;
    metadata: {
        timestamp: number;
        tokensUsed?: number;
        model?: string;
        cost?: number;
    };
}

export interface CacheSearchResult {
    entry: CacheEntry;
    similarity: number;
}

export interface ContextWindow {
    messages: Message[];
    totalTokens: number;
}

export interface ModelConfig {
    id: string;
    name: string;
    contextWindow: number;
    maxOutputTokens: number;
    costPerToken: number;
    priority: number;
}

export interface TokenUsage {
    prompt: number;
    completion: number;
    total: number;
    cost: number;
}