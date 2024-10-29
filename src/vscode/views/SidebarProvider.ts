import * as vscode from 'vscode';

interface ProjectConfig {
    name: string;
    type: 'web' | 'mobile' | 'backend' | 'fullstack';
    framework?: string;
    database?: string;
    features: string[];
    requirements: string;
}

interface WebviewMessage {
    type: 'newProject' | 'openProject' | 'openChat' | 'submitProjectConfig' | 'backToHome';
    config?: ProjectConfig;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    private async handleNewProject(webviewView: vscode.WebviewView) {
        webviewView.webview.html = this._getProjectCreationHtml();
    }

    private async handleOpenProject() {
        const options: vscode.OpenDialogOptions = {
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Project Folder'
        };

        const folderUri = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri[0]) {
            await vscode.commands.executeCommand('vscode.openFolder', folderUri[0]);
        }
    }

    private async handleOpenChat() {
        await vscode.commands.executeCommand('workbench.view.extension.codemonkey-chat-view');
    }

    private async handleProjectConfigSubmission(config: ProjectConfig) {
        try {
            const currentWorkspace = vscode.workspace.workspaceFolders?.[0];
            if (!currentWorkspace) {
                throw new Error('No workspace folder found');
            }
            
            const parentDir = vscode.Uri.joinPath(currentWorkspace.uri, '..');
            const aiProjectsDir = vscode.Uri.joinPath(parentDir, 'AIGeneratedProjects');

            const options: vscode.OpenDialogOptions = {
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: aiProjectsDir,
                openLabel: 'Select Location for New Project'
            };

            const folderUri = await vscode.window.showOpenDialog(options);
            if (folderUri && folderUri[0]) {
                const projectPath = vscode.Uri.joinPath(folderUri[0], config.name);
                
                await vscode.commands.executeCommand('codemonkey.createProject', {
                    ...config,
                    path: projectPath.fsPath
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create project: ${error}`);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getInitialHtml();

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            switch (data.type) {
                case 'newProject':
                    await this.handleNewProject(webviewView);
                    break;
                case 'openProject':
                    await this.handleOpenProject();
                    break;
                case 'openChat':
                    await this.handleOpenChat();
                    break;
                case 'submitProjectConfig':
                    if (data.config) {
                        await this.handleProjectConfigSubmission(data.config);
                    }
                    break;
                case 'backToHome':
                    webviewView.webview.html = this._getInitialHtml();
                    break;
            }
        });
    }

    private _getCommonStyles(): string {
        return `
            body {
                font-family: var(--vscode-font-family);
                padding: 20px;
                color: var(--vscode-foreground);
            }
            .container {
                position: relative;
            }
            .back-button {
                display: block;
                background: none;
                border: none;
                color: var(--vscode-button-foreground);
                cursor: pointer;
                padding: 5px 0;
                margin-bottom: 20px;
                font-size: 14px;
                text-align: left;
                width: auto;
            }
            .back-button:hover {
                color: var(--vscode-button-hoverBackground);
            }
            .header {
                margin-bottom: 20px;
            }
            h2 {
                margin: 0;
                padding: 0;
            }
            button {
                width: 100%;
                padding: 8px;
                margin: 5px 0;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 2px;
                cursor: pointer;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
            .form-group {
                margin-bottom: 15px;
            }
            label {
                display: block;
                margin-bottom: 5px;
            }
            input, select, textarea {
                width: 100%;
                padding: 8px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
            }
            textarea {
                min-height: 100px;
                resize: vertical;
            }
            .checkbox-group {
                margin-top: 10px;
            }
            .checkbox-group label {
                display: inline-block;
                margin-right: 10px;
            }
            .welcome-message {
                margin-bottom: 20px;
                line-height: 1.4;
            }
        `;
    }

    private _getInitialHtml(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CodeMonkey</title>
                <style>${this._getCommonStyles()}</style>
            </head>
            <body>
                <div class="welcome-message">
                    <h2>Welcome to CodeMonkey</h2>
                    <p>What would you like to do?</p>
                </div>
                
                <button onclick="newProject()">Create New Project</button>
                <button onclick="openProject()">Open Existing Project</button>
                <button onclick="openChat()">Work on Current Project</button>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function newProject() {
                        vscode.postMessage({ type: 'newProject' });
                    }
                    
                    function openProject() {
                        vscode.postMessage({ type: 'openProject' });
                    }

                    function openChat() {
                        vscode.postMessage({ type: 'openChat' });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private _getProjectCreationHtml(): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Create Project - CodeMonkey</title>
                <style>${this._getCommonStyles()}</style>
            </head>
            <body>
                <div class="container">
                    <button class="back-button" onclick="backToHome()">← Back</button>
                    <div class="header">
                        <h2>Create New Project</h2>
                    </div>

                    <form id="projectForm">
                        <div class="form-group">
                            <label for="projectName">Project Name:</label>
                            <input type="text" id="projectName" required>
                        </div>
                        
                        <div class="form-group">
                            <label for="requirements">Project Requirements:</label>
                            <textarea 
                                id="requirements" 
                                placeholder="Describe your project requirements here... For example: Create a React app with user authentication, a dashboard, and the ability to create and edit blog posts." 
                                required
                            ></textarea>
                        </div>
                        
                        <div class="form-group">
                            <label for="projectType">Project Type:</label>
                            <select id="projectType" required>
                                <option value="web">Web Application</option>
                                <option value="mobile">Mobile App</option>
                                <option value="backend">Backend Service</option>
                                <option value="fullstack">Full Stack Application</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="framework">Framework:</label>
                            <select id="framework">
                                <option value="react">React</option>
                                <option value="vue">Vue</option>
                                <option value="angular">Angular</option>
                                <option value="next">Next.js</option>
                                <option value="express">Express</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label for="database">Database:</label>
                            <select id="database">
                                <option value="none">None</option>
                                <option value="postgres">PostgreSQL</option>
                                <option value="mongodb">MongoDB</option>
                                <option value="mysql">MySQL</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label>Features:</label>
                            <div class="checkbox-group">
                                <input type="checkbox" id="auth" value="authentication">
                                <label for="auth">Authentication</label>
                                
                                <input type="checkbox" id="api" value="api">
                                <label for="api">API</label>
                                
                                <input type="checkbox" id="docker" value="docker">
                                <label for="docker">Docker</label>
                            </div>
                        </div>
                        
                        <button type="submit">Create Project</button>
                    </form>
                </div>
                
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function backToHome() {
                        vscode.postMessage({ type: 'backToHome' });
                    }
                    
                    document.getElementById('projectForm').addEventListener('submit', (e) => {
                        e.preventDefault();
                        
                        const features = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
                            .map(cb => cb.value);
                        
                        const config = {
                            name: document.getElementById('projectName').value,
                            requirements: document.getElementById('requirements').value,
                            type: document.getElementById('projectType').value,
                            framework: document.getElementById('framework').value,
                            database: document.getElementById('database').value,
                            features: features
                        };
                        
                        vscode.postMessage({ 
                            type: 'submitProjectConfig', 
                            config: config 
                        });
                    });
                </script>
            </body>
            </html>
        `;
    }
}