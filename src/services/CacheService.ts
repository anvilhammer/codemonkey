// src/services/CacheService.ts

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import * as os from 'os';
import { logger } from '../utils/logger';
import { ModelService } from './ModelService';
import { computeStringSimilarity } from '../utils/similarity';


export interface CacheEntry {
    id: string;
    level: number;
    content: string;
    tags: string[];
    parentId?: string;
    metadata: {
        timestamp: number;
        tokensUsed?: number;
        model?: string;
        cost?: number;
    };
}

export interface CacheSearchResult {
    entry: CacheEntry;
    similarity: number;
}

export class CacheService {
    private static instance: CacheService;
    private cacheDir: string;
    private modelService: ModelService;

    private constructor() {
        this.cacheDir = path.join(os.homedir(), '.codemonkey', 'cache');
        this.modelService = ModelService.getInstance();
        this.initializeCache().catch(error => {
            logger.error('Failed to initialize cache:', error);
        });
    }

    static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService(); 
        }
        return CacheService.instance;
    }
    

    private async initializeCache(): Promise<void> {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            for (let level = 0; level <= 3; level++) {
                await fs.mkdir(this.getLevelPath(level), { recursive: true });
            }
        } catch (error) {
            logger.error('Failed to create cache directories:', error);
            throw error;
        }
    }

    private getLevelPath(level: number): string {
        return path.join(this.cacheDir, `level${level}`);
    }

    private generateId(content: string): string {
        return crypto.createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 12);
    }

    async store(
        level: number,
        content: string,
        tags: string[],
        parentId?: string,
        tokensUsed?: number
    ): Promise<CacheEntry> {
        try {
            const entry: CacheEntry = {
                id: this.generateId(content),
                level,
                content,
                tags,
                parentId,
                metadata: {
                    timestamp: Date.now(),
                    tokensUsed,
                    model: this.modelService.getCurrentModel(),
                    cost: tokensUsed ? tokensUsed * this.modelService.getCurrentTokenCost() : undefined
                }
            };

            const filePath = path.join(this.getLevelPath(level), `${entry.id}.json`);
            await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
            await this.updateIndex(level, entry.id, tags);
            
            logger.info(`Cached entry ${entry.id} at level ${level}`);
            return entry;
        } catch (error) {
            logger.error('Failed to store cache entry:', error);
            throw error;
        }
    }

    private async updateIndex(level: number, id: string, tags: string[]): Promise<void> {
        const indexPath = path.join(this.getLevelPath(level), 'index.json');
        let index: Record<string, string[]> = {};
        
        try {
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            index = JSON.parse(indexContent);
        } catch (error) {
            // Index doesn't exist yet, use empty object
        }

        for (const tag of tags) {
            if (!index[tag]) {
                index[tag] = [];
            }
            if (!index[tag].includes(id)) {
                index[tag].push(id);
            }
        }

        await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    }

    async get(id: string, level: number): Promise<CacheEntry | null> {
        try {
            const filePath = path.join(this.getLevelPath(level), `${id}.json`);
            const content = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(content) as CacheEntry;
        } catch (error) {
            logger.debug(`Cache miss for ${id} at level ${level}`);
            return null;
        }
    }

    async search(
        query: string,
        level: number,
        tags?: string[],
        similarityThreshold: number = 0.8
    ): Promise<CacheSearchResult[]> {
        try {
            const levelPath = this.getLevelPath(level);
            const files = await fs.readdir(levelPath);
            const results: CacheSearchResult[] = [];

            for (const file of files) {
                if (!file.endsWith('.json') || file === 'index.json') continue;

                const entry = await this.get(file.replace('.json', ''), level);
                if (!entry) continue;

                // Check tags first if provided
                if (tags && !tags.every(tag => entry.tags.includes(tag))) {
                    continue;
                }

                const similarity = computeStringSimilarity(query, entry.content);
                if (similarity >= similarityThreshold) {
                    results.push({ entry, similarity });
                }
            }

            return results.sort((a, b) => b.similarity - a.similarity);
        } catch (error) {
            logger.error('Failed to search cache:', error);
            return [];
        }
    }

    async getHierarchy(id: string, level: number): Promise<CacheEntry[]> {
        const results: CacheEntry[] = [];
        try {
            // Get the requested entry
            const entry = await this.get(id, level);
            if (!entry) return results;

            results.push(entry);

            // Get parent entries
            let currentEntry = entry;
            while (currentEntry.parentId) {
                const parent = await this.get(currentEntry.parentId, currentEntry.level - 1);
                if (!parent) break;
                results.unshift(parent);
                currentEntry = parent;
            }

            // Get child entries
            const children = await this.findChildren(id, level + 1);
            results.push(...children);

            return results;
        } catch (error) {
            logger.error(`Failed to get hierarchy for ${id}:`, error);
            return results;
        }
    }

    private async findChildren(parentId: string, level: number): Promise<CacheEntry[]> {
        try {
            const levelPath = this.getLevelPath(level);
            const files = await fs.readdir(levelPath);
            const children: CacheEntry[] = [];

            for (const file of files) {
                if (!file.endsWith('.json') || file === 'index.json') continue;

                const entry = await this.get(file.replace('.json', ''), level);
                if (entry && entry.parentId === parentId) {
                    children.push(entry);
                }
            }

            return children;
        } catch (error) {
            logger.error(`Failed to find children for ${parentId}:`, error);
            return [];
        }
    }

    async cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
        try {
            const now = Date.now();

            for (let level = 0; level <= 3; level++) {
                const levelPath = this.getLevelPath(level);
                const files = await fs.readdir(levelPath);

                for (const file of files) {
                    if (!file.endsWith('.json') || file === 'index.json') continue;

                    const entry = await this.get(file.replace('.json', ''), level);
                    if (!entry) continue;

                    if (now - entry.metadata.timestamp > maxAge) {
                        await this.invalidate(entry.id, level);
                    }
                }

                await this.rebuildIndex(level);
            }

            logger.info('Cache cleanup completed');
        } catch (error) {
            logger.error('Failed to cleanup cache:', error);
        }
    }

    async invalidate(id: string, level: number): Promise<void> {
        try {
            const filePath = path.join(this.getLevelPath(level), `${id}.json`);
            await fs.unlink(filePath);
            logger.info(`Invalidated cache entry ${id} at level ${level}`);
        } catch (error) {
            logger.error(`Failed to invalidate cache entry ${id}:`, error);
        }
    }

    private async rebuildIndex(level: number): Promise<void> {
        const levelPath = this.getLevelPath(level);
        const files = await fs.readdir(levelPath);
        const index: Record<string, string[]> = {};
        
        for (const file of files) {
            if (!file.endsWith('.json') || file === 'index.json') continue;
            
            try {
                const entry = await this.get(file.replace('.json', ''), level);
                if (entry) {
                    for (const tag of entry.tags) {
                        if (!index[tag]) {
                            index[tag] = [];
                        }
                        if (!index[tag].includes(entry.id)) {
                            index[tag].push(entry.id);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Failed to process file ${file} during index rebuild:`, error);
            }
        }
        
        await fs.writeFile(
            path.join(levelPath, 'index.json'),
            JSON.stringify(index, null, 2)
        );
    }
}

// Export the class as default and named
export default CacheService;
export { CacheService as HierarchicalCacheService };