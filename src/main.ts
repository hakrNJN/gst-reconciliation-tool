// src/main.ts

import 'reflect-metadata';
import config from './config';
import { registerDependencies } from './register';

// === REGISTER DEPENDENCIES IMMEDIATELY ===
registerDependencies();
// ==========================================

import { container } from 'tsyringe';
import { Logger } from 'winston';
import { LOGGER_TOKEN } from './infrastructure/logger'; // Import token
import { Server } from './infrastructure/webserver/server';
import { AppDataSource } from './infrastructure/database/providers/data-source.provider';

async function bootstrap() {
    // Resolve logger *after* registration
    const logger = container.resolve<Logger>(LOGGER_TOKEN);

    try {
        logger.info(`Application starting in ${config.nodeEnv} mode...`);
        logger.info(`Using port: ${config.port}`);
        logger.info(`Log level set to: ${config.logLevel}`);

        // --- STEP 1: Initialize Critical Infrastructure (Database) ---
        // Resolve the provider *after* registration
        const dataSourceProvider = container.resolve(AppDataSource);
        try {
            logger.info('Initializing database connection...');
            await dataSourceProvider.init(); // <<<< AWAIT INITIALIZATION HERE
            logger.info('Database connection initialized successfully.');
        } catch (dbError) {
            logger.error('FATAL: Failed to initialize database connection. Exiting.', dbError);
            process.exit(1);
        }
        // --- END STEP 1 ---


        // Optional: Setup background job queues and workers if applicable
        // logger.info('Initializing job queues...');
        // await setupQueues();
        // await setupWorkers();
        // logger.info('Job queues and workers initialized.');


        // --- STEP 2: Resolve Main Application Components (Server) ---
        // Now that the DB is initialized, resolving the Server (and its dependent
        // controllers/repositories) is safe because the repository constructor
        // will successfully get the initialized DataSource via getDataSource().
        logger.info('Resolving main application server...');
        const server = container.resolve(Server);
        logger.info('Server component resolved.');
        // --- END STEP 2 ---


        // --- STEP 3: Start the Server ---
        logger.info('Starting HTTP server...');
        await server.start(config.port);
        logger.info(`Server listening successfully on port ${config.port}`);
        // --- END STEP 3 ---

    } catch (error) {
        // Use logger if available, otherwise console
        const log = container.isRegistered(LOGGER_TOKEN) ? container.resolve<Logger>(LOGGER_TOKEN) : console;
        if (error instanceof Error) {
            log.error('Failed to bootstrap application:', { message: error.message, stack: error.stack });
        } else {
            log.error('Failed to bootstrap application with unknown error:', error);
        }
        process.exit(1);
    }
}

// ... (gracefulShutdown function remains the same, ensuring dataSourceProvider.close() is called) ...
async function gracefulShutdown(signal: string) {
    // Resolve necessary components for shutdown
    const logger = container.resolve<Logger>(LOGGER_TOKEN);
    const server = container.resolve(Server); // Assuming singleton
    const dataSourceProvider = container.resolve(AppDataSource); // Assuming singleton

    logger.warn(`Received ${signal}. Initiating graceful shutdown...`);

    try {
        // Stop the server first to prevent new connections
        await server.stop();
        logger.info('HTTP server stopped.');

        // Close database connections
        logger.info('Closing database connection...');
        await dataSourceProvider.close(); // Ensure close is called
        logger.info('Database connection closed.');

        // Add other cleanup logic here (e.g., stop workers)
        // logger.info('Stopping background workers...');

        logger.info('Application shut down gracefully.');
        process.exit(0);
    } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1); // Exit with error code during shutdown failure
    }
}

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Catches Ctrl+C


// Start the application
bootstrap();