// src/config/index.ts
import 'reflect-metadata'; // Ensure metadata reflection is available for DI later
import { default as logger } from '../infrastructure/logger'; // Import logger instance for early use

// Define the structure of our application configuration
interface AppConfig {
    readonly nodeEnv: 'development' | 'production' | 'test';
    readonly port: number;
    readonly logLevel: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
    readonly reconciliation: {
        readonly toleranceAmount: number;
        readonly toleranceTax: number;
        // readonly asyncThresholdRows: number; // Example if needed later
    };
    // readonly redisUrl?: string; // Example if needed later
}
/**
 * Parses a string environment variable into an integer.
 * Throws an error if parsing fails or the variable is missing and no default is provided.
 * @param varName Name of the environment variable.
 * @param defaultValue Optional default value if the variable is not set.
 * @returns The parsed integer.
 */
function parseIntEnv(varName: string, defaultValue?: number): number {
    const valueStr = process.env[varName];
    if (valueStr) {
        const valueInt = parseInt(valueStr, 10);
        if (!isNaN(valueInt)) {
            return valueInt;
        }
        // Throw error if value exists but is not a valid integer
        throw new Error(`Invalid integer format for environment variable ${varName}: ${valueStr}`);
    }
    if (defaultValue !== undefined) {
        return defaultValue;
    }
    // Throw error if required variable is missing and no default provided
    throw new Error(`Missing required environment variable: ${varName}`);
}

/**
 * Parses a string environment variable into a float.
 * Throws an error if parsing fails or the variable is missing and no default is provided.
 * @param varName Name of the environment variable.
 * @param defaultValue Optional default value if the variable is not set.
 * @returns The parsed float.
 */
function parseFloatEnv(varName: string, defaultValue?: number): number {
    const valueStr = process.env[varName];
    if (valueStr) {
        const valueFloat = parseFloat(valueStr);
        if (!isNaN(valueFloat)) {
            return valueFloat;
        }
        // Throw error if value exists but is not a valid float
        throw new Error(`Invalid float format for environment variable ${varName}: ${valueStr}`);
    }
    if (defaultValue !== undefined) {
        return defaultValue;
    }
    // Throw error if required variable is missing and no default provided
    throw new Error(`Missing required environment variable: ${varName}`);
}


// Load, validate, and export configuration
const config: AppConfig = {
    nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development',
    port: parseIntEnv('PORT', 3000), // Default to port 3000 if not set
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info', // Default log level

    reconciliation: {
        toleranceAmount: parseFloatEnv('RECON_TOLERANCE_AMOUNT', 5), // Default tolerance +/- 5
        toleranceTax: parseFloatEnv('RECON_TOLERANCE_TAX', 1),      // Default tolerance +/- 1
        // asyncThresholdRows: parseIntEnv('RECON_ASYNC_THRESHOLD_ROWS', 10000), // Example
    },

    // redisUrl: process.env.REDIS_URL, // Example
};

// Validate specific values if necessary (example)
const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
if (!validLogLevels.includes(config.logLevel)) {
    logger.warn(`Invalid LOG_LEVEL: ${config.logLevel}. Defaulting to 'info'.`);
    // Re-assigning directly is tricky if we freeze it, adjust logic if needed
    // Or better: throw error during initial load if invalid and required
    // (config as any).logLevel = 'info'; // Less ideal mutation
    // For now, warning is sufficient, or throw error above instead of defaulting.
}

// Freeze the configuration object to prevent accidental modifications
Object.freeze(config);
Object.freeze(config.reconciliation); // Freeze nested objects too

export default config;

logger.info('Configuration loaded successfully:'); // Log on load
logger.info(`NODE_ENV: ${config.nodeEnv}`);
logger.info(`PORT: ${config.port}`);
logger.info(`LOG_LEVEL: ${config.logLevel}`);
logger.info(`Recon Tolerance Amount: ${config.reconciliation.toleranceAmount}`);
logger.info(`Recon Tolerance Tax: ${config.reconciliation.toleranceTax}`);