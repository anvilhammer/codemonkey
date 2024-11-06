// src/services/ClaudeService.ts

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from '../utils/logger';
import { Message } from '../vscode/types/chat';
import { SYSTEM_PROMPT } from './SystemPrompts';
import { WorkspaceService } from './WorkspaceService';
import { CacheService } from './CacheService';
import { ModelService, ModelType, MODELS } from './ModelService';

// Load environment variables
const envPath = path.join(__dirname, '..', '..', '.env');
dotenv.config({ path: envPath });

// Check for API keys
if (!process.env.CLAUDE_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error(
        `CLAUDE_API_KEY or OPENAI_API_KEY is not set in environment variables. Looking for .env at: ${envPath}`
    );
}

export interface ClaudeServiceConfig {
    apiKey?: string;
    maxContextMessages?: number;
    contextWindowSize?: number;
    outputChannel?: vscode.OutputChannel;
}

export class ClaudeService {
    private anthropicClient: Anthropic | null = null;
    private openaiClient: OpenAI | null = null;
    private workspaceService: WorkspaceService;
    private modelService: ModelService;
    private cacheService: CacheService;
    private readonly outputChannel: vscode.OutputChannel;

    constructor(config?: ClaudeServiceConfig) {
        // Initialize clients if API keys are available
        if (process.env.CLAUDE_API_KEY) {
            this.anthropicClient = new Anthropic({
                apiKey: config?.apiKey || process.env.CLAUDE_API_KEY
            });
        }
        
        if (process.env.OPENAI_API_KEY) {
            this.openaiClient = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        }

        // Initialize services
        this.outputChannel = config?.outputChannel || vscode.window.createOutputChannel('CodeMonkey');
        this.workspaceService = new WorkspaceService(this.outputChannel);
        this.cacheService = CacheService.getInstance();
        this.modelService = ModelService.getInstance();
    }

    private async getWorkspaceContext(): Promise<string> {
        try {
            const workspaceInfo = await this.workspaceService.getWorkspaceContent(true);
            return workspaceInfo ? 
                `Current workspace: ${workspaceInfo.path}\n` : 
                'No workspace context available.';
        } catch (error) {
            logger.error('Failed to get workspace context:', error);
            return 'Failed to get workspace context.';
        }
    }

    async sendMessage(message: string, history: Message[] = []): Promise<string> {
        try {
            if (!message) {
                throw new Error('Message cannot be empty');
            }

            // Get workspace context and prepare message
            const workspaceContext = await this.getWorkspaceContext();
            const contextualizedMessage = `${workspaceContext}\n\nUser Message: ${message}`;
            
            // Check cache for similar responses
            const similarResponses = await this.cacheService.search(
                message,
                2,
                ['chat_response'],
                0.9
            );

            if (similarResponses.length > 0) {
                logger.info('Found cached similar response');
                return similarResponses[0].entry.content;
            }

            // Get current model and send message
            const currentModel = this.modelService.getCurrentModel();
            let responseContent = '';

            if (currentModel.startsWith('gpt')) {
                responseContent = await this.sendOpenAIMessage(contextualizedMessage, history);
            } else {
                responseContent = await this.sendClaudeMessage(contextualizedMessage, history);
            }

            if (!responseContent) {
                throw new Error('Invalid response from model API');
            }

            // Cache the response
            await this.cacheService.store(
                2,
                responseContent,
                ['chat_response', 'workspace_context'],
                undefined,
                4000
            );

            return responseContent;

        } catch (error) {
            logger.error('Error calling model API:', error);
            throw error;
        }
    }

    private async sendOpenAIMessage(message: string, history: Message[]): Promise<string> {
        if (!this.openaiClient) {
            throw new Error('OpenAI client is not configured properly.');
        }

        const response = await this.openaiClient.chat.completions.create({
            model: MODELS[this.modelService.getCurrentModel()].modelString,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...history.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                { role: 'user', content: message }
            ],
            max_tokens: 4000
        });

        return response.choices[0]?.message?.content || '';
    }

    private async sendClaudeMessage(message: string, history: Message[]): Promise<string> {
        if (!this.anthropicClient) {
            throw new Error('Claude client is not configured properly.');
        }

        const response = await this.anthropicClient.messages.create({
            model: MODELS[this.modelService.getCurrentModel()].modelString,
            max_tokens: 4000,
            messages: history.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            })),
            system: SYSTEM_PROMPT
        });

        return response.content[0].text;
    }

    public setModel(modelId: string): void {
        if (!MODELS[modelId as ModelType]) {
            throw new Error(`Model ${modelId} is not recognized. Please select a valid model.`);
        }
        logger.info(`Setting model to: ${modelId}`);
        this.modelService.setModel(modelId as ModelType);
    }

    public dispose(): void {
        this.outputChannel.dispose();
    }
}

export default ClaudeService;