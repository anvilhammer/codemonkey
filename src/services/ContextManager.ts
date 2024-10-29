import { Message } from '../vscode/types/chat';
import { HierarchicalCacheService } from './CacheService';
import { ModelService } from './ModelService';
import { logger } from '../utils/logger';
import type { ContextWindow, CacheLevel } from '../services/types';
import { Anthropic } from '@anthropic-ai/sdk';

export class ContextManager {
    private static instance: ContextManager;
    private readonly cacheService: HierarchicalCacheService;
    private readonly modelService: ModelService;
    private readonly client: Anthropic;

    private constructor() {
        this.cacheService = new HierarchicalCacheService();
        this.modelService = ModelService.getInstance();
        this.client = new Anthropic({
            apiKey: process.env.CLAUDE_API_KEY || ''
        });
    }

    static getInstance(): ContextManager {
        if (!ContextManager.instance) {
            ContextManager.instance = new ContextManager();
        }
        return ContextManager.instance;
    }

    async optimizeContext(
        messages: Message[],
        maxTokens: number
    ): Promise<ContextWindow> {
        const priorityMessages = this.getPriorityMessages(messages);
        let totalTokens = this.estimateTokenCount(priorityMessages);

        if (totalTokens <= maxTokens) {
            return { messages: priorityMessages, totalTokens };
        }

        // Try to use cached summaries for older messages
        const summarizedMessages = await this.summarizeOldMessages(
            messages,
            maxTokens
        );

        totalTokens = this.estimateTokenCount(summarizedMessages);
        if (totalTokens <= maxTokens) {
            return { messages: summarizedMessages, totalTokens };
        }

        // If still too large, truncate while keeping essential context
        return this.truncateContext(summarizedMessages, maxTokens);
    }

    private getPriorityMessages(messages: Message[]): Message[] {
        return messages.filter(msg => {
            // Keep system messages
            if (msg.role === 'assistant' || msg.role === 'user') {
                // Keep recent messages
                const isRecent = Date.now() - (msg.timestamp || 0) < 30 * 60 * 1000; // 30 minutes
                
                // Keep messages with code or important content
                const hasCode = msg.content.includes('```') || msg.content.includes('systemCommand');
                const isImportant = msg.content.includes('CREATE FILE:') || 
                                msg.content.includes('WRITE TO FILE:') ||
                                msg.content.includes('DEBUG:');
                
                return isRecent || hasCode || isImportant;
            }
            return true;
        });
    }

    private estimateTokenCount(messages: Message[]): number {
        // Rough estimation: 1 token ≈ 4 characters for English text
        return Math.ceil(
            messages.reduce((sum, msg) => sum + msg.content.length / 4, 0)
        );
    }

    private async summarizeOldMessages(
        messages: Message[],
        maxTokens: number
    ): Promise<Message[]> {
        const recentMessages = messages.slice(-5); // Keep last 5 messages as is
        const olderMessages = messages.slice(0, -5);

        if (olderMessages.length === 0) {
            return recentMessages;
        }

        try {
            // Check cache first
            const cacheKey = this.generateCacheKey(olderMessages);
            const cachedResults = await this.cacheService.findByTags(
                ['summary', cacheKey],
                2 as CacheLevel
            );

            if (cachedResults.length > 0) {
                logger.info('Using cached summary for old messages');
                return [
                    {
                        role: 'assistant',
                        content: cachedResults[0].content,
                        timestamp: Date.now()
                    },
                    ...recentMessages
                ];
            }

            // Generate new summary using cheaper model
            const currentModel = this.modelService.getCurrentModel();
            this.modelService.setModel('haiku'); // Use enum value instead of string

            // Format messages for summarization
            const formattedMessages = olderMessages
                .map(m => `${m.role}: ${m.content}`)
                .join('\n\n');

            // Create summary prompt
            const summaryPrompt = `Summarize the key points from this conversation, focusing on:
- Code changes and file operations
- Important decisions made
- Current task context and requirements
- Debug information and error states
Be concise and focus on technically relevant details.\n\n${formattedMessages}`;

            // Generate summary using Claude API
            const response = await this.client.messages.create({
                model: this.modelService.getModelString(),
                max_tokens: 500,
                messages: [{
                    role: 'user',
                    content: summaryPrompt
                }]
            });

            const summaryContent = response.content[0].text;

            // Store in cache
            await this.cacheService.store(
                2 as CacheLevel,
                summaryContent,
                ['summary', ...this.extractTags(olderMessages)]
            );

            // Restore original model
            this.modelService.setModel(currentModel);

            return [
                {
                    role: 'assistant',
                    content: summaryContent,
                    timestamp: Date.now()
                },
                ...recentMessages
            ];

        } catch (error) {
            logger.error('Failed to process message summary:', error);
            // Fallback: keep most recent messages that fit within token limit
            return this.truncateContext(messages, maxTokens).messages;
        }
    }

