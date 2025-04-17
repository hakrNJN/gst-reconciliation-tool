// src/infrastructure/database/repositories/reconciled-record.repository.ts
import 'reflect-metadata';
import { inject, injectable } from 'tsyringe';
import { DataSource, Repository } from 'typeorm';
import winston from 'winston';

// --- Infrastructure Imports ---
import { LOGGER_TOKEN } from '../../logger'; // Import Logger token
import { AppDataSource } from '../providers/data-source.provider'; // Inject the DataSource Provider

// --- Core Imports ---
import { Gstr2bReconciledRecord } from '../../../core/common/entities'; // Entity
import { AppError } from '../../../core/common/errors'; // Optional: for custom errors
import {
    IReconciledRecordRepository
} from '../../../core/common/interfaces/repositories/IReconciledRecordRepository'; // Interface
import { StorableReconciliationRecord } from '../../../core/reporting/interfaces/services'; // DTO for input


@injectable()
// Optional: Register the implementation directly with the token if preferred over module registration
// @registry([{ token: RECONCILED_RECORD_REPOSITORY_TOKEN, useClass: ReconciledRecordRepository }])
export class ReconciledRecordRepository implements IReconciledRecordRepository {

    // Store the TypeORM repository instance once initialized
    private _ormRepository: Repository<Gstr2bReconciledRecord> | null = null;
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    constructor(
        @inject(LOGGER_TOKEN) private readonly logger: winston.Logger,
        @inject(AppDataSource) private readonly dataSourceProvider: AppDataSource
    ) {
        this.logger.info("ReconciledRecordRepository constructing. Triggering initialization.");
        // Start initialization but don't wait in the constructor
        this.initPromise = this.initializeDataSourceAndRepository();
        this.initPromise.catch(err => {
            // Log error, the repository will remain uninitialized until ensureInitialized is called again
            this.logger.error("ReconciledRecordRepository background initialization failed:", err);
            this.initPromise = null; // Reset promise to allow retry later if needed
        });
    }

    /**
     * Ensures the underlying TypeORM repository is initialized.
     * Waits for the initial attempt or retries if necessary.
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.isInitialized && this.initPromise) {
            this.logger.debug("ReconciledRecordRepository waiting for initialization to complete...");
            try {
                await this.initPromise;
            } catch (error) {
                 // Error already logged by the catch block in constructor or initializeDataSourceAndRepository
                 this.logger.warn("ReconciledRecordRepository initial initialization attempt failed. State remains uninitialized.");
                 // Do not re-throw here, let the check below handle it or allow retry
            }

        }

        // If still not initialized after waiting (or if first attempt failed badly), try again
        if (!this.isInitialized) {
             this.logger.warn("ReconciledRecordRepository attempting initialization on demand...");
             // Re-assign promise to handle concurrent calls during this retry
             if (!this.initPromise) {
                 this.initPromise = this.initializeDataSourceAndRepository();
             }
             try {
                 await this.initPromise;
             } catch (error) {
                 this.logger.error("ReconciledRecordRepository on-demand initialization failed.", error);
                 this.initPromise = null; // Reset promise on failure
                  // Throw now, as the operation requiring the repo cannot proceed
                 throw new AppError('DatabaseError', 'Repository could not be initialized.', 500, false);
             }
        }

        // Final check after waiting/retrying
        if (!this.isInitialized || !this._ormRepository) {
            this.logger.error("ReconciledRecordRepository initialization failed critically.");
            throw new AppError('DatabaseError', 'Repository could not be initialized.', 500, false);
        }
         this.logger.debug("ReconciledRecordRepository confirmed initialized.");
    }

    /**
     * Initializes the DataSource (if needed) and gets the TypeORM Repository.
     */
    private async initializeDataSourceAndRepository(): Promise<void> {
        // Prevent concurrent execution if called multiple times before completing
        if (this.initPromise && !this.isInitialized) {
            return this.initPromise;
        }
        if (this.isInitialized) return; // Already done

        this.logger.info("ReconciledRecordRepository attempting DataSource init and Repository creation...");
        try {
            // Ensure the main TypeORM DataSource is initialized via the provider
            const dataSource = await this.dataSourceProvider.init(); // This now needs to handle its own "already initialized" logic safely
            if (!dataSource) {
                 throw new Error("AppDataSource provider returned null or undefined after init.");
            }
            this._ormRepository = dataSource.getRepository(Gstr2bReconciledRecord);
            this.isInitialized = true; // Set flag *only* on complete success
            this.logger.info("ReconciledRecordRepository internal components initialized successfully.");
        } catch (error) {
            this.logger.error("Error initializing ReconciledRecordRepository internal components:", error);
            this.isInitialized = false;
            this._ormRepository = null;
             // Don't reset initPromise here, let the caller handle retries if desired
            throw error; // Re-throw so awaiting calls know about the failure
        }
    }

