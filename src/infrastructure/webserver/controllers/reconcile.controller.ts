// src/infrastructure/webserver/controllers/reconcile.controller.ts
import { NextFunction, Request, Response } from 'express';
import 'reflect-metadata';
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../../config';
import { AppError, ValidationError } from '../../../core/common/errors';
import { InternalInvoiceRecord, ReconciliationMatch, ReconciliationMismatch, ReconciliationPotentialMatch, ReconciliationResults } from '../../../core/common/interfaces/models';
import { FileParserService } from '../../../core/parsing'; // Import concrete class for DI token or use interface token
import { ReconciliationOptions, ReconciliationService } from '../../../core/reconciliation'; // Import concrete class
import { ReportGeneratorService } from '../../../core/reporting'; // Import concrete class
import { ValidationService } from '../../../core/validation';
import { LOGGER_TOKEN } from '../../logger';


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
        @inject(ReportGeneratorService) private reporter: ReportGeneratorService
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
            const effectiveDateStrategy: 'month' | 'fy' = (rawDateStrategy === 'fy' || rawDateStrategy === 'month') ? rawDateStrategy : 'month';
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
            const resultsInput = req.body;

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
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `reconciliation-report-${timestamp}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.send(reportBuffer);
            this.logger.info(`Exported report ${filename}`);

        } catch (error) {
            this.logger.error('Error during report export handling.', error);
            next(error);
        }
    }

    // Add handleGetStatus, handleGetResults methods here if implementing async processing later

}

// --- DI Registration ---
// Register the controller as a singleton
container.registerSingleton(ReconcileController);
