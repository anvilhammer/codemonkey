// src/services/ClaudeService.ts

import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { Message, Role } from '../vscode/types/chat';
import { SYSTEM_PROMPT } from './SystemPrompts';
import { WorkspaceService } from './WorkspaceService';
import { CacheService } from './CacheService';
import { ModelService } from './ModelService';
import { ModelType } from './ModelService';

// Get the absolute path to .env from the extension root
const envPath = path.join(__dirname, '..', '..', '.env');
dotenv.config({ path: envPath });

if (!process.env.CLAUDE_API_KEY) {
    throw new Error(`CLAUDE_API_KEY is not set in environment variables. Looking for .env at: ${envPath}`);
}

export interface ClaudeServiceConfig {
    apiKey?: string;
    maxContextMessages?: number;
    contextWindowSize?: number;
    outputChannel?: vscode.OutputChannel;
}

export class ClaudeService {
    private client: Anthropic;
    private workspaceService: WorkspaceService;
    private modelService: ModelService;
    private cacheService: CacheService;
    private readonly outputChannel: vscode.OutputChannel;

    constructor(config?: ClaudeServiceConfig) {
        this.client = new Anthropic({
            apiKey: config?.apiKey || process.env.CLAUDE_API_KEY
        });
        this.outputChannel = config?.outputChannel || vscode.window.createOutputChannel('CodeMonkey');
        this.workspaceService = new WorkspaceService(this.outputChannel);
        this.cacheService = CacheService.getInstance();
        this.modelService = ModelService.getInstance();
    }

    private async prepareContext(history: Message[]): Promise<Message[]> {
        if (!history || history.length === 0) {
            return [];
        }

        return history;
    }

    private async getWorkspaceContext(): Promise<string> {
        try {
            const workspaceInfo = await this.workspaceService.getWorkspaceContent(true);
            if (!workspaceInfo) {
                return 'No workspace context available.';
            }

            const context = `Current workspace: ${workspaceInfo.path}\n`;
            return context;
        } catch (error) {
            logger.error('Failed to get workspace context:', error);
            return 'Failed to get workspace context.';
        }
    }

    private convertToAnthropicMessages(messages: Message[]): { role: Role; content: string }[] {
        return messages
            .filter(msg => msg.role !== 'system')
            .map(msg => ({
                role: msg.role as Role,
                content: msg.content
            }));
    }

    async sendMessage(message: string, history: Message[] = []): Promise<string> {
        try {
            logger.info('Preparing context for Claude API');
            
            if (!message) {
                throw new Error('Message cannot be empty');
            }
            
            // Try to find similar cached responses
            const similarResponses = await this.cacheService.search(
                message,
                2,  // Use level 2 for responses
                ['chat_response'],
                0.9
            );

            if (similarResponses.length > 0) {
                logger.info('Found cached similar response');
                return similarResponses[0].entry.content;
            }
            
            const workspaceContext = await this.getWorkspaceContext();
            const optimizedHistory = await this.prepareContext(history);
            const contextualizedMessage = `${workspaceContext}\n\nUser Message: ${message}`;
            
            const response = await this.client.messages.create({
                model: this.modelService.getModelString(),
                max_tokens: 4000,
                messages: [
                    ...this.convertToAnthropicMessages(optimizedHistory),
                    { role: 'user' as Role, content: contextualizedMessage }
                ],
                system: SYSTEM_PROMPT
            });

            if (!response?.content?.[0]?.text) {
                throw new Error('Invalid response from Claude API');
            }

            // Cache the response
            await this.cacheService.store(
                2,  // Use level 2 for responses
                response.content[0].text,
                ['chat_response', 'workspace_context'],
                undefined,  // No parent ID
                response.usage?.output_tokens
            );

            logger.info(`Used model: ${this.modelService.getCurrentModel()}`);
            return response.content[0].text;

        } catch (error) {
            logger.error('Error calling Claude API:', error);
            throw error;
        }
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }

    public setModel(modelId: string): void {
        this.modelService.setModel(modelId as ModelType);
    }
}

export default ClaudeService;