// Path: src/vscode/views/ChatProvider.ts

import * as vscode from 'vscode';
import { ChatMessage, MessageType, ApiContext, WebviewMessage } from '../types/chat';
import { ClaudeService } from '../../services/ClaudeService';
import { logger } from '../../utils/logger';
import { HistoryService } from '../../services/HistoryService';
import { WorkspaceService } from '../../services/WorkspaceService';
import { ModelService, ModelType, MODELS } from '../../services/ModelService';
import { CommandParser } from '../../services/CommandParser';
import { getHtmlForWebview } from '../../webview/webviewTemplate';
import { WorkspaceHandler } from '../../services/WorkspaceHandler';

export class ChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: ApiContext;
    private _messages: ChatMessage[] = [];
    private _claudeService: ClaudeService;
    private _messageHistory: { role: 'user' | 'assistant', content: string }[] = [];
    private _historyService: HistoryService;
    private workspaceService: WorkspaceService;
    private currentModel: ModelType;
    private modelService: ModelService;
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.OutputChannel
    ) {
        // Initialize context and services
        this._context = {
            recentErrors: [],
            recentLogs: [],
            sessionStartTime: Date.now()
        };
        
        this.modelService = ModelService.getInstance();
        this.currentModel = 'gpt3_5'; // Default model
        
        this._claudeService = new ClaudeService({
            outputChannel: this._outputChannel,
            maxContextMessages: 10,
            contextWindowSize: 15000
            // Remove systemPrompt line
        });
        
        this._historyService = new HistoryService();
        this.workspaceService = new WorkspaceService(this._outputChannel);
        
        this.loadHistory();
    }

    // Load chat history from the history service
    private async loadHistory(): Promise<void> {
        try {
            const history = await this._historyService.loadHistory();
            this._messageHistory = history.map(entry => ({
                role: entry.role,
                content: entry.content
            }));
            
            history.forEach(entry => {
                const content = this._historyService.removeTags(entry.content);
                this.addMessage(entry.type as MessageType || entry.role, content);
            });
        } catch (error) {
            logger.error('Failed to load chat history:', error);
        }
    }

    // Resolve the webview view
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = getHtmlForWebview();

        // Handle messages received from the webview
        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            try {
                switch (data.type) {
                    case 'sendMessage': {
                        if (data.message) {
                            await this.handleUserMessage(data.message);
                        }
                        break;
                    }
                    case 'clearChat': {
                        this._messages = [];
                        this.updateWebview();
                        break;
                    }
                    case 'copyCode': {
                        if (data.messageId) {
                            await this.copyMessageToClipboard(data.messageId);
                        }
                        break;
                    }
                    case 'changeModel': {
                        if (data.modelId) {
                            await this.changeModel(data.modelId as ModelType);
                        }
                        break;
                    }
                }
            } catch (error) {
                logger.error('Error handling webview message:', error);
                this.addMessage('error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }

    // Handle user message and process it
    private async handleUserMessage(message: string) {
        try {
            this.addMessage('user', message);
            
            const userHistoryEntry = { role: 'user' as const, content: message };
            this._messageHistory.push(userHistoryEntry);
    
            // Get workspace information to provide context
            const workspaceInfo = await this.getWorkspaceInfo();
            const contextualizedMessage = `
    Current Workspace Information:
    ${workspaceInfo}
    User Message: ${message}`;
    
            // Send message to Claude AI for response
            const response = await this._claudeService.sendMessage(contextualizedMessage, this._messageHistory);
            
            // Debug logging
            logger.info('Claude Response:', response);
            
            // Begin transaction to handle workspace changes
            const transaction = await this.workspaceService.beginTransaction();
    
            try {
                // Parse any commands from the response
                const commands = CommandParser.parse(response);
                
                // Debug logging
                logger.info('Parsed Commands:', commands);
                
                if (commands.length > 0) {
                    for (const command of commands) {
                        try {
                            // Debug logging
                            logger.info('Executing command:', command);
                            
                            switch (command.type) {
                                case 'CREATE_FILE': {
                                    logger.info('Creating file:', command.params);
                                    await this.workspaceService.createFile(
                                        command.params.path as string,
                                        command.params.content as string
                                    );
                                    this.addMessage('success', `Created file: ${command.params.path}`);
                                    break;
                                }
                                case 'WRITE_TO_FILE': {
                                    logger.info('Writing to file:', command.params);
                                    await this.workspaceService.updateFile(
                                        command.params.path as string,
                                        command.params.content as string
                                    );
                                    this.addMessage('success', `Updated file: ${command.params.path}`);
                                    break;
                                }
                                case 'EXECUTE_COMMAND': {
                                    logger.info('Executing system command:', command.params);
                                    const result = await this.workspaceService.executeCommand(
                                        command.params.command as string
                                    );
                                    if (result.success) {
                                        this.addMessage('success', `Command executed successfully: ${command.params.command}`);
                                    } else {
                                        this.addMessage('error', `Command execution failed: ${result.error}`);
                                    }
                                    break;
                                }
                                // Additional cases for other command types could be added here
                            }
                        } catch (error) {
                            logger.error('Command execution failed:', error);
                            this.addMessage('error', `Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                }
    
                // Parse and display any messages
                const messages = this.parseMessageTypes(response);
                
                // Debug logging
                logger.info('Parsed Messages:', messages);
                
                for (const msg of messages) {
                    this.addMessage(msg.type, msg.content);
                }
    
                // Commit workspace changes if successful
                await this.workspaceService.commitTransaction(transaction);
                this._messageHistory.push({ role: 'assistant', content: response });
    
            } catch (error) {
                logger.error('Transaction failed:', error);
                // Rollback in case of errors
                await this.workspaceService.rollbackTransaction(transaction);
                throw error;
            }
        } catch (error) {
            logger.error('Error processing message:', error);
            this.addMessage('error', `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Add a message to the messages array and update the webview
    private addMessage(type: MessageType, content: string) {
        const cleanContent = content.replace(/\[\d+(;\d+)*m/g, ''); // Remove control characters

        const message: ChatMessage = {
            id: `msg_${Date.now()}`,
            type,
            content: cleanContent,
            timestamp: Date.now()
        };

        this._messages.push(message);
        this.updateWebview();

        const prefix = type === 'error' ? '\x1b[31m' : 
                      type === 'success' ? '\x1b[32m' : 
                      type === 'systemCommand' ? '\x1b[36m' : '';
        const suffix = prefix ? '\x1b[0m' : '';
        this._outputChannel.appendLine(`[${type}] ${prefix}${cleanContent}${suffix}`);
    }

    // Change model
    private async changeModel(modelId: ModelType) {
        this.currentModel = modelId;
        this._claudeService.setModel(modelId);
        // Remove setSystemPrompt line
        
        const modelInfo = MODELS[modelId];
        this.addMessage('status', `Changed to ${modelInfo.name} model - ${modelInfo.description} (Cost: $${modelInfo.cost}/1K tokens)`);
        this.updateWebview();
    }

    // Parse different message types from the response
    private parseMessageTypes(response: string): { type: MessageType; content: string }[] {
        const messages: { type: MessageType; content: string }[] = [];
        const validTags = ['assistant', 'question', 'error', 'suggestion', 'code', 'debug', 'status', 'warning', 'success'];
        
        // Remove any JSON command objects first
        response = response.replace(/\{[\s\S]*?\}/g, '');

        // Parse tags from the response
        const tagRegex = new RegExp(`<(${validTags.join('|')})>([\\s\\S]*?)<\\/\\1>`, 'gs');

        let match;

        while ((match = tagRegex.exec(response)) !== null) {
            const [, type, content] = match;
            messages.push({
                type: type as MessageType,
                content: content.trim()
            });
        }

        // If no tags found, treat entire response as assistant message
        if (messages.length === 0 && response.trim()) {
            messages.push({
                type: 'assistant',
                content: response.trim()
            });
        }

        return messages;
    }

    // Get detailed information about the current workspace
    private async getWorkspaceInfo(): Promise<string> {
        return WorkspaceHandler.getWorkspaceInfo();
    }

    // Update the webview with new messages
    private updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateMessages',
                messages: this._messages,
                currentModel: this.currentModel
            });
        }
    }

    // Copy a message's content to the clipboard
    private async copyMessageToClipboard(messageId: string) {
        const message = this._messages.find(m => m.id === messageId);
        if (message) {
            await vscode.env.clipboard.writeText(message.content);
            this.addMessage('success', 'Content copied to clipboard!');
        }
    }
}
