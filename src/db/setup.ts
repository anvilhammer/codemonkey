import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { ProjectModel } from './models/Project';
import { logger } from '../utils/logger';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    ssl: {
        rejectUnauthorized: false
    }
});

async function setupDatabase() {
    try {
        const projectModel = new ProjectModel(pool);
        await projectModel.createTable();
        logger.info('Database setup completed successfully');
    } catch (error) {
        logger.error('Database setup failed:', error);
    } finally {
        await pool.end();
    }
}

setupDatabase();