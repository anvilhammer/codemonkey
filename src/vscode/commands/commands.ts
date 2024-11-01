import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger } from '../../utils/logger';
import { ClaudeService } from '../../services/ClaudeService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ProjectConfig {
    name: string;
    type: string;
    framework?: string;
    database?: string;
    features: string[];
    requirements: string;
    path: string;
}

export interface CommandResult {
    output: string;
    error?: string;
}

export function registerCommands(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('CodeMonkey');
    const claudeService = new ClaudeService();

    // Register createProject command
    const createProject = vscode.commands.registerCommand('codemonkey.createProject', async (config: ProjectConfig) => {
        try {
            logger.info(`Creating project: ${config.name} at ${config.path}`);
            logger.info(`Requirements: ${config.requirements}`);

            // Create project directory
            if (!fs.existsSync(config.path)) {
                fs.mkdirSync(config.path, { recursive: true });
            }

            // Generate project structure and boilerplate code
            const projectStructurePrompt = `
Create a basic project structure and boilerplate code for a ${config.type} project with the following requirements:
${config.requirements}

The project should use ${config.framework || 'no specific framework'} and ${config.database || 'no database'}.
Include the following features: ${config.features.join(', ')}.

Provide the necessary commands to set up the project, initialize a Git repo, and install dependencies.
Use <systemCommand> tags for each command. 
Also include any key files or configurations needed for the project.
`;

            const projectStructureResponse = await claudeService.sendMessage(projectStructurePrompt, []);
            const projectSetupCommands = projectStructureResponse.match(/<systemCommand>(.*?)<\/systemCommand>/g) || [];

            outputChannel.appendLine('Setting up project structure and boilerplate code...');

            for (const command of projectSetupCommands) {
                const commandText = command.replace(/<\/?systemCommand>/g, '');
                outputChannel.appendLine(`Executing: ${commandText}`);
                
                try {
                    // Execute the command in the project directory
                    const { stdout, stderr } = await execAsync(commandText, {
                        cwd: config.path
                    });
                    
                    if (stdout) {
                        outputChannel.appendLine(`Output: ${stdout}`);
                    }
                    
                    if (stderr) {
                        outputChannel.appendLine(`Error: ${stderr}`);
                    }
                } catch (error) {
                    logger.error(`Failed to execute command: ${commandText}`, error);
                    outputChannel.appendLine(`Error: ${error}`);
                }
            }

            // Open the new project in VS Code
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(config.path));

            outputChannel.appendLine(`Project ${config.name} created successfully!`);
            vscode.window.showInformationMessage(`Project ${config.name} created successfully!`);

        } catch (error) {
            logger.error('Failed to create project:', error);
            outputChannel.appendLine(`Failed to create project: ${error}`);
            vscode.window.showErrorMessage(`Failed to create project: ${error}`);
        }
    });

    const changeActiveProject = vscode.commands.registerCommand('codemonkey.changeActiveProject', async (projectPath: string) => {
        try {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath));
            outputChannel.appendLine(`Changed active project to: ${projectPath}`);
        } catch (error) {
            logger.error('Failed to change active project:', error);
            outputChannel.appendLine(`Failed to change active project: ${error}`);
            vscode.window.showErrorMessage(`Failed to change active project: ${error}`);
        }
    });

    context.subscriptions.push(changeActiveProject);
    context.subscriptions.push(createProject);
    context.subscriptions.push(outputChannel);
}