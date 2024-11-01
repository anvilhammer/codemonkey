import React, { useState, useEffect } from 'react';

interface ModelConfig {
    id: string;
    displayName: string;
    description: string;
    costPerToken: string;
}

const MODELS: ModelConfig[] = [
    {
        id: 'haiku',
        displayName: 'Claude 3 Haiku',
        description: 'Fastest and most cost-effective. Best for simple tasks and quick responses.',
        costPerToken: '$0.00025'
    },
    {
        id: 'sonnet',
        displayName: 'Claude 3 Sonnet',
        description: 'Balanced performance. Good for complex tasks and detailed analysis.',
        costPerToken: '$0.0015'
    },
    {
        id: 'opus',
        displayName: 'Claude 3 Opus',
        description: 'Most capable. Best for architecture decisions and complex reasoning.',
        costPerToken: '$0.015'
    }
];

const ModelSelector = () => {
    const [selectedModel, setSelectedModel] = useState('haiku');
    const [showDetails, setShowDetails] = useState(false);

    const handleModelChange = (modelId: string) => {
        setSelectedModel(modelId);
        // Post message to VS Code
        const vscode = acquireVsCodeApi();
        vscode.postMessage({
            type: 'changeModel',
            modelId: modelId
        });
    };

    return (
        <div className="p-4 bg-gray-800 rounded-lg shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Model Selection</h3>
                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-blue-400 hover:text-blue-300 text-sm"
                >
                    {showDetails ? 'Hide Details' : 'Show Details'}
                </button>
            </div>

            <div className="space-y-3">
                {MODELS.map((model) => (
                    <div
                        key={model.id}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                            selectedModel === model.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                        }`}
                        onClick={() => handleModelChange(model.id)}
                    >
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="font-medium">{model.displayName}</div>
                                {showDetails && (
                                    <div className="mt-2 space-y-1">
                                        <div className="text-sm opacity-90">{model.description}</div>
                                        <div className="text-xs opacity-75">
                                            Cost per token: {model.costPerToken}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="ml-3">
                                <div className={`w-4 h-4 rounded-full border-2 ${
                                    selectedModel === model.id
                                        ? 'bg-white border-white'
                                        : 'border-gray-400'
                                }`} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ModelSelector;