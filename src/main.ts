// src/main.ts

// IMPORTANT: Must be the first import to enable Reflection APIs for tsyringe
import 'reflect-metadata';

// Import configuration first
import config from './config';

// Import the DI container and necessary types/tokens
import { container } from 'tsyringe';
import { Logger } from 'winston'; // Import Logger type for resolving
import { LOGGER_TOKEN, default as loggerInstance } from './infrastructure/logger'; // Import token AND the instance for early use

// Import the Server class (needed for resolving)
import { Server } from './infrastructure/webserver/server';

// Optional: Import Job Queue setup if using async processing
// import { setupQueues, setupWorkers } from './infrastructure/jobs/queue.setup';


/**
 * Main application bootstrap function.
 */
async function bootstrap() {
    // --- Early Logger Access ---
    // We use the directly exported instance for logging *before* resolving everything,
    // ensuring logging is available immediately after the logger module runs.
    const logger = loggerInstance;
    // OR, slightly cleaner DI approach if preferred (ensure logger registration happened):
    // const logger = container.resolve<Logger>(LOGGER_TOKEN);

    try {
        logger.info(`Application starting in ${config.nodeEnv} mode...`);
        logger.info(`Using port: ${config.port}`); // Example: Log some config
        logger.info(`Log level set to: ${config.logLevel}`);

        // Optional: Setup background job queues and workers if applicable
        // await setupQueues();
        // await setupWorkers();
        // logger.info('Job queues and workers initialized.');

        // --- Dependency Injection Resolution ---
        // Explicitly register other services/controllers here if not done automatically
        // via decorators or dedicated registration files. E.g.:
        // import { ReconciliationService } from './core/reconciliation/reconciliation.service';
        // container.registerSingleton(ReconciliationService); // if using class directly

        // Resolve the Server instance using the tsyringe container.
        // The container will automatically inject the logger (and other registered dependencies).
        const server = container.resolve(Server);

        // --- Start Server ---
        await server.start(config.port);
        logger.info(`Server listening successfully on port ${config.port}`); // Log after successful start

    } catch (error) {
        // Use logger for bootstrap errors
        if (error instanceof Error) {
            logger.error('Failed to bootstrap application:', { message: error.message, stack: error.stack });
        } else {
            logger.error('Failed to bootstrap application with unknown error:', error);
        }
        process.exit(1); // Exit if critical setup fails
    }
}

/**
 * Handles graceful shutdown.
 * @param signal NodeJS Signal ('SIGINT', 'SIGTERM')
 */
async function gracefulShutdown(signal: string) {
    // Resolve logger and server again, or ensure they are accessible in this scope
    const logger = container.resolve<Logger>(LOGGER_TOKEN);
    const server = container.resolve(Server); // Assuming singleton, gets the same instance

    logger.warn(`Received ${signal}. Initiating graceful shutdown...`);

    try {
        // Stop the server first to prevent new connections
        await server.stop();

        // Add other cleanup logic here (e.g., close DB connections, stop workers)
        // logger.info('Closing database connections...');
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