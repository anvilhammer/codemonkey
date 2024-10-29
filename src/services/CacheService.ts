import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { logger } from '../utils/logger';

export interface CacheLevel {
    level: number;  // 0 = raw, 1 = structured, 2 = summary, 3 = meta-summary
    content: string;
    parentHash?: string;
    tags: string[];
    timestamp: number;
}

export interface CacheIndex {
    [tag: string]: string[];
}

export class HierarchicalCacheService {
    private readonly basePath: string;
    private readonly levels = ['raw', 'structured', 'summary', 'meta'] as const;
    
    constructor() {
        this.basePath = path.join(os.homedir(), '.codemonkey', 'cache');
        this.ensureDirectories().catch(error => {
            logger.error('Failed to create cache directories:', error);
        });
    }

    private async ensureDirectories(): Promise<void> {
        for (const level of this.levels) {
            const levelPath = path.join(this.basePath, level);
            await fs.mkdir(levelPath, { recursive: true });
        }
    }

    private generateHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
    }

    async store(level: number, content: string, tags: string[], parentHash?: string): Promise<string> {
        await this.ensureDirectories();
        
        const entry: CacheLevel = {
            level,
            content,
            tags,
            parentHash,
            timestamp: Date.now()
        };

        const hash = this.generateHash(content);
        const levelDir = path.join(this.basePath, this.levels[level]);
        const filePath = path.join(levelDir, `${hash}.json`);

        await fs.writeFile(filePath, JSON.stringify(entry, null, 2));
        await this.updateIndex(level, hash, tags);

        return hash;
    }

    private async updateIndex(level: number, hash: string, tags: string[]): Promise<void> {
        const indexPath = path.join(this.basePath, this.levels[level], 'index.json');
        let index: CacheIndex = {};
        
        try {
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            index = JSON.parse(indexContent) as CacheIndex;
        } catch (error) {
            // Index doesn't exist yet, use empty object
        }

        for (const tag of tags) {
            if (!index[tag]) {
                index[tag] = [];
            }
            if (!index[tag].includes(hash)) {
                index[tag].push(hash);
            }
        }

        await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    }

    async findByTags(tags: string[], level: number): Promise<CacheLevel[]> {
        const indexPath = path.join(this.basePath, this.levels[level], 'index.json');
        let matchingHashes: string[] = [];
        
        try {
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            const index = JSON.parse(indexContent) as CacheIndex;
            
            // Find entries that match ALL provided tags
            const hashSets = tags.map(tag => new Set<string>(index[tag] || []));
            matchingHashes = Array.from(hashSets[0] || new Set<string>()).filter(hash => 
                hashSets.every(set => set.has(hash))
            );
        } catch (error) {
            return [];
        }

        const results: CacheLevel[] = [];
        for (const hash of matchingHashes) {
            try {
                const content = await fs.readFile(
                    path.join(this.basePath, this.levels[level], `${hash}.json`),
                    'utf-8'
                );
                results.push(JSON.parse(content) as CacheLevel);
            } catch (error) {
                logger.error(`Failed to read cache entry ${hash}:`, error);
            }
        }

        return results;
    }

    async getRelatedContent(hash: string): Promise<CacheLevel[]> {
        const results: CacheLevel[] = [];
        
        for (const level of this.levels) {
            try {
                const content = await fs.readFile(
                    path.join(this.basePath, level, `${hash}.json`),
                    'utf-8'
                );
                const entry = JSON.parse(content) as CacheLevel;
                results.push(entry);
                
                // Get children if they exist
                const childEntries = await this.findByTags([hash], this.levels.indexOf(level) + 1);
                results.push(...childEntries);
            } catch (error) {
                // Entry doesn't exist at this level
            }
        }

        return results;
    }

    async cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
        const now = Date.now();
        
        for (let i = 0; i < this.levels.length; i++) {
            const level = this.levels[i];
            const levelPath = path.join(this.basePath, level);
            try {
                const files = await fs.readdir(levelPath);
                
                for (const file of files) {
                    if (file === 'index.json') continue;
                    
                    const filePath = path.join(levelPath, file);
                    try {
                        const content = await fs.readFile(filePath, 'utf-8');
                        const entry = JSON.parse(content) as CacheLevel;
                        
                        if (now - entry.timestamp > maxAge) {
                            await fs.unlink(filePath);
                            logger.info(`Cleaned up old cache entry: ${file}`);
                        }
                    } catch (error) {
                        logger.error(`Failed to process cache file ${file}:`, error);
                    }
                }
                
                await this.rebuildIndex(i);
            } catch (error) {
                logger.error(`Failed to clean up cache level ${level}:`, error);
            }
        }
    }

    private async rebuildIndex(level: number): Promise<void> {
        const levelPath = path.join(this.basePath, this.levels[level]);
        const files = await fs.readdir(levelPath);
        const index: CacheIndex = {};
        
        for (const file of files) {
            if (file === 'index.json') continue;
            
            try {
                const content = await fs.readFile(path.join(levelPath, file), 'utf-8');
                const entry = JSON.parse(content) as CacheLevel;
                const hash = file.replace('.json', '');
                
                for (const tag of entry.tags) {
                    if (!index[tag]) {
                        index[tag] = [];
                    }
                    if (!index[tag].includes(hash)) {
                        index[tag].push(hash);
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