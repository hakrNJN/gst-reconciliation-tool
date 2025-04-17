// src/infrastructure/webserver/controllers/reconcile.controller.ts
import { NextFunction, Request, Response } from 'express';
import 'reflect-metadata';
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../../config';
import { AppError, ValidationError } from '../../../core/common/errors';
import { InternalInvoiceRecord, ReconciliationMatch, ReconciliationMismatch, ReconciliationPotentialMatch, ReconciliationResults } from '../../../core/common/interfaces/models';
import { FileParserService } from '../../../core/parsing'; // Import concrete class for DI token or use interface token
import { dateToString, ReconciliationOptions, ReconciliationService } from '../../../core/reconciliation'; // Import concrete class
import { ReportGeneratorService } from '../../../core/reporting'; // Import concrete class
import { ValidationService } from '../../../core/validation';
import { LOGGER_TOKEN } from '../../logger';
import { IReconciledRecordRepository, RECONCILED_RECORD_REPOSITORY_TOKEN } from '../../../core/common/interfaces/repositories';

const TARGET_GSTIN_FOR_DEBUG = '09CCQPG2489D1ZA';
// Define expected structure for uploaded files in req.files
interface UploadedFiles {
    localData?: Express.Multer.File[];
    portalData?: Express.Multer.File[];
}

@singleton()
@injectable()
export class ReconcileController {

