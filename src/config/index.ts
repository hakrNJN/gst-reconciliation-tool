// src/config/index.ts
import 'reflect-metadata'; // Ensure metadata reflection is available
import { default as logger } from '../infrastructure/logger'; // Import logger instance

// --- Interfaces ---

// Define the structure for Database Configuration
interface DatabaseConfig {
    readonly type: 'mssql'; // Currently fixed to mssql
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly password?: string; // Optional here, but usually required
    readonly database: string;
    readonly synchronize: boolean; // Use boolean type
    readonly logging: boolean;     // Use boolean type
    // entities, subscribers, migrations are handled by DataSource directly
}

// Define the structure of our main application configuration
interface AppConfig {
    readonly nodeEnv: 'development' | 'production' | 'test';
    readonly port: number;
    readonly logLevel: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
    readonly reconciliation: {
        readonly toleranceAmount: number;
        readonly toleranceTax: number;
    };
    readonly database: DatabaseConfig; // <-- Add Database Config section
    // readonly redisUrl?: string; // Example if needed later
}

// --- Helper Functions (Keep parseIntEnv and parseFloatEnv as they are) ---
function parseIntEnv(varName: string, defaultValue?: number): number {
    const valueStr = process.env[varName];
    if (valueStr) {
        const valueInt = parseInt(valueStr, 10);
        if (!isNaN(valueInt)) {
            return valueInt;
        }
        throw new Error(`Invalid integer format for environment variable ${varName}: ${valueStr}`);
    }
    if (defaultValue !== undefined) {
        return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${varName}`);
}

function parseFloatEnv(varName: string, defaultValue?: number): number {
    const valueStr = process.env[varName];
    if (valueStr) {
        const valueFloat = parseFloat(valueStr);
        if (!isNaN(valueFloat)) {
            return valueFloat;
        }
        throw new Error(`Invalid float format for environment variable ${varName}: ${valueStr}`);
    }
    if (defaultValue !== undefined) {
        return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${varName}`);
}

// --- Load, Validate, and Export Configuration ---
const config: AppConfig = {
    nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) || 'development',
    port: parseIntEnv('APP_PORT', 3000),
    logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',

    reconciliation: {
        toleranceAmount: parseFloatEnv('RECON_TOLERANCE_AMOUNT', 5),
        toleranceTax: parseFloatEnv('RECON_TOLERANCE_TAX', 1),
    },

    database: {
        type: "mssql", // Fixed as per requirement
        host: process.env.DB_HOST || "192.168.1.1",
        port: parseIntEnv('DB_PORT', 1433), // Use helper
        username: process.env.DB_USER || "sa",
        password: process.env.DB_PASS || "password", // Read from env or default
        database: process.env.DB_NAME || "test",
        // Convert string 'true'/'false' from env to boolean
        synchronize: (process.env.DB_SYNCHRONIZE === 'true') || false, // Default to false
        logging: (process.env.DB_LOGGING === 'true') || true,         // Default to true for dev? Or false? Let's default true.
    },

    // redisUrl: process.env.REDIS_URL,
};

// --- Validation ---
const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
if (!validLogLevels.includes(config.logLevel)) {
    // Log using console initially as logger might not be fully ready or depend on this config
    console.warn(`Invalid LOG_LEVEL: ${config.logLevel}. Defaulting to 'info'.`);
    // This mutation is tricky with Object.freeze, validation should ideally cause an error or use the default reliably
    // (config as any).logLevel = 'info';
}
if (!config.database.password) {
    // It's often better to throw an error if critical config like DB password is missing
    console.warn(`Database password (DB_PASS) is not set in environment variables. Using default (if applicable) or potentially failing connection.`);
    // throw new Error('Missing required environment variable: DB_PASS'); // More robust approach
}


// --- Freeze Configuration ---
Object.freeze(config);
Object.freeze(config.reconciliation);
Object.freeze(config.database); // Freeze the new database section

// --- Export ---
export default config;


// --- Log Loaded Configuration (AFTER config object is defined and frozen) ---
// We need to wait until the logger is properly initialized if it depends on this config.
// The logger index.ts calls createAppLogger() which reads config.
// So, we can log here, assuming the logger instance export works correctly.
logger.info('-------------------- Configuration Loaded --------------------');
logger.info(`NODE_ENV: ${config.nodeEnv}`);
logger.info(`PORT: ${config.port}`);
logger.info(`LOG_LEVEL: ${config.logLevel}`);
logger.info(`Recon Tolerance Amount: ${config.reconciliation.toleranceAmount}`);
logger.info(`Recon Tolerance Tax: ${config.reconciliation.toleranceTax}`);
logger.info(`DB Type: ${config.database.type}`);
logger.info(`DB Host: ${config.database.host}`);
logger.info(`DB Port: ${config.database.port}`);
logger.info(`DB User: ${config.database.username}`);
logger.info(`DB Name: ${config.database.database}`);
logger.info(`DB Synchronize: ${config.database.synchronize}`);
logger.info(`DB Logging: ${config.database.logging}`);
logger.info('--------------------------------------------------------------');