    /**
     * Gets the initialized TypeORM repository instance, ensuring initialization first.
     */
    private async _getRepository(): Promise<Repository<Gstr2bReconciledRecord>> {
        await this.ensureInitialized();
        // If ensureInitialized completed without error, _ormRepository is guaranteed to be non-null
        return this._ormRepository!;
    }
    /**
     * Saves multiple reconciled records to the database.
     */
    async saveMany(records: StorableReconciliationRecord[]): Promise<void> {
        if (!records || records.length === 0) {
            this.logger.info('ReconciledRecordRepository: No records provided to saveMany.');
            return;
        }

        const repository = await this._getRepository();
        this.logger.info(`ReconciledRecordRepository: Attempting to save ${records.length} reconciled records...`);

        try {
            // 1. Map DTOs to Entities
            const entitiesToSave = records.map(dto => {
                const entity = new Gstr2bReconciledRecord();
                entity.supplierGstin = dto.supplierGstin;
                entity.supplierName = dto.supplierName;
                entity.localInvoiceNumber = dto.localInvoiceNumber;
                entity.localDate = dto.localDate; // Assumes Date object or null
                entity.localInvoiceValue = dto.localInvoiceValue;
            
                entity.localDocType = dto.localDocType;
                entity.portalInvoiceNumber = dto.portalInvoiceNumber;
                entity.portalDate = dto.portalDate;
                entity.remark = dto.remark; // Matches enum/string type
                entity.reconciliationDate = dto.reconciliationDate; // Assumes Date object
                 // Handle localConum
                 if (dto.localConum !== undefined && dto.localConum !== null) {
                    entity.localConum = parseInt(dto.localConum.toString()); // Convert number or use string directly
                } else {
                    entity.localConum = undefined; // Explicitly undefined for null/undefined input -> maps to NULL
                }

                // Handle localVno
                if (dto.localVno !== undefined && dto.localVno !== null) {
                    entity.localVno = parseInt(dto.localVno.toString());
                } else {
                    entity.localVno = undefined;
                }

                // Handle localInvType
                if (dto.localInvType !== undefined && dto.localInvType !== null) {
                    entity.localInvType = parseInt(dto.localInvType.toString());
                } else {
                    entity.localInvType = undefined;
                }
                // Timestamps (createdAt, updatedAt) are handled by DB/TypeORM decorators
                // Map optional sourceItcRegisterId if you added it
                // entity.sourceItcRegisterId = dto.localRecordId;
                return entity;
            });

            // 2. Perform the bulk save operation
            // Use `save` which handles insert/update based on primary key presence.
            // For large volumes, consider chunking or using query builder's insert.
            const savedEntities = await repository.save(entitiesToSave, { chunk: 100 }); // Optional: chunk size

            this.logger.info(`ReconciledRecordRepository: Successfully saved ${savedEntities.length} reconciled records.`);

        } catch (error: any) {
            this.logger.error('ReconciledRecordRepository: Error saving reconciled records to database.', {
                errorMessage: error.message,
                errorCode: error.code, // Log DB error code if available
                query: error.query,   // Log failing query if available (be cautious in prod)
                parameters: error.parameters, // Log parameters (be cautious in prod)
                stack: error.stack,
                recordCount: records.length,
            });
            // Re-throw a domain-specific error or the original error
            throw new AppError(
                'DatabaseError',
                `Failed to save reconciled records: ${error.message}`,
                500, // Internal Server Error
                false, // Generally non-operational unless it indicates a fundamental DB issue// Keep original error attached if needed
            );
        }
    }

    /**
     * Finds a reconciled record by its unique primary key ID.
     */
    async findById(id: number): Promise<Gstr2bReconciledRecord | null> {
        const repository = await this._getRepository();
        this.logger.debug(`ReconciledRecordRepository: Finding record by ID: ${id}`);
        try {
            const record = await repository.findOneBy({ id: id });
            if (!record) {
                this.logger.debug(`ReconciledRecordRepository: Record with ID ${id} not found.`);
            }
            return record;
        } catch (error: any) {
            this.logger.error(`ReconciledRecordRepository: Error finding record by ID ${id}.`, {
                errorMessage: error.message,
                errorCode: error.code,
                stack: error.stack,
            });
            throw new AppError('DatabaseError', `Failed to find record by ID: ${error.message}`, 500, false);
        }
    }

    // --- Implement other query methods from the interface here ---
    // Example:
    // async findByGstinAndInvoice(gstin: string, invoiceNumber: string): Promise<Gstr2bReconciledRecord[]> {
    //     this.logger.debug(`ReconciledRecordRepository: Finding records by GSTIN ${gstin} and Invoice ${invoiceNumber}`);
    //     try {
    //         return await this.ormRepository.find({
    //             where: {
    //                 supplierGstin: gstin,
    //                 localInvoiceNumber: invoiceNumber // or portalInvoiceNumber? Clarify requirement
    //             }
    //         });
    //     } catch (error: any) {
    //         this.logger.error('ReconciledRecordRepository: Error finding records by GSTIN and Invoice.', {
    //             errorMessage: error.message,
    //             // ... error details ...
    //         });
    //         throw new AppError('DatabaseError', `Failed to find records: ${error.message}`, 500, false, error);
    //     }
    // }

} // End of class ReconciledRecordRepository


