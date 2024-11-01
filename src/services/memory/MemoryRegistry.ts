// src/services/memory/MemoryRegistry.ts

import { SemanticMemoryManager } from './SemanticMemory';
import { AdaptivePipeline } from '../pipeline/AdaptivePipeline';
import { logger } from '../../utils/logger';

export class MemoryRegistry {
    private static instance: MemoryRegistry;
    private semanticMemory: SemanticMemoryManager;
    private pipeline: AdaptivePipeline;
    private memoryUsageInterval: NodeJS.Timeout;

    private constructor() {
        this.semanticMemory = new SemanticMemoryManager();
        this.pipeline = new AdaptivePipeline(this.semanticMemory);
        this.memoryUsageInterval = setTimeout(() => {}, 0); // Initialize with dummy timeout
        this.setupMemoryMonitoring();
    }

    static getInstance(): MemoryRegistry {
        if (!MemoryRegistry.instance) {
            MemoryRegistry.instance = new MemoryRegistry();
        }
        return MemoryRegistry.instance;
    }

    private setupMemoryMonitoring(): void {
        // Clear the dummy timeout
        clearTimeout(this.memoryUsageInterval);
        
        this.memoryUsageInterval = setInterval(async () => {
            const memoryState = await this.semanticMemory.analyzeMemoryState();
            const pipelineState = await this.pipeline.analyzePerformance();

            const totalMemoryUsage = process.memoryUsage().heapUsed;
            const memoryThreshold = 1024 * 1024 * 1024; // 1GB

            if (totalMemoryUsage > memoryThreshold) {
                logger.warn('Memory usage high, triggering optimization');
                await this.optimizeMemory();
            }

            logger.debug('Memory status:', {
                totalUsage: totalMemoryUsage,
                semanticNodes: memoryState.totalNodes,
                pipelineQueue: pipelineState.queueLength
            });
        }, 60000); // Check every minute
    }

    private async optimizeMemory(): Promise<void> {
        // Make consolidateMemory public in SemanticMemoryManager or use a public method
        await this.semanticMemory.optimize(); // Assuming we rename/create this public method
        await this.pipeline.optimizePipeline();
    }

    getSemanticMemory(): SemanticMemoryManager {
        return this.semanticMemory;
    }

    getPipeline(): AdaptivePipeline {
        return this.pipeline;
    }

    async shutdown(): Promise<void> {
        clearInterval(this.memoryUsageInterval);
        await this.optimizeMemory();
    }
}