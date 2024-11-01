// src/services/ContextManager.ts

import { Message, Role, InternalRole } from '../vscode/types/chat';
import { CacheService } from './CacheService';
import { ModelService } from './ModelService';
import { logger } from '../utils/logger';
import { ClaudeService } from './ClaudeService';

export interface ContextWindow {
    messages: Message[];
    totalTokens: number;
}

// Change these lines
const SYSTEM_ROLE: InternalRole = 'system';
const ASSISTANT_ROLE: Role = 'assistant';

export class ContextManager {
    private static instance: ContextManager;
    private readonly cacheService: CacheService;
    private readonly modelService: ModelService;
    private readonly claudeService: ClaudeService;
    private readonly MAX_SUMMARY_LENGTH = 500;
    private readonly MAX_RECENT_MESSAGES = 10;

    private constructor() {
        this.cacheService = CacheService.getInstance();
        this.modelService = ModelService.getInstance();
        this.claudeService = new ClaudeService();
    }

    static getInstance(): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager();
        }
        return ContextManager.instance;
    }

    async optimizeContext(messages: Message[]): Promise<ContextWindow> {
        try {
            const availableTokens = this.modelService.getCurrentTokenLimit();
            const priorityMessages = this.getPriorityMessages(messages);
            let totalTokens = this.estimateTokenCount(priorityMessages);

            if (totalTokens <= availableTokens) {
                return { messages: priorityMessages, totalTokens };
            }

            const summarizedMessages = await this.summarizeOldMessages(messages);
            totalTokens = this.estimateTokenCount(summarizedMessages);
            
            if (totalTokens <= availableTokens) {
                return { messages: summarizedMessages, totalTokens };
            }

            return this.truncateContext(summarizedMessages, availableTokens);
        } catch (error) {
            logger.error('Error optimizing context:', error);
            const fallbackMessages = messages.slice(-this.MAX_RECENT_MESSAGES);
            return {
                messages: fallbackMessages,
                totalTokens: this.estimateTokenCount(fallbackMessages)
            };
        }
    }

    private getPriorityMessages(messages: Message[]): Message[] {
        return messages.filter(msg => {
            if (msg.role === SYSTEM_ROLE) return true;
            
            const isRecent = Date.now() - (msg.timestamp || 0) < 30 * 60 * 1000;
            
            const hasCode = msg.content.includes('```') || msg.content.includes('systemCommand');
            const isFileOperation = msg.content.includes('CREATE FILE:') || 
                                  msg.content.includes('WRITE TO FILE:') ||
                                  msg.content.includes('DEBUG:');
            
            const isImportantRole = msg.role === ASSISTANT_ROLE && 
                                  (msg.content.includes('code') || 
                                   msg.content.includes('systemCommand') || 
                                   msg.content.includes('error'));
            
            return isRecent || hasCode || isFileOperation || isImportantRole;
        });
    }

    private estimateTokenCount(messages: Message[]): number {
        const metadataOverhead = 20;
        return Math.ceil(messages.reduce((sum, msg) => 
            sum + (msg.content.length / 4) + metadataOverhead, 0
        ));
    }

    private async summarizeOldMessages(messages: Message[]): Promise<Message[]> {
        if (messages.length <= this.MAX_RECENT_MESSAGES) {
            return messages;
        }

        try {
            const recentMessages = messages.slice(-this.MAX_RECENT_MESSAGES);
            const oldMessages = messages.slice(0, -this.MAX_RECENT_MESSAGES);

            const systemMessages = messages.filter(msg => msg.role === SYSTEM_ROLE);
            const nonSystemOldMessages = oldMessages.filter(msg => msg.role !== SYSTEM_ROLE);

            const summaryPrompt = `Summarize the following conversation context concisely (max ${this.MAX_SUMMARY_LENGTH} chars). Focus on key decisions, file changes, and important technical details:\n\n${nonSystemOldMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`;

            const summary = await this.claudeService.sendMessage(summaryPrompt, []);

            const summaryMessage: Message = {
                role: ASSISTANT_ROLE,
                content: summary,
                timestamp: Date.now()
            };

            return [...systemMessages, summaryMessage, ...recentMessages];

        } catch (error) {
            logger.error('Error summarizing old messages:', error);
            return messages.slice(-this.MAX_RECENT_MESSAGES);
        }
    }

    private async truncateContext(
        messages: Message[],
        maxTokens: number
    ): Promise<ContextWindow> {
        const result: Message[] = [];
        let totalTokens = 0;
        
        const systemMessages = messages.filter(msg => msg.role === SYSTEM_ROLE);
        for (const msg of systemMessages) {
            const tokens = this.estimateTokenCount([msg]);
            if (totalTokens + tokens <= maxTokens) {
                result.push(msg);
                totalTokens += tokens;
            }
        }

        const recentMessages = messages
            .filter(msg => msg.role !== SYSTEM_ROLE)
            .reverse();

        for (const msg of recentMessages) {
            const tokens = this.estimateTokenCount([msg]);
            if (totalTokens + tokens <= maxTokens) {
                result.unshift(msg);
                totalTokens += tokens;
            } else {
                break;
            }
        }

        return { messages: result, totalTokens };
    }

    async analyzeContext(messages: Message[]): Promise<{
        totalTokens: number;
        priorityMessages: number;
        oldMessages: number;
        recentMessages: number;
        systemMessages: number;
        codeBlocks: number;
        fileOperations: number;
    }> {
        const priorityMessages = this.getPriorityMessages(messages);
        
        return {
            totalTokens: this.estimateTokenCount(messages),
            priorityMessages: priorityMessages.length,
            oldMessages: messages.length - this.MAX_RECENT_MESSAGES,
            recentMessages: Math.min(messages.length, this.MAX_RECENT_MESSAGES),
            systemMessages: messages.filter(msg => msg.role === SYSTEM_ROLE).length,
            codeBlocks: messages.filter(m => m.content.includes('```')).length,
            fileOperations: messages.filter(m => 
                m.content.includes('CREATE FILE:') || 
                m.content.includes('WRITE TO FILE:')
            ).length
        };
    }
}