    private generateCacheKey(messages: Message[]): string {
        return messages
            .map(m => `${m.role}:${m.content.substring(0, 100)}`)
            .join('\n');
    }

    private extractTags(messages: Message[]): string[] {
        const tags = new Set<string>();
        
        // Technical terms and operations
        const patterns = {
            languages: /\b(?:javascript|typescript|python|java|rust|go)\b/gi,
            frameworks: /\b(?:react|vue|angular|next|nest|express)\b/gi,
            operations: /\b(?:create|update|delete|read|deploy|test)\b/gi,
            components: /\b(?:component|module|service|controller|middleware)\b/gi,
            infrastructure: /\b(?:docker|kubernetes|aws|azure|gcp)\b/gi,
            debugging: /\b(?:error|bug|fix|issue|debug)\b/gi,
            fileOps: /\b(?:file|directory|path|import|export)\b/gi,
            database: /\b(?:database|sql|nosql|mongodb|postgres)\b/gi
        };

        messages.forEach(msg => {
            Object.values(patterns).forEach(pattern => {
                const matches = msg.content.match(pattern);
                if (matches) {
                    matches.forEach(match => tags.add(match.toLowerCase()));
                }
            });

            // Extract VSCode extension specific tags
            if (msg.content.includes('systemCommand')) {
                tags.add('system-command');
            }
            if (msg.content.includes('CREATE FILE:') || msg.content.includes('WRITE TO FILE:')) {
                tags.add('file-operation');
            }
            if (msg.content.includes('DEBUG:')) {
                tags.add('debug');
            }
        });

        return Array.from(tags);
    }

    private truncateContext(messages: Message[], maxTokens: number): ContextWindow {
        // Priority messages to keep
        const essential = messages.filter(msg => 
            msg.role === 'assistant' || 
            msg.content.includes('systemCommand') ||
            msg.content.includes('CREATE FILE:') ||
            msg.content.includes('DEBUG:')
        );

        const nonEssential = messages.filter(msg => 
            !essential.includes(msg)
        );

        const essentialTokens = this.estimateTokenCount(essential);
        const remainingTokens = maxTokens - essentialTokens;

        if (remainingTokens <= 0) {
            logger.warn('Not enough tokens for context after essential messages');
            return {
                messages: essential,
                totalTokens: essentialTokens
            };
        }

        const result: Message[] = [...essential];
        let currentTokens = essentialTokens;

        // Add most recent non-essential messages that fit
        for (let i = nonEssential.length - 1; i >= 0; i--) {
            const msgTokens = this.estimateTokenCount([nonEssential[i]]);
            if (currentTokens + msgTokens <= maxTokens) {
                result.unshift(nonEssential[i]);
                currentTokens += msgTokens;
            } else {
                break;
            }
        }

        logger.info(`Context truncated to ${result.length} messages (${currentTokens} tokens)`);
        return {
            messages: result,
            totalTokens: currentTokens
        };
    }
}