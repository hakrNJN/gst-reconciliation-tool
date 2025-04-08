// src/core/parsing/interfaces/services.ts
import { InternalInvoiceRecord } from '../../common/interfaces/models';

/** Potential options for file parsing */
export interface FileParsingOptions {
    fileTypeHint?: 'excel' | 'json'; // Hint if file extension is missing/ambiguous
    sheetName?: string; // Specify sheet name for Excel
    headerRow?: number; // Specify header row index
    // Add other potential options
}

/** Defines the contract for the File Parser Service */
export interface IFileParserService {
    /**
     * Parses the content of a file buffer into standardized invoice records.
     * @param fileBuffer - The buffer containing the file content.
     * @param options - Optional configuration for parsing.
     * @returns A promise resolving to an array of InternalInvoiceRecord.
     * @throws {AppError} If parsing fails due to format issues or invalid data.
     */
    parseFile(
        fileBuffer: Buffer,
        options?: FileParsingOptions
    ): Promise<Partial<InternalInvoiceRecord>[]>; // Return partial as full validation happens later
}