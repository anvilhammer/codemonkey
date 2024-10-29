export type ModelType = 'haiku' | 'sonnet' | 'opus';

export interface Model {
    id: ModelType;
    name: string;
    description: string;
    modelString: string;
    cost: string;
}

export const MODELS: Record<ModelType, Model> = {
    haiku: {
        id: 'haiku',
        name: 'Claude 3 Haiku',
        description: 'Fastest and most cost-effective',
        modelString: 'claude-3-haiku-20240307',
        cost: '$0.00025/token'
    },
    sonnet: {
        id: 'sonnet',
        name: 'Claude 3 Sonnet',
        description: 'Balanced performance',
        modelString: 'claude-3-sonnet-20240229',
        cost: '$0.0015/token'
    },
    opus: {
        id: 'opus',
        name: 'Claude 3 Opus',
        description: 'Most capable',
        modelString: 'claude-3-opus-20240229',
        cost: '$0.015/token'
    }
};

export class ModelService {
    private static instance: ModelService;
    private currentModel: ModelType = 'haiku';

    private constructor() {}

    static getInstance(): ModelService {
        if (!ModelService.instance) {
            ModelService.instance = new ModelService();
        }
        return ModelService.instance;
    }

    getCurrentModel(): ModelType {
        return this.currentModel;
    }

    setModel(modelId: ModelType): void {
        this.currentModel = modelId;
    }

    getModelString(): string {
        return MODELS[this.currentModel].modelString;
    }
}