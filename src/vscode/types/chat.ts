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

export type Role = 'user' | 'assistant';

export interface Message {
    role: Role;
    content: string;
    type?: MessageType;
    timestamp?: number;
}

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