/* eslint-disable no-console */
// src/services/CommandExecutor.ts
import { Command } from '../types/commands';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export class CommandExecutor {
    static async execute(command: Command): Promise<void> {
        console.log('Executing command type:', command.type);
        try {
            switch (command.type) {
                case 'EXECUTE_COMMAND':
                    console.log('Executing EXECUTE_COMMAND with content:', command.params.command);
                    if (command.params.command) {
                        await CommandExecutor.executeShellCommand(command.params.command);
                    } else {
                        throw new Error('Missing content for EXECUTE_COMMAND');
                    }
                    break;
                case 'CREATE_FILE':
                    console.log('Executing CREATE_FILE with path:', command.params.path);
                    if (command.params.path) {
                        await CommandExecutor.createFile(command.params.path, command.params.content || '');
                    } else {
                        throw new Error('Missing path for CREATE_FILE');
                    }
                    break;
                case 'DELETE_FILE':
                    console.log('Executing DELETE_FILE with path:', command.params.path);
                    if (command.params.path) {
                        await CommandExecutor.deleteFile(command.params.path);
                    } else {
                        throw new Error('Missing path for DELETE_FILE');
                    }
                    break;
                case 'READ_FILE':
                    console.log('Executing READ_FILE with path:', command.params.path);
                    if (command.params.path) {
                        const content = await CommandExecutor.readFile(command.params.path);
                        console.log('File content:', content);
                    } else {
                        throw new Error('Missing path for READ_FILE');
                    }
                    break;
                case 'WRITE_TO_FILE':
                    console.log('Executing WRITE_TO_FILE with path:', command.params.path, 'and content:', command.params.content);
                    if (command.params.path && command.params.content !== undefined) {
                        await CommandExecutor.writeToFile(command.params.path, command.params.content);
                    } else {
                        throw new Error('Missing path or content for WRITE_TO_FILE');
                    }
                    break;
                default:
                    console.log('Unknown command type:', command.type);
                    throw new Error(`Unknown command type: ${command.type}`);
            }
        } catch (error) {
            console.error('Error executing command:', error);
            throw error;
        }
    }

    private static async executeShellCommand(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log('About to execute shell command:', command);
            const process = spawn(command, { shell: true, cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath });

            process.stdout.on('data', (data) => {
                console.log(`stdout: ${data}`);
            });

            process.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
            });

            process.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Command failed with exit code ${code}`);
                    reject(new Error(`Command failed with exit code ${code}`));
                } else {
                    console.log(`Command executed successfully`);
                    resolve();
                }
            });
        });
    }

    private static async createFile(relativePath: string, content: string): Promise<void> {
        console.log('About to create file at path:', relativePath, 'with content:', content);
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder is currently open');
            }
            const fullPath = path.join(workspaceFolder.uri.fsPath, relativePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content);
            console.log(`File created at: ${fullPath}`);
        } catch (error) {
            console.error('Error creating file at path:', relativePath, 'Error:', error);
            throw error;
        }
    }

    private static async deleteFile(relativePath: string): Promise<void> {
        console.log('About to delete file at path:', relativePath);
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder is currently open');
            }
            const fullPath = path.join(workspaceFolder.uri.fsPath, relativePath);
            await fs.unlink(fullPath);
            console.log(`File deleted at: ${fullPath}`);
        } catch (error) {
            console.error('Error deleting file at path:', relativePath, 'Error:', error);
            throw error;
        }
    }

    private static async readFile(relativePath: string): Promise<string> {
        console.log('About to read file at path:', relativePath);
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder is currently open');
            }
            const fullPath = path.join(workspaceFolder.uri.fsPath, relativePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            console.log(`File read from: ${fullPath}`);
            return content;
        } catch (error) {
            console.error('Error reading file at path:', relativePath, 'Error:', error);
            throw error;
        }
    }

    private static async writeToFile(relativePath: string, content: string): Promise<void> {
        console.log('About to write to file at path:', relativePath, 'with content:', content);
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder is currently open');
            }
            const fullPath = path.join(workspaceFolder.uri.fsPath, relativePath);
            await fs.writeFile(fullPath, content);
            console.log(`File written to: ${fullPath}`);
        } catch (error) {
            console.error('Error writing to file at path:', relativePath, 'Error:', error);
            throw error;
        }
    }
}
