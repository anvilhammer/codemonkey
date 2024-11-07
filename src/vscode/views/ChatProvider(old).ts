import * as vscode from 'vscode';
import { ChatMessage, MessageType, ApiContext, WebviewMessage } from '../types/chat';
import { ClaudeService } from '../../services/ClaudeService';
import { logger } from '../../utils/logger';
import { HistoryService } from '../../services/HistoryService';
import { WorkspaceService } from '../../services/WorkspaceService';
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
        
        this._claudeService = new ClaudeService({
            outputChannel: this._outputChannel,
            maxContextMessages: 10,
            contextWindowSize: 15000
        });
        
        this._historyService = new HistoryService();
        this.workspaceService = new WorkspaceService(this._outputChannel);
        this.loadHistory();
    }

    private async loadHistory(): Promise<void> {
        try {
            const history = await this._historyService.loadHistory();
            this._messageHistory = history.map(entry => ({
                role: entry.role,
                content: entry.content
            }));
            
            history.forEach(entry => {
                const content = this._historyService.removeTags(entry.content);
                this._addMessage(entry.type as MessageType || entry.role, content);
            });
        } catch (error) {
            logger.error('Failed to load chat history:', error);
        }
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
                    case 'sendMessage': {
                        if (data.message) {
                            await this._handleUserMessage(data.message);
                        }
                        break;
                    }
                    case 'clearChat': {
                        this._messages = [];
                        this._updateWebview();
                        break;
                    }
                    case 'copyCode': {
                        if (data.messageId) {
                            await this._copyMessageToClipboard(data.messageId);
                        }
                        break;
                    }
                    case 'changeModel': {
                        if (data.modelId) {
                            await this._claudeService.setModel(data.modelId as ModelType);
                            this._addMessage('status', `Changed to ${data.modelId} model`);
                        }
                        break;
                    }
                }
            } catch (error) {
                logger.error('Error handling webview message:', error);
                this._addMessage('error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }

    // Add these two new methods to your ChatProvider class:
    private _isValidPath(path: string): boolean {
        // Validate path to prevent directory traversal and unsafe characters
        const validPathPattern = /^[a-zA-Z0-9_\-./\\]+$/;  // Removed unnecessary escape
        const normalizedPath = path.normalize();
    
        if (!validPathPattern.test(normalizedPath)) {
            logger.warn(`Invalid path pattern: ${path}`);
            return false;
        }
    
        // Prevent directory traversal
        if (normalizedPath.includes('..')) {
            logger.warn(`Directory traversal attempt detected: ${path}`);
            return false;
        }
    
        // Prevent absolute paths
        if (path.startsWith('/') || path.startsWith('\\')) {
            logger.warn(`Absolute path not allowed: ${path}`);
            return false;
        }
    
        return true;
    }

    private _isValidCommand(command: string): boolean {
        // Define allowed commands and their validation rules
        const commandRules: Record<string, {
            maxParams: number;
            validateParams: (params: string[]) => boolean;
        }> = {
            'CREATE_FILE': {
                maxParams: 2,
                validateParams: (params) => {
                    return this._isValidPath(params[0]) && params[1] !== undefined;
                }
            },
            'WRITE_TO_FILE': {
                maxParams: 2,
                validateParams: (params) => {
                    return this._isValidPath(params[0]) && params[1] !== undefined;
                }
            },
            'DELETE_FILE': {
                maxParams: 1,
                validateParams: (params) => this._isValidPath(params[0])
            },
            'READ_FILE': {
                maxParams: 1,
                validateParams: (params) => this._isValidPath(params[0])
            }
        };

        // Parse command
        const parts = command.split(' ');
        const commandType = parts[0];
        const params = parts.slice(1);

        // Check if command is allowed
        const rule = commandRules[commandType];
        if (!rule) {
            logger.warn(`Invalid command type: ${commandType}`);
            return false;
        }

        // Validate number of parameters
        if (params.length > rule.maxParams) {
            logger.warn(`Too many parameters for command ${commandType}`);
            return false;
        }

        // Validate parameters according to command rules
        return rule.validateParams(params);
    }

// Add this method to your ChatProvider class

    private async _getWorkspaceInfo(): Promise<string> {
        try {
            // Assuming WorkspaceService has a method to fetch workspace details
            const workspaceContent = await this.workspaceService.getWorkspaceContent(true);
            if (!workspaceContent) {
                return 'No workspace context available.';
            }

            const info: string[] = [`Current workspace: ${workspaceContent.path}`];

            if (workspaceContent.directories.length > 0) {
                info.push('\nDirectories:');
                workspaceContent.directories.forEach(dir => info.push(`  ${dir}`));
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

    // Replace your existing _handleUserMessage with this one:
    private async _handleUserMessage(message: string) {
        try {
            this._addMessage('user', message);
            
            const userHistoryEntry = { role: 'user' as const, content: message };
            this._messageHistory.push(userHistoryEntry);

            const workspaceInfo = await this._getWorkspaceInfo();
            const contextualizedMessage = `
    Current Workspace Information:
    ${workspaceInfo}
    User Message: ${message}`;

            const response = await this._claudeService.sendMessage(contextualizedMessage, this._messageHistory);
            const transaction = await this.workspaceService.beginTransaction();

            try {
                // Validation Layer: Check each command in the response
                if (this._isValidCommand(response)) {
                    const result = await this.workspaceService.executeCommand(response);
                    
                    if (result.success) {
                        if (result.output) {
                            this._addMessage('systemCommand', result.output);
                        }
                        if (result.workspaceChanges) {
                            await this.workspaceService.commitTransaction(transaction);
                            this._addMessage('success', 'Command executed successfully');
                        }
                    } else if (result.error) {
                        this._addMessage('error', result.error);
                        await this.workspaceService.rollbackTransaction(transaction);
                    }
                } else {
                    this._addMessage('warning', 'Command validation failed. Command not executed for security reasons.');
                }

                // Add Claude's response to chat
                this._addMessage('assistant', response);
                this._messageHistory.push({ role: 'assistant', content: response });

            } catch (error) {
                await this.workspaceService.rollbackTransaction(transaction);
                throw error;
            }
        } catch (error) {
            logger.error('Error processing message:', error);
            this._addMessage('error', `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _addMessage(type: MessageType, content: string) {
        // Remove ANSI color codes with ESLint-approved regex
        const cleanContent = content.replace(
            /* eslint-disable-next-line no-control-regex */
            /\u001b\[[0-9;]*m/g,
            ''
        ).trim();
        
        const message: ChatMessage = {
            id: `msg_${Date.now()}`,
            type,
            content: cleanContent,
            timestamp: Date.now()
        };

        this._messages.push(message);
        this._updateWebview();
        
        const prefix = type === 'error' ? '\u001b[31m' : 
                      type === 'success' ? '\u001b[32m' : 
                      type === 'systemCommand' ? '\u001b[36m' : '';
        const suffix = prefix ? '\u001b[0m' : '';
        this._outputChannel.appendLine(`[${type}] ${prefix}${cleanContent}${suffix}`);
        
        await this._historyService.saveEntry({
            role: type === 'user' ? 'user' : 'assistant',
            content: cleanContent,
            timestamp: Date.now(),
            type
        });
    }

    private async _copyMessageToClipboard(messageId: string) {
        const message = this._messages.find(m => m.id === messageId);
        if (message) {
            await vscode.env.clipboard.writeText(message.content);
            this._addMessage('success', 'Content copied to clipboard!');
        }
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateMessages',
                messages: this._messages
            });
        }
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

                        #chat-container {
                            display: flex;
                            flex-direction: column;
                            height: 100%;
                            width: 100%;
                            padding: 10px;
                            gap: 10px;
                            box-sizing: border-box;
                        }

                        #messages {
                            flex: 1;
                            overflow-y: auto;
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
                            word-break: break-word;
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
                        /* Message type-specific styles */
                        .message.user {
                            background: var(--vscode-button-background);
                            color: var(--vscode-button-foreground);
                            margin-left: 20px;
                            border-left: 3px solid var(--vscode-button-hoverBackground);
                        }
                        .message.user::before { 
                            content: "👤";
                        }

                        .message.assistant {
                            background: var(--vscode-editor-selectionBackground);
                            color: rgba(255, 255, 255, 0.95);
                            margin-right: 20px;
                            border-left: 3px solid var(--vscode-editor-selectionHighlightBackground);
                        }
                        .message.assistant::before { 
                            content: "🤖";
                        }

                        .message.error {
                            background: var(--vscode-errorForeground);
                            color: var(--vscode-editor-background);
                            font-weight: 500;
                            border-left: 3px solid darkred;
                        }
                        .message.error::before { 
                            content: "⚠️";
                        }

                        .message.warning {
                            background: var(--vscode-editorWarning-foreground);
                            color: var(--vscode-editor-background);
                            font-weight: 500;
                            border-left: 3px solid orange;
                        }
                        .message.warning::before { 
                            content: "⚡";
                        }

                        .message.success {
                            background: var(--vscode-testing-iconPassed);
                            color: var(--vscode-editor-background);
                            font-weight: 500;
                            border-left: 3px solid green;
                        }
                        .message.success::before { 
                            content: "✅";
                        }

                        .message.question {
                            background: var(--vscode-inputValidation-infoBackground, #063b49);
                            color: rgba(255, 255, 255, 0.95);
                            font-weight: bold;
                            border-left: 3px solid var(--vscode-focusBorder);
                        }
                        .message.question::before { 
                            content: "❓";
                        }

                        .message.code {
                            font-family: var(--vscode-editor-font-family);
                            background: var(--vscode-textBlockQuote-background);
                            color: rgba(255, 255, 255, 0.95);
                            padding: 12px;
                            border-left: 3px solid var(--vscode-textBlockQuote-border);
                        }
                        .message.code::before { 
                            content: "</>"; 
                            font-family: monospace;
                        }

                        .message.suggestion {
                            background: var(--vscode-inputValidation-warningBackground, #352a05);
                            color: rgba(255, 255, 255, 0.95);
                            border-left: 3px solid var(--vscode-activityBarBadge-background);
                            font-style: italic;
                        }
                        .message.suggestion::before { 
                            content: "💡";
                        }

                        .message.systemCommand {
                            background: var(--vscode-debugConsole-infoForeground);
                            color: var(--vscode-editor-background);
                            font-family: var(--vscode-editor-font-family);
                            font-weight: 500;
                            border-left: 3px solid var(--vscode-terminal-foreground);
                        }
                        .message.systemCommand::before { 
                            content: "$";
                            font-family: monospace;
                        }

                        .message.debug {
                            font-family: var(--vscode-editor-font-family);
                            background: var(--vscode-debugConsole-sourceForeground);
                            color: var(--vscode-editor-foreground);
                            opacity: 0.9;
                            border-left: 3px solid var(--vscode-debugIcon-startForeground);
                        }
                        .message.debug::before { 
                            content: "🔍";
                        }

                        .message.status {
                            background: var(--vscode-statusBar-background);
                            color: var(--vscode-statusBar-foreground);
                            font-style: italic;
                            border-left: 3px solid var(--vscode-statusBar-border);
                        }
                        .message.status::before { 
                            content: "ℹ️";
                        }

                        /* Add a hover state to show message type */
                        .message::after {
                            content: attr(class);
                            position: absolute;
                            top: -18px;
                            left: 8px;
                            font-size: 10px;
                            background: var(--vscode-editor-background);
                            padding: 2px 6px;
                            border-radius: 3px;
                            opacity: 0;
                            transition: opacity 0.2s;
                            text-transform: capitalize;
                            pointer-events: none;
                        }

                        .message:hover::after {
                            opacity: 0.8;
                        }
                        .timestamp {
                            font-size: 0.8em;
                            color: var(--vscode-descriptionForeground);
                            margin-top: 4px;
                            opacity: 0.8;
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
                            container.innerHTML = Object.entries(MODELS)
                                .map(([id, model]) => \`
                                    <div class="model-option \${id === currentModel ? 'selected' : ''}"
                                         onclick="selectModel('\${id}')">
                                        <div class="model-name">\${model.name}</div>
                                        <div class="model-desc">\${model.description}</div>
                                        <div class="model-cost">\${model.cost}</div>
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
        }
                        });

                        // Initialize model selector and message handlers
                        updateModelSelector();
                    </script>
                </body>
            </html>
        `;
    }
}