import * as winston from 'winston';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Create logs directory in user's home directory
const logDir = path.join(os.homedir(), '.codemonkey', 'logs');

// Ensure log directory exists
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

export const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(logDir, 'error.log'), 
            level: 'error'
        }),
        new winston.transports.File({ 
            filename: path.join(logDir, 'combined.log')
        })
    ]
});

// Add console logging if we're in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}