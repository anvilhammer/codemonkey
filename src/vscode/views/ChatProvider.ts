// src/vscode/views/ChatProvider.ts

import * as vscode from 'vscode';
import { ChatMessage, MessageType, ApiContext, WebviewMessage } from '../types/chat';
import { ClaudeService } from '../../services/ClaudeService';
import { logger } from '../../utils/logger';
import { HistoryService } from '../../services/HistoryService';
import { WorkspaceService } from '../../services/WorkspaceService';
import { CommandParser, Command } from '../../services/CommandParser';
import { ModelType } from '../../services/ModelService';

export class ChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: ApiContext;
    private _messages: ChatMessage[] = [];
    private _claudeService: ClaudeService;
    private _messageHistory: { role: 'user' | 'assistant', content: string }[] = [];
    private _historyService: HistoryService;
    private workspaceService: WorkspaceService;
    
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.OutputChannel
    ) {
        this._context = {
            recentErrors: [],
            recentLogs: [],
            sessionStartTime: Date.now()
        };
        this._claudeService = new ClaudeService();
        this._historyService = new HistoryService();
        this.workspaceService = new WorkspaceService(_outputChannel);
        this.loadHistory();
    }
    
    private async loadHistory(): Promise<void> {
        const history = await this._historyService.loadHistory();
        this._messageHistory = history.map(entry => ({
            role: entry.role,
            content: entry.content
        }));
        
        history.forEach(entry => {
            const content = this._historyService.removeTags(entry.content);
            this._addMessage(entry.type as MessageType || entry.role, content);
        });
    }

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

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            try {
                switch (data.type) {
                    case 'sendMessage':
                        if (data.message) {
                            await this._handleUserMessage(data.message);
                        }
                        break;
                    case 'clearChat':
                        this._messages = [];
                        this._updateWebview();
                        break;
                    case 'copyCode':
                        if (data.messageId) {
                            await this._copyMessageToClipboard(data.messageId);
                        }
                        break;
                    case 'changeModel':
                        if (data.modelId) {
                            await this._claudeService.setModel(data.modelId as ModelType);
                            this._addMessage('status', `Changed to ${data.modelId} model`);
                        }
                        break;
                }
            } catch (error) {
                logger.error('Error handling webview message:', error);
                this._addMessage('error', `Error: ${error}`);
            }
        });
    }

    private async _handleUserMessage(message: string) {
        try {
            this._addMessage('user', message);
            const workspaceInfo = await this._getWorkspaceInfo();
            
            const contextualizedMessage = `
Current Workspace Information:
${workspaceInfo}

User Message: ${message}`;
            
            this._context.lastUserMessage = contextualizedMessage;
            this._messageHistory.push({ role: 'user', content: contextualizedMessage });

            const response = await this._claudeService.sendMessage(
                contextualizedMessage,
                this._messageHistory
            );

            const commands = CommandParser.parse(response);
            if (commands.length > 0) {
                for (const command of commands) {
                    try {
                        const result = await this.executeCommands([command]);
                        if (result.trim()) {
                            if (result.toLowerCase().includes('error')) {
                                this._addMessage('error', result);
                            } else {
                                this._addMessage('systemCommand', result);
                                if (command.type === 'EXECUTE_COMMAND') {
                                    this._addMessage('success', `Command executed: ${command.params.content}`);
                                }
                            }
                        }
                    } catch (error) {
                        logger.error('Error executing command:', error);
                        this._addMessage('error', `Failed to execute command: ${error}`);
                    }
                }
            }

            const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
            let match;
            let foundTags = false;

            while ((match = tagRegex.exec(response)) !== null) {
                foundTags = true;
                const [, type, content] = match;
                if (this._isValidMessageType(type) && type !== 'systemCommand') {
                    this._addMessage(type as MessageType, content.trim());
                }
            }

            if (!foundTags) {
                this._addMessage('assistant', response);
            }

            this._messageHistory.push({ role: 'assistant', content: response });

        } catch (error) {
            logger.error('Error handling user message:', error);
            this._addMessage('error', `Failed to process message: ${error}`);
        }
    }

    private async _getWorkspaceInfo(): Promise<string> {
        try {
            const workspaceContent = await this.workspaceService.getWorkspaceContent(true);
            const info: string[] = [];
            
            info.push(`Current workspace: ${workspaceContent.path}`);
            
            if (workspaceContent.directories.length > 0) {
                info.push('\nDirectories:');
                workspaceContent.directories.forEach(dir => 
                    info.push(`  ${dir}`)
                );
            }
            
            if (workspaceContent.files.length > 0) {
                info.push('\nFiles:');
                workspaceContent.files.forEach(file => {
                    info.push(`  ${file}`);
                    const content = workspaceContent.fileContents?.[file];
                    if (content && content.length < 500) {
                        info.push(`    Content:\n${content.split('\n').map(line => `      ${line}`).join('\n')}`);
                    }
                });
            }

            return info.join('\n');
        } catch (error) {
            logger.error('Failed to get workspace info:', error);
            return 'Unable to get workspace information';
        }
    }

    private async executeCommands(commands: Command[]): Promise<string> {
        const results: string[] = [];
        
        for (const command of commands) {
            try {
                switch (command.type) {
                    case 'CREATE_FILE': {
                        await this.workspaceService.createFile(
                            command.params.path as string,
                            command.params.content as string
                        );
                        results.push(`Created file: ${command.params.path}`);
                        break;
                    }
                    case 'WRITE_TO_FILE': {
                        await this.workspaceService.updateFile(
                            command.params.path as string,
                            command.params.content as string
                        );
                        results.push(`Updated file: ${command.params.path}`);
                        break;
                    }
                    case 'READ_FILE': {
                        const content = await this.workspaceService.readFile(command.params.path as string);
                        results.push(`Content of ${command.params.path}:\n${content}`);
                        break;
                    }
                    case 'DELETE_FILE': {
                        await this.workspaceService.deleteFile(command.params.path as string);
                        results.push(`Deleted file: ${command.params.path}`);
                        break;
                    }
                    case 'EXECUTE_COMMAND': {
                        const result = await this.workspaceService.executeCommand(command.params.content as string);
                        if (result.output) {
                            results.push(result.output);
                        }
                        if (result.error) {
                            results.push(`Error: ${result.error}`);
                        }
                        break;
                    }
                }
            } catch (error) {
                logger.error(`Failed to execute command ${command.type}:`, error);
                results.push(`Error executing command ${command.type}: ${error}`);
            }
        }

        return results.join('\n');
    }
    
    private async _addMessage(type: MessageType, content: string) {
        const cleanContent = content.replace(
            // eslint-disable-next-line no-control-regex
            /\x1b\[[0-9;]*m/g,
            ''
        );
        
        const message: ChatMessage = {
            id: `msg_${Date.now()}`,
            type,
            content: cleanContent,
            timestamp: Date.now()
        };

        this._messages.push(message);
        this._updateWebview();
        
        const prefix = type === 'error' ? '\x1b[31m' : 
                      type === 'success' ? '\x1b[32m' : 
                      type === 'systemCommand' ? '\x1b[36m' : '';
        const suffix = prefix ? '\x1b[0m' : '';
        this._outputChannel.appendLine(`[${type}] ${prefix}${cleanContent}${suffix}`);
        
        await this._historyService.saveEntry({
            role: type === 'user' ? 'user' : 'assistant',
            content: cleanContent,
            timestamp: Date.now(),
            type
        });
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateMessages',
                messages: this._messages
            });
        }
    }

    private async _copyMessageToClipboard(messageId: string) {
        const message = this._messages.find(m => m.id === messageId);
        if (message) {
            await vscode.env.clipboard.writeText(message.content);
            this._addMessage('success', 'Content copied to clipboard!');
        }
    }

    private _isValidMessageType(type: string): type is MessageType {
        const validTypes = [
            'user', 'assistant', 'question', 'error', 'suggestion',
            'code', 'systemCommand', 'debug', 'status', 'warning', 'success'
        ];
        return validTypes.includes(type);
    }

    private _getHtmlForWebview(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        margin: 0;
                        padding: 0;
                        font-family: var(--vscode-font-family);
                        background: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }

                    .model-selector {
                        display: flex;
                        gap: 8px;
                        padding: 8px;
                        background: var(--vscode-editor-background);
                        border-bottom: 1px solid var(--vscode-input-border);
                    }

                    .model-option {
                        flex: 1;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        cursor: pointer;
                        opacity: 0.7;
                        transition: all 0.2s;
                    }

                    .model-option:hover {
                        opacity: 0.9;
                        border-color: var(--vscode-focusBorder);
                    }

                    .model-option.selected {
                        opacity: 1;
                        border-color: var(--vscode-focusBorder);
                        background: var(--vscode-editor-selectionBackground);
                    }

                    .model-name {
                        font-weight: bold;
                        margin-bottom: 4px;
                    }

                    .model-desc {
                        font-size: 0.9em;
                        opacity: 0.8;
                    }

                    .model-cost {
                        font-size: 0.8em;
                        opacity: 0.7;
                        margin-top: 4px;
                    }

                    #chat-container {
                        display: flex;
                        flex-direction: column;
                        height: 100%;
                        padding: 10px;
                        gap: 10px;
                    }

                    #messages {
                        flex: 3;
                        overflow-y: auto;
                        margin-bottom: 10px;
                        padding: 10px;
                        background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                    }

                    .message {
                        margin: 8px 0;
                        padding: 12px 12px 12px 36px;
                        border-radius: 6px;
                        white-space: pre-wrap;
                        overflow-wrap: break-word;
                        font-size: 14px;
                        line-height: 1.4;
                        position: relative;
                    }

                    .message::before {
                        position: absolute;
                        left: 8px;
                        top: 12px;
                        font-size: 12px;
                        font-weight: 600;
                        opacity: 0.8;
                    }

                    .message.user {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        margin-left: 20px;
                        border-left: 3px solid var(--vscode-button-hoverBackground);
                    }
                    .message.user::before { content: "👤"; }

                    .message.assistant {
                        background: var(--vscode-editor-selectionBackground);
                        color: var(--vscode-editor-foreground);
                        margin-right: 20px;
                        border-left: 3px solid var(--vscode-editor-selectionHighlightBackground);
                    }
                    .message.assistant::before { content: "🤖"; }

                    .message.error {
                        background: var(--vscode-errorForeground);
                        color: var(--vscode-editor-background);
                        font-weight: 500;
                        border-left: 3px solid darkred;
                    }
                    .message.error::before { content: "⚠️"; }

                    .message.warning {
                        background: var(--vscode-editorWarning-foreground);
                        color: var(--vscode-editor-background);
                        font-weight: 500;
                        border-left: 3px solid orange;
                    }
                    .message.warning::before { content: "⚡"; }

                    .message.success {
                        background: var(--vscode-testing-iconPassed);
                        color: var(--vscode-editor-background);
                        font-weight: 500;
                        border-left: 3px solid green;
                    }
                    .message.success::before { content: "✅"; }

                    .message.question {
                        background: var(--vscode-editor-findMatchHighlightBackground);
                        color: var(--vscode-editor-foreground);
                        font-weight: bold;
                        border-left: 3px solid var(--vscode-focusBorder);
                    }
                    .message.question::before { content: "❓"; }

                    .message.code {
                        font-family: var(--vscode-editor-font-family);
                        background: var(--vscode-textBlockQuote-background);
                        color: var(--vscode-editor-foreground);
                        padding: 12px;
                        border-left: 3px solid var(--vscode-textBlockQuote-border);
                    }
                    .message.code::before { content: "</>"; }

                    .message.suggestion {
                        background: var(--vscode-editor-inactiveSelectionBackground);
                        color: var(--vscode-editor-foreground);
                        border-left: 3px solid var(--vscode-activityBarBadge-background);
                    }
                    .message.suggestion::before { content: "💡"; }

                    .message.systemCommand {
                        background: var(--vscode-debugConsole-infoForeground);
                        color: var(--vscode-editor-background);
                        font-family: var(--vscode-editor-font-family);
                        font-weight: 500;
                        border-left: 3px solid var(--vscode-terminal-foreground);
                    }
                    .message.systemCommand::before { content: "$"; }

                    .message.debug {
                        font-family: var(--vscode-editor-font-family);
                        background: var(--vscode-debugConsole-sourceForeground);
                        color: var(--vscode-editor-foreground);
                        opacity: 0.9;
                        border-left: 3px solid var(--vscode-debugIcon-startForeground);
                    }
                    .message.debug::before { content: "🔍"; }

                    .message.status {
                        background: var(--vscode-statusBar-background);
                        color: var(--vscode-statusBar-foreground);
                        font-style: italic;
                        border-left: 3px solid var(--vscode-statusBar-border);
                    }
                    .message.status::before { content: "ℹ️"; }

                    .timestamp {
                        font-size: 0.8em;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 4px;
                        opacity: 0.8;
                    }

                    .copy-button {
                        float: right;
                        padding: 4px 8px;
                        font-size: 12px;
                        margin-left: 8px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        opacity: 0.8;
                        transition: opacity 0.2s;
                    }

                    .copy-button:hover {
                        opacity: 1;
                        background: var(--vscode-button-hoverBackground);
                    }

                    #input-area {
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        min-height: 100px;
                        max-height: 200px;
                    }

                    textarea {
                        flex-grow: 1;
                        width: 100%;
                        resize: vertical;
                        padding: 8px;
                        box-sizing: border-box;
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        font-family: var(--vscode-font-family);
                    }

                    button {
                        padding: 8px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 2px;
                        cursor: pointer;
                    }

                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                </style>
            </head>
            <body>
                <div id="chat-container">
                    <div id="model-selector" class="model-selector"></div>
                    <div id="messages"></div>
                    <div id="input-area">
                        <textarea 
                            id="message-input" 
                            placeholder="Type your message here... (Shift+Enter for new line, Enter to send)"
                            rows="3"
                        ></textarea>
                        <button onclick="sendMessage()">Send Message</button>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentModel = 'haiku';

                    const MODELS = {
                        haiku: {
                            name: 'Claude 3 Haiku',
                            description: 'Fastest and most cost-effective',
                            cost: '$0.00025/token'
                        },
                        sonnet: {
                            name: 'Claude 3 Sonnet',
                            description: 'Balanced performance',
                            cost: '$0.0015/token'
                        },
                        opus: {
                            name: 'Claude 3 Opus',
                            description: 'Most capable',
                            cost: '$0.015/token'
                        }
                    };

                    function updateModelSelector() {
                        const container = document.getElementById('model-selector');
                        container.innerHTML = Object.entries(MODELS).map(([id, model]) => \`
                            <div class="model-option \${id === currentModel ? 'selected' : ''}"
                                 onclick="selectModel('\${id}')">
                                <div class="model-info">
                                    <div class="model-name">\${model.name}</div>
                                    <div class="model-desc">\${model.description}</div>
                                    <div class="model-cost">\${model.cost}</div>
                                </div>
                            </div>
                        \`).join('');
                    }

                    function selectModel(modelId) {
                        currentModel = modelId;
                        vscode.postMessage({
                            type: 'changeModel',
                            modelId: modelId
                        });
                        updateModelSelector();
                    }

                    function updateMessages(messages) {
                        const messagesContainer = document.getElementById('messages');
                        messagesContainer.innerHTML = '';
                        messages.forEach(msg => {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message ' + msg.type;
                            
                            if (msg.type === 'code') {
                                const copyButton = document.createElement('button');
                                copyButton.className = 'copy-button';
                                copyButton.textContent = 'Copy';
                                copyButton.onclick = () => copyMessage(msg.id);
                                messageDiv.appendChild(copyButton);
                            }

                            const contentDiv = document.createElement('div');
                            contentDiv.textContent = msg.content;
                            messageDiv.appendChild(contentDiv);

                            const timestampDiv = document.createElement('div');
                            timestampDiv.className = 'timestamp';
                            timestampDiv.textContent = new Date(msg.timestamp).toLocaleTimeString();
                            messageDiv.appendChild(timestampDiv);

                            messagesContainer.appendChild(messageDiv);
                        });

                        messagesContainer.scrollTop = messagesContainer.scrollHeight;
                    }

                    function sendMessage() {
                        const messageInput = document.getElementById('message-input');
                        const message = messageInput.value.trim();
                        if (message) {
                            vscode.postMessage({
                                type: 'sendMessage',
                                message: message
                            });
                            messageInput.value = '';
                        }
                    }

                    function copyMessage(messageId) {
                        vscode.postMessage({
                            type: 'copyCode',
                            messageId: messageId
                        });
                    }

                    document.getElementById('message-input').addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'updateMessages':
                                updateMessages(message.messages);
                                break;
                        }
                    });

                    // Initialize model selector
                    updateModelSelector();
                </script>
            </body>
            </html>
        `;
    }
}