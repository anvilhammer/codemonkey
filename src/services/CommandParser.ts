import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export interface Command {
    type: CommandType;
    params: Record<string, string | number>;
}

export type CommandType = 
    | 'CREATE_FILE'
    | 'WRITE_TO_FILE'
    | 'READ_FILE'
    | 'DELETE_FILE'
    | 'EXECUTE_COMMAND'
    | 'INSTALL_PACKAGE'
    | 'CREATE_DIRECTORY'
    | 'SET_ENV_VAR';

export class CommandParser {
    static parse(text: string): Command[] {
        const commands: Command[] = [];
        
        // Parse <systemCommand> tags
        const systemCommandRegex = /<systemCommand>([\s\S]*?)<\/systemCommand>/g;
        let match;
        
        while ((match = systemCommandRegex.exec(text)) !== null) {
            const commandText = match[1].trim();
            
            // Parse npm/yarn commands
            if (commandText.startsWith('npm ') || commandText.startsWith('yarn ')) {
                commands.push({
                    type: 'INSTALL_PACKAGE',
                    params: {
                        command: commandText
                    }
                });
                continue;
            }

            // Parse mkdir commands
            if (commandText.startsWith('mkdir ')) {
                commands.push({
                    type: 'CREATE_DIRECTORY',
                    params: {
                        path: commandText.replace('mkdir ', '').trim()
                    }
                });
                continue;
            }

            // Handle other commands
            commands.push({
                type: 'EXECUTE_COMMAND',
                params: {
                    command: commandText
                }
            });
        }

        // Parse file operations using standard format
        const fileOpRegex = /(CREATE_FILE|WRITE_TO_FILE|READ_FILE|DELETE_FILE):\s*([^\n]+)(?:\n([\s\S]*?)(?=\n(?:CREATE_FILE|WRITE_TO_FILE|READ_FILE|DELETE_FILE):|$))?/g;
        
        while ((match = fileOpRegex.exec(text)) !== null) {
            const [, type, path, content] = match;
            
            commands.push({
                type: type as CommandType,
                params: {
                    path: path.trim(),
                    ...(content && { content: content.trim() })
                }
            });
        }

        // Log parsed commands for debugging
        logger.info('Parsed commands:', commands);
        
        return commands;
    }

    static async executeCommand(command: Command): Promise<void> {
        try {
            switch (command.type) {
                case 'CREATE_FILE':
                case 'WRITE_TO_FILE': {
                    const uri = vscode.Uri.file(command.params.path as string);
                    const content = command.params.content as string || '';
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
                    break;
                }

                case 'READ_FILE': {
                    const uri = vscode.Uri.file(command.params.path as string);
                    await vscode.workspace.fs.readFile(uri);
                    break;
                }

                case 'DELETE_FILE': {
                    const uri = vscode.Uri.file(command.params.path as string);
                    await vscode.workspace.fs.delete(uri);
                    break;
                }

                case 'CREATE_DIRECTORY': {
                    const uri = vscode.Uri.file(command.params.path as string);
                    await vscode.workspace.fs.createDirectory(uri);
                    break;
                }

                case 'INSTALL_PACKAGE': {
                    const terminal = vscode.window.createTerminal('Package Installation');
                    terminal.sendText(command.params.command as string);
                    terminal.show();
                    break;
                }

                case 'EXECUTE_COMMAND': {
                    await vscode.commands.executeCommand(command.params.command as string);
                    break;
                }
            }
        } catch (error) {
            logger.error(`Failed to execute command ${command.type}:`, error);
            throw error;
        }
    }
}