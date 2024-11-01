// src/services/pipeline/AdaptivePipeline.ts

import { logger } from '../../utils/logger';
import { SemanticMemoryManager } from '../memory/SemanticMemory';

type ProcessableData = string | Buffer | Record<string, unknown>;
type ProcessedResult = string | Buffer | Record<string, unknown>;

interface PipelineStage<T = ProcessableData, R = ProcessedResult> {
    name: string;
    processor: (data: T) => Promise<R>;
    priority: number;
    memoryThreshold: number;
    timeThreshold: number;
}

interface PipelineMetrics {
    stageTiming: Map<string, number[]>;
    memoryUsage: Map<string, number[]>;
    successRate: Map<string, number>;
    throughput: number;
}

interface BackpressureStrategy {
    maxConcurrent: number;
    queueSize: number;
    dropPolicy: 'oldest' | 'newest' | 'lowest-priority';
}

interface QueueItem {
    id: string;
    data: ProcessableData;
    priority: number;
    timestamp: number;
}

export class AdaptivePipeline {
    private stages: Map<string, PipelineStage>;
    private metrics: PipelineMetrics;
    private backpressure: BackpressureStrategy;
    private memoryManager: SemanticMemoryManager;
    private processing: Set<string>;
    private queue: QueueItem[];

    constructor(
        memoryManager: SemanticMemoryManager,
        backpressure: Partial<BackpressureStrategy> = {}
    ) {
        this.stages = new Map();
        this.memoryManager = memoryManager;
        this.processing = new Set();
        this.queue = [];
        
        this.metrics = {
            stageTiming: new Map(),
            memoryUsage: new Map(),
            successRate: new Map(),
            throughput: 0
        };

        this.backpressure = {
            maxConcurrent: backpressure.maxConcurrent || 5,
            queueSize: backpressure.queueSize || 100,
            dropPolicy: backpressure.dropPolicy || 'lowest-priority'
        };
    }

    registerStage<T extends ProcessableData, R extends ProcessedResult>(
        stage: PipelineStage<T, R>
    ): void {
        // Use type assertion since we know the types are compatible
        const typedStage = stage as unknown as PipelineStage<ProcessableData, ProcessedResult>;
        this.stages.set(stage.name, typedStage);
        this.metrics.stageTiming.set(stage.name, []);
        this.metrics.memoryUsage.set(stage.name, []);
        this.metrics.successRate.set(stage.name, 1);
    }

    async process<T extends ProcessableData>(
        data: T,
        priority: number = 1
    ): Promise<ProcessedResult> {
        const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        if (this.processing.size >= this.backpressure.maxConcurrent) {
            return this.handleBackpressure(id, data, priority);
        }

        try {
            this.processing.add(id);
            let result: ProcessedResult = data as ProcessedResult;
            const startTime = Date.now();

            for (const [stageName, stage] of this.stages.entries()) {
                const stageStart = process.hrtime();
                const memoryBefore = process.memoryUsage().heapUsed;

                try {
                    result = await this.executeStage(stage, result);
                    
                    const [seconds, nanoseconds] = process.hrtime(stageStart);
                    const duration = seconds * 1000 + nanoseconds / 1e6;
                    const memoryUsed = process.memoryUsage().heapUsed - memoryBefore;

                    this.updateMetrics(stageName, duration, memoryUsed, true);
                } catch (error) {
                    this.updateMetrics(stageName, 0, 0, false);
                    throw error;
                }

                if (process.memoryUsage().heapUsed > stage.memoryThreshold) {
                    await this.optimizeMemory();
                }
            }

            const totalTime = Date.now() - startTime;
            this.metrics.throughput = this.calculateThroughput(totalTime);

            return result;
        } finally {
            this.processing.delete(id);
            this.processQueue();
        }
    }

    private async executeStage<T extends ProcessableData, R extends ProcessedResult>(
        stage: PipelineStage<T, R>,
        data: T
    ): Promise<R> {
        try {
            return await stage.processor(data);
        } catch (error) {
            logger.error(`Error in pipeline stage ${stage.name}:`, error);
            throw error;
        }
    }

    private async handleBackpressure(
        id: string,
        data: ProcessableData,
        priority: number
    ): Promise<ProcessedResult> {
        if (this.queue.length >= this.backpressure.queueSize) {
            await this.applyDropPolicy();
        }

        const queueItem: QueueItem = {
            id,
            data,
            priority,
            timestamp: Date.now()
        };

        this.queue.push(queueItem);
        logger.info(`Added job ${id} to queue. Current queue size: ${this.queue.length}`);

        // Return a promise that will be resolved when the item is processed
        return new Promise((resolve, reject) => {
            const checkQueue = setInterval(() => {
                const index = this.queue.findIndex(item => item.id === id);
                if (index === -1) {
                    clearInterval(checkQueue);
                    resolve(this.process(data, priority));
                }
            }, 100);

            // Add timeout to prevent infinite waiting
            setTimeout(() => {
                clearInterval(checkQueue);
                reject(new Error('Queue processing timeout'));
            }, 30000);
        });
    }

