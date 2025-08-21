// src/core/reporting/report-generator.service.ts
import ExcelJS, { Row, Workbook, Worksheet } from 'exceljs';
import 'reflect-metadata';
import { inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import { LOGGER_TOKEN } from '../../infrastructure/logger';
import { AppError } from '../common/errors';
import {
    AmountSummary,
    InternalInvoiceRecord,
    ReconciliationMatch,
    ReconciliationResults,
    ReconciliationSummary
} from '../common/interfaces/models';
import { formatDateToDDMMYYYY } from '../common/utils';
import { IReportGeneratorService, ReportOptions, StorableReconciliationRecord } from './interfaces/services';

const DATE_FORMAT = 'dd-mm-yyyy';
const CURRENCY_FORMAT = '#,##0.00';
const REMARK_MATCHED_PERFECTLY = 'Matched Perfectly';
const REMARK_MATCHED_TOLERANCE = 'Matched (Tolerance)';
const REMARK_MISMATCHED_AMOUNT = 'Mismatched Amounts';
const REMARK_MISSING_IN_PORTAL = 'Missing in Portal (GSTR-2B)';
const REMARK_POTENTIAL_MATCH = 'Manually Matched';

@singleton()
@injectable()
export class ReportGeneratorService implements IReportGeneratorService {

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger
    ) {
        this.logger.info('ReportGeneratorService initialized.');
    }

    async generateReport(results: ReconciliationResults, options?: ReportOptions): Promise<Buffer> {
        this.logger.info('Generating reconciliation Excel report...');
        if (!(results.summary.reconciliationTimestamp instanceof Date)) {
            results.summary.reconciliationTimestamp = new Date(results.summary.reconciliationTimestamp);
        }
        try {
            const workbook = new ExcelJS.Workbook();
            this.setWorkbookProperties(workbook, results.summary.reconciliationTimestamp);
            this.createSummarySheet(workbook, results.summary);
            this.createConsolidatedLocalSheet(workbook, results.details);
            this.createPerfectlyMatchedSheet(workbook, results.details);
            this.createToleranceMatchedSheet(workbook, results.details);
            this.createPotentialMatchSheet(workbook, results.details);
            this.createMismatchedAmountSheet(workbook, results.details);
            this.createMissingInPortalSheet(workbook, results.details);
            this.createMissingInLocalSheet(workbook, results.details);
            this.createReverseChargeSheet(workbook, results.reverseChargeLiable);

            const buffer = await workbook.xlsx.writeBuffer();
            this.logger.info('Excel report generated successfully.');
            return buffer as unknown as Buffer;
        } catch (error: any) {
            this.logger.error('Failed to generate Excel report:', { message: error.message, stack: error.stack });
            if (error instanceof AppError) throw error;
            throw new AppError('ReportGenerationError', 'Failed to generate Excel report', 500, false);
        }
    }

    private setWorkbookProperties(workbook: Workbook, timestamp: Date | string): void {
        workbook.creator = 'GST Reconciliation Tool';
        const created = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
        workbook.created = created;
        workbook.modified = new Date();
    }

    private createSummarySheet(workbook: Workbook, summary: ReconciliationSummary): void {
        const sheet = workbook.addWorksheet('Summary');

        // Title
        const titleRow = sheet.addRow(['GST Reconciliation Summary']);
        titleRow.font = { bold: true, size: 16 };
        sheet.mergeCells('A1:K1');

        // Timestamp
        const timeRow = sheet.addRow(['Reconciliation Timestamp:', summary.reconciliationTimestamp]);
        timeRow.getCell(2).numFmt = DATE_FORMAT + ' hh:mm:ss';
        sheet.addRow([]); // Spacer

        // Main Headers
        const headerRow1 = sheet.addRow([
            '', 'Count', 'Book', '', '', '', 'Portal', '', '', ''
        ]);
        sheet.mergeCells('C4:F4');
        sheet.mergeCells('G4:J4');
        headerRow1.font = { bold: true, size: 12 };
        headerRow1.alignment = { horizontal: 'center' };

        // Sub Headers
        const headerRow2 = sheet.addRow([
            'Particulars', '', 'Taxable', 'IGST', 'CGST', 'SGST', 'Taxable', 'IGST', 'CGST', 'SGST'
        ]);
        headerRow2.font = { bold: true };

        // Helper to add a row for categories with Book and Portal values
        const addMatchCategoryRow = (label: string, data: any) => {
            const row = sheet.addRow([
                label, data.count,
                data.book.taxable, data.book.igst, data.book.cgst, data.book.sgst,
                data.portal.taxable, data.portal.igst, data.portal.cgst, data.portal.sgst
            ]);
            this.formatSummaryRow(row);
        };

        // Helper to add a row for categories with only one side of values
        const addSingleSidedRow = (label: string, data: any, side: 'book' | 'portal') => {
            const rowData = [label, data.count];
            if (side === 'book') {
                rowData.push(data.amounts.taxable, data.amounts.igst, data.amounts.cgst, data.amounts.sgst, '', '', '', '');
            } else { // portal
                rowData.push('', '', '', '', data.amounts.taxable, data.amounts.igst, data.amounts.cgst, data.amounts.sgst);
            }
            const row = sheet.addRow(rowData);
            this.formatSummaryRow(row);
        };

        // Populate Data Rows
        addSingleSidedRow('Total Purchase Records:', summary.totalLocal, 'book');
        addSingleSidedRow('Total Portal (GSTR-2B) Records:', summary.totalPortal, 'portal');
        sheet.addRow([]); // Spacer

        addMatchCategoryRow('Perfectly Matched Records:', summary.perfectlyMatched);
        addMatchCategoryRow('Matched within Tolerance:', summary.toleranceMatched);
        addMatchCategoryRow('Mismatch in Portal vs Book:', summary.mismatched);
        addMatchCategoryRow('Potential Matches Found:', summary.potentialMatches);
        addSingleSidedRow('Missing in Portal (GSTR-2B):', summary.missingInPortal, 'book');
        addSingleSidedRow('Missing in Local Books:', summary.missingInLocal, 'portal');
        addSingleSidedRow('RCM Entries:', summary.rcmEntries, 'portal');

        // Styling and Sizing
        sheet.columns.forEach(col => col.width = 15);
        sheet.getColumn('A').width = 35;
    }

    private formatSummaryRow(row: Row) {
        row.getCell(2).numFmt = '#,##0'; // Count
        for (let i = 3; i <= 10; i++) {
            const cell = row.getCell(i);
            if (cell.value !== '' && cell.value !== null) {
                 cell.numFmt = CURRENCY_FORMAT;
            }
        }
    }

    private createMatchedDetailsSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Matched Details');

        // Define headers (grouped)
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Match Status',
            // Local Data
            'Local Inv No', 'Local Date', 'Local Taxable Amt', 'Local Total Tax', 'Local Inv Value',
            // Portal Data
            'Portal Inv No', 'Portal Date', 'Portal Taxable Amt', 'Portal Total Tax', 'Portal Inv Value',
            // Differences / Tolerance
            'Taxable Diff', 'Tax Diff', 'Tolerance Notes'
        ];
        // const headerRow = sheet.addRow(headers);
        // headerRow.font = { bold: true };
        // sheet.views = [{ state: 'frozen', ySplit: 1 }]; // Freeze header row
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Add data rows
        details.forEach((supplierData, gstin) => {
            supplierData.matches.forEach(match => {
                const toleranceNotes = this.formatToleranceNotes(match);
                const row = sheet.addRow([
                    gstin,
                    supplierData.supplierName ?? '',
                    match.status,
                    // Local
                    match.localRecord.invoiceNumberRaw,
                    match.localRecord.date,
                    match.localRecord.taxableAmount,
                    match.localRecord.totalTax,
                    match.localRecord.invoiceValue,
                    // Portal
                    match.portalRecord.invoiceNumberRaw,
                    match.portalRecord.date,
                    match.portalRecord.taxableAmount,
                    match.portalRecord.totalTax,
                    match.portalRecord.invoiceValue,
                    // Differences
                    match.localRecord.taxableAmount - match.portalRecord.taxableAmount,
                    match.localRecord.totalTax - match.portalRecord.totalTax,
                    toleranceNotes
                ]);

                // Apply formatting
                this.formatDataRow(row, [5, 10], [6, 7, 8, 11, 12, 13, 14, 15]);
            });
        });

        this.autoFitColumns(sheet, headers);
    }

    private createPerfectlyMatchedSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Perfectly Matched');
        const headers = ['Supplier GSTIN', 'Supplier Name', 'Inv No', 'Date', 'Taxable Amt', 'IGST', 'CGST', 'SGST', 'Inv Value',
            'Source', 'Filing Date', 'Type', 'localVno', 'Document Type'];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        details.forEach((supplierData, gstin) => {
            supplierData.matches
                .filter(match => match.status === 'MatchedPerfectly')
                .forEach(match => {
                    // Use local or portal record - should be identical for perfectly matched
                    const record = match.localRecord;
                    const portal = match.portalRecord;
                    let parseDate = formatDateToDDMMYYYY(portal.supfileDate)
                    const row = sheet.addRow([
                        gstin, supplierData.supplierName ?? '', record.invoiceNumberRaw, record.date,
                        record.taxableAmount, record.igst, record.cgst, record.sgst, record.invoiceValue, portal.supSource, parseDate,
                        record.invType, record.vno, record.documentType
                    ]);
                    this.formatDataRow(row, [4], [5, 6, 7, 8]); // Date Col 4, Currency Cols 5,6,7,8
                });
        });
        this.autoFitColumns(sheet, headers);
    }

    private createToleranceMatchedSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Matched (Tolerance)');
        const headers = [
            'Supplier GSTIN', 'Supplier Name',
            'Local Inv No', 'Local Date', 'Local Taxable', 'Local IGST', 'Local CGST', 'Local SGST', 'Local Value',
            'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal IGST', 'Portal CGST', 'Portal SGST', 'Portal Value',
            'Taxable Diff', 'Tax Diff', 'Tolerance Notes', 'Type', 'localVno', 'Document Type'
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.matches
                .filter(match => match.status === 'MatchedWithTolerance')
                .forEach(match => {
                    const toleranceNotes = this.formatToleranceNotes(match);
                    const taxableDiff = match.localRecord.taxableAmount - match.portalRecord.taxableAmount;
                    const taxDiff = match.localRecord.totalTax - match.portalRecord.totalTax;

                    const row = sheet.addRow([
                        gstin, supplierData.supplierName ?? '',
                        match.localRecord.invoiceNumberRaw, match.localRecord.date, match.localRecord.taxableAmount, match.localRecord.igst, match.localRecord.cgst, match.localRecord.sgst, match.localRecord.invoiceValue,
                        match.portalRecord.invoiceNumberRaw, match.portalRecord.date, match.portalRecord.taxableAmount, match.portalRecord.igst, match.portalRecord.cgst, match.portalRecord.sgst, match.portalRecord.invoiceValue,
                        taxableDiff, taxDiff, toleranceNotes, match.localRecord.invType, match.localRecord.vno, match.localRecord.documentType
                    ]);
                    // Date cols 4, 10. Currency cols 5,6,7,8, 11,12,13,14, 15,16
                    this.formatDataRow(row, [4, 10], [5, 6, 7, 8, 11, 12, 13, 14, 15, 16]);
                });
        });
        this.autoFitColumns(sheet, headers);
    }

    private createMismatchedAmountSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Mismatched Amounts');
        const headers = [
            'Supplier GSTIN', 'Supplier Name',
            'Local Inv No', 'Local Date', 'Local Taxable', 'Local IGST', 'Local CGST', 'Local SGST', 'Local Value',
            'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal IGST', 'Portal CGST', 'Portal SGST', 'Portal Value',
            'Taxable Diff', 'Tax Diff', 'Type', 'localVno', 'Document Type'
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.mismatchedAmounts?.forEach(mismatch => {
                const taxableDiff = mismatch.localRecord.taxableAmount - mismatch.portalRecord.taxableAmount;
                const taxDiff = mismatch.localRecord.totalTax - mismatch.portalRecord.totalTax;
                const row = sheet.addRow([gstin, supplierData.supplierName ?? '',
                    mismatch.localRecord.invoiceNumberRaw, mismatch.localRecord.date, mismatch.localRecord.taxableAmount, mismatch.localRecord.igst, mismatch.localRecord.cgst, mismatch.localRecord.sgst, mismatch.localRecord.invoiceValue,
                    mismatch.portalRecord.invoiceNumberRaw, mismatch.portalRecord.date, mismatch.portalRecord.taxableAmount, mismatch.portalRecord.igst, mismatch.portalRecord.cgst, mismatch.portalRecord.sgst, mismatch.portalRecord.invoiceValue,
                    taxableDiff, taxDiff, mismatch.localRecord.invType, mismatch.localRecord.vno, mismatch.portalRecord.documentType
                ]);
                this.formatDataRow(row, [4, 10], [5, 6, 7, 8, 11, 12, 13, 14, 15, 16]);
            });
        });
        this.autoFitColumns(sheet, headers);
    }

    private createMissingInPortalSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Missing in Portal (GSTR-2B)');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Local Inv No', 'Local Date',
            'Local Taxable Amt', 'Local IGST', 'Local CGST', 'Local SGST', 'Local Inv Value', 'Type', 'localVno', 'Document Type'
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.missingInPortal.forEach(record => {
                const row = sheet.addRow([
                    gstin,
                    supplierData.supplierName ?? record.supplierName ?? '',
                    record.invoiceNumberRaw,
                    record.date,
                    record.taxableAmount,
                    record.igst,
                    record.cgst,
                    record.sgst,
                    record.invoiceValue,
                    record.invType,
                    record.vno,
                    record.documentType
                ]);
                // Apply formatting
                this.formatDataRow(row, [4], [5, 6, 7, 8]);
            });
        });

        this.autoFitColumns(sheet, headers);
    }

    private createMissingInLocalSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Missing in Book');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Portal Inv No', 'Portal Date',
            'Portal Taxable Amt', 'Portal IGST', 'Portal CGST', 'Portal SGST', 'Portal Inv Value', 'Document Type'
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];


        details.forEach((supplierData, gstin) => {
            supplierData.missingInLocal.forEach(record => {
                const row = sheet.addRow([
                    gstin,
                    supplierData.supplierName ?? record.supplierName ?? '',
                    record.invoiceNumberRaw,
                    record.date,
                    record.taxableAmount,
                    record.igst,
                    record.cgst,
                    record.sgst,
                    record.invoiceValue,
                    record.documentType
                ]);
                // Apply formatting
                this.formatDataRow(row, [4], [5, 6, 7, 8]);
            });
        });

        this.autoFitColumns(sheet, headers);
    }

    // *** ADD NEW SHEET FUNCTION ***
    private createPotentialMatchSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        const sheet = workbook.addWorksheet('Potential Matches');
        const headers = [
            'Supplier GSTIN', 'Supplier Name',
            'Local Inv No', 'Local Date', 'Local Taxable', 'Local IGST', 'Local CGST', 'Local SGST',
            'Portal Inv No', 'Portal Date', 'Portal Taxable', 'Portal IGST', 'Portal CGST', 'Portal SGST',
            'Similarity Method', 'Similarity Score', 'Type', 'localVno', 'Document Type'
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        details.forEach((supplierData, gstin) => {
            supplierData.potentialMatches?.forEach(potential => { // Iterate new array
                const row = sheet.addRow([
                    gstin, supplierData.supplierName ?? '',
                    potential.localRecord.invoiceNumberRaw, potential.localRecord.date, potential.localRecord.taxableAmount, potential.localRecord.igst, potential.localRecord.cgst, potential.localRecord.sgst,
                    potential.portalRecord.invoiceNumberRaw, potential.portalRecord.date, potential.portalRecord.taxableAmount, potential.portalRecord.igst, potential.portalRecord.cgst, potential.portalRecord.sgst,
                    potential.similarityMethod ?? '', // Show how match was found
                    potential.similarityScore ?? '',  // Show score (e.g., Levenshtein distance)
                    potential.localRecord.invType,
                    potential.localRecord.vno,
                    potential.localRecord.documentType
                ]);
                // Date cols 4, 9. Currency cols 5,6,7,8, 10,11,12,13. Score col 15 maybe general.
                this.formatDataRow(row, [4, 9], [5, 6, 7, 8, 10, 11, 12, 13]);
                // Format score as number if it's numeric
                if (typeof potential.similarityScore === 'number') { row.getCell(15).numFmt = '0'; }
            });
        });
        this.autoFitColumns(sheet, headers);
    }

    private createConsolidatedLocalSheet(workbook: Workbook, details: ReconciliationResults['details']): void {
        this.logger.debug('Creating consolidated local records sheet (ITC Register View)...');
        const sheet = workbook.addWorksheet('ITC Register');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Local Inv No', 'Local Date',
            'Local Taxable Amt', 'Local IGST', 'Local CGST', 'Local SGST', 'Local Inv Value',
            'Type', 'localVno', 'Document Type', 'Recon Remark' // <-- New Remark column
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        // Iterate through each supplier's details
        details.forEach((supplierData, gstin) => {
            const supplierName = supplierData.supplierName ?? ''; // Use empty string if undefined

            // Helper function to add a row consistently
            const addLocalRecordRow = (record: InternalInvoiceRecord, remark: string) => {
                if (!record) {
                    this.logger.warn(`Skipping row creation due to missing record data for GSTIN ${gstin} with remark ${remark}`);
                    return; // Avoid errors if a record is unexpectedly null/undefined
                }
                const row = sheet.addRow([
                    gstin,
                    supplierName, // Use consistent supplier name from supplierData
                    record.invoiceNumberRaw ?? '',
                    record.date, // Assumes date is valid Date object or null after sanitization
                    record.taxableAmount ?? 0, // Default to 0 if null/undefined
                    record.igst ?? 0,
                    record.cgst ?? 0,
                    record.sgst ?? 0,
                    record.invoiceValue ?? 0,
                    record.invType ?? '',
                    record.vno ?? '',
                    record.documentType ?? '',
                    remark // The calculated remark
                ]);
                // Apply formatting: Date Col 4, Currency Cols 5, 6, 7, 8
                this.formatDataRow(row, [4], [5, 6, 7, 8]);
            };

            // 1. Process Perfectly Matched Records
            supplierData.matches
                .filter(match => match.status === 'MatchedPerfectly')
                .forEach(match => addLocalRecordRow(match.localRecord, REMARK_MATCHED_PERFECTLY));

            // 2. Process Tolerance Matched Records
            supplierData.matches
                .filter(match => match.status === 'MatchedWithTolerance')
                .forEach(match => addLocalRecordRow(match.localRecord, REMARK_MATCHED_TOLERANCE));

            // 3. Process Mismatched Amount Records
            // Ensure mismatchedAmounts is an array before iterating
            (supplierData.mismatchedAmounts ?? []).forEach(mismatch => addLocalRecordRow(mismatch.localRecord, REMARK_MISMATCHED_AMOUNT));

            // 4. Process Potential Match Records
            // Ensure potentialMatches is an array before iterating
            (supplierData.potentialMatches ?? []).forEach(potential => addLocalRecordRow(potential.localRecord, REMARK_POTENTIAL_MATCH));

            // 5. Process Records Missing in Portal (These are local records)
            supplierData.missingInPortal.forEach(record => addLocalRecordRow(record, REMARK_MISSING_IN_PORTAL));

            // Note: supplierData.missingInLocal contains PORTAL records, so they are skipped here.
        });

        this.autoFitColumns(sheet, headers);
        this.logger.debug('Consolidated local records sheet created.');
    }

    /**
     * Prepares a structured list of matched (perfect/tolerance) and mismatched records
     * for database storage, extracting only the necessary fields.
     *
     * @param results - The complete reconciliation results.
     * @returns An array of StorableReconciliationRecord objects ready for persistence.
     * @throws {AppError} if the reconciliation timestamp is invalid.
     */
    public prepareDataForStorage(results: ReconciliationResults): StorableReconciliationRecord[] {
        this.logger.info('Preparing matched and mismatched records for database storage...');
        const storableRecords: StorableReconciliationRecord[] = [];

        // 1. Validate and get Reconciliation Date
        let reconciliationDate: Date;
        if (results.summary.reconciliationTimestamp instanceof Date && !isNaN(results.summary.reconciliationTimestamp.getTime())) {
            reconciliationDate = results.summary.reconciliationTimestamp;
        } else if (typeof results.summary.reconciliationTimestamp === 'string') {
            reconciliationDate = new Date(results.summary.reconciliationTimestamp);
            if (isNaN(reconciliationDate.getTime())) {
                this.logger.error('Invalid reconciliation timestamp string provided for storage preparation.');
                throw new AppError('InvalidInputError', 'Invalid reconciliation timestamp for storage preparation.', 400);
            }
        } else {
            this.logger.error('Missing or invalid reconciliation timestamp for storage preparation.');
            throw new AppError('InvalidInputError', 'Reconciliation timestamp is required for storage preparation.', 400);
        }

        // 2. Iterate through details
        results.details.forEach((supplierData, gstin) => {
            const supplierName = supplierData.supplierName;

            // --- Process Matched Records ---
            supplierData.matches?.forEach(match => {
                const local = match.localRecord;
                const portal = match.portalRecord;
                let remark: StorableReconciliationRecord['remark'];

                if (!local) {
                    this.logger.warn(`Skipping matched record for GSTIN ${gstin} due to missing localRecord data.`);
                    return; // Skip if essential local data is missing
                }


                if (match.status === 'MatchedPerfectly') {
                    remark = REMARK_MATCHED_PERFECTLY;
                } else if (match.status === 'MatchedWithTolerance') {
                    remark = REMARK_MATCHED_TOLERANCE;
                } else if (match.status === 'PotentialMatch') {
                    remark = REMARK_POTENTIAL_MATCH;
                } else {
                    // Should not happen based on filtering, but good practice to handle
                    this.logger.warn(`Unexpected match status "${match.status}" for GSTIN ${gstin}, Invoice ${local.invoiceNumberRaw}. Skipping storage.`);
                    return;
                }

                storableRecords.push({
                    supplierGstin: gstin,
                    supplierName: supplierName,
                    localInvoiceNumber: String(local.invoiceNumberRaw) ?? 'N/A', // Provide fallback
                    localDate: local.date, // Assumes date is Date object or null
                    localInvoiceValue: local.invoiceValue ?? 0,
                    localConum: Number(local.conum), // <-- The new field
                    localVno: local.vno,
                    localInvType: local.invType,
                    localDocType: local.documentType,
                    portalInvoiceNumber: String(portal?.invoiceNumberRaw), // Include portal info
                    portalDate: portal?.date,                     // Include portal info
                    remark: remark,
                    reconciliationDate: reconciliationDate,
                    // localRecordId: local.id // Optional: uncomment if needed
                });
            });

            // --- Process Mismatched Amount Records ---
            supplierData.mismatchedAmounts?.forEach(mismatch => {
                const local = mismatch.localRecord;
                const portal = mismatch.portalRecord; // Mismatches always have both

                if (!local || !portal) {
                    this.logger.warn(`Skipping mismatched record for GSTIN ${gstin} due to missing local or portal record data.`);
                    return; // Skip if essential data is missing
                }

                storableRecords.push({
                    supplierGstin: gstin,
                    supplierName: supplierName,
                    localInvoiceNumber: String(local.invoiceNumberRaw) ?? 'N/A',
                    localDate: local.date,
                    localInvoiceValue: local.invoiceValue ?? 0,
                    localConum: Number(local.conum), // <-- The new field
                    localVno: local.vno,
                    localInvType: local.invType,
                    localDocType: local.documentType, // Or decide if portal.documentType is more relevant here
                    portalInvoiceNumber: String(portal.invoiceNumberRaw), // Include portal info
                    portalDate: portal.date,                     // Include portal info
                    remark: REMARK_MISMATCHED_AMOUNT,
                    reconciliationDate: reconciliationDate,
                    // localRecordId: local.id // Optional: uncomment if needed
                });
            });

            // --- Process Potential Match Records ---
            supplierData.potentialMatches?.forEach(potential => {
                const local = potential.localRecord;
                const portal = potential.portalRecord;

                if (!local || !portal) {
                    this.logger.warn(`Skipping potential match for GSTIN ${gstin} due to missing local or portal record data.`);
                    return; // Skip if essential data is missing
                }

                storableRecords.push({
                    supplierGstin: gstin,
                    supplierName: supplierName,
                    localInvoiceNumber: String(local.invoiceNumberRaw) ?? 'N/A',
                    localDate: local.date,
                    localInvoiceValue: local.invoiceValue ?? 0,
                    localConum: Number(local.conum),
                    localVno: local.vno,
                    localInvType: local.invType,
                    localDocType: local.documentType,
                    portalInvoiceNumber: String(portal.invoiceNumberRaw),
                    portalDate: portal.date,
                    remark: REMARK_POTENTIAL_MATCH,
                    reconciliationDate: reconciliationDate,
                });
            });

            // Note: Missing records are NOT included in this specific output.
        });

        this.logger.info(`Prepared ${storableRecords.length} records for storage.`);
        return storableRecords;
    }
    // --- Helper Methods ---
    private styleHeaderRow(row: Row, headers: string[]): void {
        // Style each header cell based on the headers array length
        for (let i = 1; i <= headers.length; i++) {
            const cell = row.getCell(i);

            cell.font = {
                bold: true,
                color: { argb: 'FFFFFFFF' }  // White text (Background 1)
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

            // Add dark blue fill (Text 2)
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1F4E79' }  // Dark Blue, Text 2 color
            };

            // Optional: Add borders for a more defined look
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        }
    }

    /** Applies standard date and currency formats to cells in a row */
    private formatDataRow(row: Row, dateColIndices: number[], currencyColIndices: number[]): void {
        dateColIndices.forEach(idx => {
            row.getCell(idx).numFmt = DATE_FORMAT;
        });
        currencyColIndices.forEach(idx => {
            row.getCell(idx).numFmt = CURRENCY_FORMAT;
        });
    }

    /** Auto-fits column widths based on header and some sample data */
    private autoFitColumns(sheet: Worksheet, headers: string[]): void {
        sheet.columns.forEach((column, i) => {
            if (column) {
                let maxLength = headers[i]?.length ?? 10;
                const scanRowCount = 21;

                try {
                    // Type guard to ensure column has eachCell method
                    if (typeof column.eachCell === 'function') {
                        column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
                            if (rowNumber <= scanRowCount) {
                                const cellValue = cell.value;
                                let columnLength = 0;

                                // Special handling for date values
                                if (cellValue instanceof Date) {
                                    // Date format strings are typically ~10 chars (DD-MM-YYYY)
                                    columnLength = 10;
                                } else if (cellValue !== null && cellValue !== undefined) {
                                    columnLength = cellValue.toString().length;
                                }

                                if (columnLength > maxLength) {
                                    maxLength = columnLength;
                                }
                            }
                        });

                        // Set column widths based on content type
                        if (headers[i]?.toLowerCase().includes('date')) {
                            // Fixed width for date columns
                            column.width = 12;
                        } else {
                            column.width = Math.max(12, maxLength + 4);
                        }
                    } else {
                        this.logger.warn(`Column at index ${i} doesn't have expected eachCell method`);
                        // Fallback if eachCell is not available
                        if ('width' in column) {
                            column.width = Math.max(12, maxLength + 4);
                        }
                    }
                } catch (cellError) {
                    this.logger.error(`Error processing cells for column index ${i} during autoFit`, cellError);
                    // Fallback width if cell processing fails
                    if ('width' in column) {
                        column.width = Math.max(12, maxLength + 4);
                    }
                }
            } else {
                this.logger.warn(`Column at index ${i} was unexpectedly undefined during autoFit.`);
            }
        });
    }

    /** Formats tolerance details into a readable string */
    private formatToleranceNotes(match: ReconciliationMatch): string {
        const notes: string[] = [];
        if (match.toleranceDetails.taxableAmount) notes.push('Taxable Amt Diff');
        if (match.toleranceDetails.taxAmount) notes.push('Total Tax Diff');
        if (match.toleranceDetails.rawInvoiceNumberDiffers) notes.push('Inv No Differs');
        if (match.toleranceDetails.exactDateDiffers) notes.push('Date Differs');
        return notes.join('; ');
    }

    private createReverseChargeSheet(workbook: Workbook, reverseChargeInvoices: InternalInvoiceRecord[]): void {
        if (!reverseChargeInvoices || reverseChargeInvoices.length === 0) {
            this.logger.info('No reverse charge liable invoices to report. Skipping sheet creation.');
            return;
        }

        this.logger.info(`Creating 'RCM Entries' sheet with ${reverseChargeInvoices.length} records.`);
        const sheet = workbook.addWorksheet('RCM Entries');
        const headers = [
            'Supplier GSTIN', 'Supplier Name', 'Portal Inv No', 'Portal Date',
            'Portal Taxable Amt', 'Portal IGST', 'Portal CGST', 'Portal SGST', 'Portal Inv Value', 'Document Type'
        ];
        this.styleHeaderRow(sheet.addRow(headers), headers);
        sheet.views = [{ state: 'frozen', ySplit: 1 }];

        reverseChargeInvoices.forEach(record => {
            const row = sheet.addRow([
                record.supplierGstin,
                record.supplierName ?? '',
                record.invoiceNumberRaw,
                record.date,
                record.taxableAmount,
                record.igst,
                record.cgst,
                record.sgst,
                record.invoiceValue,
                record.documentType
            ]);
            // Apply formatting
            this.formatDataRow(row, [4], [5, 6, 7, 8]);
        });

        this.autoFitColumns(sheet, headers);
    }

}