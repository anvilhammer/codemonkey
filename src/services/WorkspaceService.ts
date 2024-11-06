import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, SpawnOptions } from 'child_process';
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

export interface FileOperation {
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    path: string;
    content?: string;
}

export class WorkspaceService {
    private readonly outputChannel: vscode.OutputChannel;
    private cachedWorkspaceInfo: WorkspaceInfo | null = null;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('CodeMonkey');
    }

    /**
     * File Operations
     */
    async createFile(filePath: string, content: string): Promise<void> {
        try {
            logger.info(`Creating file: ${filePath}`);
            const fullPath = this.resolveWorkspacePath(filePath);
            
            // Create directory if it doesn't exist
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            
            // Write file
            await fs.writeFile(fullPath, content, 'utf-8');
            
            this.outputChannel.appendLine(`✅ Created file: ${filePath}`);
            logger.info(`File created successfully: ${filePath}`);
            
            // Invalidate cache
            this.cachedWorkspaceInfo = null;
        } catch (error) {
            logger.error(`Failed to create file ${filePath}:`, error);
            this.outputChannel.appendLine(`❌ Failed to create file ${filePath}: ${error}`);
            throw error;
        }
    }

    async readFile(filePath: string): Promise<string> {
        try {
            logger.info(`Reading file: ${filePath}`);
            const fullPath = this.resolveWorkspacePath(filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            return content;
        } catch (error) {
            logger.error(`Failed to read file ${filePath}:`, error);
            throw error;
        }
    }

    async updateFile(filePath: string, content: string): Promise<void> {
        try {
            logger.info(`Updating file: ${filePath}`);
            const fullPath = this.resolveWorkspacePath(filePath);
            await fs.writeFile(fullPath, content, 'utf-8');
            this.outputChannel.appendLine(`✅ Updated file: ${filePath}`);
            
            // Invalidate cache
            this.cachedWorkspaceInfo = null;
        } catch (error) {
            logger.error(`Failed to update file ${filePath}:`, error);
            this.outputChannel.appendLine(`❌ Failed to update file ${filePath}: ${error}`);
            throw error;
        }
    }

    async deleteFile(filePath: string): Promise<void> {
        try {
            logger.info(`Deleting file: ${filePath}`);
            const fullPath = this.resolveWorkspacePath(filePath);
            await fs.unlink(fullPath);
            this.outputChannel.appendLine(`✅ Deleted file: ${filePath}`);
            
            // Invalidate cache
            this.cachedWorkspaceInfo = null;
        } catch (error) {
            logger.error(`Failed to delete file ${filePath}:`, error);
            this.outputChannel.appendLine(`❌ Failed to delete file ${filePath}: ${error}`);
            throw error;
        }
    }

    /**
     * Package Management
     */
    async installPackage(packageName: string, isDev: boolean = false): Promise<CommandResult> {
        const command = `npm install ${isDev ? '--save-dev' : ''} ${packageName}`;
        return this.executeCommand(command);
    }

    async initializeProject(projectType?: string): Promise<CommandResult> {
        let command = 'npm init -y';
        if (projectType) {
            switch (projectType.toLowerCase()) {
                case 'react':
                    command = 'npx create-react-app .';
                    break;
                case 'next':
                    command = 'npx create-next-app .';
                    break;
                case 'vue':
                    command = 'npm init vue@latest .';
                    break;
                case 'express':
                    command = 'npm init -y && npm install express';
                    break;
            }
        }
        return this.executeCommand(command);
    }

    /**
     * Command Execution
     */
    async executeCommand(command: string, options: SpawnOptions = {}): Promise<CommandResult> {
        return new Promise((resolve) => {
            logger.info(`Executing command: ${command}`);
            this.outputChannel.appendLine(`\n> Executing: ${command}`);

            const defaultOptions: SpawnOptions = {
                shell: true,
                cwd: this.getCurrentWorkspacePath(),
                ...options
            };

            let outputBuffer = '';
            let errorBuffer = '';

            const process = spawn(command, [], defaultOptions);

            if (process.stdout) {
                process.stdout.on('data', (data) => {
                    const output = data.toString();
                    outputBuffer += output;
                    this.outputChannel.append(output);
                    logger.info(`Command output: ${output.trim()}`);
                });
            }

            if (process.stderr) {
                process.stderr.on('data', (data) => {
                    const error = data.toString();
                    errorBuffer += error;
                    this.outputChannel.append(error);
                    logger.error(`Command error: ${error.trim()}`);
                });
            }

            process.on('close', async (code) => {
                const workspaceChanges = await this.getWorkspaceInfo();
                const result: CommandResult = {
                    success: code === 0,
                    output: outputBuffer,
                    workspaceChanges,
                    ...(code !== 0 && { error: errorBuffer })
                };

                if (code === 0) {
                    this.outputChannel.appendLine('✅ Command completed successfully');
                } else {
                    this.outputChannel.appendLine(`❌ Command failed with exit code ${code}`);
                }

                resolve(result);
            });

            process.on('error', (error) => {
                logger.error('Failed to execute command:', error);
                this.outputChannel.appendLine(`❌ Failed to execute command: ${error.message}`);
                resolve({
                    success: false,
                    output: outputBuffer,
                    error: error.message
                });
            });
        });
    }

    /**
     * Workspace Information
     */
    async getWorkspaceInfo(): Promise<WorkspaceInfo> {
        if (this.cachedWorkspaceInfo) {
            return this.cachedWorkspaceInfo;
        }
        return this.getWorkspaceContent(true);
    }

    async getWorkspaceContent(includeFileContents = false): Promise<WorkspaceInfo> {
        const workspacePath = this.getCurrentWorkspacePath();
        const files: string[] = [];
        const directories: string[] = [];
        const fileContents: { [path: string]: string } = {};

        async function scan(dir: string) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relativePath = path.relative(workspacePath, fullPath);

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

        await scan(workspacePath);

        this.cachedWorkspaceInfo = {
            path: workspacePath,
            files,
            directories,
            ...(includeFileContents && { fileContents })
        };

        return this.cachedWorkspaceInfo;
    }

    /**
     * Utility Methods
     */
    private getCurrentWorkspacePath(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder is currently open');
        }
        return workspaceFolder.uri.fsPath;
    }

    private resolveWorkspacePath(relativePath: string): string {
        return path.join(this.getCurrentWorkspacePath(), relativePath);
    }

    /**
     * Project Templates
     */
    async createProjectStructure(type: string, name: string): Promise<void> {
        const templates: Record<string, FileOperation[]> = {
            'express': [
                {
                    type: 'CREATE',
                    path: 'package.json',
                    content: JSON.stringify({
                        name,
                        version: '1.0.0',
                        dependencies: {
                            'express': '^4.17.1'
                        },
                        scripts: {
                            'start': 'node server.js',
                            'dev': 'nodemon server.js'
                        }
                    }, null, 2)
                },
                {
                    type: 'CREATE',
                    path: 'server.js',
                    content: `const express = require('express');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});`
                }
            ],
            // Add more templates as needed
        };

        const operations = templates[type];
        if (!operations) {
            throw new Error(`Unknown project type: ${type}`);
        }

        for (const op of operations) {
            switch (op.type) {
                case 'CREATE':
                case 'UPDATE':
                    await this.createFile(op.path, op.content!);
                    break;
                case 'DELETE':
                    await this.deleteFile(op.path);
                    break;
            }
        }
    }
}