    private async applyDropPolicy(): Promise<void> {
        switch (this.backpressure.dropPolicy) {
            case 'oldest': {
                this.queue.shift();
                break;
            }
            case 'newest': {
                this.queue.pop();
                break;
            }
            case 'lowest-priority': {
                const { lowestPriorityIndex } = this.queue.reduce(
                    (acc, item, index) => {
                        if (item.priority < acc.lowestPriority) {
                            return { lowestPriority: item.priority, lowestPriorityIndex: index };
                        }
                        return acc;
                    },
                    { lowestPriority: Infinity, lowestPriorityIndex: 0 }
                );
                this.queue.splice(lowestPriorityIndex, 1);
                break;
            }
        }
    }

    private async processQueue(): Promise<void> {
        if (this.queue.length === 0 || this.processing.size >= this.backpressure.maxConcurrent) {
            return;
        }

        // Sort queue by priority
        this.queue.sort((a, b) => b.priority - a.priority);

        const next = this.queue.shift();
        if (next) {
            await this.process(next.data, next.priority);
        }
    }

    private async optimizeMemory(): Promise<void> {
        const memoryUsage = process.memoryUsage().heapUsed;
        const threshold = 1024 * 1024 * 1024; // 1GB

        if (memoryUsage > threshold) {
            logger.info('Memory optimization triggered');
            
            // Clear metrics older than 1 hour
            const oneHourAgo = Date.now() - (60 * 60 * 1000);
            for (const timings of this.metrics.stageTiming.values()) {
                const recentTimings = timings.filter(t => t > oneHourAgo);
                timings.length = 0;
                timings.push(...recentTimings);
            }

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
        }
    }

    private updateMetrics(
        stageName: string,
        duration: number,
        memoryUsed: number,
        success: boolean
    ): void {
        // Update timing metrics
        const timings = this.metrics.stageTiming.get(stageName) || [];
        timings.push(duration);
        this.metrics.stageTiming.set(stageName, timings);

        // Update memory metrics
        const memoryMetrics = this.metrics.memoryUsage.get(stageName) || [];
        memoryMetrics.push(memoryUsed);
        this.metrics.memoryUsage.set(stageName, memoryMetrics);

        // Update success rate
        const currentRate = this.metrics.successRate.get(stageName) || 1;
        const newRate = success
            ? currentRate * 0.95 + 0.05 // Slight increase
            : currentRate * 0.95;       // Slight decrease
        this.metrics.successRate.set(stageName, newRate);
    }

    private calculateThroughput(processingTime: number): number {
        return 1000 / processingTime; // Operations per second
    }

    async analyzePerformance(): Promise<{
        averageTimings: Map<string, number>;
        averageMemoryUsage: Map<string, number>;
        successRates: Map<string, number>;
        currentThroughput: number;
        queueLength: number;
        activeProcesses: number;
    }> {
        const averageTimings = new Map();
        const averageMemoryUsage = new Map();

        for (const [stage, timings] of this.metrics.stageTiming.entries()) {
            if (timings.length > 0) {
                const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
                averageTimings.set(stage, avg);
            }
        }

        for (const [stage, memory] of this.metrics.memoryUsage.entries()) {
            if (memory.length > 0) {
                const avg = memory.reduce((a, b) => a + b, 0) / memory.length;
                averageMemoryUsage.set(stage, avg);
            }
        }

        return {
            averageTimings,
            averageMemoryUsage,
            successRates: this.metrics.successRate,
            currentThroughput: this.metrics.throughput,
            queueLength: this.queue.length,
            activeProcesses: this.processing.size
        };
    }

    async optimizePipeline(): Promise<void> {
        const performance = await this.analyzePerformance();
        
        // Adjust stage order based on performance
        const stageArray = Array.from(this.stages.entries());
        stageArray.sort(([nameA, stageA], [nameB, stageB]) => {
            const successA = performance.successRates.get(nameA) || 0;
            const successB = performance.successRates.get(nameB) || 0;
            const timeA = performance.averageTimings.get(nameA) || 0;
            const timeB = performance.averageTimings.get(nameB) || 0;
            
            // Calculate efficiency score
            const scoreA = (successA * stageA.priority) / (timeA + 1);
            const scoreB = (successB * stageB.priority) / (timeB + 1);
            
            return scoreB - scoreA;
        });

        // Rebuild stages map in optimized order
        this.stages = new Map(stageArray);
    }
}