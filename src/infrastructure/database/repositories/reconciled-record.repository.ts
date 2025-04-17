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

    private readonly ormRepository: Repository<Gstr2bReconciledRecord>;
    private readonly logger: winston.Logger;
    private readonly dataSource: DataSource;

    constructor(
        @inject(LOGGER_TOKEN) logger: winston.Logger,
        // Inject AppDataSource provider to get the DataSource instance
        @inject(AppDataSource) dataSourceProvider: AppDataSource
    ) {
        this.logger = logger;
        // Get the initialized DataSource instance from the provider
        // Ensure .init() has been called elsewhere (e.g., in main.ts) before this repository is used
        this.dataSource = dataSourceProvider.getDataSource(); // Get the initialized DataSource
        this.ormRepository = this.dataSource.getRepository(Gstr2bReconciledRecord);
        this.logger.info('ReconciledRecordRepository initialized.');
    }

    /**
     * Saves multiple reconciled records to the database.
     */
    async saveMany(records: StorableReconciliationRecord[]): Promise<void> {
        if (!records || records.length === 0) {
            this.logger.info('ReconciledRecordRepository: No records provided to saveMany.');
            return;
        }

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
            const savedEntities = await this.ormRepository.save(entitiesToSave, { chunk: 100 }); // Optional: chunk size

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
        this.logger.debug(`ReconciledRecordRepository: Finding record by ID: ${id}`);
        try {
            const record = await this.ormRepository.findOneBy({ id: id });
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


