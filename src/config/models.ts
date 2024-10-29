export interface ModelConfig {
    id: string;
    name: string;
    displayName: string;
    description: string;
    maxTokens: number;
    contextWindow: number;
    toolUseSystemPromptTokens: number;
    costPerInputToken: number;
    costPerOutputToken: number;
}

export const AVAILABLE_MODELS: ModelConfig[] = [
    {
        id: 'haiku',
        name: 'claude-3-haiku-20240307',
        displayName: 'Claude 3 Haiku',
        description: 'Fastest and most cost-effective. Best for simple tasks and quick responses.',
        maxTokens: 4000,
        contextWindow: 200000,
        toolUseSystemPromptTokens: 264,
        costPerInputToken: 0.00025,
        costPerOutputToken: 0.00025
    },
    {
        id: 'sonnet',
        name: 'claude-3-sonnet-20240229',
        displayName: 'Claude 3 Sonnet',
        description: 'Balanced performance. Good for complex tasks and detailed analysis.',
        maxTokens: 4000,
        contextWindow: 200000,
        toolUseSystemPromptTokens: 159,
        costPerInputToken: 0.0015,
        costPerOutputToken: 0.0015
    },
    {
        id: 'opus',
        name: 'claude-3-opus-20240229',
        displayName: 'Claude 3 Opus',
        description: 'Most capable. Best for architecture decisions and complex reasoning.',
        maxTokens: 4000,
        contextWindow: 200000,
        toolUseSystemPromptTokens: 530,
        costPerInputToken: 0.015,
        costPerOutputToken: 0.015
    }
];

export const DEFAULT_MODEL = AVAILABLE_MODELS[0]; // Haiku as default