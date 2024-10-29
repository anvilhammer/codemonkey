import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

export interface ChatHistoryEntry {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    type?: string;
}

export class HistoryService {
    private readonly historyFile: string;
    private readonly maxHistorySize = 1000; // Maximum number of messages to keep
    private readonly trimThreshold = 1200; // When to trigger cleanup

    constructor() {
        const historyDir = path.join(os.homedir(), '.codemonkey', 'history');
        this.historyFile = path.join(historyDir, 'chat_history.json');
        this.ensureHistoryDirExists(historyDir);
    }

    private async ensureHistoryDirExists(dir: string): Promise<void> {
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (error) {
            logger.error('Failed to create history directory:', error);
        }
    }

    async loadHistory(): Promise<ChatHistoryEntry[]> {
        try {
            const data = await fs.readFile(this.historyFile, 'utf-8');
            return JSON.parse(data);
        } catch (error) {
            logger.info('No history file found, starting fresh');
            return [];
        }
    }

    async saveEntry(entry: ChatHistoryEntry): Promise<void> {
        try {
            const history = await this.loadHistory();
            history.push(entry);
            
            if (history.length > this.trimThreshold) {
                await this.cleanup(history);
            } else {
                await this.writeHistory(history);
            }
        } catch (error) {
            logger.error('Failed to save history entry:', error);
        }
    }

    private async cleanup(initialHistory: ChatHistoryEntry[]): Promise<void> {
        // Keep the most recent maxHistorySize messages
        let history = initialHistory;
        if (history.length > this.maxHistorySize) {
            history = history.slice(-this.maxHistorySize);
        }

        // Group conversations by day
        const groupedByDay: { [key: string]: ChatHistoryEntry[] } = {};
        history.forEach(entry => {
            const day = new Date(entry.timestamp).toDateString();
            if (!groupedByDay[day]) {
                groupedByDay[day] = [];
            }
            groupedByDay[day].push(entry);
        });

        // Keep only important messages from older conversations
        const days = Object.keys(groupedByDay).sort();
        if (days.length > 7) { // More than a week of history
            days.slice(0, -7).forEach(day => {
                groupedByDay[day] = groupedByDay[day].filter(entry =>
                    entry.type === 'important' || 
                    entry.content.includes('CREATE FILE:') ||
                    entry.content.includes('WRITE TO FILE:')
                );
            });
        }

        // Reconstruct history
        const finalHistory = Object.values(groupedByDay).flat();
        await this.writeHistory(finalHistory);
    }

    private async writeHistory(history: ChatHistoryEntry[]): Promise<void> {
        try {
            await fs.writeFile(this.historyFile, JSON.stringify(history, null, 2));
        } catch (error) {
            logger.error('Failed to write history:', error);
        }
    }

    removeTags(content: string): string {
        return content.replace(/<(\w+)>([\s\S]*?)<\/\1>/g, '$2').trim();
    }
}