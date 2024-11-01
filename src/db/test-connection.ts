import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED,
    ssl: {
        rejectUnauthorized: false
    }
});

async function testConnection() {
    try {
        const client = await pool.connect();
        logger.info('Successfully connected to Neon database!');
        await client.release();
    } catch (err) {
        logger.error('Error connecting to database:', err);
    }
}

testConnection();