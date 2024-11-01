// src/vscode/types/chat.ts

export type MessageType = 
    | 'user'
    | 'assistant'
    | 'question'
    | 'error'
    | 'suggestion'
    | 'code'
    | 'systemCommand'
    | 'debug'
    | 'status'
    | 'warning'
    | 'success';

// Keep Role compatible with Anthropic API
export type Role = 'user' | 'assistant';

// Add internal message role type
export type InternalRole = Role | 'system';

export interface Message {
    role: InternalRole;  // Use InternalRole here
    content: string;
    type?: MessageType;
    timestamp?: number;
}

// Rest of the interfaces remain the same
export interface ChatMessage {
    id: string;
    type: MessageType;
    content: string;
    timestamp: number;
    metadata?: {
        fileName?: string;
        lineNumber?: number;
        error?: string;
        command?: string;
        language?: string;
    };
}

export interface ApiContext {
    projectPath?: string;
    recentErrors: string[];
    recentLogs: string[];
    lastUserMessage?: string;
    lastAssistantMessage?: string;
    sessionStartTime: number;
}

export interface WebviewMessage {
    type: 'sendMessage' | 'clearChat' | 'copyCode' | 'executeCommand' | 'changeModel';
    message?: string;
    messageId?: string;
    command?: string;
    modelId?: string;
}