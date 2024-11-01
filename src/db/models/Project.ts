import { Pool } from 'pg';
import { ProjectConfig } from '../../core/project/ProjectTypes';
import { logger } from '../../utils/logger';

export interface ProjectRecord {
    id: string;
    name: string;
    config: ProjectConfig;
    created_at: Date;
    updated_at: Date;
    status: ProjectStatus;
}

export enum ProjectStatus {
    CREATING = 'creating',
    ACTIVE = 'active',
    ARCHIVED = 'archived'
}

export class ProjectModel {
    private pool: Pool;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    async createTable(): Promise<void> {
        const query = `
            CREATE TABLE IF NOT EXISTS projects (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL,
                config JSONB NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(50) NOT NULL DEFAULT 'creating'
            );
        `;

        try {
            await this.pool.query(query);
            logger.info('Projects table created or verified');
        } catch (error) {
            logger.error('Error creating projects table:', error);
            throw error;
        }
    }

    async create(name: string, config: ProjectConfig): Promise<ProjectRecord> {
        const query = `
            INSERT INTO projects (name, config, status)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;

        try {
            const result = await this.pool.query(query, [
                name,
                JSON.stringify(config),
                ProjectStatus.CREATING
            ]);
            return result.rows[0];
        } catch (error) {
            logger.error('Error creating project:', error);
            throw error;
        }
    }

    async findById(id: string): Promise<ProjectRecord | null> {
        const query = 'SELECT * FROM projects WHERE id = $1;';
        
        try {
            const result = await this.pool.query(query, [id]);
            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error finding project:', error);
            throw error;
        }
    }

    async updateStatus(id: string, status: ProjectStatus): Promise<void> {
        const query = `
            UPDATE projects
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2;
        `;

        try {
            await this.pool.query(query, [status, id]);
        } catch (error) {
            logger.error('Error updating project status:', error);
            throw error;
        }
    }
}