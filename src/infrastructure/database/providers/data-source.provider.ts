// src/infrastructure/database/providers/data-source.provider.ts
import 'reflect-metadata'; // Keep for DI
import { inject, injectable } from "tsyringe";
import { DataSource, DataSourceOptions } from "typeorm";
import winston from "winston";

// --- Import Config ---
import config from "../../../config"; // Adjusted path relative to new location

// --- Import Logger Token ---
import { LOGGER_TOKEN } from "../../../infrastructure/logger"; // Adjusted path

// --- Import Entities (Adjust paths and names as per your actual files) ---
// Assuming files are src/core/entities/ and export classes with these names:
import { Gstr2bReconciledRecord, ItcRegister } from "../../../core/common/entities";


@injectable()
export class AppDataSource {

    private _dataSource: DataSource | null = null;
    // Logger is injected via token now, no need for type alias WINSTON_LOGGER if LOGGER_TOKEN is used
    private readonly logger: winston.Logger;

    // Inject logger using the token
    constructor(@inject(LOGGER_TOKEN) logger: winston.Logger) {
        this.logger = logger;
        this.logger.info('AppDataSource service initialized.'); // Log initialization of the service itself
    }

    // --- Removed the old DB_CONFIG constant ---

    async init(): Promise<DataSource> {
        if (this._dataSource && this._dataSource.isInitialized) {
            this.logger.info("AppDataSource: DataSource already initialized.");
            return this._dataSource;
        }

        if (this._dataSource && !this._dataSource.isInitialized) {
            this.logger.warn("AppDataSource: Existing DataSource instance found but not initialized. Attempting re-initialization...");
            // Fall through to initialize
        }

        if (!this._dataSource) {
            this.logger.info("AppDataSource: Creating new DataSource instance.");

            // --- Use configuration from the main config object ---
            const options: DataSourceOptions = {
                type: config.database.type, // 'mssql'
                host: config.database.host,
                port: config.database.port,
                username: config.database.username,
                password: config.database.password, // Use password from config
                database: config.database.database,
                synchronize: config.database.synchronize, // Use boolean from config
                logging: config.database.logging,         // Use boolean from config
                // --- Specify the entities directly ---
                entities: [
                    Gstr2bReconciledRecord, // Use the imported class
                    ItcRegister             // Use the imported class
                ],
                subscribers: [], // Keep empty or add yours
                migrations: [],  // Keep empty or add yours
                connectionTimeout: 150000, // Keep or configure via env/config if needed
                extra: { // Use 'extra' for MSSQL specific options
                    trustServerCertificate: true // Often needed for local/non-prod SQL Server
                },
                options: {
                    encrypt: false, // Explicitly false based on your previous setting
                    // cryptoCredentialsDetails: { // Keep commented unless needed
                    //     minVersion: 'TLSv1.2'
                    // }
                },
            };

            // Log sensitive info carefully
            this.logger.info(`AppDataSource: Configuring DataSource for ${options.database} on ${options.host}:${options.port}`);
            if (options.logging) {
                this.logger.debug('AppDataSource: Detailed TypeORM options:', { ...options, password: '****' }); // Mask password
            }


            this._dataSource = new DataSource(options);
        }

        try {
            this.logger.info("AppDataSource: Attempting to initialize TypeORM DataSource...");
            await this._dataSource.initialize();
            this.logger.info(`AppDataSource: TypeORM DataSource initialized successfully! [${this._dataSource.options.database}@${this._dataSource.options.database}]`);
        } catch (err: any) { // Add type annotation for error
            this.logger.error("AppDataSource: Error during Data Source initialization", {
                message: err.message,
                code: (err as any).code, // Log specific DB error codes if available
                stack: err.stack, // Include stack trace
                db_host: config.database.host, // Add context
                db_name: config.database.database
            });
            this._dataSource = null; // Ensure it's nullified on error
            throw err; // Re-throw to indicate failure
        }

        return this._dataSource;
    }

    async close(): Promise<void> {
        if (this._dataSource && this._dataSource.isInitialized) {
            try {
                this.logger.info("AppDataSource: Attempting to close TypeORM DataSource...");
                await this._dataSource.destroy(); // Use destroy for TypeORM >= 0.3
                this.logger.info("AppDataSource: TypeORM DataSource has been closed successfully!");
                this._dataSource = null; // Clear the instance after closing
            } catch (err: any) { // Add type annotation
                this.logger.error("AppDataSource: Error during Data Source closing", { message: err.message, stack: err.stack });
                // Decide if we should nullify dataSource here as well
                // this._dataSource = null;
                throw err; // Re-throw
            }
        } else if (this._dataSource && !this._dataSource.isInitialized) {
            this.logger.warn("AppDataSource: Attempted to close a non-initialized DataSource instance.");
            this._dataSource = null; // Clear the non-initialized instance
        } else {
            this.logger.warn("AppDataSource: Close called but DataSource was already null.");
        }
    }

    // Getter remains useful for accessing the DataSource elsewhere if needed (e.g., in repositories)
    getDataSource(): DataSource {
        if (!this._dataSource || !this._dataSource.isInitialized) {
            // Depending on application lifecycle, either auto-init or throw error
            this.logger.error("AppDataSource: getDataSource() called before initialization or after close!");
            throw new Error("DataSource is not available or not initialized. Ensure AppDataSource.init() was called successfully.");
        }
        return this._dataSource;
    }
}

