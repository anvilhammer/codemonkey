import { Message } from '../vscode/types/chat';
import { ModelService, MODELS } from './ModelService';
import { ContextManager } from './ContextManager';
import { getSystemPromptForModel } from './SystemPrompts';
import { logger } from '../utils/logger';

interface MessageContent {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface FormattedMessages {
    messages: MessageContent[];
    system?: string;
    totalTokens: number;
    isClaudeModel: boolean;
}

export class MessageService {
    private static instance: MessageService;
    private modelService: ModelService;
    private contextManager: ContextManager;
    private readonly MAX_GPT_MESSAGES = 5; // Limit the number of messages for GPT

    private constructor() {
        this.modelService = ModelService.getInstance();
        this.contextManager = ContextManager.getInstance();
    }

    static getInstance(): MessageService {
        if (!MessageService.instance) {
            MessageService.instance = new MessageService();
        }
        return MessageService.instance;
    }

    async formatMessagesForModel(
        message: string,
        history: Message[],
        workspaceContext: string
    ): Promise<FormattedMessages> {
        const currentModel = this.modelService.getCurrentModel();
        const isClaudeModel = !currentModel.startsWith('gpt');
        
        // Get model token limits
        const modelConfig = MODELS[currentModel];
        const maxContextTokens = modelConfig.contextTokenLimit;
        const maxOutputTokens = modelConfig.outputTokenLimit;
        
        // Reserve more space for GPT models
        const reserveTokens = isClaudeModel ? maxOutputTokens : maxOutputTokens * 1.5;
        const availableContextTokens = maxContextTokens - Math.ceil(reserveTokens);

        logger.info(`Model: ${currentModel}, Max Tokens: ${maxContextTokens}, Available: ${availableContextTokens}`);

        // Format the contextualized message, but be more concise for GPT
        const contextualizedMessage = isClaudeModel ? 
            `${workspaceContext}\n\nUser Message: ${message}` :
            `Current workspace: ${workspaceContext.split('\n')[0]}\n\nUser Message: ${message}`;

        const systemPrompt = getSystemPromptForModel(currentModel);

        if (!isClaudeModel) {
            // OpenAI format - be more aggressive with context reduction
            const recentHistory = history.slice(-this.MAX_GPT_MESSAGES);
    
            const formattedMessages: MessageContent[] = [
                { role: 'system', content: systemPrompt },
                ...recentHistory.map(msg => ({
                    role: msg.role as 'user' | 'assistant',
                    content: msg.content
                })),
                { role: 'user', content: contextualizedMessage }
            ];

            // Check token count and trim if needed
            let currentTokens = this.estimateTokens(formattedMessages);
            logger.info(`Initial GPT tokens: ${currentTokens}, Limit: ${availableContextTokens}`);

            while (currentTokens > availableContextTokens && formattedMessages.length > 2) {
                formattedMessages.splice(1, 1); // Remove oldest non-system message
                currentTokens = this.estimateTokens(formattedMessages);
                logger.info(`Reduced GPT tokens to: ${currentTokens}`);
            }

            return {
                messages: formattedMessages,
                totalTokens: currentTokens,
                isClaudeModel: false
            };
        } else {
            // Claude format - can handle more context
            const { messages: optimizedHistory } = await this.contextManager.optimizeContext(
                history,
                availableContextTokens
            );

            const formattedMessages: MessageContent[] = optimizedHistory.map(msg => ({
                role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: msg.content
            }));

            formattedMessages.push({
                role: 'user',
                content: contextualizedMessage
            });

            const totalTokens = this.estimateTokens(formattedMessages);
            logger.info(`Claude tokens: ${totalTokens}`);

            return {
                messages: formattedMessages,
                system: systemPrompt,
                totalTokens,
                isClaudeModel: true
            };
        }
    }

    private estimateTokens(messages: MessageContent[]): number {
        // Rough estimation: ~4 chars per token
        const totalChars = messages.reduce((total, msg) => {
            return total + msg.content.length;
        }, 0);
        
        const estimatedTokens = Math.ceil(totalChars / 4);
        return estimatedTokens;
    }
}