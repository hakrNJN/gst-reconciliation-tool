// src/infrastructure/webserver/controllers/reconcile.controller.ts
import { NextFunction, Request, Response } from 'express';
import 'reflect-metadata';
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../../config';
import { ValidationError } from '../../../core/common/errors';
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
     * Handles file uploads, parsing, and initiates reconciliation.
     */
    public handleUploadAndReconcile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        this.logger.info('Received request to reconcile uploaded files.');
        try {
            const files = req.files as UploadedFiles | undefined;

            // 1. Validate File Uploads
            if (!files || !files.localData?.[0] || !files.portalData?.[0]) {
                throw new ValidationError('Both "localData" and "portalData" files are required.');
            }
            const localFile = files.localData[0];
            const portalFile = files.portalData[0];

            this.logger.info(`Processing local file: ${localFile.originalname} (${(localFile.size / 1024).toFixed(2)} KB)`);
            this.logger.info(`Processing portal file: ${portalFile.originalname} (${(portalFile.size / 1024).toFixed(2)} KB)`);

            // --- 1b. Extract and Validate Options from req.body ---
            // Non-file fields from FormData are typically available in req.body
            const { toleranceAmount: rawToleranceAmount,
                toleranceTax: rawToleranceTax,
                dateMatchStrategy: rawDateStrategy,
                reconciliationScope: rawScope
            } = req.body;

            // Validate and parse tolerances, using config defaults if invalid/missing
            const toleranceAmount = parseFloat(rawToleranceAmount);
            const effectiveToleranceAmount = (!isNaN(toleranceAmount) && toleranceAmount >= 0)
                ? toleranceAmount
                : config.reconciliation.toleranceAmount;

            const toleranceTax = parseFloat(rawToleranceTax);
            const effectiveToleranceTax = (!isNaN(toleranceTax) && toleranceTax >= 0)
                ? toleranceTax
                : config.reconciliation.toleranceTax;

            // Validate date match strategy, default to 'month'
            const effectiveDateStrategy: 'month' | 'fy' = (rawDateStrategy === 'fy' || rawDateStrategy === 'month')
                ? rawDateStrategy
                : 'month';

            const effectiveScope: 'all' | 'b2b' | 'cdnr' = (rawScope === 'b2b' || rawScope === 'cdnr')
                ? rawScope
                : 'all'; // Default to 'all'

            const options: ReconciliationOptions = {
                toleranceAmount: effectiveToleranceAmount,
                toleranceTax: effectiveToleranceTax,
                dateMatchStrategy: effectiveDateStrategy,
                reconciliationScope: effectiveScope
            };
            this.logger.info('Using reconciliation options:', options);
            // -------------------------------------------------------

            // 2. Parse Files
            // Run parsing in parallel
            const [localParsedPromise, portalParsedPromise] = await Promise.allSettled([
                this.fileParser.parseFile(localFile.buffer),
                this.fileParser.parseFile(portalFile.buffer)
            ]);

            if (localParsedPromise.status === 'rejected') throw localParsedPromise.reason;
            if (portalParsedPromise.status === 'rejected') throw portalParsedPromise.reason;

            let localRawRecords = localParsedPromise.value;
            let portalRawRecords = portalParsedPromise.value;

            this.logger.info(`Parsed local records: ${localRawRecords.length}`);
            this.logger.info(`Parsed portal records: ${portalRawRecords.length}`);


            // 3. Validation & Standardization
            // --- Validation & Standardization Step ---
            this.logger.info('Validating and standardizing records...');
            // Process in parallel
            const [localValidatedPromise, portalValidatedPromise] = await Promise.allSettled([
                this.validationService.validateAndStandardize(localRawRecords, 'local'),
                this.validationService.validateAndStandardize(portalRawRecords, 'portal')
            ]);
            if (localValidatedPromise.status === 'rejected') throw localValidatedPromise.reason; // Or handle more gracefully
            if (portalValidatedPromise.status === 'rejected') throw portalValidatedPromise.reason;

            const localRecords = localValidatedPromise.value;
            const portalRecords = portalValidatedPromise.value;
            this.logger.info(`Validated records - Local: ${localRecords.length}, Portal: ${portalRecords.length}`);
            // -----------------------------------------



            // 4. Perform Reconciliation
            // TODO: Implement Async handling if needed based on record count / config
            const results = await this.reconciler.reconcile(localRecords, portalRecords,options);

            // --- Prepare Response Data (Convert Map to Object) ---
            const responseData = {
                summary: results.summary,
                // Convert the Map into a plain object for JSON serialization
                details: Object.fromEntries(results.details)
            };

            // 5. Send Response
            res.status(200).json(responseData);
            this.logger.info('Reconciliation successful, results sent.');

        } catch (error) {
            this.logger.error('Error during reconciliation handling.', error);
            next(error); // Pass error to the centralized error handler
        }
    };

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
