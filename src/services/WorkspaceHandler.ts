import * as vscode from 'vscode';
import { logger } from '../utils/logger';

export class WorkspaceHandler {
    static async getWorkspaceInfo(): Promise<string> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return 'No workspace folder is currently open';
            }

            const workspacePath = workspaceFolder.uri.fsPath;
            const info = [`Current workspace: ${workspacePath}`];

            // Get all files in the workspace
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
            
            // Group files by directory
            const filesByDirectory = new Map<string, vscode.Uri[]>();
            files.forEach(file => {
                const dir = vscode.workspace.asRelativePath(file.path).split('/')[0];
                if (!filesByDirectory.has(dir)) {
                    filesByDirectory.set(dir, []);
                }
                filesByDirectory.get(dir)!.push(file);
            });

            // Add directory structure to info
            info.push('\nDirectory Structure:');
            for (const [dir, files] of filesByDirectory) {
                info.push(`\n${dir}/`);
                for (const file of files) {
                    const relativePath = vscode.workspace.asRelativePath(file);
                    info.push(`  ${relativePath}`);

                    // For small text files, include their content
                    if (this.isTextFile(file.fsPath)) {
                        try {
                            const content = await vscode.workspace.fs.readFile(file);
                            const textContent = Buffer.from(content).toString('utf8');
                            if (textContent.length < 1000) { // Only include small files
                                info.push('    Content:');
                                info.push(textContent.split('\n').map(line => `      ${line}`).join('\n'));
                            }
                        } catch (error) {
                            logger.error(`Failed to read file ${file.fsPath}:`, error);
                        }
                    }
                }
            }

            // Add package.json info if it exists
            const packageJsonFiles = await vscode.workspace.findFiles('**/package.json', '**/node_modules/**');
            if (packageJsonFiles.length > 0) {
                info.push('\nPackage Information:');
                for (const packageFile of packageJsonFiles) {
                    const content = await vscode.workspace.fs.readFile(packageFile);
                    const packageJson = JSON.parse(Buffer.from(content).toString());
                    info.push(`  ${vscode.workspace.asRelativePath(packageFile)}:`);
                    info.push(`    Dependencies: ${Object.keys(packageJson.dependencies || {}).join(', ')}`);
                    info.push(`    DevDependencies: ${Object.keys(packageJson.devDependencies || {}).join(', ')}`);
                }
            }

            return info.join('\n');
        } catch (error) {
            logger.error('Failed to get workspace info:', error);
            return 'Error getting workspace information';
        }
    }

    private static isTextFile(filePath: string): boolean {
        const textExtensions = ['.txt', '.md', '.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml', '.env'];
        return textExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
    }
}