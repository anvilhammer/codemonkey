import { Message } from '../vscode/types/chat';
import { CacheService } from './CacheService';
import { ModelService } from './ModelService';
import { logger } from '../utils/logger';

export interface ContextWindow {
    messages: Message[];
    totalTokens: number;
}

export class ContextManager {
    private static instance: ContextManager;
    private readonly cacheService: CacheService;
    private readonly modelService: ModelService;
    private readonly MAX_SUMMARY_LENGTH = 500;
    private readonly MAX_RECENT_MESSAGES = 10;

    private constructor() {
        this.cacheService = CacheService.getInstance();
        this.modelService = ModelService.getInstance();
    }

    static getInstance(): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager();
        }
        return ContextManager.instance;
    }

    async optimizeContext(
        messages: Message[],
        maxTokens?: number
    ): Promise<ContextWindow> {
        try {
            const availableTokens = maxTokens || this.modelService.getCurrentTokenLimit();
            const priorityMessages = this.getPriorityMessages(messages);
            const totalTokens = this.estimateTokenCount(priorityMessages);
    
            if (totalTokens <= availableTokens) {
                return { messages: priorityMessages, totalTokens };
            }
    
            return this.truncateContext(priorityMessages, availableTokens);
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
            const isRecent = Date.now() - (msg.timestamp || 0) < 30 * 60 * 1000;
            const hasCode = msg.content.includes('```') || msg.content.includes('systemCommand');
            const isFileOperation = msg.content.includes('CREATE FILE:') || 
                                  msg.content.includes('WRITE TO FILE:') ||
                                  msg.content.includes('DEBUG:');
            
            return isRecent || hasCode || isFileOperation;
        });
    }

    private estimateTokenCount(messages: Message[]): number {
        const metadataOverhead = 20;
        return Math.ceil(messages.reduce((sum, msg) => 
            sum + (msg.content.length / 4) + metadataOverhead, 0
        ));
    }

    private async truncateContext(
        messages: Message[],
        maxTokens: number
    ): Promise<ContextWindow> {
        const result: Message[] = [];
        let totalTokens = 0;
        
        // Process messages from most recent to oldest
        const recentMessages = [...messages].reverse();

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
}