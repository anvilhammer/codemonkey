// src/extension.ts

import * as vscode from 'vscode';
import { ChatProvider } from './vscode/views/ChatProvider';
import { logger } from './utils/logger';
import { CacheService } from './services/CacheService';

export async function activate(context: vscode.ExtensionContext) {
    try {
        logger.info('Starting CodeMonkey...');

        const outputChannel = vscode.window.createOutputChannel('CodeMonkey');
        context.subscriptions.push(outputChannel);

        // Initialize cache service using singleton pattern
        const cacheService = CacheService.getInstance();
        
        // Set up periodic cache cleanup
        const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
        const cleanup = setInterval(() => {
            cacheService.cleanup().catch((error: Error) => {
                logger.error('Failed to clean up cache:', error);
            });
        }, CLEANUP_INTERVAL);

        // Register cleanup for disposal with proper type
        context.subscriptions.push(new vscode.Disposable(() => clearInterval(cleanup)));
        
        // Initialize chat provider
        const chatProvider = new ChatProvider(context.extensionUri, outputChannel);
        const chatRegistration = vscode.window.registerWebviewViewProvider(
            "codemonkey-chat-view",
            chatProvider,
            {
                webviewOptions: { 
                    retainContextWhenHidden: true
                }
            }
        );
        
        context.subscriptions.push(chatRegistration);
        logger.info('CodeMonkey chat interface activated');
        outputChannel.appendLine('CodeMonkey is ready to assist you!');

        // Register project management command
        const changeActiveProject = vscode.commands.registerCommand(
            'codemonkey.changeActiveProject', 
            async (projectPath: string) => {
                try {
                    await vscode.commands.executeCommand(
                        'vscode.openFolder', 
                        vscode.Uri.file(projectPath)
                    );
                    logger.info(`Changed active project to: ${projectPath}`);
                    outputChannel.appendLine(`Changed active project to: ${projectPath}`);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.error('Failed to change active project:', error);
                    outputChannel.appendLine(`Failed to change active project: ${errorMessage}`);
                    vscode.window.showErrorMessage(`Failed to change active project: ${errorMessage}`);
                }
            }
        );

        context.subscriptions.push(changeActiveProject);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to activate CodeMonkey:', error);
        vscode.window.showErrorMessage(`CodeMonkey activation failed: ${errorMessage}`);
    }
}

export function deactivate() {
    // Clean up cache service on deactivation
    try {
        const cacheService = CacheService.getInstance();
        void cacheService.cleanup();
        logger.info('CodeMonkey deactivated and cache cleaned');
    } catch (error) {
        logger.error('Error during CodeMonkey deactivation:', error);
    }
}