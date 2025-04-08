// src/infrastructure/logger/index.ts
import 'reflect-metadata';
import { container } from 'tsyringe'; // Removed Lifecycle as it wasn't used here
import winston from 'winston';
// Import config - it might still be undefined during the initial top-level pass
import config from '../../config';

// --- Define Logger Creation Function ---
// We wrap the creation in a function to delay accessing config until it's called.
const createAppLogger = () => {
    // Now, when this function is called, 'config' should be loaded.
    if (!config) {
        // Fallback or throw error if config is unexpectedly missing *at runtime*
        console.error("CRITICAL: Configuration object is missing during logger creation!");
        // Use basic console logging as fallback
        return winston.createLogger({
            level: 'info',
            format: winston.format.simple(),
            transports: [new winston.transports.Console()]
        });
        // Or: throw new Error("Configuration not loaded before logger initialization.");
    }

    // Determine log format based on environment (accessing config safely now)
    const logFormat = winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }), // Log stack traces
        config.nodeEnv === 'production'
            ? winston.format.json()
            : winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message} ${info.stack ? '\n' + info.stack : ''}`)
    );

    // Define transports
    const transports: winston.transport[] = [
        new winston.transports.Console({
            format: config.nodeEnv === 'development'
                ? winston.format.combine(
                    winston.format.colorize(),
                    logFormat // Use the base format defined above
                )
                : logFormat, // Use base format directly in production
            level: config.logLevel, // Use level from config
            handleExceptions: true,
            handleRejections: true,
        }),
        // Add File transports here if needed...
    ];

    // Create the logger instance
    const logger = winston.createLogger({
        level: config.logLevel,
        format: logFormat,
        transports: transports,
        exitOnError: false,
    });

    logger.info(`Logger initialized successfully in ${config.nodeEnv} mode (Level: ${config.logLevel}).`);
    return logger;
};


// --- Create Logger Instance ---
// Call the function to create the instance
const loggerInstance = createAppLogger();


// --- Dependency Injection Registration ---
export const LOGGER_TOKEN = Symbol.for('AppLogger');

container.register(LOGGER_TOKEN, {
    useValue: loggerInstance
});


// --- Export ---
export default loggerInstance; // Export the instance for direct use