import * as vscode from 'vscode';
import { ChatMessage, MessageType, ApiContext, WebviewMessage } from '../types/chat';
import { ClaudeService } from '../../services/ClaudeService';
import { logger } from '../../utils/logger';
import { HistoryService } from '../../services/HistoryService';
import { WorkspaceService } from '../../services/WorkspaceService';
import { ModelService, ModelType, MODELS } from '../../services/ModelService';
import { getHtmlForWebview } from '../../webview/webviewTemplate';

export class ChatProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _messages: ChatMessage[] = [];
    private _messageHistory: { role: 'user' | 'assistant', content: string }[] = [];
    private _context: ApiContext;

    private readonly claudeService: ClaudeService;
    private readonly historyService: HistoryService;
    private readonly workspaceService: WorkspaceService;
    private readonly modelService: ModelService;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this._context = {
            recentErrors: [],
            recentLogs: [],
            sessionStartTime: Date.now()
        };

        this.modelService = ModelService.getInstance();
        this.claudeService = new ClaudeService({
            outputChannel: this.outputChannel,
            maxContextMessages: 10,
            contextWindowSize: 15000
        });
        
        this.historyService = new HistoryService();
        this.workspaceService = new WorkspaceService(this.outputChannel);
        
        this.loadHistory();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            try {
                await this.handleWebviewMessage(data);
            } catch (error) {
                logger.error('Error handling webview message:', error);
                this.addMessage('error', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
    }

    private async handleWebviewMessage(data: WebviewMessage): Promise<void> {
        switch (data.type) {
            case 'sendMessage': {
                if (data.message) {
                    await this.handleUserMessage(data.message);
                }
                break;
            }
            case 'clearChat': {
                this.clearChat();
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
    }

    private clearChat(): void {
        this._messages = [];
        this.updateWebview();
    }
    private async handleUserMessage(message: string): Promise<void> {
        try {
            this.addMessage('user', message);
            
            // Add to message history
            const userHistoryEntry = { role: 'user' as const, content: message };
            this._messageHistory.push(userHistoryEntry);

            // Get workspace context
            const workspaceInfo = await this.getWorkspaceInfo();
            const contextualizedMessage = `
Current Workspace Information:
${workspaceInfo}

User Message: ${message}`;

            // Get AI response
            const response = await this.claudeService.sendMessage(contextualizedMessage, this._messageHistory);
            logger.info('AI Response:', response);

            // Handle any workspace operations
            await this.handleWorkspaceOperations(message, response);

            // Parse and display messages
            const messages = this.parseMessageTypes(response);
            for (const msg of messages) {
                this.addMessage(msg.type, msg.content);
            }

            // Store in history
            this._messageHistory.push({ role: 'assistant', content: response });

        } catch (error) {
            logger.error('Error processing message:', error);
            this.addMessage('error', `Failed to process message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleWorkspaceOperations(userMessage: string, aiResponse: string): Promise<void> {
        try {
            // Infer workspace operations from the context and message
            if (this.isFileOperation(userMessage)) {
                await this.handleFileOperation(userMessage, aiResponse);
            }

            if (this.isProjectOperation(userMessage)) {
                await this.handleProjectOperation(userMessage, aiResponse);
            }

            if (this.isPackageOperation(userMessage)) {
                await this.handlePackageOperation(userMessage, aiResponse);
            }
        } catch (error) {
            logger.error('Workspace operation failed:', error);
            this.addMessage('error', `Operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleFileOperation(message: string, aiResponse: string): Promise<void> {
        const operation = this.inferFileOperation(message, aiResponse);
        if (!operation) return;

        try {
            switch (operation.type) {
                case 'CREATE': {
                    await this.workspaceService.createFile(operation.path, operation.content || '');
                    this.addMessage('success', `Created file: ${operation.path}`);
                    break;
                }
                case 'UPDATE': {
                    await this.workspaceService.updateFile(operation.path, operation.content || '');
                    this.addMessage('success', `Updated file: ${operation.path}`);
                    break;
                }
                case 'DELETE': {
                    await this.workspaceService.deleteFile(operation.path);
                    this.addMessage('success', `Deleted file: ${operation.path}`);
                    break;
                }
            }
        } catch (error) {
            this.addMessage('error', `File operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleProjectOperation(message: string, aiResponse: string): Promise<void> {
        const projectType = this.inferProjectType(message);
        if (!projectType) return;

        try {
            // Extract any specific configuration from AI response
            const config = this.extractProjectConfig(aiResponse);
            
            await this.workspaceService.createProjectStructure(
                projectType, 
                this.getProjectName(message),
                config
            );
            
            // Look for additional setup instructions in AI response
            const setupCommands = this.extractSetupCommands(aiResponse);
            for (const command of setupCommands) {
                const result = await this.workspaceService.executeCommand(command);
                if (result.success) {
                    this.addMessage('success', `Setup command executed: ${command}`);
                } else {
                    this.addMessage('error', `Setup command failed: ${result.error}`);
                }
            }

            this.addMessage('success', `Created ${projectType} project structure`);
        } catch (error) {
            this.addMessage('error', `Project creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handlePackageOperation(message: string, aiResponse: string): Promise<void> {
        const packages = this.inferPackages(message);
        const aiSuggestedPackages = this.extractPackageSuggestions(aiResponse);
        
        // Combine user-requested and AI-suggested packages
        const allPackages = [...packages, ...aiSuggestedPackages];
        
        if (allPackages.length === 0) return;

        try {
            for (const pkg of allPackages) {
                const result = await this.workspaceService.installPackage(pkg.name, pkg.isDev);
                if (result.success) {
                    this.addMessage('success', `Installed ${pkg.name}`);
                    
                    // Check AI response for configuration suggestions for this package
                    const config = this.extractPackageConfig(aiResponse, pkg.name);
                    if (config) {
                        await this.handlePackageConfig(pkg.name, config);
                    }
                } else {
                    this.addMessage('error', `Failed to install ${pkg.name}: ${result.error}`);
                }
            }
        } catch (error) {
            this.addMessage('error', `Package installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private extractPackageSuggestions(aiResponse: string): { name: string, isDev: boolean }[] {
        const suggestions: { name: string, isDev: boolean }[] = [];
        
        // Look for package suggestions in AI response
        const devDependencyMatch = aiResponse.match(/dev dependencies?:?\s+([@\w\s-,]+)/i);
        const dependencyMatch = aiResponse.match(/dependencies?:?\s+([@\w\s-,]+)/i);

        if (devDependencyMatch) {
            const packages = devDependencyMatch[1].split(/[\s,]+/);
            packages.forEach(pkg => {
                if (pkg.trim()) {
                    suggestions.push({ name: pkg.trim(), isDev: true });
                }
            });
        }

        if (dependencyMatch) {
            const packages = dependencyMatch[1].split(/[\s,]+/);
            packages.forEach(pkg => {
                if (pkg.trim()) {
                    suggestions.push({ name: pkg.trim(), isDev: false });
                }
            });
        }

        return suggestions;
    }

    private extractProjectConfig(aiResponse: string): any {
        // Look for configuration blocks in the AI response
        const configMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (configMatch) {
            try {
                return JSON.parse(configMatch[1]);
            } catch (error) {
                logger.error('Failed to parse project config:', error);
            }
        }
        return null;
    }

    private extractSetupCommands(aiResponse: string): string[] {
        const commands: string[] = [];
        
        // Look for setup commands in AI response
        const setupMatch = aiResponse.match(/setup commands?:?\s+([\s\S]*?)(?:\n\n|$)/i);
        if (setupMatch) {
            const commandLines = setupMatch[1].split('\n');
            commandLines.forEach(line => {
                const cmd = line.replace(/^[-*•]\s*/, '').trim();
                if (cmd) {
                    commands.push(cmd);
                }
            });
        }

        return commands;
    }

    private async handlePackageConfig(packageName: string, config: any): Promise<void> {
        try {
            // Common configuration files for different packages
            const configFiles = {
                'eslint': '.eslintrc.json',
                'prettier': '.prettierrc',
                'jest': 'jest.config.js',
                'typescript': 'tsconfig.json',
                'babel': '.babelrc'
            };

            const configFile = configFiles[packageName.toLowerCase()] || `${packageName}.config.js`;
            
            await this.workspaceService.createFile(
                configFile,
                typeof config === 'string' ? config : JSON.stringify(config, null, 2)
            );
            
            this.addMessage('success', `Created configuration for ${packageName}`);
        } catch (error) {
            this.addMessage('error', `Failed to configure ${packageName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async changeModel(modelId: ModelType): Promise<void> {
        this.modelService.setModel(modelId);
        this.claudeService.setModel(modelId);
        
        const modelInfo = MODELS[modelId];
        this.addMessage('status', `Changed to ${modelInfo.name} model - ${modelInfo.description} (Cost: ${modelInfo.cost})`);
    }

    private parseMessageTypes(response: string): { type: MessageType; content: string }[] {
        const messages: { type: MessageType; content: string }[] = [];
        const validTags = ['assistant', 'question', 'error', 'suggestion', 'code', 'debug', 'status', 'warning', 'success'];
        
        const tagRegex = new RegExp(`<(${validTags.join('|')})>([\\s\\S]*?)<\\/\\1>`, 'gs');
        let match;

        while ((match = tagRegex.exec(response)) !== null) {
            const [, type, content] = match;
            messages.push({
                type: type as MessageType,
                content: content.trim()
            });
        }

        if (messages.length === 0 && response.trim()) {
            messages.push({
                type: 'assistant',
                content: response.trim()
            });
        }

        return messages;
    }

    private isFileOperation(message: string): boolean {
        const fileKeywords = ['create file', 'make file', 'new file', 'write file', 'delete file', 'remove file', 'update file', 'edit file'];
        return fileKeywords.some(keyword => message.toLowerCase().includes(keyword));
    }

    private isProjectOperation(message: string): boolean {
        const projectKeywords = ['create project', 'new project', 'init project', 'setup project', 'scaffold'];
        return projectKeywords.some(keyword => message.toLowerCase().includes(keyword));
    }

    private isPackageOperation(message: string): boolean {
        const packageKeywords = ['install package', 'add package', 'npm install', 'yarn add'];
        return packageKeywords.some(keyword => message.toLowerCase().includes(keyword));
    }

    private inferFileOperation(message: string, aiResponse: string): { type: 'CREATE' | 'UPDATE' | 'DELETE', path: string, content?: string } | null {
        // Implementation details for inferring file operations
        return null; // Placeholder
    }

    private inferProjectType(message: string): string | null {
        // Implementation details for inferring project type
        return null; // Placeholder
    }

    private inferPackages(message: string): { name: string, isDev: boolean }[] {
        // Implementation details for inferring packages
        return []; // Placeholder
    }

    private getProjectName(message: string): string {
        // Implementation details for getting project name
        return 'project'; // Placeholder
    }
    private async getWorkspaceInfo(): Promise<string> {
        try {
            const workspaceContent = await this.workspaceService.getWorkspaceInfo();
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

    private addMessage(type: MessageType, content: string): void {
        const cleanContent = content.replace(/\[\d+(;\d+)*m/g, '');

        const message: ChatMessage = {
            id: `msg_${Date.now()}`,
            type,
            content: cleanContent,
            timestamp: Date.now()
        };

        this._messages.push(message);
        this.updateWebview();

        // Log to output channel with colors
        const prefix = type === 'error' ? '\x1b[31m' : 
                      type === 'success' ? '\x1b[32m' : 
                      type === 'systemCommand' ? '\x1b[36m' : '';
        const suffix = prefix ? '\x1b[0m' : '';
        this.outputChannel.appendLine(`[${type}] ${prefix}${cleanContent}${suffix}`);
    }

    private async copyMessageToClipboard(messageId: string): Promise<void> {
        const message = this._messages.find(m => m.id === messageId);
        if (message) {
            await vscode.env.clipboard.writeText(message.content);
            this.addMessage('success', 'Content copied to clipboard!');
        }
    }

    private updateWebview(): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateMessages',
                messages: this._messages,
                currentModel: this.modelService.getCurrentModel()
            });
        }
    }

    private async loadHistory(): Promise<void> {
        try {
            const history = await this.historyService.loadHistory();
            this._messageHistory = history.map(entry => ({
                role: entry.role,
                content: entry.content
            }));
            
            history.forEach(entry => {
                const content = this.historyService.removeTags(entry.content);
                this.addMessage(entry.type as MessageType || entry.role, content);
            });
        } catch (error) {
            logger.error('Failed to load chat history:', error);
        }
    }
}