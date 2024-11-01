// src/services/memory/SemanticMemory.ts

import { Message } from '../../vscode/types/chat';
import { logger } from '../../utils/logger';
import { computeStringSimilarity } from '../../utils/similarity';

interface SemanticNode {
    id: string;
    content: string;
    embedding: number[];
    type: 'command' | 'context' | 'response' | 'file';
    metadata: {
        timestamp: number;
        lastAccessed: number;
        accessCount: number;
        importance: number;
    };
    relationships: Map<string, number>; // nodeId -> strength
}

interface MemorySearchResult {
    node: SemanticNode;
    similarity: number;
    lastAccessed: number;
}

export class SemanticMemoryManager {
    private nodes: Map<string, SemanticNode>;
    private shortTermCapacity: number;
    private longTermCapacity: number;
    private consolidationThreshold: number;

    constructor(
        shortTermCapacity = 100,
        longTermCapacity = 1000,
        consolidationThreshold = 0.7
    ) {
        this.nodes = new Map();
        this.shortTermCapacity = shortTermCapacity;
        this.longTermCapacity = longTermCapacity;
        this.consolidationThreshold = consolidationThreshold;
    }

    async storeMemory(
        content: string,
        type: SemanticNode['type'],
        _context?: Message[]  // Added underscore prefix
    ): Promise<string> {
        const embedding = await this.generateEmbedding(content);
        const id = this.generateId(content);

        const node: SemanticNode = {
            id,
            content,
            embedding,
            type,
            metadata: {
                timestamp: Date.now(),
                lastAccessed: Date.now(),
                accessCount: 1,
                importance: await this.calculateImportance(content, type)
            },
            relationships: new Map()
        };

        // Build relationships with existing nodes
        for (const [existingId, existingNode] of this.nodes.entries()) {
            const similarity = this.calculateSimilarity(node, existingNode);
            if (similarity > this.consolidationThreshold) {
                node.relationships.set(existingId, similarity);
                existingNode.relationships.set(id, similarity);
            }
        }

        this.nodes.set(id, node);
        await this.consolidateMemory();

        return id;
    }

    async recall(query: string, limit: number = 5): Promise<MemorySearchResult[]> {
        const queryEmbedding = await this.generateEmbedding(query);
        const results: MemorySearchResult[] = [];

        for (const node of this.nodes.values()) {
            const similarity = this.calculateCosineSimilarity(queryEmbedding, node.embedding);
            if (similarity > 0.5) { // Threshold for relevance
                results.push({
                    node,
                    similarity,
                    lastAccessed: node.metadata.lastAccessed
                });

                // Update access patterns
                node.metadata.lastAccessed = Date.now();
                node.metadata.accessCount++;
            }
        }

        return results
            .sort((a, b) => {
                // Combine similarity with recency and importance
                const scoreA = (a.similarity * 0.6) + 
                             (this.calculateRecencyScore(a.lastAccessed) * 0.2) +
                             (a.node.metadata.importance * 0.2);
                const scoreB = (b.similarity * 0.6) + 
                             (this.calculateRecencyScore(b.lastAccessed) * 0.2) +
                             (b.node.metadata.importance * 0.2);
                return scoreB - scoreA;
            })
            .slice(0, limit);
    }

    // Add to SemanticMemoryManager class:
    public async optimize(): Promise<void> {
        await this.consolidateMemory();
    }

    private async consolidateMemory(): Promise<void> {
        const totalSize = this.nodes.size;
        if (totalSize <= this.longTermCapacity) return;

        // Calculate retention scores for all nodes
        const scores = new Map<string, number>();
        for (const [id, node] of this.nodes.entries()) {
            const score = this.calculateRetentionScore(node);
            scores.set(id, score);
        }

        // Sort nodes by score
        const sortedNodes = Array.from(this.nodes.entries())
            .sort(([idA, _], [idB, __]) => {
                return (scores.get(idB) || 0) - (scores.get(idA) || 0);
            });

        // Keep only the highest scoring nodes
        this.nodes = new Map(sortedNodes.slice(0, this.longTermCapacity));
        
        logger.info(`Consolidated memory from ${totalSize} to ${this.nodes.size} nodes`);
    }

    private calculateRetentionScore(node: SemanticNode): number {
        const recency = this.calculateRecencyScore(node.metadata.lastAccessed);
        const frequency = Math.min(node.metadata.accessCount / 10, 1); // Normalize to 0-1
        const connectedness = node.relationships.size / this.nodes.size;
        const importance = node.metadata.importance;

        return (recency * 0.3) + 
               (frequency * 0.2) + 
               (connectedness * 0.2) + 
               (importance * 0.3);
    }

    private calculateRecencyScore(timestamp: number): number {
        const age = Date.now() - timestamp;
        const dayInMs = 24 * 60 * 60 * 1000;
        return Math.exp(-age / dayInMs); // Exponential decay
    }

    private async calculateImportance(content: string, type: SemanticNode['type']): Promise<number> {
        let importance = 0;

        // Base importance on type
        switch (type) {
            case 'command':
                importance += 0.8; // Commands are usually important
                break;
            case 'file':
                importance += 0.6; // Files are moderately important
                break;
            case 'context':
                importance += 0.4; // Context varies in importance
                break;
            case 'response':
                importance += 0.3; // Responses might be reusable
                break;
        }

        // Adjust for content characteristics
        if (content.includes('```')) importance += 0.2; // Code blocks
        if (content.includes('ERROR:')) importance += 0.2; // Error messages
        if (content.includes('CRITICAL:')) importance += 0.3; // Critical information

        return Math.min(importance, 1); // Normalize to 0-1
    }

    private async generateEmbedding(content: string): Promise<number[]> {
        // In a real implementation, this would use a proper embedding model
        // For now, we'll use a simple hash-based approach
        const hash = Array.from(content)
            .reduce((acc, char) => {
                return acc + char.charCodeAt(0);
            }, 0);

        // Generate a simple 8-dimensional embedding
        return Array.from({ length: 8 }, (_, i) => {
            return Math.sin(hash * (i + 1)) * 0.5 + 0.5;
        });
    }

    private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) return 0;
        
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }

    private calculateSimilarity(node1: SemanticNode, node2: SemanticNode): number {
        // Combine embedding similarity with content similarity
        const embeddingSimilarity = this.calculateCosineSimilarity(
            node1.embedding,
            node2.embedding
        );
        
        const contentSimilarity = computeStringSimilarity(
            node1.content,
            node2.content
        );

        return (embeddingSimilarity * 0.7) + (contentSimilarity * 0.3);
    }

    private generateId(_content: string): string {
        return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Debug and analysis methods
    async analyzeMemoryState(): Promise<{
        totalNodes: number;
        typeDistribution: Record<SemanticNode['type'], number>;
        averageImportance: number;
        averageConnections: number;
        memoryUsage: number;
    }> {
        const typeDistribution: Record<SemanticNode['type'], number> = {
            command: 0,
            context: 0,
            response: 0,
            file: 0
        };

        let totalImportance = 0;
        let totalConnections = 0;

        for (const node of this.nodes.values()) {
            typeDistribution[node.type]++;
            totalImportance += node.metadata.importance;
            totalConnections += node.relationships.size;
        }

        return {
            totalNodes: this.nodes.size,
            typeDistribution,
            averageImportance: totalImportance / this.nodes.size,
            averageConnections: totalConnections / this.nodes.size,
            memoryUsage: process.memoryUsage().heapUsed
        };
    }
}