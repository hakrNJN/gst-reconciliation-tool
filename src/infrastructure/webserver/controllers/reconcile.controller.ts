// src/infrastructure/webserver/controllers/reconcile.controller.ts
import { NextFunction, Request, Response } from 'express';
import 'reflect-metadata';
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import config from '../../../config';
import { ValidationError } from '../../../core/common/errors';
import { InternalInvoiceRecord, ReconciliationResults } from '../../../core/common/interfaces/models';
import { FileParserService } from '../../../core/parsing'; // Import concrete class for DI token or use interface token
import { ReconciliationOptions, ReconciliationService } from '../../../core/reconciliation'; // Import concrete class
import { ReportGeneratorService } from '../../../core/reporting'; // Import concrete class
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
        // Using concrete classes as tokens for simplicity, or use interface tokens
        @inject(FileParserService) private fileParser: FileParserService,
        @inject(ReconciliationService) private reconciler: ReconciliationService,
        @inject(ReportGeneratorService) private reporter: ReportGeneratorService
        // TODO: Inject Validation/Standardization Service once created
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
            const { toleranceAmount: rawToleranceAmount, toleranceTax: rawToleranceTax, dateMatchStrategy: rawDateStrategy } = req.body;

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

            const options: ReconciliationOptions = {
                toleranceAmount: effectiveToleranceAmount,
                toleranceTax: effectiveToleranceTax,
                dateMatchStrategy: effectiveDateStrategy
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


            // 3. TODO: Validation & Standardization Step
            // Once the ValidationService is created, call it here:
            // const { validLocalRecords, validPortalRecords } = await this.validationService.validateAndStandardize(localRawRecords, portalRawRecords);
            // For now, we assume the parser output is usable directly by the reconciler (which does temp standardization)
            const localRecords = localRawRecords as InternalInvoiceRecord[]; // Temporary cast
            const portalRecords = portalRawRecords as InternalInvoiceRecord[]; // Temporary cast


            // 4. Perform Reconciliation
            // TODO: Implement Async handling if needed based on record count / config
            const results = await this.reconciler.reconcile(localRecords, portalRecords);

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
    // public handleExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    //     this.logger.info('Received request to export reconciliation results.');
    //     try {
    //         // --- How to get results data for export? ---
    //         // Option 1: Client POSTs the results JSON back (simple, but potentially large payload)
    //         // Option 2: Use a jobId from async processing (requires job store)
    //         // Option 3: Perform reconciliation again (inefficient)
    //         // For now, let's assume Option 1: results are in req.body
    //         const results = req.body; // Requires body-parser middleware and client sending data

    //         if (!results || !results.summary || !results.details) {
    //             throw new ValidationError('Reconciliation results data is required in the request body for export.');
    //         }
    //         // Convert Map-like structure back to Map if needed after JSON parsing
    //         if (!(results.details instanceof Map)) {
    //             try {
    //                 // Attempt conversion if it looks like an array of [key, value] pairs or an object
    //                 if (Array.isArray(results.details)) {
    //                     results.details = new Map(results.details);
    //                 } else if (typeof results.details === 'object' && results.details !== null) {
    //                     results.details = new Map(Object.entries(results.details));
    //                 } else {
    //                     throw new Error('Invalid format for details property');
    //                 }
    //             } catch (convError) {
    //                 this.logger.error('Failed to convert results.details back to Map', convError);
    //                 throw new ValidationError('Invalid format for results details in request body.');
    //             }
    //         }


    //         // Generate Excel Report
    //         const reportBuffer = await this.reporter.generateReport(results);

    //         // Set Headers for Excel download
    //         const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    //         const filename = `reconciliation-report-${timestamp}.xlsx`;
    //         res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    //         res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    //         // Send Buffer
    //         res.send(reportBuffer);
    //         this.logger.info(`Exported report ${filename}`);

    //     } catch (error) {
    //         this.logger.error('Error during report export handling.', error);
    //         next(error); // Pass error to the centralized error handler
    //     }
    // };
    public handleExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        this.logger.info('Received request to export reconciliation results.');
        try {
            const resultsInput = req.body;

            if (!resultsInput || !resultsInput.summary || !resultsInput.details) {
                throw new ValidationError('Reconciliation results data is required in the request body for export.');
            }

            // --- Convert details back to Map ---
            let detailsMap: Map<string, any>;
            try {
                detailsMap = new Map(Object.entries(resultsInput.details));
            } catch (convError) {
                this.logger.error('Failed to convert input results.details to Map', convError);
                throw new ValidationError('Invalid format for results details in request body.');
            }

            // --- Convert Date Strings back to Date Objects ---
            this.logger.info('Converting date strings in results back to Date objects for export...');
            for (const supplierData of detailsMap.values()) {
                // Helper function to parse date strings safely
                const parseDate = (record: any, field: string = 'date') => {
                    if (record && typeof record[field] === 'string') {
                        const dateObj = new Date(record[field]); // ISO strings are parsed reliably by new Date()
                        if (!isNaN(dateObj.getTime())) {
                            record[field] = dateObj; // Replace string with Date object
                        } else {
                            this.logger.warn(`Could not re-parse date string "${record[field]}" for export. Leaving as string or nulling?`);
                            // Decide how to handle invalid dates during export - maybe nullify?
                            // record[field] = null;
                        }
                    } else if (record && !(record[field] instanceof Date)) {
                        // If it's somehow not a string or Date, log warning
                        this.logger.warn(`Unexpected type for date field "${field}" during export pre-processing: ${typeof record[field]}`);
                    }
                };

                supplierData.matches?.forEach((match: any) => {
                    parseDate(match.localRecord, 'date');
                    parseDate(match.portalRecord, 'date');
                });
                supplierData.missingInPortal?.forEach((record: any) => parseDate(record, 'date'));
                supplierData.missingInLocal?.forEach((record: any) => parseDate(record, 'date'));
            }
            this.logger.debug('Date conversion for export complete.');
            // --- End Date Conversion ---


            // Reconstruct the ReconciliationResults object with the Map containing Date objects
            const resultsForReport: ReconciliationResults = {
                summary: resultsInput.summary,
                details: detailsMap // Now contains Date objects where possible
            };

            // Generate Excel Report
            const reportBuffer = await this.reporter.generateReport(resultsForReport);

            // Set Headers and Send Buffer (as before)
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
    };

    // Add handleGetStatus, handleGetResults methods here if implementing async processing later

}

// --- DI Registration ---
// Register the controller as a singleton
container.registerSingleton(ReconcileController);