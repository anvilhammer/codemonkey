import Anthropic from '@anthropic-ai/sdk';
import { Message } from '../vscode/types/chat';
import { logger } from '../utils/logger';
import { ModelService } from './ModelService';
import { HierarchicalCacheService } from './CacheService';
import { ContextManager } from './ContextManager';
import { ModelType } from './ModelService';
import { SYSTEM_PROMPT } from './SystemPrompts';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as vscode from 'vscode';

const envPath = path.join(__dirname, '..', '..', '.env');
dotenv.config({ path: envPath });


export class ClaudeService {
    private readonly client: Anthropic;
    private readonly modelService: ModelService;
    private readonly cacheService: HierarchicalCacheService;
    private readonly contextManager: ContextManager;

    constructor() {
        logger.info('API Key status:', process.env.CLAUDE_API_KEY ? 'Found' : 'Not found');
        logger.info('Looking for .env at:', envPath);
        
        if (!process.env.CLAUDE_API_KEY) {
            throw new Error(`CLAUDE_API_KEY is not set in environment variables. Looking for .env at: ${envPath}`);
        }
        this.client = new Anthropic({
            apiKey: process.env.CLAUDE_API_KEY
        });
        this.modelService = ModelService.getInstance();
        this.modelService.setModel('haiku');
        this.cacheService = new HierarchicalCacheService();
        this.contextManager = ContextManager.getInstance();
    }

      // Make sure setModel persists the change
        setModel(modelType: ModelType): void {
        this.modelService.setModel(modelType);
        logger.info(`Model changed to ${modelType}`);
    }

        private async structureContent(rawContent: string, tags: string[]): Promise<void> {
        try {
            // Store raw content (Level 0)
            const rawId = await this.cacheService.store(
                0,
                rawContent,
                tags
            );

            // Parse and structure the content
            const structured = {
                codeBlocks: this.extractCodeBlocks(rawContent),
                systemCommands: this.extractSystemCommands(rawContent),
                explanations: this.extractExplanations(rawContent),
                suggestions: this.extractSuggestions(rawContent),
                timestamp: Date.now()
            };

            // Store structured version (Level 1)
            await this.cacheService.store(
                1,
                JSON.stringify(structured, null, 2),
                [...tags, 'structured'],
                rawId  // Link to raw content
            );

            logger.info('Content structured and cached at levels 0 and 1');
        } catch (error) {
            logger.error('Failed to structure content:', error);
        }
    }

    private extractCodeBlocks(content: string): string[] {
        const codeBlockRegex = /```[\s\S]*?```/g;
        return content.match(codeBlockRegex) || [];
    }

    private extractSystemCommands(content: string): string[] {
        const commandRegex = /<systemCommand>([\s\S]*?)<\/systemCommand>/g;
        const matches = [];
        let match;
        while ((match = commandRegex.exec(content)) !== null) {
            matches.push(match[1]);
        }
        return matches;
    }

    private extractExplanations(content: string): string[] {
        // Extract content not in code blocks or commands
        const cleanContent = content
            .replace(/```[\s\S]*?```/g, '')
            .replace(/<systemCommand>[\s\S]*?<\/systemCommand>/g, '');
        
        return cleanContent
            .split('\n\n')
            .map(p => p.trim())
            .filter(p => p.length > 0);
    }

    private extractSuggestions(content: string): string[] {
        const suggestions = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/\b(suggest|recommend|could|should|might)\b/i)) {
                suggestions.push(lines[i].trim());
            }
        }
        return suggestions;
    }
    
    async sendMessage(message: string, history: Message[]): Promise<string> {
        try {
            logger.info('Preparing to send message to Claude API');

            // Check cache first
            const cacheResults = await this.cacheService.findByTags(
                ['message', ...this.extractTags(message)],
                0 // Raw level
            );

            if (cacheResults.length > 0) {
                logger.info('Cache hit, returning cached response');
                return cacheResults[0].content;
            }

            // Analyze task complexity
            const complexity = this.analyzeComplexity(message);
            const currentModel = this.modelService.getCurrentModel();
            let suggestedModel: ModelType = 'haiku';
            let useModelForMessage: ModelType = currentModel;  // The model we'll actually use
            
            if (complexity >= 0.8) {
                suggestedModel = 'opus';
            } else if (complexity >= 0.5) {
                suggestedModel = 'sonnet';
            }

            if (suggestedModel !== currentModel) {
                const response = await vscode.window.showInformationMessage(
                    `This task's complexity is better served by ${suggestedModel}. Would you like to send this message to ${suggestedModel} or keep using ${currentModel}?`,
                    { modal: true },
                    suggestedModel,  // First button - recommended option
                    currentModel     // Second button - keep current
                );
                
                // Use suggested model just for this message if selected
                useModelForMessage = response || currentModel;
                logger.info(`Using ${useModelForMessage} for this message (default model remains ${currentModel})`);
            }

            // Store original model and set temporary one for this message
            const originalModel = this.modelService.getCurrentModel();
            this.modelService.setModel(useModelForMessage);

            // Optimize context
            const contextWindow = await this.contextManager.optimizeContext(
                history,
                4000
            );

            // Clean messages for API by only including role and content
            const cleanMessages = contextWindow.messages.map(({ role, content }) => ({
                role,
                content
            }));

            const response = await this.client.messages.create({
                model: this.modelService.getModelString(),
                max_tokens: 4000,
                messages: [
                    ...cleanMessages,
                    { role: 'user', content: message }
                ],
                system: SYSTEM_PROMPT
            });

            const responseContent = response.content[0].text;

            // Structure and store the content in cache hierarchy
            const tags = this.extractTags(message);
            await this.structureContent(responseContent, tags);

            // Log token usage
            logger.info('Token usage:', {
                prompt: response.usage?.input_tokens || 0,
                completion: response.usage?.output_tokens || 0,
                total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
            });

            // Restore original model
            this.modelService.setModel(originalModel);
            logger.info(`Restored model to ${originalModel}`);

            return responseContent;

        } catch (error) {
            logger.error('Error in Claude service:', error);
            throw error;
        }
    }

       private analyzeComplexity(message: string): number {
        const complexityIndicators = {
            code: /(function|class|import|export|async|await)/g,
            systemCommands: /<systemCommand>/g,
            fileOperations: /(CREATE_FILE|WRITE_TO_FILE|READ_FILE|DELETE_FILE)/g,
            architecture: /(architecture|design pattern|database schema|api|authentication)/gi
        };

        let complexityScore = 0;
        const messageLength = message.length;

        // Length-based complexity (0.1 - 0.3)
        complexityScore += Math.min(0.3, messageLength / 1000);

        // Feature-based complexity (0.0 - 0.7)
        Object.values(complexityIndicators).forEach(pattern => {
            const matches = (message.match(pattern) || []).length;
            complexityScore += matches * 0.1;
        });

        return Math.min(1, complexityScore);
    }

    private extractTags(message: string): string[] {
        const tags = new Set<string>();

        // Extract technical terms
        const techTerms = message.match(
            /\b(?:react|vue|angular|node|api|database|auth|docker|kubernetes|aws|azure|git|ci|cd)\b/gi
        );
        if (techTerms) {
            techTerms.forEach(term => tags.add(term.toLowerCase()));
        }

        // Extract action types
        const actions = message.match(
            /\b(?:create|update|delete|read|install|deploy|configure|debug|test|optimize)\b/gi
        );
        if (actions) {
            actions.forEach(action => tags.add(action.toLowerCase()));
        }

        return Array.from(tags);
    }
}