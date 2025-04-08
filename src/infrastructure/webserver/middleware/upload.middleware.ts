// src/infrastructure/webserver/middleware/upload.middleware.ts
import { Request } from 'express';
import multer from 'multer';
import { FileParsingError } from '../../../core/common/errors';

// Configure multer for memory storage (good for processing then discarding)
const storage = multer.memoryStorage();

// Define file filter (optional - example allows excel and json)
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimes = [
        'application/vnd.ms-excel', // .xls
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/json',
        'text/csv' // Allow CSV as well potentially? Add if needed.
    ];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new FileParsingError(`Invalid file type: ${file.mimetype}. Only Excel (.xls, .xlsx) and JSON are allowed.`));
    }
};

// Configure multer instance
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 20 * 1024 * 1024, // 20 MB file size limit (adjust as needed)
    }
});

/**
 * Middleware to handle uploading the two reconciliation files.
 * Expects fields named 'localData' and 'portalData'.
 */
export const uploadReconciliationFiles = upload.fields([
    { name: 'localData', maxCount: 1 },
    { name: 'portalData', maxCount: 1 }
]);

// If you needed only a single file upload later, you could use:
// export const uploadSingleFile = upload.single('fieldName');