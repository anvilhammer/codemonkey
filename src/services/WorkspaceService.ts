import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';

export interface WorkspaceInfo {
    path: string;
    files: string[];
    directories: string[];
    fileContents?: { [path: string]: string };
}

export interface CommandResult {
    success: boolean;
    output: string;
    error?: string;
    workspaceChanges?: WorkspaceInfo;
}

interface FileOperationTransaction {
    operations: Array<
        | { type: 'CREATE_FILE'; filePath: string; content: string }
        | { type: 'UPDATE_FILE'; filePath: string; content: string }
        | { type: 'DELETE_FILE'; filePath: string }
    >;
    workspaceInfo: WorkspaceInfo;
}

export class WorkspaceService {
    private readonly outputChannel: vscode.OutputChannel;
    private cachedWorkspaceInfo: WorkspaceInfo | null = null;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('CodeMonkey Shell');
    }

    async executeCommand(command: string): Promise<CommandResult> {
        return new Promise((resolve) => {
            this.outputChannel.show(true);
            this.outputChannel.appendLine(`\n\x1b[36m> Executing: ${command}\x1b[0m`);

            let outputBuffer = '';
            let errorBuffer = '';

            const process = spawn(command, [], {
                shell: true,
                cwd: this.resolveWorkspacePath('.')
            });

            process.stdout.on('data', (data) => {
                const output = data.toString();
                outputBuffer += output;
                this.outputChannel.append(`\x1b[32m${output}\x1b[0m`);
                logger.info(`Command output: ${output.trim()}`);
            });

            process.stderr.on('data', (data) => {
                const error = data.toString();
                errorBuffer += error;
                this.outputChannel.append(`\x1b[31m${error}\x1b[0m`);
                logger.error(`Command error: ${error.trim()}`);
            });

            process.on('close', async (code) => {
                const workspaceChanges = await this.getWorkspaceContent();
                const result: CommandResult = {
                    success: code === 0,
                    output: outputBuffer,
                    workspaceChanges,
                    ...(code !== 0 && { error: errorBuffer })
                };

                if (code !== 0) {
                    this.outputChannel.appendLine(`\x1b[31m✖ Command failed with exit code ${code}\x1b[0m`);
                } else {
                    this.outputChannel.appendLine(`\x1b[32m✔ Command completed successfully\x1b[0m`);
                }

                if (workspaceChanges) {
                    this.outputChannel.appendLine('\n\x1b[36mWorkspace changes:\x1b[0m');
                    this.outputChannel.appendLine(`Files: ${workspaceChanges.files.join(', ')}`);
                    this.outputChannel.appendLine(`Directories: ${workspaceChanges.directories.join(', ')}`);
                }

                resolve(result);
            });

            process.on('error', (error) => {
                const result: CommandResult = {
                    success: false,
                    output: outputBuffer,
                    error: error.message
                };
                this.outputChannel.appendLine(`\x1b[31m✖ Failed to execute command: ${error.message}\x1b[0m`);
                logger.error('Command execution error:', error);
                resolve(result);
            });
        });
    }

    // Transaction Management
    async createWorkspaceSnapshot(): Promise<void> {
        this.cachedWorkspaceInfo = await this.getWorkspaceContent(true);
    }

    async getWorkspaceInfo(): Promise<WorkspaceInfo> {
        if (this.cachedWorkspaceInfo) {
            return this.cachedWorkspaceInfo;
        }
        return this.getWorkspaceContent(true);
    }

    async beginTransaction(): Promise<FileOperationTransaction> {
        return {
            operations: [],
            workspaceInfo: await this.getWorkspaceInfo()
        };
    }

    async commitTransaction(transaction: FileOperationTransaction): Promise<void> {
        try {
            for (const operation of transaction.operations) {
                switch (operation.type) {
                    case 'CREATE_FILE':
                        await this.createFile(operation.filePath, operation.content);
                        break;
                    case 'UPDATE_FILE':
                        await this.updateFile(operation.filePath, operation.content);
                        break;
                    case 'DELETE_FILE':
                        await this.deleteFile(operation.filePath);
                        break;
                }
            }
            this.cachedWorkspaceInfo = transaction.workspaceInfo;
        } catch (error) {
            await this.rollbackTransaction(transaction);
            throw error;
        }
    }

    async rollbackTransaction(transaction: FileOperationTransaction): Promise<void> {
        for (const operation of transaction.operations.reverse()) {
            try {
                switch (operation.type) {
                    case 'CREATE_FILE':
                    case 'UPDATE_FILE':
                        await this.deleteFile(operation.filePath);
                        break;
                    case 'DELETE_FILE':
                        await this.createFile(
                            operation.filePath, 
                            transaction.workspaceInfo.fileContents?.[operation.filePath] || ''
                        );
                        break;
                }
            } catch (error) {
                logger.error(`Rollback failed for operation ${operation.type}:`, error);
            }
        }
        this.cachedWorkspaceInfo = transaction.workspaceInfo;
    }

    // File Operations
    async createFile(filePath: string, content: string): Promise<void> {
        try {
            const fullPath = this.resolveWorkspacePath(filePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content);
            this.outputChannel.appendLine(`\x1b[32m✔ Created file: ${filePath}\x1b[0m`);
            logger.info(`Created file: ${filePath}`);
        } catch (error) {
            this.outputChannel.appendLine(`\x1b[31m✖ Failed to create file ${filePath}: ${error}\x1b[0m`);
            logger.error(`Failed to create file ${filePath}:`, error);
            throw error;
        }
    }

    async readFile(filePath: string): Promise<string> {
        try {
            const fullPath = this.resolveWorkspacePath(filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            logger.info(`Read file: ${filePath}`);
            return content;
        } catch (error) {
            logger.error(`Failed to read file ${filePath}:`, error);
            throw error;
        }
    }

    async updateFile(filePath: string, content: string): Promise<void> {
        try {
            const fullPath = this.resolveWorkspacePath(filePath);
            await fs.writeFile(fullPath, content);
            this.outputChannel.appendLine(`\x1b[32m✔ Updated file: ${filePath}\x1b[0m`);
            logger.info(`Updated file: ${filePath}`);
        } catch (error) {
            this.outputChannel.appendLine(`\x1b[31m✖ Failed to update file ${filePath}: ${error}\x1b[0m`);
            logger.error(`Failed to update file ${filePath}:`, error);
            throw error;
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        try {
            const fullPath = this.resolveWorkspacePath(filePath);
            await fs.unlink(fullPath);
            this.outputChannel.appendLine(`\x1b[32m✔ Deleted file: ${filePath}\x1b[0m`);
            logger.info(`Deleted file: ${filePath}`);
        } catch (error) {
            this.outputChannel.appendLine(`\x1b[31m✖ Failed to delete file ${filePath}: ${error}\x1b[0m`);
            logger.error(`Failed to delete file ${filePath}:`, error);
            throw error;
        }
    }

    // Workspace Operations
    async getWorkspaceContent(includeFileContents = false): Promise<WorkspaceInfo> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder is currently open');
        }

        const rootPath = workspaceFolder.uri.fsPath;
        const files: string[] = [];
        const directories: string[] = [];
        const fileContents: { [path: string]: string } = {};

        async function scan(dir: string) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(rootPath, fullPath);

                if (entry.name === 'node_modules' || entry.name === '.git') {
                    continue;
                }

                if (entry.isDirectory()) {
                    directories.push(relativePath);
                    await scan(fullPath);
                } else {
                    files.push(relativePath);
                    if (includeFileContents) {
                        try {
                            fileContents[relativePath] = await fs.readFile(fullPath, 'utf-8');
                        } catch (error) {
                            logger.error(`Failed to read file ${relativePath}:`, error);
                        }
                    }
                }
            }
        }

        await scan(rootPath);

        return {
            path: rootPath,
            files,
            directories,
            ...(includeFileContents && { fileContents })
        };
    }

    private resolveWorkspacePath(relativePath: string): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder is currently open');
        }
        return path.join(workspaceFolder.uri.fsPath, relativePath);
    }
}