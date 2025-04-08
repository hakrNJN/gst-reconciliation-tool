// src/infrastructure/webserver/controllers/reconcile.controller.ts
import { NextFunction, Request, Response } from 'express';
import 'reflect-metadata';
import { container, inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import { ValidationError } from '../../../core/common/errors';
import { InternalInvoiceRecord } from '../../../core/common/interfaces/models';
import { FileParserService } from '../../../core/parsing'; // Import concrete class for DI token or use interface token
import { ReconciliationService } from '../../../core/reconciliation'; // Import concrete class
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


            // 5. Send Response
            res.status(200).json(results);
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
            // --- How to get results data for export? ---
            // Option 1: Client POSTs the results JSON back (simple, but potentially large payload)
            // Option 2: Use a jobId from async processing (requires job store)
            // Option 3: Perform reconciliation again (inefficient)
            // For now, let's assume Option 1: results are in req.body
            const results = req.body; // Requires body-parser middleware and client sending data

            if (!results || !results.summary || !results.details) {
                 throw new ValidationError('Reconciliation results data is required in the request body for export.');
            }
            // Convert Map-like structure back to Map if needed after JSON parsing
            if (!(results.details instanceof Map)) {
                 try {
                    // Attempt conversion if it looks like an array of [key, value] pairs or an object
                     if (Array.isArray(results.details)) {
                         results.details = new Map(results.details);
                     } else if (typeof results.details === 'object' && results.details !== null) {
                        results.details = new Map(Object.entries(results.details));
                     } else {
                         throw new Error('Invalid format for details property');
                     }
                 } catch (convError) {
                    this.logger.error('Failed to convert results.details back to Map', convError);
                    throw new ValidationError('Invalid format for results details in request body.');
                 }
            }


            // Generate Excel Report
            const reportBuffer = await this.reporter.generateReport(results);

            // Set Headers for Excel download
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `reconciliation-report-${timestamp}.xlsx`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

            // Send Buffer
            res.send(reportBuffer);
            this.logger.info(`Exported report ${filename}`);

        } catch (error) {
            this.logger.error('Error during report export handling.', error);
            next(error); // Pass error to the centralized error handler
        }
    };

    // Add handleGetStatus, handleGetResults methods here if implementing async processing later

}

// --- DI Registration ---
// Register the controller as a singleton
container.registerSingleton(ReconcileController);