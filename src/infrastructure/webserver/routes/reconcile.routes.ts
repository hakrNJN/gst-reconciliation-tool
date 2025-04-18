// src/infrastructure/webserver/routes/reconcile.routes.ts
import { Router } from 'express';
import { container } from 'tsyringe';
import { ReconcileController } from '../controllers/reconcile.controller';
import { uploadReconciliationFiles } from '../middleware/upload.middleware'; // Import upload middleware

const router = Router();

// Resolve the controller instance from the DI container
const reconcileController = container.resolve(ReconcileController);

// Define routes

// POST /api/reconcile - Upload files and start reconciliation
// Apply the upload middleware first
router.post(
    '/',
    uploadReconciliationFiles, // Middleware handles 'localData' and 'portalData' fields
    reconcileController.handleUploadAndReconcile // Controller method uses req.files
);

// POST /api/reconcile/export - Generate and download Excel report
// Expects results JSON in the request body (adjust if using job IDs later)
router.post(
    '/export',
    reconcileController.handleExport
);

// POST /api/reconcile/export - Generate and download Excel report
// Expects results JSON in the request body (adjust if using job IDs later)
router.post(
    '/persist',
    reconcileController.handlePersistResults
);

// Add routes for status/results retrieval if using async processing
// GET /api/reconcile/status/:jobId
// router.get('/status/:jobId', reconcileController.handleGetStatus);

// GET /api/reconcile/results/:jobId
// router.get('/results/:jobId', reconcileController.handleGetResults);


export default router; // Export the configured router