    // Inject dependencies using tsyringe
    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger,
        @inject(FileParserService) private fileParser: FileParserService,
        @inject(ValidationService) private validationService: ValidationService, // Inject new service
        @inject(ReconciliationService) private reconciler: ReconciliationService,
        @inject(ReportGeneratorService) private reporter: ReportGeneratorService,
        @inject(RECONCILED_RECORD_REPOSITORY_TOKEN) private reconciledRepo: IReconciledRecordRepository
    ) {
        this.logger.info('ReconcileController initialized.');
    }

     /**
     * Handles uploads of multiple local and portal files,
     * parsing, validation, standardization, and initiates reconciliation.
     */
     public handleUploadAndReconcile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        this.logger.info('Received request to reconcile uploaded files.');
        try {
            // 1. --- Validate File Uploads ---
            const files = req.files as UploadedFiles | undefined;
            if (!files || !files.localData || files.localData.length === 0) {
                throw new ValidationError('At least one Local Purchase Data file ("localData") is required.');
            }
            if (!files.portalData || files.portalData.length === 0) {
                throw new ValidationError('At least one Portal Data file ("portalData") is required.');
            }

            const localFiles = files.localData;
            const portalFiles = files.portalData;

            this.logger.info(`Received ${localFiles.length} local file(s) and ${portalFiles.length} portal file(s).`);
            localFiles.forEach((file, i) => this.logger.debug(`Local file ${i+1}: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`));
            portalFiles.forEach((file, i) => this.logger.debug(`Portal file ${i+1}: ${file.originalname} (${(file.size / 1024).toFixed(2)} KB)`));

            // 2. --- Extract and Validate Options ---
            const { toleranceAmount: rawToleranceAmount,
                toleranceTax: rawToleranceTax,
                dateMatchStrategy: rawDateStrategy,
                reconciliationScope: rawScope } = req.body;
            const toleranceAmount = parseFloat(rawToleranceAmount);
            const effectiveToleranceAmount = (!isNaN(toleranceAmount) && toleranceAmount >= 0) ? toleranceAmount : config.reconciliation.toleranceAmount;
            const toleranceTax = parseFloat(rawToleranceTax);
            const effectiveToleranceTax = (!isNaN(toleranceTax) && toleranceTax >= 0) ? toleranceTax : config.reconciliation.toleranceTax;
            const effectiveDateStrategy: 'month' | 'fy' | 'quarter' = (rawDateStrategy === 'fy'|| rawDateStrategy === 'quarter' || rawDateStrategy === 'month') ? rawDateStrategy : 'month';
            const effectiveScope: 'all' | 'b2b' | 'cdnr' = (rawScope === 'b2b' || rawScope === 'cdnr') ? rawScope : 'all';
            
            const options: ReconciliationOptions = {
                toleranceAmount: effectiveToleranceAmount,
                toleranceTax: effectiveToleranceTax,
                dateMatchStrategy: effectiveDateStrategy,
                reconciliationScope: effectiveScope
            };
            this.logger.info('Using reconciliation options:', options);

            // 3. --- Parse All Files Concurrently ---
            this.logger.info('Starting file parsing...');
            const localParsePromises = localFiles.map(file => this.fileParser.parseFile(file.buffer /* Add options if needed */));
            const portalParsePromises = portalFiles.map(file => this.fileParser.parseFile(file.buffer /* Add options if needed */));

            const localSettledResults = await Promise.allSettled(localParsePromises);
            const portalSettledResults = await Promise.allSettled(portalParsePromises);

            // --- Aggregate Successfully Parsed Records & Collect Errors ---
            let localRawRecords: Partial<InternalInvoiceRecord>[] = [];
            const localErrors: string[] = [];
            localSettledResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    localRawRecords = localRawRecords.concat(result.value);
                } else {
                    const errorMsg = result.reason?.message ?? result.reason;
                    localErrors.push(`Local file ${index + 1} (${localFiles[index].originalname}): ${errorMsg}`);
                    this.logger.error(`Failed to parse local file ${index + 1}: ${errorMsg}`, { stack: result.reason?.stack });
                }
            });

            let portalRawRecords: Partial<InternalInvoiceRecord>[] = [];
            const portalErrors: string[] = [];
            portalSettledResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    portalRawRecords = portalRawRecords.concat(result.value);
                } else {
                    const errorMsg = result.reason?.message ?? result.reason;
                    portalErrors.push(`Portal file ${index + 1} (${portalFiles[index].originalname}): ${errorMsg}`);
                    this.logger.error(`Failed to parse portal file ${index + 1}: ${errorMsg}`, { stack: result.reason?.stack });
                }
            });

            // Handle parsing errors - Fail request if any file failed
            const allParsingErrors = [...localErrors, ...portalErrors];
            if (allParsingErrors.length > 0) {
                this.logger.error(`File parsing failed for ${allParsingErrors.length} file(s).`);
                // Throw a single error summarizing the failures
                throw new AppError('error',`Failed to parse ${allParsingErrors.length} file(s): ${allParsingErrors.join('; ')}`);
            }
            this.logger.info(`Successfully parsed all files. Local records raw: ${localRawRecords.length}, Portal records raw: ${portalRawRecords.length}`);
            // --- End Parsing ---
            this.logger.debug(`--- DEBUG: Data BEFORE Validation for GSTIN: ${TARGET_GSTIN_FOR_DEBUG} ---`);
            // 4. --- Validation & Standardization Step ---
            this.logger.info('Validating and standardizing records...');
            const [localValidatedPromise, portalValidatedPromise] = await Promise.allSettled([
                 this.validationService.validateAndStandardize(localRawRecords, 'local'),
                 this.validationService.validateAndStandardize(portalRawRecords, 'portal')
            ]);
            // Handle validation/standardization errors
            if (localValidatedPromise.status === 'rejected') throw localValidatedPromise.reason;
            if (portalValidatedPromise.status === 'rejected') throw portalValidatedPromise.reason;
            const localRecords = localValidatedPromise.value;
            const portalRecords = portalValidatedPromise.value;
            this.logger.info(`Validated records - Local: ${localRecords.length}, Portal: ${portalRecords.length}`);
            // --- End Validation ---
            // 5. --- Perform Reconciliation ---
            const results: ReconciliationResults = await this.reconciler.reconcile(localRecords, portalRecords, options);
            // ---------------------------------

            // 6. --- Prepare and Send Response ---
            const responseData = {
                summary: results.summary,
                details: Object.fromEntries(results.details) // Convert Map for JSON
            };
            res.status(200).json(responseData);
            this.logger.info('Reconciliation successful, results sent.');
            // ---------------------------------

        } catch (error) {
            // Log error before passing to central handler
            this.logger.error('Error during handleUploadAndReconcile:', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                errorObj: error // Log the full error object if needed
            });
            next(error); // Pass error to the centralized error handler
        }
    }; // End handleUploadAndReconcile

    /**
     * Handles request to export reconciliation results as Excel.
     * (Assumes results might be passed or retrieved via an ID - simplified for now)
     */
    public handleExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        this.logger.info('Received request to export reconciliation results.');
        try {
            const {results: resultsInput,scope } = req.body;

            if (!resultsInput || !resultsInput.summary || !resultsInput.details) {
                throw new ValidationError('Reconciliation results data is required in the request body for export.');
            }

            // --- Convert details back to Map ---
            let detailsMap: Map<string, any>; // Use 'any' temporarily before casting record types
            try {
                detailsMap = new Map(Object.entries(resultsInput.details));
            } catch (convError) {
                this.logger.error('Failed to convert input results.details to Map', convError);
                throw new ValidationError('Invalid format for results details in request body.');
            }

            // --- Sanitize Date Fields IN-PLACE before reporting ---
            this.logger.debug('Sanitizing date fields in results for export...');
            let dateProcessingErrorOccurred = false; // Flag to track issues
            for (const [gstin, supplierData] of detailsMap.entries()) {
                // Helper to sanitize the 'date' field of a record
                const sanitizeDate = (record: Partial<InternalInvoiceRecord>, context: string) => {

                    const field = 'date';
                    if (!record || record[field] === undefined || record[field] === null) {
                        record.date = null; // Ensure null if missing
                        return;
                    }
                    const originalValue = record[field];
                    const originalType = typeof originalValue;
                    // let finalDateValue: Date | null = null;

                    let dateObj: Date | null = null;

                    try { // Add try-catch around date operations
                        if (originalValue instanceof Date) {
                            if (!isNaN(originalValue.getTime())) {
                                dateObj = originalValue; // Already a valid Date
                                this.logger.debug(`[${context}] Kept existing valid Date object for record ${record.id}`);
                            } else {
                                this.logger.warn(`[${context}] Found 'Invalid Date' object for record ${record.id}. Setting to null.`);
                            }
                        } else if (typeof originalValue === 'string') {
                            const parsed = new Date(originalValue); // Try parsing the string (ISO expected)
                            if (!isNaN(parsed.getTime())) {
                                dateObj = parsed; // Parsed successfully
                                this.logger.debug(`[${context}] Parsed date string "${originalValue}" to Date object for record ${record.id}`);
                            } else {
                                this.logger.warn(`[${context}] Could not re-parse date string "${originalValue}" for record ${record.id}. Setting to null.`);
                            }
                        } else {
                            // Handle other unexpected types
                            this.logger.warn(`[${context}] Unexpected type "${originalType}" for date field on record ${record.id}. Value: ${originalValue}. Setting to null.`);
                        }
                    } catch (parseError) {
                        this.logger.error(`[${context}] Error during date processing for record ${record.id}. Value: ${originalValue}`, parseError);
                        dateProcessingErrorOccurred = true;
                    }

                    // Replace original with valid Date object or null
                    record.date = dateObj;

                };
                // Apply sanitization
                const contextPrefix = `GSTIN ${gstin}`;
                (supplierData.matches as ReconciliationMatch[] | undefined)?.forEach((match, i) => {
                    sanitizeDate(match.localRecord as InternalInvoiceRecord, `${contextPrefix}-Match[${i}]-Local`);
                    sanitizeDate(match.portalRecord as InternalInvoiceRecord, `${contextPrefix}-Match[${i}]-Portal`);
                });
                (supplierData.missingInPortal as InternalInvoiceRecord[] | undefined)?.forEach((record, i) => sanitizeDate(record, `${contextPrefix}-MissingPortal[${i}]`));
                (supplierData.missingInLocal as InternalInvoiceRecord[] | undefined)?.forEach((record, i) => sanitizeDate(record, `${contextPrefix}-MissingLocal[${i}]`));
                (supplierData.mismatchedAmounts as any[] | undefined)?.forEach((mismatch, i) => { // Use any temporarily if ReconciliationMismatch type not updated fully
                    sanitizeDate(mismatch.localRecord as InternalInvoiceRecord, `${contextPrefix}-Mismatch[${i}]-Local`);
                    sanitizeDate(mismatch.portalRecord as InternalInvoiceRecord, `${contextPrefix}-Mismatch[${i}]-Portal`);
                });
                (supplierData.potentialMatches as ReconciliationPotentialMatch[] | undefined)?.forEach((potential, i) => {
                    sanitizeDate(potential.localRecord, `${contextPrefix}-Potential[${i}]-Local`);
                    sanitizeDate(potential.portalRecord, `${contextPrefix}-Potential[${i}]-Portal`);
                });

            }
            if (dateProcessingErrorOccurred) {
                this.logger.error("Errors occurred during date sanitization for export. Report data might be incomplete or invalid.");
                // Optionally throw an error here if desired:
                // throw new AppError('ExportPrepError', 'Failed to prepare date fields for export.', 500);
            } else {
                this.logger.debug('Date sanitization for export complete.');
            }
            // --- End Date Sanitization ---


            // Reconstruct the ReconciliationResults object, NOW types should be closer
            const resultsForReport: ReconciliationResults = {
                summary: resultsInput.summary,
                details: detailsMap as Map<string, { // Cast the value type more specifically if possible
                    supplierName?: string;
                    matches: ReconciliationMatch[];
                    missingInPortal: InternalInvoiceRecord[];
                    missingInLocal: InternalInvoiceRecord[];
                    mismatchedAmounts: ReconciliationMismatch[]; // Adjust type if needed
                    potentialMatches: ReconciliationPotentialMatch[]; // Adjust type if needed
                }>
            };

            // Generate Excel Report
            const reportBuffer = await this.reporter.generateReport(resultsForReport);

            // Set Headers and Send Buffer
            const timestamp = new Date()
            const filename = `reconciliation-report-${dateToString(timestamp)}-${scope}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(reportBuffer);
            this.logger.info(`Exported report ${filename}`);

        } catch (error) {
            this.logger.error('Error during report export handling.', error);
            next(error);
        }
    }


    /**
     * Handles POST requests to persist reconciled records (Matched/Mismatched) to the database.
     * Expects the full ReconciliationResults object in the request body.
     */
    public handlePersistResults = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        this.logger.info('Received request to persist reconciliation results.');

        try {
            // 1. Extract and Validate Input
            const resultsInput: ReconciliationResults | any = req.body.results; // Assuming results are nested under 'results' key

            if (!resultsInput || typeof resultsInput !== 'object' || !resultsInput.summary || !resultsInput.details) {
                throw new ValidationError('Valid ReconciliationResults object under the "results" key is required in the request body.');
            }

            // 2. Convert details to Map & Sanitize Dates (CRITICAL STEP)
            //    This ensures the data structure and types are correct for the services.
            let detailsMap: Map<string, any>;
            try {
                // Convert plain object from JSON back to Map
                if (resultsInput.details instanceof Map) {
                    detailsMap = resultsInput.details; // Already a Map (less likely from JSON)
                } else if (typeof resultsInput.details === 'object' && resultsInput.details !== null) {
                    detailsMap = new Map(Object.entries(resultsInput.details));
                } else {
                     throw new Error('results.details is not a valid object or Map.');
                }

                // Ensure dates are actual Date objects (or null) before proceeding
                // This step is vital as services expect Date objects, not strings.
                this.sanitizeDatesInDetails(detailsMap); // Call helper function

            } catch (processingError: any) {
                this.logger.error('Failed to process results.details for persistence.', { error: processingError.message });
                throw new ValidationError('Invalid format or structure for results details in request body.');
            }

             // Reconstruct the results object with the processed Map
             const resultsForPersistence: ReconciliationResults = {
                 summary: resultsInput.summary, // Summary likely needs date checks too if timestamp is string
                 details: detailsMap as any // Cast carefully
             };

             // Ensure summary timestamp is a Date object for prepareDataForStorage
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
                message: 'Reconciliation results processed for persistence successfully.',
                recordsPersisted: recordsToStore.length,
            });

        } catch (error) {
            // Catch specific AppErrors or general errors
            this.logger.error('Error during reconciliation results persistence handling.', { error });
            // Pass error to the centralized Express error handling middleware
            next(error);
        }
    };


    // --- Helper for Date Sanitization (Example - Adapt as needed) ---
    // This is crucial and needs to handle your specific date formats and potential issues.
    // Consider moving this to a dedicated validation/sanitization service.
    private sanitizeDatesInDetails(detailsMap: Map<string, any>): void {
        this.logger.debug('Sanitizing date fields in details map...');
        let itemsProcessed = 0;
        for (const [, supplierData] of detailsMap.entries()) {
            const processRecordDate = (record: any, field: string) => {
                if (!record || !(field in record) || record[field] === null || record[field] === undefined) {
                    record[field] = null; // Ensure null if missing/null
                    return;
                }
                const originalValue = record[field];
                if (originalValue instanceof Date && !isNaN(originalValue.getTime())) {
                    return; // Already a valid Date object
                }
                if (typeof originalValue === 'string') {
                    try {
                        const parsedDate = new Date(originalValue);
                        if (!isNaN(parsedDate.getTime())) {
                            record[field] = parsedDate; // Replace string with Date object
                        } else {
                            this.logger.warn(`Could not parse date string "${originalValue}" for field ${field}. Setting to null.`);
                            record[field] = null;
                        }
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
            supplierData.matches?.forEach((match: any) => {
                processRecordDate(match.localRecord, 'date');
                processRecordDate(match.portalRecord, 'date');
                processRecordDate(match.portalRecord, 'supfileDate'); // Also sanitize portal filing date
                itemsProcessed++;
            });
             supplierData.mismatchedAmounts?.forEach((mismatch: any) => {
                 processRecordDate(mismatch.localRecord, 'date');
                 processRecordDate(mismatch.portalRecord, 'date');
                  processRecordDate(mismatch.portalRecord, 'supfileDate');
                 itemsProcessed++;
             });
              supplierData.missingInPortal?.forEach((record: any) => {
                  processRecordDate(record, 'date');
                   // No portal date here
                  itemsProcessed++;
              });
               supplierData.missingInLocal?.forEach((record: any) => {
                   // No local date here
                   processRecordDate(record, 'date');
                    processRecordDate(record, 'supfileDate');
                   itemsProcessed++;
               });
                supplierData.potentialMatches?.forEach((potential: any) => {
                    processRecordDate(potential.localRecord, 'date');
                    processRecordDate(potential.portalRecord, 'date');
                     processRecordDate(potential.portalRecord, 'supfileDate');
                    itemsProcessed++;
                });
        }
        this.logger.debug(`Date sanitization processed approx ${itemsProcessed} record dates.`);
    }
    // Add handleGetStatus, handleGetResults methods here if implementing async processing later

}

// --- DI Registration ---
// Register the controller as a singleton
// container.registerSingleton(ReconcileController);
