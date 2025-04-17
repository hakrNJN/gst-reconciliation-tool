// src/infrastructure/webserver/controllers/reconciled-records.controller.ts
import 'reflect-metadata';
import { Request, Response, NextFunction } from 'express';
import { inject, injectable } from 'tsyringe';
import winston from 'winston';

// --- Core Service/Repository Interfaces & Tokens ---
import { IReconciledRecordRepository, RECONCILED_RECORD_REPOSITORY_TOKEN } from '../../../core/common/interfaces/repositories/IReconciledRecordRepository';
import { ReportGeneratorService } from '../../../core/reporting/report-generator.service'; // Prepare data logic resides here
import { ReconciliationResults } from '../../../core/common/interfaces/models';

// --- Infrastructure Imports ---
import { LOGGER_TOKEN } from '../../logger';

// --- Error Handling ---
import { AppError, ValidationError } from '../../../core/common/errors';

@injectable()
export class ReconciledRecordsController {

    // Inject only the dependencies needed for persistence
    constructor(
        @inject(LOGGER_TOKEN) private logger: winston.Logger,
        // Inject ReportGeneratorService to use prepareDataForStorage
        @inject(ReportGeneratorService) private reporter: ReportGeneratorService,
        // Inject Repository using the token
        @inject(RECONCILED_RECORD_REPOSITORY_TOKEN) private reconciledRepo: IReconciledRecordRepository
    ) {
        this.logger.info('ReconciledRecordsController initialized.');
    }

    /**
     * Handles POST requests to persist reconciled records (Matched/Mismatched) to the database.
     * Expects the full ReconciliationResults object in the request body under the 'results' key.
     */
    public persistReconciledRecords = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        this.logger.info('Received request to persist reconciliation results via ReconciledRecordsController.');

        try {
            // 1. Extract and Validate Input
            const resultsInput: ReconciliationResults | any = req.body.results;

            if (!resultsInput || typeof resultsInput !== 'object' || !resultsInput.summary || !resultsInput.details) {
                throw new ValidationError('Valid ReconciliationResults object under the "results" key is required in the request body.');
            }

            // 2. Convert details to Map & Sanitize Dates (CRITICAL STEP)
            let detailsMap: Map<string, any>;
            try {
                if (resultsInput.details instanceof Map) {
                    detailsMap = resultsInput.details;
                } else if (typeof resultsInput.details === 'object' && resultsInput.details !== null) {
                    detailsMap = new Map(Object.entries(resultsInput.details));
                } else {
                    throw new Error('results.details is not a valid object or Map.');
                }
                // Ensure dates are actual Date objects (or null)
                this.sanitizeDatesInDetails(detailsMap); // Use the helper within this controller

            } catch (processingError: any) {
                this.logger.error('Failed to process results.details for persistence.', { error: processingError.message });
                throw new ValidationError('Invalid format or structure for results details in request body.');
            }

            // Reconstruct the results object with the processed Map
            const resultsForPersistence: ReconciliationResults = {
                summary: resultsInput.summary,
                details: detailsMap as any // Cast carefully
            };

            // Ensure summary timestamp is a Date object
             if (resultsForPersistence.summary.reconciliationTimestamp && !(resultsForPersistence.summary.reconciliationTimestamp instanceof Date)) {
                 try {
                      const parsedDate = new Date(resultsForPersistence.summary.reconciliationTimestamp);
                      if(isNaN(parsedDate.getTime())) throw new Error('Invalid date string');
                     resultsForPersistence.summary.reconciliationTimestamp = parsedDate;
                 } catch {
                      throw new ValidationError('Invalid reconciliationTimestamp in summary.');
                 }
             } else if (!resultsForPersistence.summary.reconciliationTimestamp) {
                 throw new ValidationError('Missing reconciliationTimestamp in summary.');
             }


            // 3. Prepare Data for Storage using ReportGeneratorService
            this.logger.info('Preparing data for database persistence...');
            const recordsToStore = this.reporter.prepareDataForStorage(resultsForPersistence);
            this.logger.info(`Prepared ${recordsToStore.length} records for storage.`);

            // 4. Save Data using Repository
            if (recordsToStore.length > 0) {
                this.logger.info('Persisting records to the database...');
                await this.reconciledRepo.saveMany(recordsToStore);
                this.logger.info(`Successfully persisted ${recordsToStore.length} reconciled records.`);
            } else {
                this.logger.info('No matched or mismatched records found in the results to persist.');
            }

            // 5. Send Success Response
            res.status(200).json({
                message: 'Reconciliation results persisted successfully.',
                recordsPersisted: recordsToStore.length,
            });

        } catch (error) {
            this.logger.error('Error during reconciliation results persistence handling.', { error });
            next(error); // Pass to central error handler
        }
    };


    // --- Helper for Date Sanitization ---
    // Moved here from ReconciliationController. Consider moving to a dedicated service later.
     private sanitizeDatesInDetails(detailsMap: Map<string, any>): void {
        this.logger.debug('Sanitizing date fields in details map...');
        let itemsProcessed = 0;
        for (const [, supplierData] of detailsMap.entries()) {
            const processRecordDate = (record: any, field: string) => {
                if (!record || !(field in record) || record[field] === null || record[field] === undefined) {
                    record[field] = null; return;
                }
                const originalValue = record[field];
                if (originalValue instanceof Date && !isNaN(originalValue.getTime())) return;
                if (typeof originalValue === 'string') {
                    try {
                        const parsedDate = new Date(originalValue);
                        record[field] = !isNaN(parsedDate.getTime()) ? parsedDate : null;
                         if (isNaN(parsedDate.getTime())) this.logger.warn(`Could not parse date string "${originalValue}" for field ${field}. Setting to null.`);
                    } catch {
                         this.logger.warn(`Error parsing date string "${originalValue}" for field ${field}. Setting to null.`);
                         record[field] = null;
                    }
                } else {
                     this.logger.warn(`Unexpected type "${typeof originalValue}" for date field ${field}. Setting to null.`);
                     record[field] = null;
                }
            };

            // Process dates in all relevant records within supplierData
            supplierData.matches?.forEach((match: any) => { processRecordDate(match.localRecord, 'date'); processRecordDate(match.portalRecord, 'date'); processRecordDate(match.portalRecord, 'supfileDate'); itemsProcessed++; });
            supplierData.mismatchedAmounts?.forEach((mismatch: any) => { processRecordDate(mismatch.localRecord, 'date'); processRecordDate(mismatch.portalRecord, 'date'); processRecordDate(mismatch.portalRecord, 'supfileDate'); itemsProcessed++; });
            supplierData.missingInPortal?.forEach((record: any) => { processRecordDate(record, 'date'); itemsProcessed++; });
            supplierData.missingInLocal?.forEach((record: any) => { processRecordDate(record, 'date'); processRecordDate(record, 'supfileDate'); itemsProcessed++; });
            supplierData.potentialMatches?.forEach((potential: any) => { processRecordDate(potential.localRecord, 'date'); processRecordDate(potential.portalRecord, 'date'); processRecordDate(potential.portalRecord, 'supfileDate'); itemsProcessed++; });
        }
        this.logger.debug(`Date sanitization processed approx ${itemsProcessed} record dates.`);
    }

} // End of ReconciledRecordsController class